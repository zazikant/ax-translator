import { NextRequest, NextResponse } from 'next/server';

// Edge runtime — Vercel's Node serverless path hangs on openai/gpt-oss-120b
// (confirmed via /api/debug). Edge uses a different egress that works.
// See /api/debug?mode=chat-oss-big for the smoking gun.
export const maxDuration = 120;
export const runtime = 'edge';
export const dynamic = 'force-dynamic';

import { runTranslationPipeline, runFastTranslation } from '@/lib/translation-pipeline';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, sourceLanguage, targetLanguage, model, fast } = body;

    // NVIDIA API key is no longer accepted from the client. It must be
    // configured server-side via the NVIDIA_API_KEY environment variable
    // (e.g. in Vercel Project Settings → Environment Variables).
    const resolvedApiKey = process.env.NVIDIA_API_KEY;

    if (!text || !targetLanguage) {
      return NextResponse.json(
        { error: 'Missing required fields: text, targetLanguage' },
        { status: 400 }
      );
    }

    if (!resolvedApiKey) {
      return NextResponse.json(
        {
          error:
            'Server is missing NVIDIA_API_KEY environment variable. Configure it in Vercel Project Settings → Environment Variables (or your local .env file).',
        },
        { status: 500 }
      );
    }

    const input = {
      text,
      sourceLanguage: sourceLanguage || 'en',
      targetLanguage,
      apiKey: resolvedApiKey,
      model: model || undefined,
    };

    // Choose pipeline mode:
    // - fast=true → skip validate/refine (for speed)
    // - fast=false → full translate→validate→refine pipeline
    // - Default: full pipeline now that the env var is required
    const useFastMode = fast === true;

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
        {
          error:
            'Translation timed out. Try using fast mode (add "fast": true to request), or upgrade the Vercel plan for a higher maxDuration.',
        },
        { status: 504 }
      );
    }

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
