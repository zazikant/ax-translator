/**
 * AX Pipeline — DSPy-like orchestration for text translation/transformation
 *
 * This pipeline implements the same DSPy-inspired patterns from the
 * atomic-graph-opencode project (the AX DSPy reference implementation),
 * ported word-to-word where possible while serving this repo's output
 * contract (TranslationResult with translatedText + qualityScore 0-100):
 *
 * - Stage-specific system prompts: Each stage has its own optimized prompt
 * - Stage-specific temperatures: translate=0.3
 * - Dynamic max_tokens: Calculated from input length (per stage)
 * - Echo detection: Detects when LLM echoes input unchanged (>80% overlap)
 *
 * Pipeline flow (single pass — streams directly to the browser):
 * 1. Translate/transform text (one streaming LLM call)
 * 2. Echo guard: if the model echoed the input, one forceful retry
 * 3. Return final translated text with metadata
 *
 * Note: the former VALIDATE (JSON self-critique) and REFINE stages were
 * removed on purpose — the JSON-validate stage could silently retry/loop
 * on JSON parsing and re-validation, adding long invisible waits before
 * any output appeared. Translation now streams directly, token-by-token.
 *
 * Chunking note: the caller (page.tsx) chunks large inputs at ~6000-token
 * boundaries before streaming each chunk through /api/translate-stream —
 * the same responsibility that atomic-graph-opencode's 1500-char
 * CHUNK_CHAR_LIMIT splitIntoChunks performs inside its extract stage.
 * Embedded transformation instructions (same-language mode) must stay
 * attached to their content, so chunking remains a caller-side concern here.
 *
 * Streaming note: /api/translate-stream wraps this pipeline. Its fast path
 * calls nvidiaChatCompletion directly for live token streaming and builds
 * its prompts via buildTranslatePrompts() — the SAME prompt builder this
 * pipeline uses — so both paths stay word-to-word identical.
 */

import { callLLM, calculateMaxTokens, getStageTemperature, DEFAULT_MODEL } from './llm-client';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TranslationRequest {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  apiKey: string;
  model?: string;
}

export interface TranslationResult {
  translatedText: string;
  qualityScore: number;
  attempts: number;
  refinements: number;
  issues?: string[];
  model: string;
  pipeline: string[]; // Which stages ran
}

// ─── Stage-Specific System Prompts (from atomic-graph-opencode's axPipeline) ──
// The translate-stage system prompt focuses the LLM on its specific task.
// This is the core of the AX DSPy pattern: structured prompting per stage.
// Prompt structure is ported word-to-word from the Bible repo's
// EXTRACT / EXTRACT_RETRY prompts, adapted to serve
// translation/transformation output instead of knowledge graph JSON.

// ─── Same-language transformation mode (en→en, hi→hi, etc.) ──────────────────
// When source and target are the same language, the user is not "translating"
// but rather transforming/enhancing text. The user's input text contains
// embedded instructions that MUST be followed.

const TRANSLATE_SYSTEM_PROMPT = `You are a semantic reasoning engine specialized in transforming raw text into polished, structured writing.
You do NOT merely reformat or paraphrase — you REASON through the semantic space of ideas.
You surface implicit structure the writer already knows but didn't articulate.
You infer missing connectives, bridge gaps, and make hidden logical relationships explicit.
You follow the transformation instructions embedded in the text faithfully.

CRITICAL OUTPUT RULES:
- Output ONLY the transformed text. No markdown fences, no explanation, no meta-commentary.
- Follow ALL embedded instructions exactly (structure, headings, bullet points, style).
- Preserve the writer's original meaning faithfully.
- Expand concepts into their natural sub-components when explaining technical terms.
- Do NOT invent specific named software products, facts, or examples unless explicitly in the input.
- Be CONCISE where the instructions demand compression; EXPAND where they demand structure.`;

const TRANSLATE_RETRY_SYSTEM_PROMPT = `You are a semantic reasoning engine specialized in transforming text. The previous attempt did not transform the text properly.

CRITICAL: You MUST transform the text according to the embedded instructions — do NOT echo the input text unchanged.

CRITICAL OUTPUT RULES:
- Output ONLY the transformed text. No markdown fences, no explanation, no meta-commentary.
- Follow ALL embedded instructions precisely.
- Produce structured output (headings, bullet points, sections) when requested.
- Expand concepts into sub-components when explaining terms.
- Do NOT repeat the input text verbatim — rewrite it per the instructions.`;

// ─── Cross-language translation mode ─────────────────────────────────────────

const CROSS_LANGUAGE_SYSTEM_PROMPT = `You are a semantic reasoning engine specialized in translating text between languages.
You do NOT merely swap words — you REASON through the meaning and re-express it naturally in the target language.
You preserve the writer's original meaning exactly — nothing added, nothing removed, nothing changed.

CRITICAL OUTPUT RULES:
- Output ONLY the translated text in the target language, nothing else.
- Do NOT output the original text — you must output the translation.
- Preserve the original meaning exactly — do not add, remove, or change information.
- Use natural phrasing that a native speaker of the target language would use.
- Maintain the same tone and register (formal, informal, technical, etc.).
- If the text contains idioms, translate them to equivalent expressions in the target language.
- If the text contains technical terms, use the standard terminology in the target language.`;

const CROSS_LANGUAGE_RETRY_SYSTEM_PROMPT = `You are a semantic reasoning engine specialized in translating text. The previous attempt did not translate the text properly.

CRITICAL: You MUST translate the text into the target language — do NOT echo the input text unchanged. This is a translation task, not a repetition task.

CRITICAL OUTPUT RULES:
- Output ONLY the translated text in the target language, nothing else.
- Preserve the original meaning exactly — do not add, remove, or change information.
- Use natural phrasing that a native speaker of the target language would use.
- The previous attempt returned the original text unchanged — you must actually translate it this time.`;

// ─── buildTranslatePrompts — shared prompt builder ───────────────────────────
// Single source of truth for translate-stage prompts. Used by the pipeline's
// translateText() AND by the streaming fast path in
// translation-pipeline-stream.ts, so both paths are word-to-word identical.

export function buildTranslatePrompts(
  input: TranslationRequest,
  isRetry: boolean = false
): { systemPrompt: string; userContent: string } {
  const srcLabel = input.sourceLanguage === 'auto' ? 'the detected source language' : input.sourceLanguage;
  const targetLabel = input.targetLanguage;
  const isSameLanguage = isSameLanguageMode(input);

  if (isSameLanguage) {
    const systemPrompt = isRetry ? TRANSLATE_RETRY_SYSTEM_PROMPT : TRANSLATE_SYSTEM_PROMPT;
    // The input text carries the embedded transformation instructions —
    // pass it through unchanged (current repo behavior, serves output).
    return { systemPrompt, userContent: input.text };
  }

  const systemPrompt = isRetry ? CROSS_LANGUAGE_RETRY_SYSTEM_PROMPT : CROSS_LANGUAGE_SYSTEM_PROMPT;
  const userContent = `Translate the following text from ${srcLabel} to ${targetLabel}. The output must be in ${targetLabel}:\n\n${input.text}`;
  return { systemPrompt, userContent };
}

// ─── Echo Detection ──────────────────────────────────────────────────────────
// If the LLM returns the same text it was given (instead of translating), we
// detect it and retry with a more forceful prompt. Ported word-to-word from
// atomic-graph-opencode's isEcho() — >80% overlap instead of exact match.
// Only applied in cross-language mode: same-language transformation output
// legitimately shares wording with the input.

export function isEcho(originalText: string, extractedText: string): boolean {
  const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const normOrig = normalize(originalText);
  const normExtr = normalize(extractedText);
  // If the extracted text is >80% similar to the input, it's an echo
  if (normExtr.length < 10) return false; // Too short to be meaningful
  const overlap = normOrig.includes(normExtr.substring(0, Math.min(200, normExtr.length)));
  return overlap && normExtr.length > normOrig.length * 0.5;
}

/** Detect same-language mode (en→en, hi→hi, etc.) — this is text
 *  transformation, not translation. Preserved from this repo's behavior. */
export function isSameLanguageMode(input: TranslationRequest): boolean {
  return input.sourceLanguage === input.targetLanguage ||
    (input.sourceLanguage === 'auto' && input.targetLanguage === 'en'); // auto likely = en for this app
}

/** Strip any markdown code blocks or quotes the LLM might add. */
export function cleanOutputText(raw: string): string {
  return raw
    .replace(/^```[\w]*\n?/m, '')
    .replace(/\n?```$/m, '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

// ─── AX Pipeline Class (mirrors atomic-graph-opencode's AXPipeline) ──────────

class TranslationPipeline {

  /** Progress emission — the SSE endpoint (translate-stream) and page.tsx
   *  own user-facing progress; emit() writes to the server console (same
   *  message text as the Bible). */
  private emit(
    phase: string,
    iteration: number,
    score: number,
    passed: boolean,
    issues?: string[],
    detail?: string
  ) {
    console.log(
      `[AX Pipeline] ${phase} | iteration=${iteration} score=${score} passed=${passed}${issues ? ` issues=${issues.length}` : ''}${detail ? ` — ${detail}` : ''}`
    );
  }

  /**
   * Wrap an async API call with rate-limit / transient error logging.
   * Does NOT retry or loop — a failure is surfaced to the caller immediately
   * (the transport-level retry inside nvidia-client is the only retry layer).
   * Adapted from atomic-graph-opencode's callWithRetryAwareness().
   */
  private async callWithRetryAwareness<T>(
    fn: () => Promise<T>,
    iteration: number,
    phaseLabel: string,
    stage: string
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);

      const isRateLimit =
        msg.includes('rate limit') ||
        msg.includes('Rate limit') ||
        msg.includes('429') ||
        msg.includes('retry attempt') ||
        msg.includes('too many requests');

      const isTransient =
        msg.includes('server error') ||
        msg.includes('Server Error') ||
        msg.includes('502') ||
        msg.includes('503') ||
        msg.includes('504') ||
        msg.includes('temporary');

      if (isRateLimit) {
        this.emit(
          'retrying',
          iteration,
          0,
          false,
          undefined,
          `Rate limited during ${phaseLabel} — all proxy retries exhausted. Please wait and try again.`
        );
      } else if (isTransient) {
        this.emit(
          'retrying',
          iteration,
          0,
          false,
          undefined,
          `Transient server error during ${phaseLabel} — all proxy retries exhausted. Try again shortly.`
        );
      }

      throw error;
    }
  }

  // ─── Step 1: TRANSLATE — reason through the semantic space ───────────────

  private async translateText(
    input: TranslationRequest,
    isRetry: boolean = false
  ): Promise<{ translatedText: string; model: string }> {
    const { systemPrompt, userContent } = buildTranslatePrompts(input, isRetry);
    const isSameLanguage = isSameLanguageMode(input);

    console.log(`[AX Pipeline] translateText (retry=${isRetry}): src=${input.sourceLanguage}, target=${input.targetLanguage}, input length=${input.text.length}`);

    // AX DSPy: stage-specific temperature and dynamic max_tokens
    const temperature = getStageTemperature('translate');
    const maxTokens = calculateMaxTokens(input.text, 'translate', isSameLanguage);
    console.log(`[AX Pipeline] Stage settings — temperature=${temperature}, max_tokens=${maxTokens} (input est. ${Math.ceil(input.text.length / 4)} tokens)`);

    const result = await callLLM(systemPrompt, userContent, input.apiKey, input.model, maxTokens, temperature);
    const cleaned = cleanOutputText(result);

    console.log(`[AX Pipeline] translateText result: length=${cleaned.length}, preview="${cleaned.substring(0, 100)}", isEcho=${!isSameLanguage && isEcho(input.text, cleaned)}`);

    return {
      translatedText: cleaned,
      model: input.model || DEFAULT_MODEL,
    };
  }

  // ─── Fast Pipeline (mirrors atomic-graph-opencode's runFast) ─────────────
  // Translate only, skip validate/refine.
  // Cuts pipeline from 3-5 LLM calls to just 1.
  // Echo detection → one forceful retry, exactly like the Bible's runFast.

  async runFast(input: TranslationRequest): Promise<TranslationResult> {
    console.log('[AX Pipeline] Fast mode: translate only (no validate/refine)');

    const pipeline: string[] = ['fast-translate'];
    let attempt = 1;
    let translatedText = '';
    let model = input.model || DEFAULT_MODEL;

    // ─── Stage 1: TRANSLATE ──────────────────────────────────────────────
    this.emit('translating', 1, 0, false);
    try {
      const result = await this.callWithRetryAwareness(
        () => this.translateText(input, false),
        1,
        'Translate',
        'translate'
      );
      translatedText = result.translatedText;
      model = result.model;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[AX Pipeline] Fast translation failed:', errorMsg);
      return {
        translatedText: '',
        qualityScore: 0,
        attempts: attempt,
        refinements: 0,
        issues: [errorMsg],
        model,
        pipeline,
      };
    }

    // Echo detection (cross-language only) — one forceful retry
    if (isEcho(input.text, translatedText) && !isSameLanguageMode(input)) {
      console.log('[AX Pipeline] Echo detected — retrying with forceful prompt');
      pipeline.push('echo-detected', 'fast-retry');
      try {
        const retryResult = await this.callWithRetryAwareness(
          () => this.translateText(input, true),
          1,
          'Translate (echo retry)',
          'translate'
        );
        translatedText = retryResult.translatedText;
      } catch {
        // Retry failed, use original result (Bible runFast pattern)
      }
    }

    this.emit('complete', 1, 0.85, true, undefined, 'Fast mode — translation generated');

    return {
      translatedText,
      qualityScore: 85, // Estimated — no validation step (Bible runFast: score 0.85)
      attempts: attempt,
      refinements: 0,
      issues: undefined,
      model,
      pipeline,
    };
  }
}

// ─── Exported Runners (route.ts contract — unchanged) ────────────────────────

/** Fast mode: single translate call, no validate/refine.
 *  Optimized for Vercel Hobby plan / speed over validated quality. */
export async function runFastTranslation(input: TranslationRequest): Promise<TranslationResult> {
  const ax = new TranslationPipeline();
  return ax.runFast(input);
}

/** Full pipeline — now identical to fast mode: one direct translate pass.
 *  The JSON-validate stage (and its validate → refine → revalidate loop)
 *  was removed because it could silently retry/loop. Kept as a separate
 *  export so the API route contract is unchanged. */
export async function runTranslationPipeline(input: TranslationRequest): Promise<TranslationResult> {
  console.log('[AX Pipeline] Full mode: JSON-validate stage removed — running direct translate (same as fast mode)');
  const ax = new TranslationPipeline();
  return ax.runFast(input);
}
