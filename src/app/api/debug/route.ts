import { NextResponse } from 'next/server';

/**
 * Debug endpoint to verify NVIDIA connectivity from inside Vercel.
 * Hits the /models endpoint (cheap, no token cost) and reports timings.
 *
 * Usage: GET /api/debug
 */
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const t0 = Date.now();
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') || 'full';

  // Smoke test: return immediately, no external calls.
  // Use /api/debug?mode=ping to verify the route + runtime is healthy.
  if (mode === 'ping') {
    return NextResponse.json({
      ok: true,
      mode: 'ping',
      msg: 'route alive, no external calls made',
      totalMs: Date.now() - t0,
      region: process.env.VERCEL_REGION || 'unknown',
      vercelEnv: process.env.VERCEL_ENV || 'unknown',
      hasKey: !!process.env.NVIDIA_API_KEY,
      keyPrefix: process.env.NVIDIA_API_KEY
        ? process.env.NVIDIA_API_KEY.slice(0, 10) + '...'
        : '(none)',
    });
  }

  // Smoke test: hit a non-NVIDIA external API to verify outbound HTTPS works.
  // Use /api/debug?mode=external to test general outbound connectivity.
  if (mode === 'external') {
    try {
      const r = await fetch('https://httpbin.org/get', { method: 'GET' });
      const body = await r.text();
      return NextResponse.json({
        ok: r.ok,
        mode: 'external',
        status: r.status,
        ms: Date.now() - t0,
        bodyPreview: body.slice(0, 300),
      });
    } catch (e) {
      return NextResponse.json({
        ok: false,
        mode: 'external',
        error: `${(e as Error).name}: ${(e as Error).message}`,
        ms: Date.now() - t0,
      });
    }
  }

  const apiKey = process.env.NVIDIA_API_KEY;

  // Test ONLY the cheap /v1/models GET. If this hangs, the issue is
  // network-level (DNS / TCP / TLS) between Vercel and NVIDIA.
  if (mode === 'models') {
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: 'no key' }, { status: 500 });
    }
    try {
      const r = await fetch('https://integrate.api.nvidia.com/v1/models', {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const body = await r.text();
      return NextResponse.json({
        ok: r.ok,
        mode: 'models',
        status: r.status,
        ms: Date.now() - t0,
        bodyPreview: body.slice(0, 300),
      });
    } catch (e) {
      return NextResponse.json({
        ok: false,
        mode: 'models',
        error: `${(e as Error).name}: ${(e as Error).message}`,
        ms: Date.now() - t0,
      });
    }
  }

  // Test ONLY a tiny chat completion, no streaming.
  if (mode === 'chat-nostream') {
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: 'no key' }, { status: 500 });
    }
    try {
      const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          messages: [{ role: 'user', content: 'Reply with: pong' }],
          max_tokens: 16,
          temperature: 0,
          stream: false,
        }),
      });
      const body = await r.text();
      return NextResponse.json({
        ok: r.ok,
        mode: 'chat-nostream',
        status: r.status,
        ms: Date.now() - t0,
        bodyPreview: body.slice(0, 400),
      });
    } catch (e) {
      return NextResponse.json({
        ok: false,
        mode: 'chat-nostream',
        error: `${(e as Error).name}: ${(e as Error).message}`,
        ms: Date.now() - t0,
      });
    }
  }

  // Test ONLY a tiny chat completion, WITH streaming.
  if (mode === 'chat-stream') {
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: 'no key' }, { status: 500 });
    }
    try {
      const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          messages: [{ role: 'user', content: 'Reply with: pong' }],
          max_tokens: 16,
          temperature: 0,
          stream: true,
        }),
      });
      if (!r.ok) {
        const body = await r.text();
        return NextResponse.json({
          ok: false,
          mode: 'chat-stream',
          status: r.status,
          ms: Date.now() - t0,
          bodyPreview: body.slice(0, 400),
        });
      }
      // Drain the stream
      const reader = r.body!.getReader();
      let chunks = 0;
      let bytes = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks++;
        bytes += value?.length || 0;
      }
      return NextResponse.json({
        ok: true,
        mode: 'chat-stream',
        status: r.status,
        ms: Date.now() - t0,
        chunks,
        bytes,
      });
    } catch (e) {
      return NextResponse.json({
        ok: false,
        mode: 'chat-stream',
        error: `${(e as Error).name}: ${(e as Error).message}`,
        ms: Date.now() - t0,
      });
    }
  }


  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        error: 'NVIDIA_API_KEY env var is NOT set on this Vercel deployment.',
        hint: 'Go to Vercel → Project Settings → Environment Variables → add NVIDIA_API_KEY=nvapi-...',
        elapsedMs: Date.now() - t0,
      },
      { status: 500 },
    );
  }

  // 1) Cheap /models call to verify network path + auth
  let modelsOk = false;
  let modelsStatus = 0;
  let modelsBody = '';
  let modelsMs = 0;
  try {
    const mStart = Date.now();
    const res = await fetch('https://integrate.api.nvidia.com/v1/models', {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    modelsStatus = res.status;
    modelsBody = (await res.text()).slice(0, 500);
    modelsMs = Date.now() - mStart;
    modelsOk = res.ok;
  } catch (e) {
    modelsBody = `${(e as Error).name}: ${(e as Error).message}`;
  }

  // 2) Tiny chat completion to verify the actual endpoint works (streaming)
  let chatOk = false;
  let chatStatus = 0;
  let chatBody = '';
  let chatMs = 0;
  try {
    const cStart = Date.now();
    const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages: [{ role: 'user', content: 'Reply with the single word: pong' }],
        max_tokens: 16,
        temperature: 0,
        stream: true,
      }),
    });
    chatStatus = res.status;
    chatMs = Date.now() - cStart;
    if (res.ok && res.body) {
      const reader = res.body.getReader();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
      chatOk = true;
      chatBody = '(stream drained ok)';
    } else {
      chatBody = (await res.text()).slice(0, 500);
    }
  } catch (e) {
    chatBody = `${(e as Error).name}: ${(e as Error).message}`;
  }

  return NextResponse.json({
    ok: modelsOk && chatOk,
    keyPrefix: apiKey.slice(0, 10) + '...',
    models: { ok: modelsOk, status: modelsStatus, ms: modelsMs, body: modelsBody },
    chat: { ok: chatOk, status: chatStatus, ms: chatMs, body: chatBody },
    totalMs: Date.now() - t0,
    region: process.env.VERCEL_REGION || 'unknown',
    vercelEnv: process.env.VERCEL_ENV || 'unknown',
  });
}
