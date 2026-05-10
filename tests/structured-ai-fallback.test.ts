import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AddressInfo } from 'node:net';

import { BackendAiService, StructuredParseError as ServerStructuredParseError } from '../server/ai.js';
import { createHttpApp } from '../server/app.js';
import { summarizeBrainstormToIdeaWithFallback } from '../server/brainstorm.js';
import { StructuredAiFallback } from '../src/components/StructuredAiFallback.js';
import { aiService, StructuredParseError as ClientStructuredParseError } from '../src/services/ai.js';
import type { AppSettings, ChatMessage, Idea } from '../src/types.js';
import { DEFAULT_APP_SETTINGS } from '../src/types.js';
import { BRAINSTORM_FALLBACK_TITLE, buildBrainstormFallbackIdea, buildBrainstormFallbackSummary } from '../shared/structuredAiFallback.js';

const TEST_SETTINGS: AppSettings = {
  ...DEFAULT_APP_SETTINGS,
  geminiKey: 'test-key'
};

const TEST_IDEA: Idea = {
  id: 'idea-1',
  title: 'Test Idea',
  details: 'Test details',
  timestamp: 1,
  keywords: [],
  chatHistory: [],
  relatedIdeas: [],
  status: 'draft'
};

const TEST_HISTORY: ChatMessage[] = [{
  id: 'msg-1',
  role: 'user',
  content: 'Summarize this chat',
  timestamp: 1
}];

class StructuredOutputTestAiService extends BackendAiService {
  constructor(private readonly responseText: string) {
    super(async () => TEST_SETTINGS);
  }

  override async generateResponse(): Promise<string> {
    return this.responseText;
  }
}

async function withHttpApp<T>(app: ReturnType<typeof createHttpApp>, run: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    return await run(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

test('backend structured-output methods throw StructuredParseError with operation and raw output', async () => {
  const arrayService = new StructuredOutputTestAiService('not valid structured output');
  const objectService = new StructuredOutputTestAiService('not valid structured output');

  const cases: Array<{
    operation: string;
    run: () => Promise<unknown>;
  }> = [
    {
      operation: 'generate_ideas',
      run: () => arrayService.generateIdeas('prompt')
    },
    {
      operation: 'find_simplest_mvp',
      run: () => arrayService.findSimplestMVP([TEST_IDEA])
    },
    {
      operation: 'suggest_folders',
      run: () => arrayService.suggestFolders([TEST_IDEA], [{ name: 'Existing Folder' }])
    },
    {
      operation: 'vet_ideas',
      run: () => arrayService.vetIdeas([TEST_IDEA], 'realism')
    },
    {
      operation: 'summarize_chat',
      run: () => objectService.summarizeIdeaFromChat(TEST_HISTORY)
    }
  ];

  for (const { operation, run } of cases) {
    await assert.rejects(run, (error: unknown) => {
      assert.ok(error instanceof ServerStructuredParseError);
      assert.equal(error.operation, operation);
      assert.equal(error.rawOutput, 'not valid structured output');
      return true;
    });
  }
});

test('structured AI API endpoints return 502 payloads with raw output', async () => {
  const store = {
    getIdea: async (id: string) => (id === TEST_IDEA.id ? TEST_IDEA : undefined),
    listIdeas: async () => [TEST_IDEA],
    listFolders: async () => [{ id: 'folder-1', name: 'Existing Folder', timestamp: 1 }]
  };

  const ai = {
    generateIdeas: async () => { throw new ServerStructuredParseError('generate_ideas', 'plain text output'); },
    summarizeIdeaFromChat: async () => { throw new ServerStructuredParseError('summarize_chat', 'plain text output'); },
    findSimplestMVP: async () => { throw new ServerStructuredParseError('find_simplest_mvp', 'plain text output'); },
    vetIdeas: async () => { throw new ServerStructuredParseError('vet_ideas', 'plain text output'); },
    suggestFolders: async () => { throw new ServerStructuredParseError('suggest_folders', 'plain text output'); }
  };

  const app = createHttpApp(store as never, ai as never);

  await withHttpApp(app, async (baseUrl) => {
    const cases = [
      { endpoint: '/api/ai/generate-ideas', body: { prompt: 'Generate ideas' }, operation: 'generate_ideas' },
      { endpoint: '/api/ai/summarize-chat', body: { history: TEST_HISTORY }, operation: 'summarize_chat' },
      { endpoint: '/api/ai/find-mvp', body: { ideaIds: [TEST_IDEA.id] }, operation: 'find_simplest_mvp' },
      { endpoint: '/api/ai/vet', body: { criteria: 'realism', ideaIds: [TEST_IDEA.id] }, operation: 'vet_ideas' },
      { endpoint: '/api/ai/suggest-folders', body: { ideaIds: [TEST_IDEA.id] }, operation: 'suggest_folders' }
    ];

    for (const { endpoint, body, operation } of cases) {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      assert.equal(response.status, 502);
      const payload = await response.json() as {
        kind: string;
        operation: string;
        rawOutput: string;
        error: string;
      };
      assert.equal(payload.kind, 'structured_parse_failed');
      assert.equal(payload.operation, operation);
      assert.equal(payload.rawOutput, 'plain text output');
      assert.equal(payload.error, 'AI response was not valid JSON');
    }
  });
});

test('frontend ai service reconstructs StructuredParseError from API failures', async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      error: 'AI response was not valid JSON',
      kind: 'structured_parse_failed',
      operation: 'generate_ideas',
      rawOutput: 'plain text output'
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });

    await assert.rejects(
      () => aiService.generateIdeas('prompt', TEST_SETTINGS),
      (error: unknown) => {
        assert.ok(error instanceof ClientStructuredParseError);
        assert.equal(error.operation, 'generate_ideas');
        assert.equal(error.rawOutput, 'plain text output');
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('frontend ai service keeps ordinary API failures as ordinary errors', async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      error: 'Something else failed'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });

    await assert.rejects(
      () => aiService.generateIdeas('prompt', TEST_SETTINGS),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error instanceof ClientStructuredParseError, false);
        assert.equal(error.message, 'Something else failed');
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('brainstorm fallback helpers produce the persisted draft contract', () => {
  const summary = buildBrainstormFallbackSummary('plain text output');
  assert.deepEqual(summary, {
    title: BRAINSTORM_FALLBACK_TITLE,
    details: 'plain text output'
  });

  const idea = buildBrainstormFallbackIdea('plain text output', TEST_HISTORY, 'draft-1', 123);
  assert.deepEqual(idea, {
    id: 'draft-1',
    title: BRAINSTORM_FALLBACK_TITLE,
    details: 'plain text output',
    timestamp: 123,
    keywords: [],
    chatHistory: TEST_HISTORY,
    relatedIdeas: [],
    status: 'draft'
  });
});

test('summarizeBrainstormToIdeaWithFallback degrades to a fallback summary instead of throwing', async () => {
  const result = await summarizeBrainstormToIdeaWithFallback({
    summarizeIdeaFromChat: async () => {
      throw new ServerStructuredParseError('summarize_chat', 'plain text output');
    }
  } as BackendAiService, TEST_HISTORY);

  assert.equal(result.degraded, true);
  assert.equal(result.rawOutput, 'plain text output');
  assert.deepEqual(result.idea, {
    title: BRAINSTORM_FALLBACK_TITLE,
    details: 'plain text output'
  });
});

test('StructuredAiFallback renders the raw output content', () => {
  const html = renderToStaticMarkup(React.createElement(StructuredAiFallback, {
    title: 'Fallback',
    rawOutput: 'plain text output'
  }));

  assert.match(html, /Fallback/);
  assert.match(html, /plain text output/);
});
