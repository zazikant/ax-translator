import { NextRequest, NextResponse } from 'next/server';

// Vercel serverless function timeout — translation pipeline can take up to 60s
export const maxDuration = 60;

import { runTranslationPipeline } from '@/lib/translation-pipeline';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, sourceLanguage, targetLanguage, apiKey, model } = body;

    if (!text || !targetLanguage || !apiKey) {
      return NextResponse.json(
        { error: 'Missing required fields: text, targetLanguage, apiKey' },
        { status: 400 }
      );
    }

    // Run the DSPy-like translation pipeline directly
    const result = await runTranslationPipeline({
      text,
      sourceLanguage: sourceLanguage || 'auto',
      targetLanguage,
      apiKey,
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
