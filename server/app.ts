import { randomUUID } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { StructuredParseError, type BackendAiService } from './ai.js';
import { MAX_HISTORY_SUMMARY_EVENTS, brainstormSchema, diffIdeaEventInputSchema, generateIdeasSchema, ideaChatSchema, ideaEventDiffSchema, ideaListQuerySchema, ideaReferenceSchema, ideaListReferenceSchema, ideaSummaryQuerySchema, importDataSchema, listIdeaEventsInputSchema, saveIdeaRequestSchema, suggestFoldersSchema, summarizeChatSchema, summarizeIdeaHistoryInputSchema, updateIdeaSchema, vetIdeasSchema } from './contracts.js';
import { createIdeaMcpServer } from './mcp.js';
import { getAllowedOrigins, SERVER_HOST } from './config.js';
import { BadRequestError, NotFoundError } from './errors.js';
import { AiConnectionError } from './errors.js';
import { CredentialStoreError } from './credentials/CredentialStore.js';
import { AiProviderError } from './ai/providers/errors.js';
import type { ConnectionService } from './connections/ConnectionService.js';
import { activeConnectionSchema, connectionInputSchema, credentialWriteSchema } from './connections/contracts.js';
import { legacyAppSettingsSchema } from './contracts.js';
import { migrateSettings } from './ai/migrateSettings.js';
import { OpenAiAuthService } from './openaiAuth.js';
import { importBackup } from './connections/importBackup.js';
import { computeIdeaEventDiff } from './ideaHistory.js';
import type { AppStore } from './store.js';
import type { ChatMessage, Idea } from '../src/types.js';

type ParsedRequest<T> = Request<Record<string, string>, unknown, T>;
type SaveIdeaInput = z.infer<typeof saveIdeaRequestSchema>;

function requestOptions(res: Response) {
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  return { signal: controller.signal };
}

function parseBody<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  return schema.parse(value);
}

function makeAssistantMessage(content: string): ChatMessage {
  return {
    id: randomUUID(),
    role: 'assistant',
    content,
    timestamp: Date.now()
  };
}

function makeUserMessage(content: string): ChatMessage {
  return {
    id: randomUUID(),
    role: 'user',
    content,
    timestamp: Date.now()
  };
}

function isIdea(value: Idea | undefined): value is Idea {
  return Boolean(value);
}

function normalizeIdeaForStorage(input: SaveIdeaInput): Idea {
  const { eventContext: _eventContext, ...idea } = input;
  return {
    ...idea,
    folder_id: idea.folder_id ?? undefined
  };
}

function normalizeChatHistory(history: ChatMessage[] | undefined, prompt: string, fallback: ChatMessage[]): ChatMessage[] {
  const source = history && history.length > 0 ? history : fallback;
  const normalized = [...source];
  const lastMessage = normalized[normalized.length - 1];

  if (lastMessage?.role === 'user' && lastMessage.content === prompt) {
    normalized.pop();
  }

  return normalized;
}

function sendStream(
  req: Request,
  res: Response,
  runner: (emitDelta: (delta: string) => void, signal: AbortSignal) => Promise<string>,
  options: {
    onErrorPayload?: (error: unknown) => Record<string, unknown>;
  } = {}
): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });

  let fullText = '';
  const emitDelta = (delta: string) => {
    if (controller.signal.aborted || res.destroyed) return;
    fullText += delta;
    res.write(`data: ${JSON.stringify({ delta })}\n\n`);
  };

  void runner(emitDelta, controller.signal)
    .then((finalText) => {
      if (controller.signal.aborted || res.destroyed) return;
      res.write(`data: ${JSON.stringify({ done: true, fullText: finalText })}\n\n`);
    })
    .catch((error: unknown) => {
      if (controller.signal.aborted) {
        return;
      }
      if (options.onErrorPayload) {
        res.write(`data: ${JSON.stringify(options.onErrorPayload(error))}\n\n`);
        return;
      }
      const message = error instanceof Error ? error.message : 'Unknown streaming error';
      res.write(`data: ${JSON.stringify({ error: message, ...((error as { code?: string })?.code ? { code: (error as { code: string }).code } : {}) })}\n\n`);
    })
    .finally(() => {
      res.end();
    });
}

export function createHttpApp(store: AppStore, aiService: BackendAiService, connections?: ConnectionService, openAiAuth = new OpenAiAuthService()) {
  const app = express();
  const connectionService = () => {
    if (!connections) throw new AiConnectionError('AI_SETUP_REQUIRED', 'AI connections are not initialized.');
    return connections;
  };
  const allowedOrigins = new Set(getAllowedOrigins());
  const allowedHostnames = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

  app.use(express.json({ limit: '10mb' }));
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin) {
      if (!allowedOrigins.has(origin)) {
        res.status(403).json({ error: 'Origin not allowed' });
        return;
      }
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    const rawHost = req.headers.host;
    if (!rawHost) {
      res.status(400).json({ error: 'Missing Host header' });
      return;
    }

    try {
      const parsed = new URL(`http://${rawHost}`);
      if (!allowedHostnames.has(parsed.hostname)) {
        res.status(403).json({ error: 'Host not allowed' });
        return;
      }
    } catch {
      res.status(400).json({ error: 'Invalid Host header' });
      return;
    }

    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/ideas', async (req, res, next) => {
    try {
      const query = parseBody(ideaListQuerySchema, req.query);
      const ideas = await store.listIdeas(query);
      res.json(ideas);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/idea-summaries', async (req, res, next) => {
    try {
      const query = parseBody(ideaSummaryQuerySchema, req.query);
      res.json(await store.listIdeaSummaries(query));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/ideas/:id', async (req, res, next) => {
    try {
      const idea = await store.getIdea(req.params.id);
      if (!idea) {
        res.status(404).json({ error: 'Idea not found' });
        return;
      }
      res.json(idea);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/ideas/:id/events', async (req, res, next) => {
    try {
      const input = parseBody(listIdeaEventsInputSchema, {
        ideaId: req.params.id,
        ...req.query
      }) as z.infer<typeof listIdeaEventsInputSchema>;
      const events = await store.listIdeaEvents(input.ideaId, input);
      res.json({ events });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/ideas/:id/events/:eventId/diff', async (req, res, next) => {
    try {
      const input = parseBody(diffIdeaEventInputSchema, {
        ideaId: req.params.id,
        eventId: req.params.eventId
      }) as z.infer<typeof diffIdeaEventInputSchema>;
      const event = await store.getIdeaEvent(input.eventId);
      if (!event || event.ideaId !== input.ideaId) {
        res.status(404).json({ error: 'Idea event not found' });
        return;
      }

      const previousEvent = await store.getPreviousIdeaEvent(input.ideaId, input.eventId);
      res.json(ideaEventDiffSchema.parse(computeIdeaEventDiff(event.snapshot, previousEvent?.snapshot)));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/ideas/:id/history/summary', async (req, res, next) => {
    try {
      const input = parseBody(summarizeIdeaHistoryInputSchema, {
        ideaId: req.params.id,
        ...req.body
      }) as z.infer<typeof summarizeIdeaHistoryInputSchema>;
      const events = await store.listIdeaEventsInRange(input.ideaId, input.from, input.to);
      if (events.length === 0 || events[0].id !== input.from || events[events.length - 1].id !== input.to) {
        res.status(404).json({ error: 'Idea event range not found' });
        return;
      }
      if (events.length > MAX_HISTORY_SUMMARY_EVENTS) {
        res.status(400).json({ error: `History summary range exceeds ${MAX_HISTORY_SUMMARY_EVENTS} events` });
        return;
      }

      sendStream(req, res, (emitDelta, signal) => aiService.summarizeIdeaHistoryStream(events, emitDelta, { emitDelta: true, signal }), {
        onErrorPayload: (error) => ({
          done: true,
          fallback: {
            rawOutput: error instanceof Error ? error.message : 'Unknown AI history summary error',
            title: 'History Summary Unavailable',
            message: 'The AI provider failed while summarizing this history range. Showing the raw error output instead.'
          }
        })
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/ideas', async (req: ParsedRequest<SaveIdeaInput>, res, next) => {
    try {
      const body = parseBody(saveIdeaRequestSchema, req.body);
      const idea = await store.saveIdeaWithEventContext(
        normalizeIdeaForStorage(body),
        body.eventContext
      );
      res.status(201).json(idea);
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/ideas/:id', async (req, res, next) => {
    try {
      const idea = await store.updateIdea(req.params.id, parseBody(updateIdeaSchema, req.body));
      res.json(idea);
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/ideas/:id', async (req, res, next) => {
    try {
      await store.deleteIdea(req.params.id);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/folders', async (_req, res, next) => {
    try {
      const folders = await store.listFolders();
      res.json(folders);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/folders', async (req, res, next) => {
    try {
      const folder = await store.saveFolder(parseBody(z.object({
        id: z.string(),
        name: z.string().min(1),
        timestamp: z.number()
      }), req.body));
      res.status(201).json(folder);
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/folders/:id', async (req, res, next) => {
    try {
      await store.deleteFolder(req.params.id);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/settings', async (_req, res, next) => {
    try {
      res.json(await store.getSettings());
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/settings', async (req, res, next) => {
    try {
      const { activeConnectionId } = activeConnectionSchema.parse(req.body);
      res.json(await connectionService().activate(activeConnectionId));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/ai/connections', (_req, res, next) => { try { res.json(connectionService().list()); } catch (error) { next(error); } });
  app.post('/api/ai/connections', (req, res, next) => { try { res.status(201).json(connectionService().create(connectionInputSchema.parse(req.body))); } catch (error) { next(error); } });
  app.patch('/api/ai/connections/:id', async (req, res, next) => { try { res.json(await connectionService().update(req.params.id, req.body)); } catch (error) { next(error); } });
  app.delete('/api/ai/connections/:id', async (req, res, next) => { try { await connectionService().delete(req.params.id); res.status(204).end(); } catch (error) { next(error); } });
  app.put('/api/ai/connections/:id/credential', async (req, res, next) => { try { await connectionService().setCredential(req.params.id, credentialWriteSchema.parse(req.body).apiKey); res.status(204).end(); } catch (error) { next(error); } });
  app.delete('/api/ai/connections/:id/credential', async (req, res, next) => { try { await connectionService().deleteCredential(req.params.id); res.status(204).end(); } catch (error) { next(error); } });
  app.post('/api/ai/connections/:id/test', async (req, res, next) => { try { res.json(await connectionService().test(req.params.id)); } catch (error) { next(error); } });
  app.get('/api/ai/status', async (_req, res, next) => { try { res.json(await connectionService().status()); } catch (error) { next(error); } });
  app.get('/api/ai/openai-auth', async (_req, res, next) => { try { res.json(await openAiAuth.status()); } catch (error) { next(error); } });
  app.post('/api/ai/openai-auth/start', async (_req, res, next) => { try { res.json(await openAiAuth.start()); } catch (error) { next(error); } });
  app.post('/api/ai/openai-auth/logout', async (_req, res, next) => { try { res.json(await openAiAuth.logout()); } catch (error) { next(error); } });
  app.get('/api/ai/proxy-tools', async (_req, res, next) => { try { res.json(await connectionService().proxyTools()); } catch (error) { next(error); } });
  app.get('/api/ai/connections/:id/models', async (req, res, next) => { try { res.json(await connectionService().models(req.params.id)); } catch (error) { next(error); } });
  app.post('/api/ai/retry-migration', async (_req, res, next) => {
    try {
      const service = connectionService(); await migrateSettings(service);
      if (service.migrationError) throw new AiConnectionError('AI_CREDENTIAL_STORE_UNAVAILABLE', service.migrationError, 503);
      res.json({ ok: true });
    } catch (error) { next(error); }
  });
  app.post('/api/ai/migrate-legacy-settings', async (req, res, next) => {
    try {
      const service = connectionService();
      const { settings } = z.object({ settings: legacyAppSettingsSchema }).strict().parse(req.body);
      await migrateSettings(service, settings);
      if (service.migrationError) throw new AiConnectionError('AI_CREDENTIAL_STORE_UNAVAILABLE', service.migrationError, 503);
      res.json(await store.getSettings());
    } catch (error) { next(error); }
  });

  app.post('/api/ai/generate-ideas', async (req, res, next) => {
    try {
      const body = parseBody(generateIdeasSchema, req.body);
      res.json({ ideas: await aiService.generateIdeas(body.prompt, body.image, requestOptions(res)) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/ai/brainstorm', async (req, res, next) => {
    try {
      const body = parseBody(brainstormSchema, req.body);
      res.json({ response: await aiService.brainstorm(body.prompt, body.history ?? [], requestOptions(res)) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/ai/summarize-chat', async (req, res, next) => {
    try {
      const body = parseBody(summarizeChatSchema, req.body);
      res.json({ idea: await aiService.summarizeIdeaFromChat(body.history, requestOptions(res)) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/ai/idea-chat', async (req, res, next) => {
    try {
      const body = parseBody(ideaChatSchema, req.body);
      const idea = await store.getIdea(body.ideaId);
      if (!idea) {
        res.status(404).json({ error: 'Idea not found' });
        return;
      }

      const baseHistory = normalizeChatHistory(body.history, body.prompt, idea.chatHistory);
      const historyForPersistence = [...baseHistory, makeUserMessage(body.prompt)];
      if (body.stream) {
        sendStream(req, res, async (emitDelta, signal) => {
          const fullText = await aiService.chatStream(body.prompt, baseHistory, idea, emitDelta, { emitDelta: true, signal });
          if (body.persist) {
            await store.updateIdea(body.ideaId, {
              chatHistory: [...historyForPersistence, makeAssistantMessage(fullText)]
            });
          }
          return fullText;
        });
        return;
      }

      const response = await aiService.chat(body.prompt, baseHistory, idea, requestOptions(res));
      if (body.persist) {
        await store.updateIdea(body.ideaId, {
          chatHistory: [...historyForPersistence, makeAssistantMessage(response)]
        });
      }
      res.json({ response });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/ai/extract-keywords', async (req, res, next) => {
    try {
      const body = parseBody(ideaReferenceSchema, req.body);
      const idea = await store.getIdea(body.ideaId);
      if (!idea) {
        res.status(404).json({ error: 'Idea not found' });
        return;
      }
      const keywords = await aiService.extractKeywords(idea, requestOptions(res));
      await store.appendIdeaEvent(body.ideaId, 'ai_keywords_extracted', {
        keywordCount: keywords.length,
        keywords
      });
      res.json({ keywords });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/ai/viability-report', async (req, res, next) => {
    try {
      const body = parseBody(z.object({
        ideaId: z.string(),
        stream: z.boolean().optional()
      }), req.body);
      const idea = await store.getIdea(body.ideaId);
      if (!idea) {
        res.status(404).json({ error: 'Idea not found' });
        return;
      }

      if (body.stream) {
        sendStream(req, res, async (emitDelta, signal) => {
          const report = await aiService.generateViabilityReportStream(idea, emitDelta, { emitDelta: true, signal });
          await store.appendIdeaEvent(body.ideaId, 'ai_viability_report_generated', {
            reportLength: report.length
          });
          return report;
        });
        return;
      }

      const report = await aiService.generateViabilityReport(idea, requestOptions(res));
      await store.appendIdeaEvent(body.ideaId, 'ai_viability_report_generated', {
        reportLength: report.length
      });
      res.json({ report });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/ai/competitor-analysis', async (req, res, next) => {
    try {
      const body = parseBody(z.object({
        ideaId: z.string(),
        stream: z.boolean().optional()
      }), req.body);
      const idea = await store.getIdea(body.ideaId);
      if (!idea) {
        res.status(404).json({ error: 'Idea not found' });
        return;
      }

      if (body.stream) {
        sendStream(req, res, async (emitDelta, signal) => {
          const report = await aiService.analyzeCompetitorsStream(idea, emitDelta, { emitDelta: true, signal });
          await store.appendIdeaEvent(body.ideaId, 'ai_competitor_analysis_generated', {
            reportLength: report.length
          });
          return report;
        });
        return;
      }

      const report = await aiService.analyzeCompetitors(idea, requestOptions(res));
      await store.appendIdeaEvent(body.ideaId, 'ai_competitor_analysis_generated', {
        reportLength: report.length
      });
      res.json({ report });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/ai/find-mvp', async (req, res, next) => {
    try {
      const body = parseBody(ideaListReferenceSchema, req.body);
      const ideas = body.ideaIds && body.ideaIds.length > 0
        ? (await Promise.all(body.ideaIds.map((ideaId) => store.getIdea(ideaId)))).filter(isIdea)
        : await store.listIdeas();
      res.json({ results: await aiService.findSimplestMVP(ideas, requestOptions(res)) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/ai/vet', async (req, res, next) => {
    try {
      const body = parseBody(vetIdeasSchema, req.body);
      const ideas = body.ideaIds && body.ideaIds.length > 0
        ? (await Promise.all(body.ideaIds.map((ideaId) => store.getIdea(ideaId)))).filter(isIdea)
        : await store.listIdeas();
      res.json({ results: await aiService.vetIdeas(ideas, body.criteria, requestOptions(res)) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/ai/suggest-folders', async (req, res, next) => {
    try {
      const body = parseBody(suggestFoldersSchema, req.body);
      const ideas = body.ideaIds && body.ideaIds.length > 0
        ? (await Promise.all(body.ideaIds.map((ideaId) => store.getIdea(ideaId)))).filter(isIdea)
        : await store.listIdeas();
      const folders = await store.listFolders();
      res.json({ suggestions: await aiService.suggestFolders(ideas, folders, requestOptions(res)) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/ai/raw-response', async (req, res, next) => {
    try {
      const body = parseBody(z.object({
        prompt: z.string().min(1),
        thinking: z.boolean().optional(),
        jsonMode: z.boolean().optional(), image: z.string().optional(), stream: z.boolean().optional()
      }), req.body);
      if (body.stream) {
        sendStream(req, res, (emitDelta, signal) => aiService.generateResponseStream(body.prompt, emitDelta, body.thinking, body.image, { signal, emitDelta: true }));
        return;
      }
      res.json({
        response: await aiService.generateResponse(body.prompt, body.thinking, body.jsonMode, body.image, requestOptions(res))
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/export', async (_req, res, next) => {
    try {
      res.json(await store.exportData());
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/import', async (req, res, next) => {
    try {
      await importBackup(connectionService(), parseBody(importDataSchema, req.body));
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.all('/mcp', async (req, res, next) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });
    const server = createIdeaMcpServer(store, aiService);
    const transportWithClose = transport as StreamableHTTPServerTransport & { close?: () => Promise<void> | void };
    let cleanedUp = false;
    const cleanup = async () => {
      if (cleanedUp) return;
      cleanedUp = true;
      await Promise.allSettled([
        server.close(),
        Promise.resolve(transportWithClose.close?.())
      ]);
    };

    res.on('close', () => {
      void cleanup();
    });

    try {
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.has(origin)) {
        res.status(403).json({ error: 'Origin not allowed' });
        return;
      }

      await server.connect(transport);
      await transport.handleRequest(req, res, (req as Request & { body?: unknown }).body);
    } catch (error) {
      next(error);
    } finally {
      await cleanup();
    }
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request', details: error.flatten() });
      return;
    }
    if (error instanceof NotFoundError) {
      res.status(404).json({ error: message });
      return;
    }
    if (error instanceof BadRequestError) {
      res.status(400).json({ error: message });
      return;
    }
    if (error instanceof AiConnectionError || error instanceof CredentialStoreError || error instanceof AiProviderError) {
      res.status(error.status).json({ error: message, code: error.code });
      return;
    }
    if (error instanceof StructuredParseError) {
      res.status(502).json({
        error: message,
        kind: error.kind,
        operation: error.operation,
        rawOutput: error.rawOutput
      });
      return;
    }
    res.status(500).json({ error: message });
  });

  return app;
}
