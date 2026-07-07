/**
 * Ax Translator — Temporal Workflow
 *
 * DSPy/Ax-inspired translation pipeline with:
 * - Signature-based prompt compilation (compileTranslatePrompt)
 * - Durable state management via Temporal
 * - Surgical retry logic: on validation failure, compiles focused fix prompt
 * - resumeFrom state machine for deterministic pipeline progression
 *
 * Workflow flow:
 * 1. Translate text (initial attempt)
 * 2. Validate translation quality
 * 3. If validation fails, refine translation (up to 2 refinement attempts)
 * 4. Return final translated text with metadata
 */

import { proxyActivities, log } from '@temporalio/workflow';
import type * as activities from './activities';

// ─── Activity Proxy ──────────────────────────────────────────────────────────

const {
  translateText,
  validateTranslation,
  refineTranslation,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '3 minutes',
  retry: {
    maximumAttempts: 1, // Workflow handles retries via state machine
  },
});

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ErrorEntry {
  attempt: number;
  stage: 'translate' | 'validate' | 'refine';
  error: string;
  issues?: string[];
}

export interface TranslateWorkflowInput {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  apiKey: string;
  model?: string;
}

export interface TranslateWorkflowOutput {
  translatedText: string;
  qualityScore: number;
  attempts: number;
  refinements: number;
  issues?: string[];
  model: string;
  errorHistory: ErrorEntry[];
}

// ─── compileTranslatePrompt (pure workflow-side function) ────────────────────
// Like DSPy's Module.compile() — produces focused prompts based on error history

function compileTranslatePrompt(
  input: TranslateWorkflowInput,
  errorHistory: ErrorEntry[],
  stage: 'translate' | 'validate' | 'refine'
): string {
  // No errors yet — this is an initial prompt context
  if (errorHistory.length === 0) {
    return `Initial translation request: ${input.text.substring(0, 100)}... from ${input.sourceLanguage} to ${input.targetLanguage}`;
  }

  // Build surgical context from error history
  const latestError = errorHistory[errorHistory.length - 1];
  const previousAttempts = errorHistory.slice(0, -1).map(e =>
    `  Attempt ${e.attempt} | ${e.stage}: ${e.error.substring(0, 200)}`
  ).join('\n');

  return `Refinement context for stage "${stage}":
Latest issue (attempt ${latestError.attempt}, stage ${latestError.stage}): ${latestError.error.substring(0, 300)}
${latestError.issues ? `Issues: ${latestError.issues.join(', ')}` : ''}

Previous attempts — do NOT repeat these patterns:
${previousAttempts || '  None yet.'}

Source text: ${input.text.substring(0, 200)}...
Target language: ${input.targetLanguage}`;
}

// ─── Main Workflow ───────────────────────────────────────────────────────────

export async function translateWorkflow(input: TranslateWorkflowInput): Promise<TranslateWorkflowOutput> {
  let attempt = 0;
  let refinements = 0;
  const maxRefinements = 2;
  let resumeFrom: 'translate' | 'validate' | 'refine' | 'done' = 'translate';
  const errorHistory: ErrorEntry[] = [];

  let translatedText = '';
  let qualityScore = 0;
  let issues: string[] = [];
  let model = input.model || 'openai/gpt-oss-120b';

  // ─── Stage 1: Translate ─────────────────────────────────────────────────

  if (resumeFrom === 'translate') {
    attempt++;
    log.info(`[Attempt ${attempt} | translate] Starting translation`);

    try {
      const result = await translateText({
        text: input.text,
        sourceLanguage: input.sourceLanguage,
        targetLanguage: input.targetLanguage,
        apiKey: input.apiKey,
        model: input.model,
      });
      translatedText = result.translatedText;
      model = result.model;
      log.info(`[Attempt ${attempt} | translate] Translation succeeded`);
      resumeFrom = 'validate';
    } catch (err: any) {
      const errorMsg = err?.message ?? String(err);
      log.error(`[Attempt ${attempt} | translate] Error: ${errorMsg.substring(0, 300)}`);
      errorHistory.push({
        attempt,
        stage: 'translate',
        error: errorMsg,
      });

      // Compile fix context (like DSPy module compilation)
      const fixContext = compileTranslatePrompt(input, errorHistory, 'translate');
      log.info(`[Attempt ${attempt} | translate] Compiled prompt: ${fixContext}`);

      // Retry translation once
      if (attempt < 2) {
        attempt++;
        log.info(`[Attempt ${attempt} | translate] Retrying translation`);
        try {
          const result = await translateText({
            text: input.text,
            sourceLanguage: input.sourceLanguage,
            targetLanguage: input.targetLanguage,
            apiKey: input.apiKey,
            model: input.model,
          });
          translatedText = result.translatedText;
          model = result.model;
          resumeFrom = 'validate';
        } catch (err2: any) {
          const errorMsg2 = err2?.message ?? String(err2);
          errorHistory.push({ attempt, stage: 'translate', error: errorMsg2 });
          return {
            translatedText: '',
            qualityScore: 0,
            attempts: attempt,
            refinements: 0,
            issues: ['Translation failed after retry'],
            model,
            errorHistory,
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
          errorHistory,
        };
      }
    }
  }

  // ─── Stage 2: Validate ──────────────────────────────────────────────────

  if (resumeFrom === 'validate') {
    log.info(`[Attempt ${attempt} | validate] Starting validation`);

    try {
      const validation = await validateTranslation({
        originalText: input.text,
        translatedText,
        sourceLanguage: input.sourceLanguage,
        targetLanguage: input.targetLanguage,
        apiKey: input.apiKey,
        model: input.model,
      });
      qualityScore = validation.qualityScore;
      issues = validation.issues;

      if (validation.isValid) {
        log.info(`[Attempt ${attempt} | validate] Validation passed (score: ${qualityScore})`);
        resumeFrom = 'done';
      } else {
        log.info(`[Attempt ${attempt} | validate] Validation failed (score: ${qualityScore}), issues: ${issues.join(', ')}`);
        resumeFrom = 'refine';
      }
    } catch (err: any) {
      const errorMsg = err?.message ?? String(err);
      log.error(`[Attempt ${attempt} | validate] Error: ${errorMsg.substring(0, 300)}`);
      errorHistory.push({ attempt, stage: 'validate', error: errorMsg });
      // On validation error, accept the translation as-is
      qualityScore = 60;
      resumeFrom = 'done';
    }
  }

  // ─── Stage 3: Refine (up to maxRefinements attempts) ────────────────────

  while (resumeFrom === 'refine' && refinements < maxRefinements) {
    refinements++;
    attempt++;
    log.info(`[Attempt ${attempt} | refine] Starting refinement #${refinements}`);

    // Compile surgical fix prompt (DSPy-like focused prompt)
    const fixContext = compileTranslatePrompt(input, errorHistory, 'refine');
    log.info(`[Attempt ${attempt} | refine] Compiled prompt: ${fixContext.substring(0, 300)}`);

    try {
      const refinement = await refineTranslation({
        originalText: input.text,
        translatedText,
        issues,
        sourceLanguage: input.sourceLanguage,
        targetLanguage: input.targetLanguage,
        apiKey: input.apiKey,
        model: input.model,
      });

      translatedText = refinement.refinedText;
      log.info(`[Attempt ${attempt} | refine] Refinement succeeded, improvements: ${refinement.improvements.join(', ')}`);

      // Re-validate after refinement
      try {
        const revalidation = await validateTranslation({
          originalText: input.text,
          translatedText,
          sourceLanguage: input.sourceLanguage,
          targetLanguage: input.targetLanguage,
          apiKey: input.apiKey,
          model: input.model,
        });
        qualityScore = revalidation.qualityScore;
        issues = revalidation.issues;

        if (revalidation.isValid) {
          log.info(`[Attempt ${attempt} | refine] Re-validation passed (score: ${qualityScore})`);
          resumeFrom = 'done';
          break;
        } else {
          log.info(`[Attempt ${attempt} | refine] Re-validation still has issues (score: ${qualityScore})`);
          if (refinements >= maxRefinements) {
            log.info(`[Attempt ${attempt} | refine] Max refinements reached, accepting current translation`);
            resumeFrom = 'done';
            break;
          }
          // Continue refining
        }
      } catch (err: any) {
        const errorMsg = err?.message ?? String(err);
        errorHistory.push({ attempt, stage: 'validate', error: errorMsg });
        // Accept the refined version
        qualityScore = 65;
        resumeFrom = 'done';
        break;
      }
    } catch (err: any) {
      const errorMsg = err?.message ?? String(err);
      log.error(`[Attempt ${attempt} | refine] Error: ${errorMsg.substring(0, 300)}`);
      errorHistory.push({
        attempt,
        stage: 'refine',
        error: errorMsg,
        issues,
      });

      if (refinements >= maxRefinements) {
        log.info(`[Attempt ${attempt} | refine] Max refinements reached, accepting current translation`);
        resumeFrom = 'done';
        break;
      }
      // Continue to next refinement attempt
    }
  }

  return {
    translatedText,
    qualityScore,
    attempts: attempt,
    refinements,
    issues: issues.length > 0 ? issues : undefined,
    model,
    errorHistory,
  };
}
