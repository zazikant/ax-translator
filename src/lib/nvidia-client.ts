/**
 * NVIDIA API Client — OpenAI SDK-compatible interface
 *
 * Calls NVIDIA's GPT-OSS-120B model via the chat completions endpoint.
 * Uses system + user message format (same as OpenAI SDK).
 *
 * Base URL: https://integrate.api.nvidia.com/v1
 * Default model: openai/gpt-oss-120b
 */

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

export interface NvidiaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface NvidiaChatOptions {
  model?: string;
  messages: NvidiaChatMessage[];
  temperature?: number;
  maxTokens?: number;
  apiKey: string; // Required — always pass explicitly
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
 * Call NVIDIA's chat completions API.
 * Compatible with OpenAI SDK format.
 * API key is always passed via options.apiKey.
 */
export async function nvidiaChatCompletion(options: NvidiaChatOptions): Promise<NvidiaChatResponse> {
  const model = options.model || DEFAULT_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000); // 2 min timeout

  try {
    const response = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: options.messages,
        max_tokens: options.maxTokens ?? 2048,
        temperature: options.temperature ?? 0.7,
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`NVIDIA API error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    if (!content) {
      throw new Error('NVIDIA API returned empty response');
    }

    return {
      content,
      model: data.model || model,
      usage: data.usage,
    };
  } catch (err: unknown) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('NVIDIA API request timed out after 120s');
    }
    throw err;
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
  temperature: number = 0.3
): Promise<string> {
  const modelName = model || DEFAULT_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const response = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        max_tokens: maxTokens,
        temperature,
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`NVIDIA API error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    if (!content) {
      throw new Error('NVIDIA API returned empty response');
    }
    return content;
  } catch (err: unknown) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('NVIDIA API request timed out after 120s');
    }
    throw err;
  }
}

export { DEFAULT_MODEL, NVIDIA_BASE_URL };
