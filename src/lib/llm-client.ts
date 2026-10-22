/**
 * AX DSPy LLM helpers + retry-aware call layer for the NVIDIA transport.
 *
 * The pipeline-level helpers below are ported word-to-word from
 * atomic-graph-opencode (the "Bible" AX DSPy reference implementation):
 * - estimateTokens / calculateMaxTokens (stage-based)
 * - getStageTemperature (translate=0.3, validate=0.1, refine=0.2)
 * - parseLLMJson + recoverTruncatedJSON (robust JSON parsing chain)
 *
 * The HTTP part of callLLM delegates to nvidiaChatCompletion() in
 * nvidia-client.ts so the pipeline keeps this repo's transport behaviors:
 * - MODEL_MAX_TOKENS_CAP (4096/call for gpt-oss-20b) with auto-continue
 *   chaining for longer outputs — so passing the Bible's stage-based
 *   max_tokens values (up to 8192) is safe: the client caps per call and
 *   transparently continues truncated generations.
 * - reasoning_content fallback when content is empty.
 *
 * On top of that transport, callLLM adds the Bible's proxy-route retry
 * policy (ported word-to-word from atomic-graph-opencode's proxy route):
 * - Retry up to 3 times on transient errors (429, 5xx) with 15-second delay
 * - Non-retryable errors fail fast with descriptive messages
 */

import { nvidiaChatCompletion, isRetryableError, DEFAULT_MODEL as NVIDIA_DEFAULT_MODEL } from './nvidia-client';

// ─── Retry Configuration (from atomic-graph-opencode's proxy route) ─────────

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 15_000; // 15 seconds between retry attempts

/**
 * Status codes that warrant a retry (transient / rate-limit errors).
 */
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeStatus(status: number): string {
  switch (status) {
    case 400:
      return 'Bad Request — the prompt or parameters are invalid';
    case 401:
      return 'Unauthorized — check your NVIDIA API key';
    case 403:
      return 'Forbidden — your API key does not have access to this model';
    case 404:
      return 'Not Found — the model endpoint does not exist';
    case 429:
      return 'Rate Limited — too many requests, retrying…';
    case 500:
      return 'Server Error — NVIDIA experienced an internal error';
    case 502:
      return 'Bad Gateway — NVIDIA\'s upstream is unreachable';
    case 503:
      return 'Service Unavailable — NVIDIA API is temporarily offline';
    case 504:
      return 'Gateway Timeout — NVIDIA API took too long to respond';
    default:
      return `HTTP ${status}`;
  }
}

// ─── Token Estimation (from atomic-graph-opencode, originally shared) ───────
// Rough: 1 token ≈ 4 chars for English, 2 chars for CJK

export function estimateTokens(text: string): number {
  const cjkChars = (text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []).length;
  const otherChars = text.length - cjkChars;
  return Math.ceil(cjkChars / 2 + otherChars / 4);
}

/**
 * Calculate max_tokens for the output based on input length (per stage).
 * Ported word-to-word from atomic-graph-opencode's calculateMaxTokens —
 * stage-specific like the AX DSPy pipeline.
 *
 * For same-language transformation (en→en), output can be 3-5× the input
 * (telegraphic notes → structured essay with explanations).
 * For cross-language translation and refinement, output ≈ input × 1.5.
 * For validation, output is small JSON (~1024 is enough).
 *
 * Minimum 2048, maximum 8192. Values above gpt-oss-20b's 4096-token
 * per-call output limit are handled by nvidia-client's auto-continue loop,
 * which chains multiple capped calls transparently.
 */
export function calculateMaxTokens(
  inputText: string,
  stage: 'translate' | 'validate' | 'refine' = 'translate',
  isSameLanguage: boolean = false
): number {
  // Validation returns small JSON — fixed 1024 is enough
  if (stage === 'validate') return 1024;

  const inputTokens = estimateTokens(inputText);
  // Same-language transformation produces structured output ≈ 3-5× input
  const multiplier = stage === 'translate' && isSameLanguage ? 4 : 1.5;
  const outputTokens = Math.ceil(inputTokens * multiplier);
  return Math.max(2048, Math.min(8192, outputTokens));
}

/**
 * Stage-specific temperature settings (from atomic-graph-opencode's axPipeline).
 * Lower temperature = more deterministic/focused output.
 * Higher temperature = more creative/diverse output.
 */
export function getStageTemperature(stage: 'translate' | 'validate' | 'refine'): number {
  switch (stage) {
    case 'translate': return 0.3;  // Focused, deterministic translation/transformation
    case 'validate': return 0.1;   // Very deterministic — objective quality assessment
    case 'refine': return 0.2;     // Slightly creative — targeted fixes
    default: return 0.3;
  }
}

// ─── Core LLM Call (with AX DSPy retry loop over the NVIDIA transport) ──────

/**
 * Convenience: Call with system prompt + user content + API key.
 * This is the primary way the pipeline calls the LLM.
 *
 * Retry loop ported word-to-word from atomic-graph-opencode's proxy route:
 * - Up to MAX_RETRIES attempts on 429/5xx with RETRY_DELAY_MS delay
 * - Non-retryable errors fail fast with a descriptive message
 * (Retriability is classified by nvidia-client's isRetryableError, which
 * covers 429/5xx statuses plus transient network errors — the same set the
 * Bible's proxy route retries on.)
 */
export async function callLLM(
  systemPrompt: string,
  userContent: string,
  apiKey: string,
  model?: string,
  maxTokens: number = 4096,
  temperature: number = 0.3,
): Promise<string> {
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userContent },
  ];

  // ─── Retry Loop (from atomic-graph-opencode's proxy route) ────────────
  let lastError: Error | null = null;
  let lastStatus = 0;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await nvidiaChatCompletion({
        model,
        messages,
        maxTokens,
        temperature,
        apiKey,
      });
      if (attempt > 1) {
        console.log(`[LLM Client] Succeeded on retry attempt ${attempt}/${MAX_RETRIES}`);
      }
      return result.content;
    } catch (err: unknown) {
      const e = err as Error & { status?: number };
      lastError = e;
      lastStatus = e?.status || 0;

      // Retryable = 429/5xx statuses (Bible proxy-route set) plus transient
      // network errors (nvidia-client's classification).
      const retryable = RETRYABLE_STATUS_CODES.has(lastStatus) || isRetryableError(e);

      // Non-retryable errors surface immediately so the UI shows a real
      // error instead of silently retrying a doomed call.
      if (!retryable || attempt >= MAX_RETRIES) {
        const statusLabel = lastStatus ? `${describeStatus(lastStatus)} (${lastStatus}): ` : '';
        throw new Error(
          `${statusLabel}${e?.message || String(e)}${
            attempt >= MAX_RETRIES && retryable
              ? ` — all ${MAX_RETRIES} attempts failed.`
              : ''
          }`,
        );
      }

      // ─── Retryable error ───────────────────────────────────────────────
      console.warn(
        `[LLM Client] Attempt ${attempt}/${MAX_RETRIES} — ${
          lastStatus ? describeStatus(lastStatus) : e?.name
        }. Retrying in ${RETRY_DELAY_MS / 1000}s…`
      );
      await sleep(RETRY_DELAY_MS);
    }
  }

  // ─── All retries exhausted ─────────────────────────────────────────────
  // User-friendly message ported word-to-word from atomic-graph-opencode's client.
  if (lastStatus === 429) {
    throw new Error(
      'NVIDIA API rate limit reached — all 3 retry attempts failed after 15-second delays. Please wait a moment and try again.'
    );
  }
  if (lastStatus >= 500) {
    throw new Error(
      `NVIDIA server error (${lastStatus}): ${lastError?.message}. This is usually temporary — try again in a moment.`
    );
  }
  throw new Error(
    lastStatus
      ? `${describeStatus(lastStatus)} — all ${MAX_RETRIES} attempts failed. ${lastError?.message}`
      : `Network error — all ${MAX_RETRIES} attempts failed. ${lastError?.message}`
  );
}

// ─── Robust JSON Parser (ported word-to-word from atomic-graph-opencode) ────

/**
 * Robust JSON parser for LLM outputs.
 * Strips markdown code fences, extracts JSON objects,
 * and handles reasoning model outputs that may contain
 * chain-of-thought text before/after the JSON.
 */
export function parseLLMJson<T>(raw: string): T {
  // Strip markdown code fences: ```json ... ``` or ``` ... ```
  let cleaned = raw.trim();

  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // Strategy 1: Try direct parse of the full text
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Continue to more sophisticated parsing
  }

  // Strategy 2: Extract balanced JSON using bracket matching.
  const jsonStr = extractBalancedJSON(cleaned);
  if (jsonStr) {
    try {
      return JSON.parse(jsonStr) as T;
    } catch {
      // Continue to fixes
    }
  }

  // Strategy 3: Fix common issues like trailing commas
  if (jsonStr) {
    const fixed = jsonStr.replace(/,\s*([}\]])/g, '$1');
    try {
      return JSON.parse(fixed) as T;
    } catch {
      // Continue
    }
  }

  // Strategy 4: Try the greedy regex as a last resort before failing
  const greedyMatch = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (greedyMatch) {
    try {
      return JSON.parse(greedyMatch[1]) as T;
    } catch {
      // Greedy match didn't work either
    }
  }

  throw new Error(
    `Failed to parse LLM JSON response. Output length: ${raw.length} chars.\nFirst 300 chars: ${raw.slice(0, 300)}\nLast 300 chars: ${raw.slice(-300)}`
  );
}

/**
 * Extract a balanced JSON object or array from text that may contain
 * extra content before or after the JSON.
 */
function extractBalancedJSON(text: string): string | null {
  const startCurly = text.indexOf('{');
  const startSquare = text.indexOf('[');

  let startIdx: number;
  let openCh: string;
  let closeCh: string;

  if (startCurly === -1 && startSquare === -1) return null;
  if (startCurly === -1) {
    startIdx = startSquare;
    openCh = '[';
    closeCh = ']';
  } else if (startSquare === -1) {
    startIdx = startCurly;
    openCh = '{';
    closeCh = '}';
  } else {
    startIdx = Math.min(startCurly, startSquare);
    openCh = startIdx === startCurly ? '{' : '[';
    closeCh = startIdx === startCurly ? '}' : ']';
  }

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === openCh || ch === '{' || ch === '[') {
      if (ch === openCh && depth === 0) {
        depth = 1;
      } else if (depth > 0) {
        depth++;
      }
    } else if (ch === closeCh || ch === '}' || ch === ']') {
      if (depth > 0) {
        depth--;
        if (depth === 0) {
          return text.slice(startIdx, i + 1);
        }
      }
    }
  }

  return null;
}

/**
 * Attempt to recover useful data from a truncated JSON response.
 */
export function recoverTruncatedJSON<T>(raw: string): T | null {
  let cleaned = raw.trim();

  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  const jsonStart = cleaned.search(/\{/);
  if (jsonStart === -1) return null;
  cleaned = cleaned.slice(jsonStart);

  const attempt1 = closeOpenBrackets(cleaned);
  if (attempt1 !== null) {
    return attempt1 as T;
  }

  const attempt2 = truncateToLastCompleteElement(cleaned);
  if (attempt2 !== null) {
    return attempt2 as T;
  }

  const attempt3 = recoverFieldsIndividually(cleaned);
  if (attempt3 !== null) {
    return attempt3 as T;
  }

  return null;
}

function closeOpenBrackets(cleaned: string): Record<string, unknown> | null {
  let curlyDepth = 0, squareDepth = 0;
  let inString = false, escape = false;

  for (const ch of cleaned) {
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') curlyDepth++;
    else if (ch === '}') curlyDepth--;
    else if (ch === '[') squareDepth++;
    else if (ch === ']') squareDepth--;
  }

  if (curlyDepth === 0 && squareDepth === 0) return null;

  let attempt = findLastSafeTruncation(cleaned);
  if (attempt === null) return null;

  let newCurly = 0, newSquare = 0;
  let inStr = false, esc = false;
  for (const ch of attempt) {
    if (esc) { esc = false; continue; }
    if (ch === '\\' && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') newCurly++;
    else if (ch === '}') newCurly--;
    else if (ch === '[') newSquare++;
    else if (ch === ']') newSquare--;
  }

  for (let i = 0; i < newSquare; i++) attempt += ']';
  for (let i = 0; i < newCurly; i++) attempt += '}';

  attempt = attempt.replace(/,\s*([}\]])/g, '$1');

  try {
    return JSON.parse(attempt) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function findLastSafeTruncation(text: string): string | null {
  const stringState: boolean[] = new Array(text.length).fill(false);
  let isStr = false, isEsc = false;
  for (let j = 0; j < text.length; j++) {
    if (isEsc) { isEsc = false; stringState[j] = isStr; continue; }
    if (text[j] === '\\' && isStr) { isEsc = true; stringState[j] = isStr; continue; }
    if (text[j] === '"') isStr = !isStr;
    stringState[j] = isStr;
  }

  const endsInString = stringState[text.length - 1];

  if (endsInString) {
    let stringStartQuote = -1;
    for (let j = text.length - 1; j >= 0; j--) {
      if (text[j] === '"') {
        const stateBefore = j > 0 ? stringState[j - 1] : false;
        const stateAfter = stringState[j];
        if (!stateBefore && stateAfter) {
          stringStartQuote = j;
          break;
        }
      }
    }

    if (stringStartQuote >= 0) {
      let beforeQuote = stringStartQuote - 1;
      while (beforeQuote >= 0 && /\s/.test(text[beforeQuote])) beforeQuote--;

      if (beforeQuote >= 0) {
        const prevChar = text[beforeQuote];
        if (prevChar === ':') {
          let objOpenIdx = -1;
          let depth = 0;
          for (let k = beforeQuote; k >= 0; k--) {
            if (text[k] === '}' && !stringState[k]) depth++;
            else if (text[k] === '{' && !stringState[k]) {
              if (depth === 0) { objOpenIdx = k; break; }
              depth--;
            }
          }
          if (objOpenIdx >= 0) {
            let beforeObj = objOpenIdx - 1;
            while (beforeObj >= 0 && /\s/.test(text[beforeObj])) beforeObj--;
            if (beforeObj >= 0 && text[beforeObj] === ',') {
              return text.slice(0, beforeObj).replace(/,\s*$/, '');
            }
            if (beforeObj >= 0 && text[beforeObj] === '[') {
              return text.slice(0, beforeObj + 1);
            }
            if (beforeObj >= 0 && text[beforeObj] === '{') {
              return text.slice(0, beforeObj + 1);
            }
            return text.slice(0, objOpenIdx).replace(/,\s*$/, '');
          }
          return text.slice(0, beforeQuote).replace(/,\s*$/, '');
        }
        if (prevChar === ',' || prevChar === '[') {
          return text.slice(0, beforeQuote + (prevChar === '[' ? 1 : 0)).replace(/,\s*$/, '');
        }
      }
      return text.slice(0, stringStartQuote).replace(/,\s*$/, '');
    }
  }

  let i = text.length - 1;
  while (i >= 0 && /\s/.test(text[i])) i--;
  if (i < 0) return null;

  const ch = text[i];

  if ((ch === '}' || ch === ']') && !stringState[i]) {
    let end = i;
    let k = i - 1;
    while (k >= 0 && /\s/.test(text[k])) k--;
    if (k >= 0 && text[k] === ',') end = k;
    return text.slice(0, end + 1).replace(/,\s*$/, '');
  }

  if (ch === '"' && !stringState[i]) {
    let result = text.slice(0, i + 1);
    result = result.replace(/,\s*$/, '');
    return result;
  }

  if (/\d/.test(ch)) {
    let numEnd = i;
    let j = i;
    while (j >= 0 && /[0-9.eE+\-]/.test(text[j])) j--;
    let beforeNum = j;
    while (beforeNum >= 0 && /\s/.test(text[beforeNum])) beforeNum--;
    if (beforeNum >= 0 && (text[beforeNum] === ':' || text[beforeNum] === ',' || text[beforeNum] === '[')) {
      let result = text.slice(0, numEnd + 1);
      result = result.replace(/,\s*$/, '');
      return result;
    }
  }

  for (let j = text.length - 1; j >= 0; j--) {
    if ((text[j] === '}' || text[j] === ']') && !stringState[j]) {
      let result = text.slice(0, j + 1);
      result = result.replace(/,\s*$/, '');
      return result;
    }
  }

  return null;
}

function truncateToLastCompleteElement(cleaned: string): Record<string, unknown> | null {
  const stringState: boolean[] = new Array(cleaned.length).fill(false);
  let isStr = false, isEsc = false;
  for (let j = 0; j < cleaned.length; j++) {
    if (isEsc) { isEsc = false; stringState[j] = isStr; continue; }
    if (cleaned[j] === '\\' && isStr) { isEsc = true; stringState[j] = isStr; continue; }
    if (cleaned[j] === '"') isStr = !isStr;
    stringState[j] = isStr;
  }

  let lastCompleteObjEnd = -1;
  for (let j = cleaned.length - 1; j >= 0; j--) {
    if (cleaned[j] === '}' && !stringState[j]) { lastCompleteObjEnd = j; break; }
  }

  let lastCompleteArrEnd = -1;
  for (let j = cleaned.length - 1; j >= 0; j--) {
    if (cleaned[j] === ']' && !stringState[j]) { lastCompleteArrEnd = j; break; }
  }

  let bestIdx = Math.max(lastCompleteObjEnd, lastCompleteArrEnd);
  if (bestIdx <= 0) return null;

  let truncated = cleaned.slice(0, bestIdx + 1);
  truncated = truncated.replace(/,\s*$/, '');

  let curly = 0, square = 0;
  let inStr = false, esc = false;
  for (const ch of truncated) {
    if (esc) { esc = false; continue; }
    if (ch === '\\' && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') curly++;
    else if (ch === '}') curly--;
    else if (ch === '[') square++;
    else if (ch === ']') square--;
  }

  for (let i = 0; i < square; i++) truncated += ']';
  for (let i = 0; i < curly; i++) truncated += '}';
  truncated = truncated.replace(/,\s*([}\]])/g, '$1');

  try {
    return JSON.parse(truncated) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function recoverFieldsIndividually(cleaned: string): Record<string, unknown> | null {
  try {
    const result: Record<string, unknown> = {};

    const scoreMatch = cleaned.match(/"score"\s*:\s*([\d.]+)/);
    if (scoreMatch) result.score = parseFloat(scoreMatch[1]);

    const issuesMatch = cleaned.match(/"issues"\s*:\s*\[/);
    if (issuesMatch) {
      const issuesStart = cleaned.indexOf('[', cleaned.indexOf('"issues"'));
      const recoveredIssues = recoverArrayElements(cleaned, issuesStart);
      if (recoveredIssues && recoveredIssues.length > 0) result.issues = recoveredIssues;
    }

    const suggestionsMatch = cleaned.match(/"suggestions"\s*:\s*\[/);
    if (suggestionsMatch) {
      const suggestionsStart = cleaned.indexOf('[', cleaned.indexOf('"suggestions"'));
      const recoveredSuggestions = recoverArrayElements(cleaned, suggestionsStart);
      if (recoveredSuggestions && recoveredSuggestions.length > 0) result.suggestions = recoveredSuggestions;
    }

    if (Object.keys(result).length > 0) return result;
  } catch {
    // Recovery failed
  }

  return null;
}

function recoverArrayElements(text: string, arrayStartIndex: number): unknown[] | null {
  if (arrayStartIndex === -1) return null;

  const elements: unknown[] = [];
  let depth = 0;
  let objStart = -1;
  let inString = false;
  let escape = false;

  for (let i = arrayStartIndex; i < text.length; i++) {
    const ch = text[i];

    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart !== -1) {
        const objStr = text.slice(objStart, i + 1);
        try { elements.push(JSON.parse(objStr)); } catch { /* skip */ }
        objStart = -1;
      }
    }
  }

  return elements;
}

export { NVIDIA_DEFAULT_MODEL as DEFAULT_MODEL };
