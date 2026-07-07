/**
 * NVIDIA API Client — OpenAI SDK-compatible interface (streaming edition)
 *
 * Calls NVIDIA's GPT-OSS-120B model via the chat completions endpoint.
 *
 * IMPORTANT: This version uses `stream: true` and accumulates chunks on the
 * server. We previously used `stream: false`, which works locally but stalls
 * on Vercel serverless (the model emits a long `reasoning_content` buffer
 * before the final answer, and Vercel's fetch implementation appears to hold
 * the connection open until the entire non-streamed payload is ready — which
 * pushes the function past Vercel's 60s limit). Streaming sidesteps this by
 * flushing chunks as they arrive.
 *
 * Base URL: https://integrate.api.nvidia.com/v1
 * Default model: openai/gpt-oss-120b
 */

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

// Vercel Hobby caps serverless functions at 60s. We abort at 45s so the
// function can return a meaningful error before Vercel kills it.
const FETCH_TIMEOUT_MS = 45_000;

export interface NvidiaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface NvidiaChatOptions {
  model?: string;
  messages: NvidiaChatMessage[];
  temperature?: number;
  maxTokens?: number;
  apiKey: string;
}

export interface NvidiaChatResponse {
  content: string;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Internal: accumulate a streamed chat completion into a single string.
 * Streams from NVIDIA but does NOT yield to the caller — useful when the
 * pipeline just needs the final text.
 */
async function streamAndAccumulate(
  body: Record<string, unknown>,
  apiKey: string,
  signal: AbortSignal,
): Promise<{ content: string; reasoning: string; raw: unknown }> {
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
    throw new Error(`NVIDIA API error (${response.status}): ${errText}`);
  }

  if (!response.body) {
    throw new Error('NVIDIA API returned no response body');
  }

  // Parse SSE stream manually. Each event is `data: {json}\n\n`.
  // A terminating `data: [DONE]` ends the stream.
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let reasoning = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let nlIdx;
    while ((nlIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nlIdx).trim();
      buffer = buffer.slice(nlIdx + 1);
      if (!line) continue;
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') {
        return { content, reasoning, raw: null };
      }
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta;
        if (delta) {
          if (typeof delta.content === 'string') content += delta.content;
          if (typeof delta.reasoning_content === 'string') reasoning += delta.reasoning_content;
        }
      } catch {
        // Partial JSON across chunks — ignore; we'll get more bytes.
      }
    }
  }

  return { content, reasoning, raw: null };
}

/**
 * Call NVIDIA's chat completions API (streaming under the hood).
 */
export async function nvidiaChatCompletion(
  options: NvidiaChatOptions,
): Promise<NvidiaChatResponse> {
  const model = options.model || DEFAULT_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const { content } = await streamAndAccumulate(
      {
        model,
        messages: options.messages,
        max_tokens: options.maxTokens ?? 2048,
        temperature: options.temperature ?? 0.7,
      },
      options.apiKey,
      controller.signal,
    );

    if (!content) {
      throw new Error('NVIDIA API returned empty response');
    }

    return {
      content,
      model,
      usage: undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Convenience: Call with system prompt + user content + API key.
 * This is the primary way the pipeline calls the LLM.
 */
export async function callNvidiaLLM(
  systemPrompt: string,
  userContent: string,
  apiKey: string,
  model?: string,
  maxTokens: number = 2048,
  temperature: number = 0.3,
): Promise<string> {
  const modelName = model || DEFAULT_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const t0 = Date.now();

  try {
    const { content, reasoning } = await streamAndAccumulate(
      {
        model: modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        max_tokens: maxTokens,
        temperature,
      },
      apiKey,
      controller.signal,
    );

    const elapsed = Date.now() - t0;
    console.log(
      `[NVIDIA] ${elapsed}ms | content=${content.length} chars | reasoning=${reasoning.length} chars | preview="${content.substring(0, 120)}"`,
    );

    if (!content) {
      console.error(
        '[NVIDIA] Empty content. Reasoning preview:',
        reasoning.substring(0, 300),
      );
      throw new Error('NVIDIA API returned empty content (model may have only emitted reasoning)');
    }
    return content;
  } catch (err: unknown) {
    const elapsed = Date.now() - t0;
    if (err instanceof Error && err.name === 'AbortError') {
      console.error(`[NVIDIA] Aborted after ${elapsed}ms (timeout=${FETCH_TIMEOUT_MS}ms)`);
      throw new Error(`NVIDIA API request timed out after ${FETCH_TIMEOUT_MS / 1000}s`);
    }
    console.error(`[NVIDIA] Error after ${elapsed}ms:`, err);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export { DEFAULT_MODEL, NVIDIA_BASE_URL, FETCH_TIMEOUT_MS };
