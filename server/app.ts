import { randomUUID } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { appSettingsSchema, brainstormSchema, folderSchema, generateIdeasSchema, ideaChatSchema, ideaListQuerySchema, ideaReferenceSchema, ideaListReferenceSchema, importDataSchema, saveIdeaSchema, suggestFoldersSchema, summarizeChatSchema, updateIdeaSchema, vetIdeasSchema } from './contracts.js';
import { createIdeaMcpServer } from './mcp.js';
import { getAllowedOrigins, SERVER_HOST } from './config.js';
import { NotFoundError } from './errors.js';
import type { BackendAiService } from './ai.js';
import type { AppStore } from './store.js';
import type { ChatMessage, Idea } from '../src/types.js';

type ParsedRequest<T> = Request<Record<string, string>, unknown, T>;
type SaveIdeaInput = z.infer<typeof saveIdeaSchema>;

function parseBody<T>(schema: z.ZodSchema<T>, value: unknown): T {
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
  return {
    ...input,
    folder_id: input.folder_id ?? undefined
  };
}

function normalizeImportPayload(payload: z.infer<typeof importDataSchema>): {
  ideas?: Idea[];
  folders?: z.infer<typeof folderSchema>[];
  settings?: Partial<z.infer<typeof appSettingsSchema>>;
} {
  return {
    ...payload,
    ideas: payload.ideas?.map(normalizeIdeaForStorage)
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
  runner: (emitDelta: (delta: string) => void, signal: AbortSignal) => Promise<string>
): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const controller = new AbortController();
  req.on('close', () => controller.abort());

  let fullText = '';
  const emitDelta = (delta: string) => {
    fullText += delta;
    res.write(`data: ${JSON.stringify({ delta, fullText })}\n\n`);
  };

  void runner(emitDelta, controller.signal)
    .then((finalText) => {
      res.write(`data: ${JSON.stringify({ done: true, fullText: finalText })}\n\n`);
    })
    .catch((error: unknown) => {
      if (controller.signal.aborted) {
        return;
      }
      const message = error instanceof Error ? error.message : 'Unknown streaming error';
      res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    })
    .finally(() => {
      res.end();
    });
}

export function createHttpApp(store: AppStore, aiService: BackendAiService) {
  const app = express();
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

  app.post('/api/ideas', async (req: ParsedRequest<SaveIdeaInput>, res, next) => {
    try {
      const idea = await store.saveIdea(normalizeIdeaForStorage(parseBody(saveIdeaSchema, req.body)));
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
      res.json(await store.saveSettings(parseBody(appSettingsSchema, req.body)));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/ai/generate-ideas', async (req, res, next) => {
    try {
      const body = parseBody(generateIdeasSchema, req.body);
      res.json({ ideas: await aiService.generateIdeas(body.prompt, body.image) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/ai/brainstorm', async (req, res, next) => {
    try {
      const body = parseBody(brainstormSchema, req.body);
      res.json({ response: await aiService.brainstorm(body.prompt, body.history ?? []) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/ai/summarize-chat', async (req, res, next) => {
    try {
      const body = parseBody(summarizeChatSchema, req.body);
      res.json({ idea: await aiService.summarizeIdeaFromChat(body.history) });
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

      const response = await aiService.chat(body.prompt, baseHistory, idea);
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
      res.json({ keywords: await aiService.extractKeywords(idea) });
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
        sendStream(req, res, (emitDelta, signal) => aiService.generateViabilityReportStream(idea, emitDelta, { emitDelta: true, signal }));
        return;
      }

      res.json({ report: await aiService.generateViabilityReport(idea) });
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
        sendStream(req, res, (emitDelta, signal) => aiService.analyzeCompetitorsStream(idea, emitDelta, { emitDelta: true, signal }));
        return;
      }

      res.json({ report: await aiService.analyzeCompetitors(idea) });
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
      res.json({ results: await aiService.findSimplestMVP(ideas) });
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
      res.json({ results: await aiService.vetIdeas(ideas, body.criteria) });
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
      res.json({ suggestions: await aiService.suggestFolders(ideas, folders) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/ai/raw-response', async (req, res, next) => {
    try {
      const body = parseBody(z.object({
        prompt: z.string().min(1),
        thinking: z.boolean().optional(),
        jsonMode: z.boolean().optional()
      }), req.body);
      res.json({
        response: await aiService.generateResponse(body.prompt, body.thinking, body.jsonMode)
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
      await store.importData(normalizeImportPayload(parseBody(importDataSchema, req.body)));
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.all('/mcp', async (req, res, next) => {
    try {
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.has(origin)) {
        res.status(403).json({ error: 'Origin not allowed' });
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined
      });
      const server = createIdeaMcpServer(store, aiService);
      await server.connect(transport);
      await transport.handleRequest(req, res, (req as Request & { body?: unknown }).body);
      await server.close();
    } catch (error) {
      next(error);
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
    res.status(500).json({ error: message });
  });

  return app;
}
