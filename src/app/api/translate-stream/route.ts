import { NextRequest } from 'next/server';
import { runFastTranslationStream, runTranslationPipelineStream, PipelineEvent } from '@/lib/translation-pipeline-stream';

/**
 * Streaming translation endpoint (Server-Sent Events).
 *
 * POST /api/translate-stream
 *   { text, sourceLanguage, targetLanguage, fast }
 *
 * Response: text/event-stream
 *   data: {"type":"stage-start","stage":"translate","ts":1234567890}
 *   data: {"type":"log","line":"[nvidia] start  model=openai/gpt-oss-120b ...","ts":...}
 *   data: {"type":"chunk","text":"न","ts":...}
 *   data: {"type":"chunk","text":"म","ts":...}
 *   data: {"type":"stage-end","stage":"translate","elapsedMs":1234,"ok":true,...}
 *   data: {"type":"pipeline-end","result":{...},"ts":...}
 *
 * Each LLM call is a "controlled call": 10s timeout, 1 retry, structured logs.
 */
export const maxDuration = 120; // Edge runtime limit on Vercel (Pro: 300s)
export const dynamic = 'force-dynamic';
export const runtime = 'edge';

function sse(event: PipelineEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { text, sourceLanguage, targetLanguage, model, fast } = body;

  const resolvedApiKey = process.env.NVIDIA_API_KEY;

  if (!text || !targetLanguage) {
    return new Response(JSON.stringify({ error: 'Missing required fields: text, targetLanguage' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!resolvedApiKey) {
    return new Response(
      JSON.stringify({ error: 'Server missing NVIDIA_API_KEY env var.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const input = {
    text,
    sourceLanguage: sourceLanguage || 'en',
    targetLanguage,
    apiKey: resolvedApiKey,
    model: model || undefined,
  };

  const useFastMode = fast === true;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: PipelineEvent) => {
        try {
          controller.enqueue(encoder.encode(sse(event)));
        } catch {
          // Controller may be closed if client disconnected.
        }
      };

      try {
        if (useFastMode) {
          await runFastTranslationStream(input, emit);
        } else {
          await runTranslationPipelineStream(input, emit);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        emit({ type: 'error', message: msg, ts: Date.now() });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable proxy buffering (e.g. on Nginx)
    },
  });
}
