import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { saveIdeaSchema, updateIdeaSchema } from './contracts.js';
import type { BackendAiService } from './ai.js';
import type { AppStore } from './store.js';
import type { ChatMessage, Idea } from '../src/types.js';

function toolResult(text: string, structuredContent: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text }],
    structuredContent
  };
}

function isIdea(value: Awaited<ReturnType<AppStore['getIdea']>>): value is NonNullable<Awaited<ReturnType<AppStore['getIdea']>>> {
  return Boolean(value);
}

function normalizeIdeaForStorage(input: z.infer<typeof saveIdeaSchema>): Idea {
  return {
    ...input,
    folder_id: input.folder_id ?? undefined
  };
}

function normalizeChatHistory(history: ChatMessage[], prompt: string): ChatMessage[] {
  const normalized = [...history];
  const lastMessage = normalized[normalized.length - 1];

  if (lastMessage?.role === 'user' && lastMessage.content === prompt) {
    normalized.pop();
  }

  return normalized;
}

export function createIdeaMcpServer(store: AppStore, aiService: BackendAiService): McpServer {
  const server = new McpServer({
    name: 'startup-idea-tracker',
    version: '1.0.0'
  }, {
    instructions: 'Use these tools to inspect and manage startup ideas stored in the local Startup Idea Tracker app.'
  });

  server.registerTool('ideas.list', {
    description: 'List startup ideas, optionally filtered by text, status, or folder.',
    inputSchema: z.object({
      query: z.string().optional(),
      status: z.enum(['draft', 'validation', 'mvp', 'completed', 'archived']).optional(),
      folderId: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional()
    })
  }, async (input) => {
    const ideas = await store.listIdeas(input ?? {});
    return toolResult(`Returned ${ideas.length} ideas.`, { ideas });
  });

  server.registerTool('ideas.search', {
    description: 'Search startup ideas and folders by free text.',
    inputSchema: z.object({
      query: z.string().min(1),
      limit: z.number().int().min(1).max(50).optional()
    })
  }, async ({ query, limit }) => {
    const results = await store.search(query, limit);
    return toolResult(`Found ${results.length} matching records.`, { results });
  });

  server.registerTool('ideas.get', {
    description: 'Get a single startup idea by id.',
    inputSchema: z.object({
      ideaId: z.string()
    })
  }, async ({ ideaId }) => {
    const idea = await store.getIdea(ideaId);
    if (!idea) {
      throw new Error(`Idea ${ideaId} not found.`);
    }
    return toolResult(`Fetched idea ${idea.title}.`, { idea });
  });

  server.registerTool('ideas.create', {
    description: 'Create a new startup idea.',
    inputSchema: saveIdeaSchema
  }, async (input) => {
    const idea = await store.saveIdea(normalizeIdeaForStorage(input));
    return toolResult(`Created idea ${idea.title}.`, { idea });
  });

  server.registerTool('ideas.update', {
    description: 'Update an existing startup idea.',
    inputSchema: z.object({
      ideaId: z.string(),
      patch: updateIdeaSchema
    })
  }, async ({ ideaId, patch }) => {
    const idea = await store.updateIdea(ideaId, patch);
    return toolResult(`Updated idea ${idea.title}.`, { idea });
  });

  server.registerTool('folders.list', {
    description: 'List idea folders.',
    inputSchema: z.object({})
  }, async () => {
    const folders = await store.listFolders();
    return toolResult(`Returned ${folders.length} folders.`, { folders });
  });

  server.registerTool('folders.create', {
    description: 'Create a new idea folder.',
    inputSchema: z.object({
      id: z.string().optional(),
      name: z.string().min(1),
      timestamp: z.number().optional()
    })
  }, async ({ id, name, timestamp }) => {
    const folder = await store.saveFolder({
      id: id ?? randomUUID(),
      name,
      timestamp: timestamp ?? Date.now()
    });
    return toolResult(`Created folder ${folder.name}.`, { folder });
  });

  server.registerTool('brainstorm.chat', {
    description: 'Run a brainstorming chat turn.',
    inputSchema: z.object({
      prompt: z.string().min(1),
      history: z.array(z.object({
        id: z.string(),
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string(),
        timestamp: z.number()
      })).optional()
    })
  }, async ({ prompt, history }) => {
    const response = await aiService.brainstorm(prompt, history ?? []);
    return toolResult('Brainstorming response generated.', { response });
  });

  server.registerTool('brainstorm.summarize_to_idea', {
    description: 'Summarize a brainstorming chat into a concrete idea draft.',
    inputSchema: z.object({
      history: z.array(z.object({
        id: z.string(),
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string(),
        timestamp: z.number()
      }))
    })
  }, async ({ history }) => {
    const idea = await aiService.summarizeIdeaFromChat(history);
    return toolResult('Generated idea summary from brainstorm.', { idea });
  });

  server.registerTool('ideas.chat', {
    description: 'Run an advisor chat turn against an existing idea and persist the exchange by default.',
    inputSchema: z.object({
      ideaId: z.string(),
      prompt: z.string().min(1),
      persist: z.boolean().default(true)
    })
  }, async ({ ideaId, prompt, persist }) => {
    const idea = await store.getIdea(ideaId);
    if (!idea) {
      throw new Error(`Idea ${ideaId} not found.`);
    }

    const baseHistory = normalizeChatHistory(idea.chatHistory, prompt);
    const userMessage = {
      id: randomUUID(),
      role: 'user' as const,
      content: prompt,
      timestamp: Date.now()
    };
    const response = await aiService.chat(prompt, baseHistory, idea);
    const assistantMessage = {
      id: randomUUID(),
      role: 'assistant' as const,
      content: response,
      timestamp: Date.now()
    };

    let updatedIdea = idea;
    if (persist) {
      updatedIdea = await store.updateIdea(ideaId, {
        chatHistory: [...baseHistory, userMessage, assistantMessage]
      });
    }

    return toolResult('Generated idea chat response.', {
      response,
      persisted: persist,
      idea: updatedIdea
    });
  });

  server.registerTool('ai.generate_ideas', {
    description: 'Generate new startup ideas from a prompt.',
    inputSchema: z.object({
      prompt: z.string().min(1),
      image: z.string().optional()
    })
  }, async ({ prompt, image }) => {
    const ideas = await aiService.generateIdeas(prompt, image);
    return toolResult(`Generated ${ideas.length} ideas.`, { ideas });
  });

  server.registerTool('ai.extract_keywords', {
    description: 'Extract keywords for an existing idea.',
    inputSchema: z.object({
      ideaId: z.string()
    })
  }, async ({ ideaId }) => {
    const idea = await store.getIdea(ideaId);
    if (!idea) {
      throw new Error(`Idea ${ideaId} not found.`);
    }
    const keywords = await aiService.extractKeywords(idea);
    return toolResult(`Extracted ${keywords.length} keywords.`, { keywords });
  });

  server.registerTool('ai.generate_viability_report', {
    description: 'Generate a business viability report for an idea.',
    inputSchema: z.object({
      ideaId: z.string()
    })
  }, async ({ ideaId }) => {
    const idea = await store.getIdea(ideaId);
    if (!idea) {
      throw new Error(`Idea ${ideaId} not found.`);
    }
    const report = await aiService.generateViabilityReport(idea);
    return toolResult('Generated viability report.', { report });
  });

  server.registerTool('ai.generate_competitor_analysis', {
    description: 'Generate a competitor analysis report for an idea.',
    inputSchema: z.object({
      ideaId: z.string()
    })
  }, async ({ ideaId }) => {
    const idea = await store.getIdea(ideaId);
    if (!idea) {
      throw new Error(`Idea ${ideaId} not found.`);
    }
    const report = await aiService.analyzeCompetitors(idea);
    return toolResult('Generated competitor analysis.', { report });
  });

  server.registerTool('ai.find_simplest_mvp', {
    description: 'Score ideas by MVP simplicity.',
    inputSchema: z.object({
      ideaIds: z.array(z.string()).optional()
    })
  }, async ({ ideaIds }) => {
    const ideas = ideaIds && ideaIds.length > 0
      ? (await Promise.all(ideaIds.map((ideaId) => store.getIdea(ideaId)))).filter(isIdea)
      : await store.listIdeas();
    const results = await aiService.findSimplestMVP(ideas);
    return toolResult('Generated MVP simplicity analysis.', { results });
  });

  server.registerTool('ai.vet_ideas', {
    description: 'Vet ideas against a realism, creativity, uniqueness, or legality criterion.',
    inputSchema: z.object({
      criteria: z.enum(['realism', 'creativity', 'uniqueness', 'legality']),
      ideaIds: z.array(z.string()).optional()
    })
  }, async ({ criteria, ideaIds }) => {
    const ideas = ideaIds && ideaIds.length > 0
      ? (await Promise.all(ideaIds.map((ideaId) => store.getIdea(ideaId)))).filter(isIdea)
      : await store.listIdeas();
    const results = await aiService.vetIdeas(ideas, criteria);
    return toolResult('Generated vetting results.', { results });
  });

  server.registerTool('ai.suggest_folders', {
    description: 'Suggest folder groupings for ideas.',
    inputSchema: z.object({
      ideaIds: z.array(z.string()).optional()
    })
  }, async ({ ideaIds }) => {
    const ideas = ideaIds && ideaIds.length > 0
      ? (await Promise.all(ideaIds.map((ideaId) => store.getIdea(ideaId)))).filter(isIdea)
      : await store.listIdeas();
    const folders = await store.listFolders();
    const suggestions = await aiService.suggestFolders(ideas, folders);
    return toolResult('Generated folder suggestions.', { suggestions });
  });

  server.registerTool('search', {
    description: 'Compatibility search tool for research-style clients.',
    inputSchema: z.object({
      query: z.string().min(1),
      limit: z.number().int().min(1).max(50).optional()
    })
  }, async ({ query, limit }) => {
    const results = await store.search(query, limit);
    return toolResult(`Found ${results.length} search results.`, { results });
  });

  server.registerTool('fetch', {
    description: 'Compatibility fetch tool for research-style clients.',
    inputSchema: z.object({
      entity: z.enum(['idea', 'folder']),
      id: z.string()
    })
  }, async ({ entity, id }) => {
    if (entity === 'folder') {
      const folders = await store.listFolders();
      const folder = folders.find((candidate) => candidate.id === id);
      if (!folder) {
        throw new Error(`Folder ${id} not found.`);
      }
      return toolResult(`Fetched folder ${folder.name}.`, { folder });
    }

    const idea = await store.getIdea(id);
    if (!idea) {
      throw new Error(`Idea ${id} not found.`);
    }
    return toolResult(`Fetched idea ${idea.title}.`, { idea });
  });

  return server;
}
