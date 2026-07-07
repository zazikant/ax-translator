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

    // Fast mode: single translate call, no validate/refine — for Vercel Hobby plan
    if (fast) {
      const result = await runFastTranslation({
        text,
        sourceLanguage: sourceLanguage || 'auto',
        targetLanguage,
        apiKey: resolvedApiKey,
        model: model || undefined,
      });
      return NextResponse.json(result);
    }

    // Full pipeline: translate → validate → refine
    const result = await runTranslationPipeline({
      text,
      sourceLanguage: sourceLanguage || 'auto',
      targetLanguage,
      apiKey: resolvedApiKey,
      model: model || undefined,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[Translate API] Error:', message);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
