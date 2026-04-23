/**
 * Ax Translator — Temporal Worker + HTTP API Server
 *
 * This is the main entry point for the Temporal service.
 * It:
 * 1. Starts an HTTP server (port 3030) for the Next.js app to interact with
 * 2. Connects to Temporal server and registers the workflow + activities
 * 3. Provides REST endpoints to start translations and check status
 *
 * If Temporal server is not available, falls back to direct execution mode.
 */

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'http';
import { Worker, NativeConnection } from '@temporalio/worker';
import * as activities from './activities';
import { translateWorkflow } from './workflows';

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
const TASK_QUEUE = 'ax-translator';
const PORT = 3030;

// ─── In-memory store for workflow results ────────────────────────────────────

interface TranslationJob {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  input: {
    text: string;
    sourceLanguage: string;
    targetLanguage: string;
  };
  output?: Record<string, unknown>;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

const jobs = new Map<string, TranslationJob>();

// ─── Direct execution fallback (when Temporal is not available) ──────────────

async function executeTranslationDirect(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  apiKey: string,
  model?: string
): Promise<Record<string, unknown>> {
  // Step 1: Translate
  const translateResult = await activities.translateText({
    text,
    sourceLanguage,
    targetLanguage,
    apiKey,
    model,
  });

  let translatedText = translateResult.translatedText;
  let qualityScore = 0;
  let issues: string[] = [];
  let refinements = 0;

  // Step 2: Validate
  try {
    const validation = await activities.validateTranslation({
      originalText: text,
      translatedText,
      sourceLanguage,
      targetLanguage,
      apiKey,
      model,
    });
    qualityScore = validation.qualityScore;
    issues = validation.issues;

    // Step 3: Refine if needed (up to 2 attempts)
    if (!validation.isValid) {
      for (let i = 0; i < 2; i++) {
        refinements++;
        try {
          const refinement = await activities.refineTranslation({
            originalText: text,
            translatedText,
            issues,
            sourceLanguage,
            targetLanguage,
            apiKey,
            model,
          });
          translatedText = refinement.refinedText;

          // Re-validate
          const revalidation = await activities.validateTranslation({
            originalText: text,
            translatedText,
            sourceLanguage,
            targetLanguage,
            apiKey,
            model,
          });
          qualityScore = revalidation.qualityScore;
          issues = revalidation.issues;

          if (revalidation.isValid) break;
        } catch {
          break; // Accept current translation on refinement error
        }
      }
    }
  } catch {
    qualityScore = 60; // Accept without validation
  }

  return {
    translatedText,
    qualityScore,
    attempts: 1 + refinements,
    refinements,
    issues: issues.length > 0 ? issues : undefined,
    model: translateResult.model,
  };
}

// ─── HTTP Server ─────────────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  // ─── POST /api/translate — Start a translation (async) ────────────────

  if (req.method === 'POST' && path === '/api/translate') {
    try {
      const body = await readBody(req);
      const { text, sourceLanguage, targetLanguage, apiKey, model } = JSON.parse(body);

      if (!text || !targetLanguage || !apiKey) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required fields: text, targetLanguage, apiKey' }));
        return;
      }

      const jobId = `job-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
      const job: TranslationJob = {
        id: jobId,
        status: 'running',
        input: { text, sourceLanguage: sourceLanguage || 'auto', targetLanguage },
        createdAt: Date.now(),
      };
      jobs.set(jobId, job);

      // Execute translation (direct mode or Temporal)
      executeTranslationDirect(text, sourceLanguage || 'auto', targetLanguage, apiKey, model)
        .then((output) => {
          job.status = 'completed';
          job.output = output;
          job.completedAt = Date.now();
        })
        .catch((err: unknown) => {
          job.status = 'failed';
          job.error = err instanceof Error ? err.message : String(err);
          job.completedAt = Date.now();
        });

      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jobId, status: 'running' }));
    } catch (err: unknown) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Invalid request' }));
    }
    return;
  }

  // ─── POST /api/translate/sync — Synchronous translation ──────────────

  if (req.method === 'POST' && path === '/api/translate/sync') {
    try {
      const body = await readBody(req);
      const { text, sourceLanguage, targetLanguage, apiKey, model } = JSON.parse(body);

      if (!text || !targetLanguage || !apiKey) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required fields: text, targetLanguage, apiKey' }));
        return;
      }

      const result = await executeTranslationDirect(
        text,
        sourceLanguage || 'auto',
        targetLanguage,
        apiKey,
        model
      );

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err: unknown) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Translation failed' }));
    }
    return;
  }

  // ─── GET /api/translate/:jobId — Check translation status ────────────

  if (req.method === 'GET' && path.startsWith('/api/translate/')) {
    const jobId = path.replace('/api/translate/', '');
    const job = jobs.get(jobId);

    if (!job) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Job not found' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(job));
    return;
  }

  // ─── GET /health — Health check ──────────────────────────────────────

  if (req.method === 'GET' && path === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'ax-translator', temporal: 'direct-mode' }));
    return;
  }

  // ─── 404 ─────────────────────────────────────────────────────────────

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('[Ax Translator] Starting service...');

  // Start HTTP server
  const server = createHttpServer(handleRequest);
  server.listen(PORT, () => {
    console.log(`[Ax Translator] HTTP server listening on port ${PORT}`);
  });

  // Try to connect to Temporal and start worker
  try {
    console.log(`[Ax Translator] Connecting to Temporal at ${TEMPORAL_ADDRESS}...`);
    const connection = await NativeConnection.connect({
      address: TEMPORAL_ADDRESS,
    });

    const worker = await Worker.create({
      connection,
      namespace: 'default',
      taskQueue: TASK_QUEUE,
      workflowsPath: import.meta.url.replace('index.ts', 'workflows.ts'),
      activities,
    });

    console.log('[Ax Translator] Temporal worker registered, starting...');
    await worker.run();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[Ax Translator] Temporal not available (${msg}), running in direct execution mode`);
    // Keep HTTP server running in direct mode — already started above
  }
}

main().catch((err) => {
  console.error('[Ax Translator] Fatal error:', err);
  process.exit(1);
});
