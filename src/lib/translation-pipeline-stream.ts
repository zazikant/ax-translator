/**
 * Streaming translation pipeline wrapper.
 *
 * Wraps the AX DSPy pipeline (translation-pipeline.ts, ported from
 * atomic-graph-opencode) but emits structured step events via a callback so
 * a caller (e.g. an SSE endpoint) can stream progress to the browser.
 *
 * Event types:
 *   { type: 'stage-start',  stage, ts }
 *   { type: 'log',          line, ts }      // raw [nvidia] log lines
 *   { type: 'chunk',        text, ts }      // live tokens for current stage
 *   { type: 'stage-end',    stage, elapsedMs, ok, summary, ts }
 *   { type: 'pipeline-end', result, ts }
 *   { type: 'error',        message, ts }
 *
 * The fast path calls nvidiaChatCompletion directly for live token
 * streaming, but builds its prompts via buildTranslatePrompts() — the SAME
 * builder the non-streaming AX pipeline uses — and applies the Bible's
 * runFast echo detection (one forceful retry with the anti-echo prompt).
 * Each LLM call is a "controlled call": 120s timeout, retry, structured logs.
 */

import { nvidiaChatCompletion, DEFAULT_MODEL } from './nvidia-client';
import { calculateMaxTokens } from './llm-client';
import {
  TranslationRequest,
  TranslationResult,
  runTranslationPipeline,
  runFastTranslation,
  buildTranslatePrompts,
  isEcho,
  isSameLanguageMode,
  cleanOutputText,
} from './translation-pipeline';

export type PipelineEvent =
  | { type: 'stage-start'; stage: string; ts: number }
  | { type: 'log'; line: string; ts: number }
  | { type: 'chunk'; text: string; ts: number }
  | { type: 'stage-end'; stage: string; elapsedMs: number; ok: boolean; summary: string; ts: number }
  | { type: 'pipeline-end'; result: TranslationResult; ts: number }
  | { type: 'error'; message: string; ts: number };

export type EmitFn = (event: PipelineEvent) => void;

/**
 * Streaming fast translation: a single controlled NVIDIA call (plus an echo
 * retry when needed), using the AX pipeline's prompts verbatim.
 * Emits stage-start → chunks → stage-end → pipeline-end.
 */
export async function runFastTranslationStream(
  input: TranslationRequest,
  emit: EmitFn,
): Promise<TranslationResult> {
  const t0 = Date.now();
  emit({ type: 'stage-start', stage: 'translate', ts: t0 });

  // Build the SAME prompts the AX pipeline uses (buildTranslatePrompts is
  // the single source of truth — ported from atomic-graph-opencode).
  const { systemPrompt, userContent } = buildTranslatePrompts(input, false);

  // AX DSPy: stage-specific temperature (0.3) and dynamic max_tokens
  // (calculateMaxTokens from llm-client, ported from atomic-graph-opencode).
  // Values above gpt-oss-20b's 4096-token per-call cap are handled by the
  // auto-continue loop in nvidiaChatCompletion.
  const isSameLanguage = isSameLanguageMode(input);
  const maxTokens = calculateMaxTokens(input.text, 'translate', isSameLanguage);
  emit({
    type: 'log',
    line: `[ax-pipeline] stage settings — temperature=0.3, max_tokens=${maxTokens} (${isSameLanguage ? 'same-language transformation' : 'cross-language translation'})`,
    ts: Date.now(),
  });

  let translatedText = '';
  let model = input.model || DEFAULT_MODEL;
  const pipeline: string[] = ['fast-translate'];

  // Shared inner call so the echo retry reuses the exact same streaming path.
  const streamTranslate = async (isRetry: boolean): Promise<{ attempts: number; continuations: number; truncated: boolean }> => {
    const prompts = isRetry ? buildTranslatePrompts(input, true) : { systemPrompt, userContent };
    const result = await nvidiaChatCompletion({
      model: input.model,
      messages: [
        { role: 'system', content: prompts.systemPrompt },
        { role: 'user', content: prompts.userContent },
      ],
      maxTokens,
      temperature: 0.3, // getStageTemperature('translate')
      apiKey: input.apiKey,
      onLog: (line) => emit({ type: 'log', line, ts: Date.now() }),
      onChunk: (text) => {
        translatedText += text;
        emit({ type: 'chunk', text, ts: Date.now() });
      },
    });
    return { attempts: result.attempts, continuations: result.continuations, truncated: result.truncated };
  };

  try {
    const meta = await streamTranslate(false);
    model = input.model || DEFAULT_MODEL;

    // Strip markdown/quotes (same as the AX pipeline's cleanOutputText).
    // onChunk already streamed the raw text; the cleaned text is what the
    // pipeline-end result carries.
    let cleaned = cleanOutputText(translatedText);

    emit({
      type: 'stage-end',
      stage: 'translate',
      elapsedMs: Date.now() - t0,
      ok: true,
      summary: `${cleaned.length} chars, ${meta.attempts} attempt(s)${meta.continuations > 0 ? `, ${meta.continuations} continuation(s)` : ''}${meta.truncated ? ' [TRUNCATED]' : ''}`,
      ts: Date.now(),
    });

    // ─── Echo detection (Bible runFast pattern — cross-language only) ────
    if (isEcho(input.text, cleaned) && !isSameLanguage) {
      emit({ type: 'log', line: '[ax-pipeline] Echo detected — retrying with forceful prompt', ts: Date.now() });
      pipeline.push('echo-detected', 'fast-retry');
      emit({ type: 'stage-start', stage: 'echo-retry', ts: Date.now() });

      const t1 = Date.now();
      translatedText = '';
      try {
        const retryMeta = await streamTranslate(true);
        cleaned = cleanOutputText(translatedText);
        emit({
          type: 'stage-end',
          stage: 'echo-retry',
          elapsedMs: Date.now() - t1,
          ok: true,
          summary: `${cleaned.length} chars, ${retryMeta.attempts} attempt(s)`,
          ts: Date.now(),
        });
      } catch {
        // Retry failed, use original result (Bible runFast pattern)
        emit({
          type: 'stage-end',
          stage: 'echo-retry',
          elapsedMs: Date.now() - t1,
          ok: false,
          summary: 'echo retry failed — using original result',
          ts: Date.now(),
        });
      }
    }

    const out: TranslationResult = {
      translatedText: cleaned,
      qualityScore: 85, // Estimated — no validation step (Bible runFast: score 0.85)
      attempts: 1,
      refinements: 0,
      issues: undefined,
      model,
      pipeline,
    };
    emit({ type: 'pipeline-end', result: out, ts: Date.now() });
    return out;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    emit({
      type: 'stage-end',
      stage: 'translate',
      elapsedMs: Date.now() - t0,
      ok: false,
      summary: msg,
      ts: Date.now(),
    });
    emit({ type: 'error', message: msg, ts: Date.now() });
    const out: TranslationResult = {
      translatedText: '',
      qualityScore: 0,
      attempts: 1,
      refinements: 0,
      issues: [msg],
      model,
      pipeline,
    };
    emit({ type: 'pipeline-end', result: out, ts: Date.now() });
    return out;
  }
}

/**
 * Streaming full pipeline: translate → validate → refine.
 *
 * For simplicity, this still uses the underlying runTranslationPipeline
 * (which doesn't stream chunks), but emits stage-start/stage-end events
 * for each step so the browser sees progress.
 *
 * To get live token streaming for ALL stages (not just translate), we'd
 * need to refactor the AX pipeline to use nvidiaChatCompletion directly.
 * For now, fast mode gives live chunks; full mode gives step visibility
 * without per-token streaming.
 */
export async function runTranslationPipelineStream(
  input: TranslationRequest,
  emit: EmitFn,
): Promise<TranslationResult> {
  emit({ type: 'stage-start', stage: 'full-pipeline', ts: Date.now() });
  emit({ type: 'log', line: '[ax-pipeline] full mode: translate → validate → refine (AX DSPy, threshold 0.75)', ts: Date.now() });

  const t0 = Date.now();
  try {
    const result = await runTranslationPipeline(input);
    emit({
      type: 'stage-end',
      stage: 'full-pipeline',
      elapsedMs: Date.now() - t0,
      ok: !!result.translatedText,
      summary: `stages=[${result.pipeline.join(',')}] quality=${result.qualityScore} refinements=${result.refinements}`,
      ts: Date.now(),
    });
    emit({ type: 'pipeline-end', result, ts: Date.now() });
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    emit({ type: 'error', message: msg, ts: Date.now() });
    throw err;
  }
}
