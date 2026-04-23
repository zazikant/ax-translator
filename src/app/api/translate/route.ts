import { NextRequest, NextResponse } from 'next/server';

const TEMPORAL_SERVICE_URL = 'http://localhost:3030';

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

    // Call the Temporal service (direct mode) synchronously
    const response = await fetch(`${TEMPORAL_SERVICE_URL}/api/translate/sync?XTransformPort=3030`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        sourceLanguage: sourceLanguage || 'auto',
        targetLanguage,
        apiKey,
        model: model || undefined,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      let errorMessage = 'Translation failed';
      try {
        const parsed = JSON.parse(errorData);
        errorMessage = parsed.error || errorMessage;
      } catch {}
      return NextResponse.json(
        { error: errorMessage },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[Translate API] Error:', error?.message);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
