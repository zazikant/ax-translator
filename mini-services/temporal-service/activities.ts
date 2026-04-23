/**
 * Ax Translator — Temporal Activities
 *
 * Activities are the "doing" layer. They perform side-effects like calling
 * the NVIDIA LLM API, validating translations, and refining them.
 *
 * DSPy/Ax design principles:
 * - Each activity is a discrete, testable step in the pipeline
 * - Inputs/outputs are typed signatures (like DSPy Signatures)
 * - The workflow compiles focused prompts (like DSPy modules) and passes them here
 */

import { Context } from '@temporalio/activity';

// ─── Safe Heartbeat ──────────────────────────────────────────────────────────
// Context.current().heartbeat() only works inside a Temporal worker.
// When running in direct mode, it throws — so we wrap it safely.

function safeHeartbeat(message: string): void {
  try {
    Context.current().heartbeat(message);
  } catch {
    // Not running inside Temporal worker — just log to console
    console.log(`[Activity] ${message}`);
  }
}

// ─── Types (DSPy-like Signatures) ────────────────────────────────────────────

export interface TranslateInput {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  apiKey: string;
  model?: string;
}

export interface TranslateOutput {
  translatedText: string;
  confidence: number;
  model: string;
}

export interface ValidateInput {
  originalText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  apiKey: string;
  model?: string;
}

export interface ValidateOutput {
  isValid: boolean;
  qualityScore: number;
  issues: string[];
  suggestion?: string;
}

export interface RefineInput {
  originalText: string;
  translatedText: string;
  issues: string[];
  sourceLanguage: string;
  targetLanguage: string;
  apiKey: string;
  model?: string;
}

export interface RefineOutput {
  refinedText: string;
  improvements: string[];
}

// ─── NVIDIA API Client ───────────────────────────────────────────────────────

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

async function callNvidiaLLM(
  systemPrompt: string,
  userContent: string,
  apiKey: string,
  model?: string,
  maxTokens: number = 2048,
  temperature: number = 0.3
): Promise<string> {
  const modelName = model || DEFAULT_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000); // 2 min timeout

  try {
    console.log(`[NVIDIA API] Calling model: ${modelName}`);
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
    console.log(`[NVIDIA API] Response received (${content.length} chars)`);
    return content;
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error('NVIDIA API request timed out after 120s');
    }
    throw err;
  }
}

// ─── Activity 1: translateText ───────────────────────────────────────────────

export async function translateText(input: TranslateInput): Promise<TranslateOutput> {
  safeHeartbeat('Starting translation');

  const systemPrompt = `You are a professional translator. Translate the given text from ${input.sourceLanguage === 'auto' ? 'the detected source language' : input.sourceLanguage} to ${input.targetLanguage}.

Rules:
- Produce a clean, natural, and understandable translation
- Preserve the original meaning exactly — do not add, remove, or change information
- Use natural phrasing that a native speaker would use
- Maintain the same tone and register (formal, informal, technical, etc.)
- If the text contains idioms, translate them to equivalent expressions in the target language
- If the text contains technical terms, use the standard terminology in the target language
- Output ONLY the translated text, nothing else.`;

  safeHeartbeat('Calling NVIDIA LLM for translation');
  const result = await callNvidiaLLM(systemPrompt, input.text, input.apiKey, input.model, 2048, 0.3);

  // Strip any markdown code blocks or quotes the LLM might add
  const cleaned = result
    .replace(/^```[\w]*\n?/m, '')
    .replace(/\n?```$/m, '')
    .replace(/^["']|["']$/g, '')
    .trim();

  return {
    translatedText: cleaned,
    confidence: 0.8, // Initial confidence, will be updated by validation
    model: input.model || DEFAULT_MODEL,
  };
}

// ─── Activity 2: validateTranslation ─────────────────────────────────────────

export async function validateTranslation(input: ValidateInput): Promise<ValidateOutput> {
  safeHeartbeat('Starting validation');

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

  const userContent = `Source text (${input.sourceLanguage}):
"""
${input.originalText}
"""

Translation (${input.targetLanguage}):
"""
${input.translatedText}
"""`;

  safeHeartbeat('Calling NVIDIA LLM for validation');
  const result = await callNvidiaLLM(systemPrompt, userContent, input.apiKey, input.model, 1024, 0.1);

  try {
    // Try to parse JSON from the response
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { isValid: true, qualityScore: 70, issues: ['Could not parse validation response'], suggestion: undefined };
    }
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      isValid: parsed.isValid ?? true,
      qualityScore: parsed.qualityScore ?? 70,
      issues: parsed.issues ?? [],
      suggestion: parsed.suggestion,
    };
  } catch {
    return { isValid: true, qualityScore: 70, issues: ['Could not parse validation response'], suggestion: undefined };
  }
}

// ─── Activity 3: refineTranslation ───────────────────────────────────────────

export async function refineTranslation(input: RefineInput): Promise<RefineOutput> {
  safeHeartbeat('Starting refinement');

  const issuesList = input.issues.map(i => `- ${i}`).join('\n');

  const systemPrompt = `You are a professional translator refining a translation.
Fix ALL the issues identified while keeping the rest of the translation unchanged.
Output ONLY the improved translation, nothing else.`;

  const userContent = `Source text (${input.sourceLanguage}):
"""
${input.originalText}
"""

Current translation (${input.targetLanguage}):
"""
${input.translatedText}
"""

Issues found with the current translation:
${issuesList}`;

  safeHeartbeat('Calling NVIDIA LLM for refinement');
  const result = await callNvidiaLLM(systemPrompt, userContent, input.apiKey, input.model, 2048, 0.2);

  const cleaned = result
    .replace(/^```[\w]*\n?/m, '')
    .replace(/\n?```$/m, '')
    .replace(/^["']|["']$/g, '')
    .trim();

  return {
    refinedText: cleaned,
    improvements: input.issues,
  };
}
