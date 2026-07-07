import { NextRequest, NextResponse } from 'next/server';

// Vercel serverless function timeout — translation pipeline can take up to 60s
// (Requires Vercel Pro. On Hobby plan, max is 10s which may timeout on long texts)
export const maxDuration = 60;

import { runTranslationPipeline, runFastTranslation } from '@/lib/translation-pipeline';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, sourceLanguage, targetLanguage, apiKey, model, fast } = body;

    // API key: use the one from frontend, or fall back to env variable
    const resolvedApiKey = apiKey || process.env.NVIDIA_API_KEY;

    if (!text || !targetLanguage || !resolvedApiKey) {
      return NextResponse.json(
        { error: 'Missing required fields: text, targetLanguage, apiKey (or set NVIDIA_API_KEY env var)' },
        { status: 400 }
      );
    }

    const input = {
      text,
      sourceLanguage: sourceLanguage || 'auto',
      targetLanguage,
      apiKey: resolvedApiKey,
      model: model || undefined,
    };

    // Choose pipeline mode:
    // - fast=true → skip validate/refine (for Vercel Hobby / speed)
    // - fast=false → full translate→validate→refine pipeline
    // - Default: fast mode on Vercel (no env key = likely Hobby), full pipeline if NVIDIA_API_KEY is set
    const useFastMode = fast === true || (fast === undefined && !process.env.NVIDIA_API_KEY);

    if (useFastMode) {
      console.log('[Translate API] Using FAST mode (translate only)');
      const result = await runFastTranslation(input);
      return NextResponse.json(result);
    }

    // Full pipeline: translate → validate → refine
    console.log('[Translate API] Using FULL pipeline (translate → validate → refine)');
    const result = await runTranslationPipeline(input);
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[Translate API] Error:', message);

    // If timeout error, suggest fast mode
    if (message.includes('timeout') || message.includes('timed out')) {
      return NextResponse.json(
        { error: 'Translation timed out. Try using fast mode (add "fast": true to request) or set NVIDIA_API_KEY env var on Vercel Pro.' },
        { status: 504 }
      );
    }

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
