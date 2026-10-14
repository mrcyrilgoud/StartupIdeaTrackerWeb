import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import Database from 'better-sqlite3';

import { AppStore, initializeSchema } from '../server/store.js';
import { createHttpApp } from '../server/app.js';
import { computeIdeaEventDiff } from '../server/ideaHistory.js';
import { createIdeaMcpServer } from '../server/mcp.js';
import type { Idea } from '../src/types.js';

function createStore(): AppStore {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  initializeSchema(sqlite);
  return new AppStore(sqlite);
}

function makeIdea(overrides: Partial<Idea> = {}): Idea {
  return {
    id: 'idea-1',
    title: 'Original title',
    details: 'Original details',
    timestamp: 1,
    keywords: [],
    chatHistory: [],
    relatedIdeas: [],
    status: 'draft',
    ...overrides
  };
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

test('idea event snapshots survive after the live idea row is deleted', async () => {
  const store = createStore();

  await store.saveIdea(makeIdea());
  await store.updateIdea('idea-1', {
    details: 'Updated details'
  });

  const [updateEvent] = await store.listIdeaEvents('idea-1', { limit: 1 });
  assert.equal(updateEvent.type, 'idea_updated');
  assert.equal(updateEvent.snapshot.details, 'Updated details');

  await store.deleteIdea('idea-1');

  const persistedEvent = await store.getIdeaEvent(updateEvent.id);
  assert.ok(persistedEvent);
  assert.equal(persistedEvent.snapshot.details, 'Updated details');
  assert.equal(persistedEvent.ideaId, 'idea-1');
});

test('chat append preserves the full history and event snapshot while avoiding relation rewrites', async () => {
  const history = Array.from({ length: 120 }, (_, index) => ({
    id: `message-${index}`,
    role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
    content: `Message ${index}`,
    timestamp: index + 1
  }));
  const appendStore = createStore();
  const fullPatchStore = createStore();
  const idea = makeIdea({ chatHistory: history });
  await appendStore.saveIdea(idea);
  await fullPatchStore.saveIdea(idea);

  const appendSqlite = (appendStore as unknown as { sqlite: Database.Database }).sqlite;
  const fullPatchSqlite = (fullPatchStore as unknown as { sqlite: Database.Database }).sqlite;
  const appendChangesBefore = appendSqlite.prepare('SELECT total_changes() AS count').get() as { count: number };
  const fullChangesBefore = fullPatchSqlite.prepare('SELECT total_changes() AS count').get() as { count: number };
  const nextMessage = {
    id: 'message-120',
    role: 'assistant' as const,
    content: 'Appended response',
    timestamp: 121
  };

  const appended = await appendStore.updateIdea('idea-1', { chatAppend: [nextMessage] });
  const fullPatched = await fullPatchStore.updateIdea('idea-1', { chatHistory: [...history, nextMessage] });
  const appendChangesAfter = appendSqlite.prepare('SELECT total_changes() AS count').get() as { count: number };
  const fullChangesAfter = fullPatchSqlite.prepare('SELECT total_changes() AS count').get() as { count: number };

  assert.deepEqual(appended.chatHistory, fullPatched.chatHistory);
  assert.equal(appended.chatHistory.length, 121);
  assert.equal((await appendStore.listIdeaEvents('idea-1', { limit: 1 }))[0].snapshot.chatHistory.length, 121);
  assert.ok(appendChangesAfter.count - appendChangesBefore.count < fullChangesAfter.count - fullChangesBefore.count);
});

test('concurrent chat appends are serialized without losing either response', async () => {
  const store = createStore();
  await store.saveIdea(makeIdea());

  await Promise.all([
    store.updateIdea('idea-1', { chatAppend: [{ id: 'message-a', role: 'assistant', content: 'A', timestamp: 1 }] }),
    store.updateIdea('idea-1', { chatAppend: [{ id: 'message-b', role: 'assistant', content: 'B', timestamp: 2 }] })
  ]);

  assert.deepEqual((await store.getIdea('idea-1'))?.chatHistory.map((message) => message.id), ['message-a', 'message-b']);
});

test('MCP idea chat persists only the new exchange through the append contract', async () => {
  const store = createStore();
  await store.saveIdea(makeIdea({
    chatHistory: [{ id: 'existing', role: 'user', content: 'Existing prompt', timestamp: 1 }]
  }));
  const mcpServer = createIdeaMcpServer(store, {
    brainstorm: async () => '',
    summarizeIdeaFromChat: async () => ({ title: '', details: '' }),
    chat: async (_prompt, history) => `history:${history.length}`,
    generateIdeas: async () => [],
    extractKeywords: async () => [],
    generateViabilityReport: async () => '',
    analyzeCompetitors: async () => '',
    findSimplestMVP: async () => [],
    vetIdeas: async () => [],
    suggestFolders: async () => [],
    summarizeIdeaHistoryStream: async () => ''
  } as never);

  const chatTool = (mcpServer as unknown as {
    _registeredTools: Record<string, { handler: (input: unknown, extra: unknown) => Promise<{ structuredContent: { idea: Idea } }> }>;
  })._registeredTools['ideas.chat'];
  const result = await chatTool.handler({ ideaId: 'idea-1', prompt: 'New prompt', persist: true }, {});
  assert.equal(result.structuredContent.idea.chatHistory.length, 3);
  assert.deepEqual(result.structuredContent.idea.chatHistory.map((message) => message.role), ['user', 'user', 'assistant']);
  assert.equal(result.structuredContent.idea.chatHistory.at(-1)?.content, 'history:1');
});

test('idea summaries paginate without hydrating chat, related ideas, or vetting data', async () => {
  const store = createStore();
  await store.saveIdea(makeIdea({
    id: 'idea-1',
    title: 'First',
    details: 'First details',
    keywords: ['alpha'],
    chatHistory: [{ id: 'message-1', role: 'user', content: 'Long history', timestamp: 1 }],
    relatedIdeas: ['idea-2'],
    vetting: { realism: { ideaId: 'idea-1', criteria: 'realism', score: 8, reason: 'Good', timestamp: 1 } }
  }));
  await store.saveIdea(makeIdea({ id: 'idea-2', title: 'Second' }));
  await store.saveIdea(makeIdea({ id: 'idea-3', title: 'Third' }));

  const firstPage = await store.listIdeaSummaries({ limit: 2 });
  assert.equal(firstPage.items.length, 2);
  assert.ok(firstPage.nextCursor);
  assert.deepEqual(firstPage.items[0], {
    id: 'idea-3',
    title: 'Third',
    details: 'Original details',
    timestamp: 1,
    keywords: [],
    status: 'draft'
  });
  assert.equal('chatHistory' in firstPage.items[0], false);
  assert.equal('relatedIdeas' in firstPage.items[0], false);
  assert.equal('vetting' in firstPage.items[0], false);

  const secondPage = await store.listIdeaSummaries({ limit: 2, cursor: firstPage.nextCursor ?? undefined });
  assert.deepEqual(secondPage.items.map((idea) => idea.id), ['idea-1']);
  assert.equal(secondPage.nextCursor, null);
});

test('idea summary endpoint validates cursors and applies filters', async () => {
  const store = createStore();
  await store.saveIdea(makeIdea({ id: 'idea-a', title: 'Alpha', status: 'mvp', folder_id: 'folder-1' }));
  await store.saveIdea(makeIdea({ id: 'idea-b', title: 'Beta', status: 'draft', folder_id: 'folder-2' }));
  const app = createHttpApp(store, {} as never);

  await withHttpApp(app, async (baseUrl) => {
    const filteredResponse = await fetch(`${baseUrl}/api/idea-summaries?status=mvp&folderId=folder-1&query=alp`);
    assert.equal(filteredResponse.status, 200);
    const filtered = await filteredResponse.json() as { items: Array<{ id: string }>; nextCursor: string | null };
    assert.deepEqual(filtered.items.map((idea) => idea.id), ['idea-a']);
    assert.equal(filtered.nextCursor, null);

    const invalidCursorResponse = await fetch(`${baseUrl}/api/idea-summaries?cursor=not-a-valid-cursor`);
    assert.equal(invalidCursorResponse.status, 400);

    const invalidLimitResponse = await fetch(`${baseUrl}/api/idea-summaries?limit=101`);
    assert.equal(invalidLimitResponse.status, 400);
  });
});

test('brainstorm-created ideas record both creation and brainstorm-summary events', async () => {
  const store = createStore();

  await store.saveIdeaWithEventContext(makeIdea({
    id: 'brainstorm-idea',
    chatHistory: [{
      id: 'msg-1',
      role: 'user',
      content: 'Turn this into an idea',
      timestamp: 1
    }]
  }), {
    type: 'ai_brainstorm_summarized',
    payload: {
      degraded: false,
      sourceChatTurns: 1
    }
  });

  const events = await store.listIdeaEvents('brainstorm-idea', { limit: 10 });
  assert.deepEqual(
    events.map((event) => event.type),
    ['ai_brainstorm_summarized', 'idea_created']
  );
});

test('idea events endpoint paginates newest-first with before cursor', async () => {
  const store = createStore();
  await store.saveIdea(makeIdea());
  await store.updateIdea('idea-1', { details: 'Details v2' });
  await store.updateIdea('idea-1', { details: 'Details v3' });
  await store.updateIdea('idea-1', { details: 'Details v4' });

  const app = createHttpApp(store, {} as never);

  await withHttpApp(app, async (baseUrl) => {
    const firstPageResponse = await fetch(`${baseUrl}/api/ideas/idea-1/events?limit=2`);
    assert.equal(firstPageResponse.status, 200);
    const firstPage = await firstPageResponse.json() as { events: Array<{ id: number; snapshot: Idea }> };
    assert.equal(firstPage.events.length, 2);
    assert.ok(firstPage.events[0].id > firstPage.events[1].id);
    assert.equal(firstPage.events[0].snapshot.details, 'Details v4');
    assert.equal(firstPage.events[1].snapshot.details, 'Details v3');

    const before = firstPage.events[1].id;
    const secondPageResponse = await fetch(`${baseUrl}/api/ideas/idea-1/events?limit=2&before=${before}`);
    assert.equal(secondPageResponse.status, 200);
    const secondPage = await secondPageResponse.json() as { events: Array<{ id: number; snapshot: Idea }> };
    assert.equal(secondPage.events.length, 2);
    assert.deepEqual(
      secondPage.events.map((event) => event.snapshot.details),
      ['Details v2', 'Original details']
    );
    assert.ok(secondPage.events.every((event) => event.id < before));
  });
});

test('idea event diff computation returns scalar, keyword, and chat deltas for synthetic snapshots', () => {
  const previous = makeIdea({
    details: 'Before',
    analysis: 'Old analysis',
    keywords: ['alpha', 'beta'],
    chatHistory: [{
      id: 'msg-1',
      role: 'user',
      content: 'First turn',
      timestamp: 1
    }]
  });
  const current = makeIdea({
    details: 'After',
    analysis: 'New analysis',
    keywords: ['beta', 'gamma'],
    chatHistory: [
      {
        id: 'msg-1',
        role: 'user',
        content: 'First turn',
        timestamp: 1
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'Second turn',
        timestamp: 2
      }
    ]
  });

  const diff = computeIdeaEventDiff(current, previous);
  assert.deepEqual(diff.fields, [
    { name: 'details', before: 'Before', after: 'After' },
    { name: 'analysis', before: 'Old analysis', after: 'New analysis' }
  ]);
  assert.equal(diff.chatTurnsAdded, 1);
  assert.deepEqual(diff.keywordsAdded, ['gamma']);
  assert.deepEqual(diff.keywordsRemoved, ['alpha']);
});

test('idea history summary endpoint streams provider output for a valid event range', async () => {
  const store = createStore();
  await store.saveIdea(makeIdea());
  await store.updateIdea('idea-1', { details: 'Details v2' });
  const events = await store.listIdeaEvents('idea-1', { limit: 10 });
  const ordered = [...events].reverse();

  const app = createHttpApp(store, {
    summarizeIdeaHistoryStream: async (_historyEvents: unknown[], onChunk: (text: string) => void) => {
      onChunk('History ');
      onChunk('summary');
      return 'History summary';
    }
  } as never);

  await withHttpApp(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/ideas/idea-1/history/summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: ordered[0].id,
        to: ordered[ordered.length - 1].id
      })
    });

    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /"delta":"History "/);
    assert.match(body, /"delta":"summary"/);
    assert.match(body, /"done":true,"fullText":"History summary"/);
  });
});

test('idea history summary endpoint emits fallback payload when the provider fails', async () => {
  const store = createStore();
  await store.saveIdea(makeIdea());
  const [event] = await store.listIdeaEvents('idea-1', { limit: 1 });

  const app = createHttpApp(store, {
    summarizeIdeaHistoryStream: async () => {
      throw new Error('provider offline');
    }
  } as never);

  await withHttpApp(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/ideas/idea-1/history/summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: event.id,
        to: event.id
      })
    });

    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /"fallback":\{"rawOutput":"provider offline"/);
    assert.match(body, /"title":"History Summary Unavailable"/);
  });
});

test('MCP server registers idea history tools with the expected contract shapes', () => {
  const server = createIdeaMcpServer(createStore(), {
    brainstorm: async () => '',
    summarizeIdeaFromChat: async () => ({ title: '', details: '' }),
    chat: async () => '',
    generateIdeas: async () => [],
    extractKeywords: async () => [],
    generateViabilityReport: async () => '',
    analyzeCompetitors: async () => '',
    findSimplestMVP: async () => [],
    vetIdeas: async () => [],
    suggestFolders: async () => [],
    summarizeIdeaHistoryStream: async () => ''
  } as never);

  const registeredTools = (server as unknown as {
    _registeredTools: Record<string, { inputSchema: { parse: (value: unknown) => unknown } }>;
  })._registeredTools;

  assert.ok(registeredTools.list_idea_events);
  assert.ok(registeredTools.diff_idea_event);
  assert.ok(registeredTools.summarize_idea_history);

  assert.deepEqual(
    registeredTools.list_idea_events.inputSchema.parse({ ideaId: 'idea-1', limit: 10, before: 25 }),
    { ideaId: 'idea-1', limit: 10, before: 25 }
  );
  assert.deepEqual(
    registeredTools.diff_idea_event.inputSchema.parse({ ideaId: 'idea-1', eventId: 25 }),
    { ideaId: 'idea-1', eventId: 25 }
  );
  assert.deepEqual(
    registeredTools.summarize_idea_history.inputSchema.parse({ ideaId: 'idea-1', from: 10, to: 25 }),
    { ideaId: 'idea-1', from: 10, to: 25 }
  );
});
