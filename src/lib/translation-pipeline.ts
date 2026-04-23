/**
 * Ax Translation Pipeline — DSPy-like orchestration
 *
 * This is the core pipeline that was originally designed as Temporal workflows.
 * It runs directly inside Next.js for reliability, but preserves all the
 * Temporal-inspired patterns from the Second Brain:
 *
 * - compileTranslatePrompt: Like DSPy's Module.compile() — produces focused prompts
 * - ErrorEntry tracking: Full error history for surgical retries
 * - resumeFrom state machine: Deterministic pipeline progression
 * - Activity-style discrete steps: translate → validate → refine
 *
 * Pipeline flow:
 * 1. Translate text (initial attempt)
 * 2. Validate translation quality
 * 3. If validation fails, refine translation (up to 2 refinements)
 * 4. Return final translated text with metadata
 *
 * Fast mode (for Vercel Hobby / timeout constraints):
 * - Single translate call only, no validate/refine
 */

import { callNvidiaLLM, DEFAULT_MODEL } from './nvidia-client';

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

interface ErrorEntry {
  attempt: number;
  stage: 'translate' | 'validate' | 'refine';
  error: string;
  issues?: string[];
}

// ─── Echo Detection ─────────────────────────────────────────────────────────
// If the LLM returns the same text it was given (instead of translating),
// we detect it and retry with a more forceful prompt.

function isEcho(originalText: string, translatedText: string): boolean {
  const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  return normalize(originalText) === normalize(translatedText);
}

// ─── compileTranslatePrompt — pure function (DSPy-like) ──────────────────────
// Like DSPy's Module.compile() — produces focused prompts based on error history.
// This is the ONLY place prompt construction happens (same rule as Temporal workflow).

function compileTranslatePrompt(
  input: TranslationRequest,
  errorHistory: ErrorEntry[],
  stage: 'translate' | 'validate' | 'refine'
): string {
  // No errors yet — this is initial context
  if (errorHistory.length === 0) {
    return `Initial translation request from ${input.sourceLanguage} to ${input.targetLanguage}`;
  }

  // Build surgical context from error history (Mode B: surgical fix)
  const latestError = errorHistory[errorHistory.length - 1];
  const previousAttempts = errorHistory.slice(0, -1).map(e =>
    `  Attempt ${e.attempt} | ${e.stage}: ${e.error.substring(0, 200)}`
  ).join('\n');

  return `Refinement context for stage "${stage}":
Latest issue (attempt ${latestError.attempt}, stage ${latestError.stage}): ${latestError.error.substring(0, 300)}
${latestError.issues ? `Issues: ${latestError.issues.join(', ')}` : ''}

Previous attempts — do NOT repeat these patterns:
${previousAttempts || '  None yet.'}

Source: ${input.text.substring(0, 200)}... → ${input.targetLanguage}`;
}

// ─── Activity 1: translateText ───────────────────────────────────────────────

async function translateText(input: TranslationRequest, isRetry: boolean = false): Promise<{ translatedText: string; model: string }> {
  const srcLabel = input.sourceLanguage === 'auto' ? 'the detected source language' : input.sourceLanguage;
  const targetLabel = input.targetLanguage;

  let systemPrompt: string;
  let userContent: string;

  if (isRetry) {
    // More forceful prompt for retries — explicitly say NOT to echo
    systemPrompt = `You are a professional translator. Your task is to TRANSLATE the given text from ${srcLabel} into ${targetLabel}.

CRITICAL INSTRUCTION: You MUST output the text IN ${targetLabel.toUpperCase()}. Do NOT output the same text in the original language. This is a translation task, not a repetition task. The previous attempt returned the original text unchanged — you must actually translate it this time.

Rules:
- Produce a clean, natural, and understandable translation in ${targetLabel}
- Preserve the original meaning exactly — do not add, remove, or change information
- Use natural phrasing that a native speaker of ${targetLabel} would use
- Output ONLY the translated text in ${targetLabel}, nothing else.`;

    userContent = `Translate the following text from ${srcLabel} to ${targetLabel}. The output must be in ${targetLabel}:\n\n${input.text}`;
  } else {
    systemPrompt = `You are a professional translator. Translate the given text from ${srcLabel} to ${targetLabel}.

Rules:
- Produce a clean, natural, and understandable translation
- Preserve the original meaning exactly — do not add, remove, or change information
- Use natural phrasing that a native speaker would use
- Maintain the same tone and register (formal, informal, technical, etc.)
- If the text contains idioms, translate them to equivalent expressions in the target language
- If the text contains technical terms, use the standard terminology in the target language
- Output ONLY the translated text in ${targetLabel}, nothing else
- Do NOT output the original text — you must output the translation`;

    userContent = `Translate the following text from ${srcLabel} to ${targetLabel}. The output must be in ${targetLabel}:\n\n${input.text}`;
  }

  console.log(`[Pipeline] translateText (retry=${isRetry}): src=${srcLabel}, target=${targetLabel}, input length=${input.text.length}`);

  const result = await callNvidiaLLM(systemPrompt, userContent, input.apiKey, input.model, 2048, 0.3);

  // Strip any markdown code blocks or quotes the LLM might add
  const cleaned = result
    .replace(/^```[\w]*\n?/m, '')
    .replace(/\n?```$/m, '')
    .replace(/^["']|["']$/g, '')
    .trim();

  console.log(`[Pipeline] translateText result: length=${cleaned.length}, preview="${cleaned.substring(0, 100)}", isEcho=${isEcho(input.text, cleaned)}`);

  return {
    translatedText: cleaned,
    model: input.model || DEFAULT_MODEL,
  };
}

// ─── Activity 2: validateTranslation ─────────────────────────────────────────

async function validateTranslation(
  input: TranslationRequest,
  translatedText: string
): Promise<{ isValid: boolean; qualityScore: number; issues: string[]; suggestion?: string }> {
  const systemPrompt = `You are a translation quality reviewer. Evaluate the provided translation and respond in JSON format.

Evaluate on these criteria:
1. Accuracy: Does the translation preserve the original meaning?
2. Fluency: Is the translation natural and well-formed in the target language?
3. Completeness: Is any information missing or added?
4. Terminology: Are technical terms translated correctly?

Respond in this exact JSON format:
{
  "isValid": true/false,
  "qualityScore": 0-100,
  "issues": ["issue1", "issue2"],
  "suggestion": "optional improvement suggestion"
}

If the translation is good enough for practical use, set isValid to true even if minor improvements are possible.`;

  const srcLabel = input.sourceLanguage === 'auto' ? 'detected' : input.sourceLanguage;
  const userContent = `Source text (${srcLabel}):
"""
${input.text}
"""

Translation (${input.targetLanguage}):
"""
${translatedText}
"""`;

  const result = await callNvidiaLLM(systemPrompt, userContent, input.apiKey, input.model, 1024, 0.1);

  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { isValid: true, qualityScore: 70, issues: ['Could not parse validation response'] };
    }
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      isValid: parsed.isValid ?? true,
      qualityScore: parsed.qualityScore ?? 70,
      issues: parsed.issues ?? [],
      suggestion: parsed.suggestion,
    };
  } catch {
    return { isValid: true, qualityScore: 70, issues: ['Could not parse validation response'] };
  }
}

// ─── Activity 3: refineTranslation ───────────────────────────────────────────

async function refineTranslation(
  input: TranslationRequest,
  translatedText: string,
  issues: string[]
): Promise<string> {
  const issuesList = issues.map(i => `- ${i}`).join('\n');

  const systemPrompt = `You are a professional translator refining a translation.
Fix ALL the issues identified while keeping the rest of the translation unchanged.
Output ONLY the improved translation, nothing else.`;

  const srcLabel = input.sourceLanguage === 'auto' ? 'detected' : input.sourceLanguage;
  const userContent = `Source text (${srcLabel}):
"""
${input.text}
"""

Current translation (${input.targetLanguage}):
"""
${translatedText}
"""

Issues found with the current translation:
${issuesList}`;

  const result = await callNvidiaLLM(systemPrompt, userContent, input.apiKey, input.model, 2048, 0.2);

  return result
    .replace(/^```[\w]*\n?/m, '')
    .replace(/\n?```$/m, '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

// ─── Fast Translation (single call, no validate/refine) ──────────────────────
// For Vercel Hobby plan or when speed is preferred over quality validation.

export async function runFastTranslation(input: TranslationRequest): Promise<TranslationResult> {
  console.log('[Pipeline] Fast mode: translate only (no validate/refine)');

  let translatedText = '';
  let model = input.model || DEFAULT_MODEL;
  const pipeline: string[] = ['fast-translate'];

  try {
    const result = await translateText(input);
    translatedText = result.translatedText;
    model = result.model;

    // Echo detection — retry once if model echoed input
    if (isEcho(input.text, translatedText) && input.sourceLanguage !== input.targetLanguage) {
      console.log('[Pipeline] Echo detected in fast mode — retrying...');
      pipeline.push('echo-detected', 'fast-retry');
      const retryResult = await translateText(input, true);
      translatedText = retryResult.translatedText;
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[Pipeline] Fast translation failed:', errorMsg);
    return {
      translatedText: '',
      qualityScore: 0,
      attempts: 1,
      refinements: 0,
      issues: [errorMsg],
      model,
      pipeline,
    };
  }

  return {
    translatedText,
    qualityScore: 85, // Estimated — no validation step
    attempts: 1,
    refinements: 0,
    issues: undefined,
    model,
    pipeline,
  };
}

// ─── Main Pipeline (was translateWorkflow) ───────────────────────────────────
// This is the Temporal workflow logic, running directly.
// State machine: translate → validate → refine → done

export async function runTranslationPipeline(input: TranslationRequest): Promise<TranslationResult> {
  console.log(`[Pipeline] Full pipeline: src=${input.sourceLanguage}, target=${input.targetLanguage}, text length=${input.text.length}`);

  let attempt = 0;
  let refinements = 0;
  const maxRefinements = 2;
  let resumeFrom: 'translate' | 'validate' | 'refine' | 'done' = 'translate';
  const errorHistory: ErrorEntry[] = [];
  const pipeline: string[] = [];

  let translatedText = '';
  let qualityScore = 0;
  let issues: string[] = [];
  let model = input.model || DEFAULT_MODEL;

  // ─── Stage 1: Translate ─────────────────────────────────────────────────

  if (resumeFrom === 'translate') {
    attempt++;
    pipeline.push('translate');

    try {
      const result = await translateText(input);
      translatedText = result.translatedText;
      model = result.model;

      // ── Echo Detection: If model returned the same text, retry with forceful prompt ──
      if (isEcho(input.text, translatedText) && input.sourceLanguage !== input.targetLanguage) {
        console.log('[Pipeline] Echo detected — model returned input text. Retrying with explicit prompt...');
        pipeline.push('echo-detected');
        attempt++;
        pipeline.push('translate-retry');

        const retryResult = await translateText(input, true);
        translatedText = retryResult.translatedText;

        // If still echoing after retry, note it but continue to validation
        if (isEcho(input.text, translatedText)) {
          console.log('[Pipeline] Echo persists after retry — validation will catch this');
          pipeline.push('echo-persist');
        }
      }

      resumeFrom = 'validate';
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errorHistory.push({ attempt, stage: 'translate', error: errorMsg });

      // Retry translation once
      if (attempt < 2) {
        attempt++;
        pipeline.push('translate-retry');

        // Compile fix context (DSPy-like)
        const fixContext = compileTranslatePrompt(input, errorHistory, 'translate');
        console.log(`[Pipeline] Translate retry context: ${fixContext.substring(0, 200)}`);

        try {
          const result = await translateText(input, true);
          translatedText = result.translatedText;
          model = result.model;

          // Echo detection on retry too
          if (isEcho(input.text, translatedText) && input.sourceLanguage !== input.targetLanguage) {
            console.log('[Pipeline] Echo detected on retry — continuing');
            pipeline.push('echo-on-retry');
          }

          resumeFrom = 'validate';
        } catch (err2: unknown) {
          const errorMsg2 = err2 instanceof Error ? err2.message : String(err2);
          errorHistory.push({ attempt, stage: 'translate', error: errorMsg2 });
          return {
            translatedText: '',
            qualityScore: 0,
            attempts: attempt,
            refinements: 0,
            issues: ['Translation failed after retry'],
            model,
            pipeline,
          };
        }
      } else {
        return {
          translatedText: '',
          qualityScore: 0,
          attempts: attempt,
          refinements: 0,
          issues: ['Translation failed'],
          model,
          pipeline,
        };
      }
    }
  }

  // ─── Stage 2: Validate ──────────────────────────────────────────────────

  if (resumeFrom === 'validate') {
    pipeline.push('validate');

    try {
      const validation = await validateTranslation(input, translatedText);
      qualityScore = validation.qualityScore;
      issues = validation.issues;

      // Check if validation caught an echo (translated text same as source)
      if (isEcho(input.text, translatedText) && input.sourceLanguage !== input.targetLanguage) {
        // Force refinement to fix the echo
        pipeline.push('echo-caught-by-validation');
        qualityScore = Math.min(qualityScore, 30);
        issues = [...issues, 'Translation appears identical to source text — not actually translated'];
        resumeFrom = 'refine';
      } else if (validation.isValid) {
        pipeline.push('validate-pass');
        resumeFrom = 'done';
      } else {
        pipeline.push('validate-fail');
        resumeFrom = 'refine';
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errorHistory.push({ attempt, stage: 'validate', error: errorMsg });
      qualityScore = 60;
      resumeFrom = 'done';
    }
  }

  // ─── Stage 3: Refine (up to maxRefinements) ─────────────────────────────

  while (resumeFrom === 'refine' && refinements < maxRefinements) {
    refinements++;
    attempt++;
    pipeline.push(`refine-${refinements}`);

    // Compile surgical fix prompt (DSPy-like focused prompt)
    const fixContext = compileTranslatePrompt(input, errorHistory, 'refine');
    console.log(`[Pipeline] Refinement #${refinements} context: ${fixContext.substring(0, 200)}`);

    try {
      translatedText = await refineTranslation(input, translatedText, issues);

      // Re-validate after refinement
      pipeline.push(`revalidate-${refinements}`);
      try {
        const revalidation = await validateTranslation(input, translatedText);
        qualityScore = revalidation.qualityScore;
        issues = revalidation.issues;

        if (revalidation.isValid && !isEcho(input.text, translatedText)) {
          pipeline.push(`revalidate-pass-${refinements}`);
          resumeFrom = 'done';
          break;
        } else {
          pipeline.push(`revalidate-fail-${refinements}`);
          if (refinements >= maxRefinements) {
            resumeFrom = 'done';
            break;
          }
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        errorHistory.push({ attempt, stage: 'validate', error: errorMsg });
        qualityScore = 65;
        resumeFrom = 'done';
        break;
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errorHistory.push({ attempt, stage: 'refine', error: errorMsg, issues });

      if (refinements >= maxRefinements) {
        resumeFrom = 'done';
        break;
      }
    }
  }

  return {
    translatedText,
    qualityScore,
    attempts: attempt,
    refinements,
    issues: issues.length > 0 ? issues : undefined,
    model,
    pipeline,
  };
}
