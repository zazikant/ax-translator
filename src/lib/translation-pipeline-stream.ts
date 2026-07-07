/**
 * Streaming translation pipeline wrapper.
 *
 * Wraps the existing runTranslationPipeline / runFastTranslation but emits
 * structured step events via a callback so a caller (e.g. an SSE endpoint)
 * can stream progress to the browser.
 *
 * Event types:
 *   { type: 'stage-start',  stage, ts }
 *   { type: 'log',          line, ts }      // raw [nvidia] log lines
 *   { type: 'chunk',        text, ts }      // live tokens for current stage
 *   { type: 'stage-end',    stage, elapsedMs, ok, summary, ts }
 *   { type: 'pipeline-end', result, ts }
 *   { type: 'error',        message, ts }
 *
 * Each LLM call is a "controlled call": 10s timeout, 1 retry, structured logs.
 */

import { callNvidiaLLM, DEFAULT_MODEL, nvidiaChatCompletion } from './nvidia-client';
import {
  TranslationRequest,
  TranslationResult,
  runTranslationPipeline,
  runFastTranslation,
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
 * Streaming fast translation: a single controlled NVIDIA call to gpt-oss-120b.
 * Emits stage-start → chunks → stage-end → pipeline-end.
 */
export async function runFastTranslationStream(
  input: TranslationRequest,
  emit: EmitFn,
): Promise<TranslationResult> {
  const t0 = Date.now();
  emit({ type: 'stage-start', stage: 'translate', ts: t0 });

  // Build the same prompts the pipeline uses, but call directly so we can
  // stream chunks.
  const srcLabel = input.sourceLanguage === 'auto' ? 'the detected source language' : input.sourceLanguage;
  const targetLabel = input.targetLanguage;
  const systemPrompt = `You are a professional translator. Translate the given text from ${srcLabel} to ${targetLabel}.

Rules:
- Produce a clean, natural, and understandable translation
- Preserve the original meaning exactly — do not add, remove, or change information
- Use natural phrasing that a native speaker would use
- Maintain the same tone and register (formal, informal, technical, etc.)
- If the text contains idioms, translate them to equivalent expressions in the target language
- If the text contains technical terms, use the standard terminology in the target language
- Output ONLY the translated text in ${targetLabel}, nothing else
- Do NOT output the original text — you must output the translation`;

  const userContent = `Translate the following text from ${srcLabel} to ${targetLabel}. The output must be in ${targetLabel}:\n\n${input.text}`;

  // Estimate max_tokens the same way as the pipeline
  const cjkChars = (input.text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []).length;
  const otherChars = input.text.length - cjkChars;
  const inputTokens = Math.ceil(cjkChars / 2 + otherChars / 4);
  const maxTokens = Math.max(2048, Math.min(16384, Math.ceil(inputTokens * 1.5)));

  let translatedText = '';
  let model = input.model || DEFAULT_MODEL;
  const pipeline: string[] = ['fast-translate'];

  try {
    const result = await nvidiaChatCompletion({
      model: input.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      maxTokens,
      temperature: 0.3,
      apiKey: input.apiKey,
      onLog: (line) => emit({ type: 'log', line, ts: Date.now() }),
      onChunk: (text) => {
        translatedText += text;
        emit({ type: 'chunk', text, ts: Date.now() });
      },
    });
    model = result.model;

    // Strip markdown/quotes (same as pipeline)
    const cleaned = translatedText
      .replace(/^```[\w]*\n?/m, '')
      .replace(/\n?```$/m, '')
      .replace(/^["']|["']$/g, '')
      .trim();

    emit({
      type: 'stage-end',
      stage: 'translate',
      elapsedMs: Date.now() - t0,
      ok: true,
      summary: `${cleaned.length} chars, ${result.attempts} attempt(s)`,
      ts: Date.now(),
    });

    const out: TranslationResult = {
      translatedText: cleaned,
      qualityScore: 85,
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
 * need to refactor translation-pipeline.ts to use nvidiaChatCompletion
 * directly. For now, fast mode gives live chunks; full mode gives step
 * visibility without per-token streaming.
 */
export async function runTranslationPipelineStream(
  input: TranslationRequest,
  emit: EmitFn,
): Promise<TranslationResult> {
  emit({ type: 'stage-start', stage: 'full-pipeline', ts: Date.now() });
  emit({ type: 'log', line: '[pipeline] full mode: translate → validate → refine', ts: Date.now() });

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
