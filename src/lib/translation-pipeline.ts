/**
 * AX Pipeline — DSPy-like orchestration for text translation/transformation
 *
 * This pipeline implements the same DSPy-inspired patterns from the
 * atomic-graph-opencode project (the AX DSPy reference implementation),
 * ported word-to-word where possible while serving this repo's output
 * contract (TranslationResult with translatedText + qualityScore 0-100):
 *
 * - compileRefinePrompt: Like DSPy's Module.compile() — produces focused
 *   refinement prompts based on error history, not generic retries
 * - ErrorEntry tracking: Full error history for surgical, targeted fixes
 * - resumeFrom state machine: Deterministic pipeline progression
 * - Activity-style discrete steps: translate → validate → refine
 * - Stage-specific system prompts: Each stage has its own optimized prompt
 * - Stage-specific temperatures: translate=0.3, validate=0.1, refine=0.2
 * - Dynamic max_tokens: Calculated from input length (per stage)
 * - Echo detection: Detects when LLM echoes input unchanged (>80% overlap)
 * - Validation threshold: score >= 0.75 passes (atomic-graph default)
 * - Robust JSON parsing: parseLLMJson + truncation recovery for validate
 *
 * Pipeline flow:
 * 1. Translate/transform text (initial attempt)
 * 2. Validate quality (self-critique, 0.0-1.0 score)
 * 3. If validation fails (score < threshold), refine with compiled error
 *    context and re-validate (up to MAX_ITERATIONS)
 * 4. Return final translated text with metadata
 *
 * Fast mode (for Vercel Hobby / timeout constraints):
 * - Single translate call only, no validate/refine
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

import { callLLM, calculateMaxTokens, getStageTemperature, parseLLMJson, DEFAULT_MODEL } from './llm-client';

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

// ─── DSPy-style Error Tracking (from atomic-graph-opencode) ─────────────────

interface ErrorEntry {
  attempt: number;
  stage: 'translate' | 'validate' | 'refine';
  error: string;
  issues?: string[];
}

/** Validation result shape — ported word-to-word from atomic-graph-opencode's
 *  validate step: score is 0.0-1.0 with issues + suggestions lists. */
interface ValidationResult {
  score: number;
  issues: string[];
  suggestions: string[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Minimum validation score (0.0-1.0) required to accept the output.
 *  Ported from atomic-graph-opencode's default threshold (0.75). */
const VALIDATION_THRESHOLD = 0.75;

/** Maximum pipeline iterations (validate → refine loops).
 *  Ported from atomic-graph-opencode's default (3). */
const MAX_ITERATIONS = 3;

// ─── Stage-Specific System Prompts (from atomic-graph-opencode's axPipeline) ──
// Each stage has its own specialized system prompt that focuses the LLM on its
// specific task. This is the core of the AX DSPy pattern: structured prompting
// per stage. Prompt structure is ported word-to-word from the Bible repo's
// EXTRACT / EXTRACT_RETRY / VALIDATE / REFINE prompts, adapted to serve
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

// ─── VALIDATE — quality-aware self-critique (ported from atomic-graph) ───────
// Same structure word-to-word: weighted axes, exact JSON format, scoring
// bands, and the "Be FAIR" instruction.

const VALIDATE_SYSTEM_PROMPT = `You are a text quality reviewer. Evaluate the provided output and respond in JSON format.

Evaluate on these criteria (weight: semantic fidelity > instruction adherence > completeness > fluency > structure):
1. SEMANTIC FIDELITY: Does it preserve the writer's meaning? Minor wording changes don't lower score.
2. INSTRUCTION ADHERENCE: Does it follow the embedded transformation instructions and/or the target language requirement?
3. COMPLETENESS: Is any information missing or added?
4. FLUENCY: Is the text natural and well-formed?
5. STRUCTURAL INTEGRITY: Requested headings, bullet points, and sections present? Orphan fragments? Broken flow?

Respond in this exact JSON format:
{
  "score": 0.85,
  "issues": ["issue1", "issue2"],
  "suggestions": ["suggestion1"]
}

Scoring:
- 0.90-1.00: Faithful representation, minor wording differences only
- 0.75-0.89: Minor gaps
- 0.50-0.74: Significant gaps
- 0.00-0.49: Major problems

Be FAIR — clear input + good output = high score. Don't invent reasons to lower it.
Only list issues affecting MEANING or STRUCTURE.`;

// ─── REFINE — targeted fixes (ported from atomic-graph) ──────────────────────

const REFINE_SYSTEM_PROMPT = `You are a text refinement engine. Fix the identified issues while preserving what already works.
Output ONLY the corrected text, nothing else.

CRITICAL OUTPUT RULES:
- Output ONLY the corrected text. No markdown fences, no explanation, no meta-commentary.
- Preserve writer's wording where accurate — only fix SEMANTIC or STRUCTURAL problems.
- Missing bridge or connective? INFER and add it.
- Awkward or unnatural phrasing? Replace it with a natural, native-quality expression.
- Rambling or non-atomic passage? TIGHTEN it per the instructions.
- No speculative additions — never invent facts.
- Keep everything that already works — return the FULL corrected text with unchanged parts as-is.`;

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

// ─── compileRefinePrompt — pure function (DSPy-like) ─────────────────────────
// Like DSPy's Module.compile() — produces focused prompts based on error history.
// This is the ONLY place refinement prompt construction happens.
// Ported word-to-word from atomic-graph-opencode's compileRefinePrompt().

function compileRefinePrompt(
  issues: string[],
  errorHistory: ErrorEntry[],
  stage: 'translate' | 'validate' | 'refine'
): string {
  // No errors yet — this is initial context
  if (errorHistory.length === 0 && issues.length === 0) {
    return `Initial ${stage} request for text transformation`;
  }

  // Build surgical context from error history (Mode B: surgical fix)
  const latestError = errorHistory.length > 0
    ? errorHistory[errorHistory.length - 1]
    : null;
  const previousErrors = errorHistory.slice(0, -1).map(e =>
    `  Attempt ${e.attempt} | ${e.stage}: ${e.error.substring(0, 200)}`
  ).join('\n');

  const issueContext = issues.length > 0
    ? `\nValidation issues to fix:\n${issues.map(i => `  - ${i}`).join('\n')}`
    : '';

  const errorContext = latestError
    ? `\nLatest error (attempt ${latestError.attempt}, stage ${latestError.stage}): ${latestError.error.substring(0, 300)}\n${latestError.issues ? `Issues: ${latestError.issues.join(', ')}` : ''}`
    : '';

  const previousContext = previousErrors.length > 0
    ? `\nPrevious errors — do NOT repeat these patterns:\n${previousErrors}`
    : '';

  return `Refinement context for stage "${stage}":${issueContext}${errorContext}${previousContext}`;
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
  private errorHistory: ErrorEntry[] = [];

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
   * Wrap an async API call with rate-limit / transient error detection.
   * Records errors to errorHistory for DSPy-style compileRefinePrompt().
   * Ported word-to-word from atomic-graph-opencode's callWithRetryAwareness().
   */
  private async callWithRetryAwareness<T>(
    fn: () => Promise<T>,
    iteration: number,
    phaseLabel: string,
    stage: ErrorEntry['stage']
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);

      // Track error in history for DSPy-style compiled prompts
      this.errorHistory.push({
        attempt: iteration,
        stage,
        error: msg,
      });

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

  // ─── Step 2: VALIDATE — quality-aware self-critique ──────────────────────

  private async validate(
    input: TranslationRequest,
    translatedText: string
  ): Promise<ValidationResult> {
    const isSameLanguage = isSameLanguageMode(input);
    const taskLabel = isSameLanguage ? 'text transformation' : 'translation';

    // Truncate very long inputs for validation (Bible truncates notes at 3000)
    const textForValidation = input.text.length > 3000
      ? input.text.slice(0, 3000) + '\n… (input truncated)'
      : input.text;

    // User prompt ported word-to-word from atomic-graph-opencode's validate step
    const userPrompt = `Evaluate this ${taskLabel} for quality and semantic fidelity.

Axes (weight: semantic fidelity > instruction adherence > completeness > fluency > structure):
1. SEMANTIC FIDELITY: Does it preserve the writer's meaning? Minor wording changes don't lower score.
2. INSTRUCTION ADHERENCE: Does it follow the embedded transformation instructions and/or the target language requirement?
3. COMPLETENESS: Is any information missing or added?
4. FLUENCY: Is the text natural and well-formed?
5. STRUCTURAL INTEGRITY: Requested headings, bullet points, and sections present? Orphan fragments? Broken flow?

Scoring:
- 0.90-1.00: Faithful representation, minor wording differences only
- 0.75-0.89: Minor gaps
- 0.50-0.74: Significant gaps
- 0.00-0.49: Major problems

Be FAIR — clear input + good output = high score. Don't invent reasons to lower it.

ORIGINAL TEXT:
${textForValidation}

${isSameLanguage ? 'Transformed output' : `Translation (${input.targetLanguage})`}:
"""
${translatedText}
"""

Return JSON: { "score": 0.85, "issues": ["..."], "suggestions": ["..."] }
Only list issues affecting MEANING or STRUCTURE.`;

    // AX DSPy: VALIDATE stage uses lowest temperature for objective assessment
    const temperature = getStageTemperature('validate');
    const maxTokens = calculateMaxTokens('', 'validate'); // Returns 1024 for validate

    const raw = await callLLM(VALIDATE_SYSTEM_PROMPT, userPrompt, input.apiKey, input.model, maxTokens, temperature);

    // Robust JSON parsing (parseLLMJson + truncation recovery), then clamp
    // values exactly like atomic-graph-opencode's validate step.
    const result = parseLLMJson<Partial<ValidationResult>>(raw);

    return {
      score:
        typeof result.score === 'number'
          ? Math.min(1, Math.max(0, result.score))
          : 0,
      issues: Array.isArray(result.issues) ? result.issues : [],
      suggestions: Array.isArray(result.suggestions) ? result.suggestions : [],
    };
  }

  // ─── Step 3: REFINE — targeted fixes using DSPy-compiled prompt ──────────

  private async refine(
    input: TranslationRequest,
    translatedText: string,
    issues: string[]
  ): Promise<string> {
    const isSameLanguage = isSameLanguageMode(input);
    const taskLabel = isSameLanguage ? 'text transformation' : 'translation';
    const srcLabel = input.sourceLanguage === 'auto' ? 'detected' : input.sourceLanguage;

    // Compile DSPy-style refinement context from error history
    const fixContext = compileRefinePrompt(issues, this.errorHistory, 'refine');
    console.log(`[AX Pipeline] Refinement context: ${fixContext.substring(0, 200)}`);

    // User prompt ported word-to-word from atomic-graph-opencode's refine step,
    // with this repo's triple-quoted source/output blocks (serves output fidelity)
    const userPrompt = `Fix ONLY these specific issues in the ${taskLabel}.

Rules:
- Preserve writer's wording where accurate
- Only fix SEMANTIC or STRUCTURAL problems, not style
- Missing bridge? INFER and add it.
- Awkward phrasing? Replace with a natural, native-quality expression.
- Rambling passage? TIGHTEN it per the instructions.
- No speculative additions.
- Return the FULL corrected text. Keep unchanged parts as-is.
- ${fixContext}

Issues:
${issues.map((i) => `- ${i}`).join('\n')}

Source text (${srcLabel}):
"""
${input.text}
"""

Current ${isSameLanguage ? 'output' : `translation (${input.targetLanguage})`}:
"""
${translatedText}
"""`;

    // AX DSPy: REFINE stage uses slightly higher temperature for creative fixes
    const temperature = getStageTemperature('refine');
    const maxTokens = calculateMaxTokens(translatedText, 'refine', isSameLanguage);

    const result = await callLLM(REFINE_SYSTEM_PROMPT, userPrompt, input.apiKey, input.model, maxTokens, temperature);

    return cleanOutputText(result);
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

  // ─── Main Pipeline Runner (resumeFrom state machine) ─────────────────────
  // Ported word-to-word from atomic-graph-opencode's run():
  // deterministic pipeline progression with state tracking, results carried
  // FORWARD between stages (never re-computed), validate → refine loop with
  // a 0.75 threshold and up to MAX_ITERATIONS attempts.
  //
  // Flow: translate → validate → (if score < threshold) refine → validate → done

  async run(input: TranslationRequest): Promise<TranslationResult> {
    console.log(`[AX Pipeline] Full pipeline: src=${input.sourceLanguage}, target=${input.targetLanguage}, text length=${input.text.length}`);

    const threshold = VALIDATION_THRESHOLD;
    const iterations = MAX_ITERATIONS;
    let score = 0;
    let attempt = 0;
    let currentIssues: string[] = [];
    const pipeline: string[] = [];

    let translatedText = '';
    let model = input.model || DEFAULT_MODEL;

    // State machine: translate → validate → refine → done
    type PipelineStage = 'translate' | 'validate' | 'refine' | 'done';
    let resumeFrom: PipelineStage = 'translate';

    // ─── Stage 1: TRANSLATE (runs once, result carried forward) ──────────
    if (resumeFrom === 'translate') {
      attempt++;
      pipeline.push('translate');
      this.emit('translating', attempt, 0, false);

      try {
        const result = await this.callWithRetryAwareness(
          () => this.translateText(input, false),
          attempt,
          'Translate',
          'translate'
        );
        translatedText = result.translatedText;
        model = result.model;

        // Echo detection (from atomic-graph-opencode pattern) — cross-language only
        if (isEcho(input.text, translatedText) && !isSameLanguageMode(input)) {
          console.log('[AX Pipeline] Echo detected in translate — retrying with forceful prompt');
          pipeline.push('echo-detected');
          attempt++;
          pipeline.push('translate-retry');

          try {
            const retryResult = await this.callWithRetryAwareness(
              () => this.translateText(input, true),
              attempt,
              'Translate (echo retry)',
              'translate'
            );
            translatedText = retryResult.translatedText;

            // If still echoing after retry, note it but continue to validation
            if (isEcho(input.text, translatedText)) {
              console.log('[AX Pipeline] Echo persists after retry — validation will catch this');
              pipeline.push('echo-persist');
            }
          } catch {
            // Retry failed, use original result
          }
        }

        resumeFrom = 'validate';
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.errorHistory.push({ attempt, stage: 'translate', error: errorMsg });

        // Retry translation once (Bible run(): throw is caught by the
        // exported wrapper, but one in-run retry is attempted first)
        pipeline.push('translate-retry');
        attempt++;

        try {
          const result = await this.callWithRetryAwareness(
            () => this.translateText(input, true),
            attempt,
            'Translate (retry)',
            'translate'
          );
          translatedText = result.translatedText;
          model = result.model;
          resumeFrom = 'validate';
        } catch (err2: unknown) {
          const errorMsg2 = err2 instanceof Error ? err2.message : String(err2);
          this.errorHistory.push({ attempt, stage: 'translate', error: errorMsg2 });
          return {
            translatedText: '',
            qualityScore: 0,
            attempts: attempt,
            refinements: 0,
            issues: ['Translation failed after retry', errorMsg2],
            model,
            pipeline,
          };
        }
      }
    }

    // ─── Validate → Refine loop (carries result forward) ─────────────────
    // Ported word-to-word from atomic-graph-opencode's run() loop:
    //   while (attempt < iterations && score < threshold && resumeFrom !== 'done')

    while (attempt < iterations && score < threshold && resumeFrom !== 'done') {
      // ─── Stage 2: VALIDATE ─────────────────────────────────────────────
      if (resumeFrom === 'validate') {
        pipeline.push('validate');
        this.emit('validating', attempt, 0, false);

        try {
          const validation = await this.callWithRetryAwareness(
            () => this.validate(input, translatedText),
            attempt,
            'Validate',
            'validate'
          );
          score = validation.score;
          currentIssues = validation.issues;

          // Echo guard (this repo's behavior, serves output correctness):
          // if validation failed to catch a cross-language echo, force refine
          if (isEcho(input.text, translatedText) && !isSameLanguageMode(input)) {
            pipeline.push('echo-caught-by-validation');
            score = Math.min(score, 0.30);
            currentIssues = [...currentIssues, 'Output appears identical to source text — not actually translated'];
          }

          const passed = score >= threshold;
          this.emit('validating', attempt, score, passed, currentIssues);

          if (passed) {
            pipeline.push('validate-pass');
            resumeFrom = 'done';
          } else if (attempt < iterations) {
            pipeline.push('validate-fail');
            resumeFrom = 'refine';
          } else {
            resumeFrom = 'done';
          }
        } catch (validateError) {
          console.warn('[AX Pipeline] Validate failed, using default score');
          score = 0.7; // Bible default fallback score
          currentIssues = ['Validation step failed — using estimated score'];
          pipeline.push('validate-error');

          if (score >= threshold) {
            resumeFrom = 'done';
          } else if (attempt < iterations) {
            resumeFrom = 'refine';
          } else {
            resumeFrom = 'done';
          }
        }
      }

      // ─── Stage 3: REFINE (DSPy-compiled prompt) ────────────────────────
      if (resumeFrom === 'refine') {
        attempt++;
        pipeline.push(`refine-${attempt}`);
        this.emit('refining', attempt, score, false);

        try {
          translatedText = await this.callWithRetryAwareness(
            () => this.refine(input, translatedText, currentIssues),
            attempt,
            'Refine',
            'refine'
          );
          // After refine, loop back to validate (Bible pattern: revalidate)
          pipeline.push(`revalidate-${attempt}`);
          resumeFrom = 'validate';
        } catch (refineError) {
          console.warn('[AX Pipeline] Refine failed, keeping current result');
          const errorMsg = refineError instanceof Error ? refineError.message : String(refineError);
          this.errorHistory.push({ attempt, stage: 'refine', error: errorMsg, issues: currentIssues });
          // Keep current result, loop back to validate
          resumeFrom = 'validate';
          if (attempt >= iterations) {
            resumeFrom = 'done';
          }
        }
      }
    }

    this.emit('complete', attempt, score, score >= threshold);

    return {
      translatedText,
      qualityScore: Math.round(score * 100), // Boundary: Bible 0.0-1.0 → this repo's 0-100
      attempts: attempt,
      refinements: Math.max(0, attempt - 1),
      issues: currentIssues.length > 0 ? currentIssues : undefined,
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

/** Full pipeline: translate → validate → (refine → revalidate)* using the
 *  AX DSPy state machine with threshold 0.75 and up to 3 iterations. */
export async function runTranslationPipeline(input: TranslationRequest): Promise<TranslationResult> {
  const ax = new TranslationPipeline();
  return ax.run(input);
}
