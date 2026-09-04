/**
 * NVIDIA API Client — streaming edition with controlled, logged calls.
 *
 * Each call to callNvidiaLLM:
 *   - Streams the response (chunk-by-chunk) from gpt-oss-120b
 *   - Has a hard per-call timeout (DEFAULT_CALL_TIMEOUT_MS)
 *   - Retries once with backoff on transient failures
 *   - Emits structured log lines so the pipeline can show progress:
 *       [nvidia] start  model=openai/gpt-oss-120b max_tokens=2048 temp=0.3
 *       [nvidia] ttfb=523ms first_content="..."
 *       [nvidia] done   elapsed=1234ms content_chars=987 reasoning_chars=4321
 *       [nvidia] retry  attempt=2 reason="AbortError"
 *
 * Base URL: https://integrate.api.nvidia.com/v1
 * Default model: openai/gpt-oss-120b
 */

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const DEFAULT_MODEL = 'openai/gpt-oss-20b';

// Per-call timeout: 120s. Matches google-ads-subagent-vercel/lib/models.ts.
// gpt-oss-120b on Vercel Edge can take 8-15s TTFB for larger outputs
// (longer translations, especially with high max_tokens), and the 18s
// budget was tight. 120s is the client-side ceiling; on Hobby Vercel
// kills the function at 30s first, so the effective budget stays 30s.
// On Pro (300s Edge cap) this gives the model comfortable room.
//
// 1 retry with 500ms backoff. Pipeline-level retry (in page.tsx for
// chunked mode) handles additional attempts.
export const DEFAULT_CALL_TIMEOUT_MS = 120_000;
export const DEFAULT_MAX_RETRIES = 1;

export interface NvidiaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface NvidiaCallOptions {
  model?: string;
  messages: NvidiaChatMessage[];
  temperature?: number;
  maxTokens?: number;
  apiKey: string;
  /** Per-call timeout in ms. Default 10000. */
  timeoutMs?: number;
  /** Max attempts (including the first). Default 2 (1 retry). */
  maxRetries?: number;
  /** Optional callback fired for every log line. */
  onLog?: (line: string) => void;
  /** Optional callback fired for every content chunk as it arrives. */
  onChunk?: (text: string) => void;
}

export interface NvidiaCallResult {
  content: string;
  reasoning: string;
  model: string;
  elapsedMs: number;
  attempts: number;
}

function log(opts: NvidiaCallOptions, msg: string) {
  const line = `[nvidia] ${msg}`;
  console.log(line);
  opts.onLog?.(line);
}

/**
 * Internal: stream + accumulate a single chat completion attempt.
 * Throws on timeout or HTTP error.
 */
async function streamOnce(
  body: Record<string, unknown>,
  apiKey: string,
  signal: AbortSignal,
  onChunk?: (text: string) => void,
): Promise<{ content: string; reasoning: string; ttfbMs: number | null }> {
  const callStart = Date.now();
  const response = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`NVIDIA API error (${response.status}): ${errText.slice(0, 300)}`);
  }
  if (!response.body) {
    throw new Error('NVIDIA API returned no response body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let reasoning = '';
  let ttfbMs: number | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (ttfbMs === null) ttfbMs = Date.now() - callStart;

    buffer += decoder.decode(value, { stream: true });
    let nlIdx;
    while ((nlIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nlIdx).trim();
      buffer = buffer.slice(nlIdx + 1);
      if (!line || !line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') {
        return { content, reasoning, ttfbMs };
      }
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta;
        if (delta) {
          if (typeof delta.content === 'string' && delta.content) {
            content += delta.content;
            onChunk?.(delta.content);
          }
          if (typeof delta.reasoning_content === 'string') {
            reasoning += delta.reasoning_content;
          }
        }
      } catch {
        // Partial JSON across chunks — wait for more bytes.
      }
    }
  }
  return { content, reasoning, ttfbMs };
}

/**
 * Controlled, logged, time-bounded chat completion with retry.
 * Returns the full content + reasoning + timing metadata.
 */
export async function nvidiaChatCompletion(
  opts: NvidiaCallOptions,
): Promise<NvidiaCallResult> {
  const model = opts.model || DEFAULT_MODEL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const callStart = Date.now();

  log(
    opts,
    `start  model=${model} max_tokens=${opts.maxTokens ?? 2048} temp=${opts.temperature ?? 0.7} timeout=${timeoutMs}ms`,
  );

  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const { content, reasoning, ttfbMs } = await streamOnce(
        {
          model,
          messages: opts.messages,
          max_tokens: opts.maxTokens ?? 2048,
          temperature: opts.temperature ?? 0.7,
        },
        opts.apiKey,
        controller.signal,
        opts.onChunk,
      );
      clearTimeout(timeout);
      const elapsed = Date.now() - callStart;
      log(
        opts,
        `ttfb=${ttfbMs ?? 'n/a'}ms  done attempt=${attempt} elapsed=${elapsed}ms content_chars=${content.length} reasoning_chars=${reasoning.length} preview="${content.slice(0, 80)}"`,
      );
      if (!content) {
        throw new Error(
          `empty content (reasoning_chars=${reasoning.length}, finish_reason may be "length" — increase max_tokens)`,
        );
      }
      return { content, reasoning, model, elapsedMs: elapsed, attempts: attempt };
    } catch (err: unknown) {
      clearTimeout(timeout);
      const e = err as Error;
      const elapsed = Date.now() - callStart;
      lastErr = e;
      if (e.name === 'AbortError') {
        log(opts, `TIMEOUT attempt=${attempt} after ${timeoutMs}ms`);
      } else {
        log(opts, `ERROR attempt=${attempt} after ${elapsed}ms: ${e.name}: ${e.message.slice(0, 200)}`);
      }
      if (attempt < maxRetries) {
        const backoff = 500 * attempt;
        log(opts, `retry  backing off ${backoff}ms before attempt ${attempt + 1}`);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
  const elapsed = Date.now() - callStart;
  const finalErr = lastErr ?? new Error('unknown error');
  throw new Error(
    `NVIDIA call failed after ${maxRetries} attempts (${elapsed}ms): ${finalErr.name}: ${finalErr.message}`,
  );
}

/**
 * Convenience: system + user prompt → content string.
 * Default model is gpt-oss-120b, 10s timeout, 1 retry.
 */
export async function callNvidiaLLM(
  systemPrompt: string,
  userContent: string,
  apiKey: string,
  model?: string,
  maxTokens: number = 2048,
  temperature: number = 0.3,
  onLog?: (line: string) => void,
  onChunk?: (text: string) => void,
): Promise<string> {
  const result = await nvidiaChatCompletion({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    maxTokens,
    temperature,
    apiKey,
    onLog,
    onChunk,
  });
  return result.content;
}

export { DEFAULT_MODEL, NVIDIA_BASE_URL };
