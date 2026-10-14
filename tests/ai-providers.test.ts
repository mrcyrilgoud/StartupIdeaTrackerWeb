import assert from 'node:assert/strict';
import test from 'node:test';
import { BackendAiService, StructuredParseError } from '../server/ai.js';
import { createProvider, getCapabilities, type AiConnection } from '../server/ai/providers/index.js';
import { AiProviderError, providerHttpError } from '../server/ai/providers/errors.js';
import type { Idea } from '../src/types.js';

const connection = (provider: Extract<AiConnection, { kind: 'api' }>['provider']): AiConnection => ({
  id: 'test', name: 'Test', kind: 'api', provider, model: 'explicit-model', hasKey: true, revision: 1,
  ...(['ollama', 'openai_compatible'].includes(provider) ? { baseUrl: 'https://custom.example/v1' } : {})
});
const proxy: AiConnection = { id: 'cli', name: 'CLI', kind: 'cli_proxy', tool: 'codex', model: 'explicit-model', revision: 1 };
const responsePayloads = {
  openai: { output: [{ content: [{ type: 'output_text', text: 'OK' }] }] },
  anthropic: { content: [{ type: 'text', text: 'OK' }] },
  gemini: { candidates: [{ content: { parts: [{ text: 'O' }, { text: 'K' }] } }] },
  openai_compatible: { choices: [{ message: { content: 'OK' } }] },
  ollama: { response: 'OK' }
};
const errorCode = (code: string) => (error: unknown) => {
  assert.ok(error instanceof AiProviderError);
  assert.equal(error.code, code);
  assert.equal(error.message.includes('secret'), false);
  return true;
};
function streamed(raw: string, size = 3): Response {
  const bytes = new TextEncoder().encode(raw);
  return new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size));
      controller.close();
    }
  }));
}

for (const provider of Object.keys(responsePayloads) as Array<keyof typeof responsePayloads>) {
  test(`${provider}: explicit model, endpoint, token cap and header-only credentials`, async () => {
    let calls = 0;
    const mock: typeof fetch = async (input, init) => {
      calls++;
      const url = String(input);
      const body = JSON.parse(String(init?.body));
      const headers = new Headers(init?.headers);
      assert.equal(url.includes('secret'), false);
      assert.equal(String(init?.body).includes('secret'), false);
      assert.equal(init?.redirect, 'manual');
      assert.ok(init?.signal);
      if (provider === 'gemini') {
        assert.match(url, /models\/explicit-model:generateContent$/);
        assert.equal(headers.get('x-goog-api-key'), 'secret');
        assert.equal(body.generationConfig.maxOutputTokens, 16);
        assert.equal(body.generationConfig.responseMimeType, 'application/json');
      } else {
        assert.equal(body.model, 'explicit-model');
        assert.equal(headers.get(provider === 'anthropic' ? 'x-api-key' : 'authorization'), provider === 'anthropic' ? 'secret' : 'Bearer secret');
      }
      if (provider === 'openai') {
        assert.equal(url, 'https://api.openai.com/v1/responses');
        assert.equal(body.store, false);
        assert.equal(body.max_output_tokens, 16);
      }
      if (provider === 'anthropic') {
        assert.equal(url, 'https://api.anthropic.com/v1/messages');
        assert.equal(body.max_tokens, 16);
      }
      if (provider === 'ollama') { assert.equal(url, 'https://custom.example/v1/api/generate'); assert.equal(body.options.num_predict, 16); }
      if (provider === 'openai_compatible') {
        assert.equal(url, 'https://custom.example/v1/chat/completions');
        assert.equal(body.max_tokens, 16);
        assert.equal(body.response_format, undefined);
      }
      return Response.json(responsePayloads[provider]);
    };
    const result = await createProvider(connection(provider), 'secret', mock).generate({ prompt: 'JSON please', model: 'explicit-model', thinking: true, jsonMode: true, maxOutputTokens: 16 });
    assert.equal(result, 'OK');
    assert.equal(calls, 1);
  });
}

test('service resolves exactly once per request and forwards connection-test token cap', async () => {
  let resolves = 0;
  const service = new BackendAiService(async () => { resolves++; return { connection: connection('openai'), apiKey: 'secret' }; }, async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.max_output_tokens, 16);
    return body.stream ? streamed('data: {"type":"response.output_text.delta","delta":"OK"}') : Response.json(responsePayloads.openai);
  });
  assert.equal(await service.generateResponse('Reply with only OK.', false, false, undefined, { maxOutputTokens: 16 }), 'OK');
  assert.equal(resolves, 1);
  assert.equal(await service.generateResponseStream('OK', () => {}, false, undefined, { maxOutputTokens: 16 }), 'OK');
  assert.equal(resolves, 2);
});

test('all SSE adapters normalize incremental text, CRLF, UTF-8, and a final event without newline', async () => {
  const payloads = {
    openai: (text: string) => ({ type: 'response.output_text.delta', delta: text }),
    anthropic: (text: string) => ({ type: 'content_block_delta', delta: { type: 'text_delta', text } }),
    gemini: (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] }),
    openai_compatible: (text: string) => ({ choices: [{ delta: { content: text } }] })
  };
  for (const provider of Object.keys(payloads) as Array<keyof typeof payloads>) {
    const raw = `: keepalive\r\nevent: update\r\ndata:${JSON.stringify(payloads[provider]('hé'))}\r\n\r\ndata: ${JSON.stringify(payloads[provider]('🙂'))}`;
    for (const emitDelta of [false, true]) {
      const chunks: string[] = [];
      const result = await createProvider(connection(provider), 'secret', async () => streamed(raw, 1)).stream({ prompt: 'hello', model: 'model' }, chunk => chunks.push(chunk), { emitDelta });
      assert.equal(result, 'hé🙂');
      assert.deepEqual(chunks, emitDelta ? ['hé', '🙂'] : ['hé', 'hé🙂']);
    }
  }
});

test('multiline SSE and NDJSON flush EOF and do not swallow error events', async () => {
  const adapter = createProvider(connection('gemini'), 'secret', async () => streamed('data: {"candidates":\ndata: [{"content":{"parts":[{"text":"OK"}]}}]}'));
  assert.equal(await adapter.stream({ prompt: 'hello', model: 'model' }, () => {}), 'OK');
  const ollama = createProvider(connection('ollama'), undefined, async () => streamed('{"response":"O"}\n{"response":"K"}'));
  assert.equal(await ollama.stream({ prompt: 'hello', model: 'model' }, () => {}), 'OK');
  for (const provider of ['openai', 'anthropic', 'gemini', 'openai_compatible', 'ollama'] as const) {
    const raw = provider === 'ollama' ? '{"error":"secret"}' : 'event: error\ndata: {"error":{"message":"secret"}}';
    await assert.rejects(createProvider(connection(provider), 'secret', async () => streamed(raw)).stream({ prompt: 'hello', model: 'model' }, () => {}), errorCode('AI_PROVIDER_ERROR'));
  }
  await assert.rejects(createProvider(connection('openai'), 'secret', async () => streamed('data: {"type":"response.failed","response":{"error":{"message":"secret"}}}')).stream({ prompt: 'hello', model: 'model' }, () => {}), errorCode('AI_PROVIDER_ERROR'));
  await assert.rejects(createProvider(connection('gemini'), 'secret', async () => streamed('data: {bad')).stream({ prompt: 'hello', model: 'model' }, () => {}), errorCode('AI_INVALID_RESPONSE'));
  await assert.rejects(createProvider(connection('gemini'), 'secret', async () => streamed('data: {"error":{"code":404,"message":"secret"}}')).stream({ prompt: 'hello', model: 'model' }, () => {}), errorCode('AI_MODEL_UNAVAILABLE'));
  await assert.rejects(createProvider(connection('openai'), 'secret', async () => Response.json({ output: 'malformed' })).generate({ prompt: 'hello', model: 'model' }), errorCode('AI_INVALID_RESPONSE'));
});

test('CLI proxy snapshot, stale snapshot, delta compatibility and model forwarding', async () => {
  for (const emitDelta of [true, false]) {
    const chunks: string[] = [];
    const adapter = createProvider(proxy, undefined, async (url, init) => {
      assert.match(String(url), /\/api\/low-level-stream$/);
      assert.equal(JSON.parse(String(init?.body)).model, 'explicit-model');
      assert.equal(JSON.parse(String(init?.body)).tool, 'codex');
      return streamed('data: {"response":"H"}\ndata: {"response":"Hi"}\ndata: {"response":"H"}\ndata: {"response":"!","mode":"delta"}');
    });
    assert.equal(await adapter.stream({ prompt: 'hello', model: 'explicit-model' }, chunk => chunks.push(chunk), { emitDelta }), 'Hi!');
    assert.deepEqual(chunks, emitDelta ? ['H', 'i', '!'] : ['H', 'Hi', 'Hi!']);
  }
  await assert.rejects(createProvider(proxy, undefined, async () => streamed('data: {"error":"secret"}')).stream({ prompt: 'hello', model: '' }, () => {}), errorCode('AI_PROVIDER_ERROR'));
});

test('capabilities reject images for text-only adapters before fetch; native adapters encode images', async () => {
  for (const item of [connection('ollama'), connection('openai_compatible'), proxy]) {
    assert.deepEqual(getCapabilities(item), { image: false, streaming: true });
    await assert.rejects(createProvider(item, 'secret', async () => { throw new Error('must not fetch'); }).generate({ prompt: 'hi', model: 'model', image: 'abc' }), errorCode('AI_UNSUPPORTED_CAPABILITY'));
  }
  for (const provider of ['openai', 'anthropic', 'gemini'] as const) {
    assert.deepEqual(getCapabilities(connection(provider)), { image: true, streaming: true });
    await createProvider(connection(provider), 'secret', async (_url, init) => {
      assert.match(String(init?.body), /image\/jpeg/);
      return Response.json(responsePayloads[provider]);
    }).generate({ prompt: 'hi', model: 'model', image: 'data:image/jpeg;base64,YWJj' });
  }
});

test('stable HTTP errors, no redirects, no retries, no leaked response bodies', async () => {
  for (const [status, code] of [[401, 'AI_AUTH_FAILED'], [403, 'AI_AUTH_FAILED'], [404, 'AI_MODEL_UNAVAILABLE'], [429, 'AI_RATE_LIMITED'], [500, 'AI_PROVIDER_ERROR'], [302, 'AI_REDIRECT_NOT_ALLOWED'], [408, 'AI_TIMEOUT']] as const) {
    let calls = 0;
    const adapter = createProvider(connection('openai'), 'secret', async () => { calls++; return new Response('secret', { status }); });
    await assert.rejects(adapter.generate({ prompt: 'hi', model: 'model' }), errorCode(code));
    assert.equal(calls, 1);
    assert.equal(providerHttpError(status).status, code === 'AI_RATE_LIMITED' ? 429 : code === 'AI_TIMEOUT' ? 504 : 502);
  }
  await assert.rejects(createProvider(connection('openai'), 'secret', async () => { throw new Error('secret'); }).generate({ prompt: 'hi', model: 'model' }), errorCode('AI_NETWORK_ERROR'));
});

test('custom endpoints permit HTTPS or loopback HTTP only; fixed providers ignore baseUrl', async () => {
  for (const baseUrl of ['http://remote.example', 'https://user:secret@example.com', 'https://example.com?key=secret', 'file:///tmp/test']) {
    await assert.rejects(createProvider({ ...connection('openai_compatible'), baseUrl } as AiConnection, 'secret').generate({ prompt: 'hi', model: 'model' }), errorCode('AI_INVALID_CONFIGURATION'));
  }
  await createProvider({ ...connection('ollama'), baseUrl: 'http://127.0.0.1:11434' } as AiConnection, undefined, async () => Response.json({ response: 'OK' })).generate({ prompt: 'hi', model: 'model' });
  await createProvider({ ...connection('openai'), baseUrl: 'https://evil.example' } as AiConnection, 'secret', async url => {
    assert.equal(String(url), 'https://api.openai.com/v1/responses'); return Response.json(responsePayloads.openai);
  }).generate({ prompt: 'hi', model: 'model' });
});

test('cancellation and timeout abort the request with stable errors', async () => {
  const pending: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  const adapter = createProvider(connection('openai'), 'secret', pending);
  const controller = new AbortController();
  const request = adapter.generate({ prompt: 'hi', model: 'model' }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(request, errorCode('AI_CANCELLED'));
  await assert.rejects(adapter.generate({ prompt: 'hi', model: 'model' }, { timeoutMs: 5 }), errorCode('AI_TIMEOUT'));
  await assert.rejects(adapter.generate({ prompt: 'hi', model: 'model' }, { signal: controller.signal }), errorCode('AI_CANCELLED'));
  const bodyAdapter = createProvider(connection('openai'), 'secret', async (_url, init) => new Response(new ReadableStream({
    start(stream) { init?.signal?.addEventListener('abort', () => stream.error(new Error('aborted')), { once: true }); }
  })));
  await assert.rejects(bodyAdapter.stream({ prompt: 'hi', model: 'model' }, () => {}, { timeoutMs: 5 }), errorCode('AI_TIMEOUT'));
});

const idea: Idea = { id: 'one', title: 'One', details: 'Details', timestamp: 1, keywords: [], chatHistory: [], relatedIdeas: [], status: 'draft' };
test('nonstream workflows forward request options and abort upstream when the caller disconnects', async () => {
  const workflows: Array<(service: BackendAiService, options: { signal: AbortSignal; maxOutputTokens: number; timeoutMs: number }) => Promise<unknown>> = [
    (service, options) => service.generateIdeas('hi', undefined, options),
    (service, options) => service.findSimplestMVP([idea], options),
    (service, options) => service.suggestFolders([idea], [], options),
    (service, options) => service.vetIdeas([idea], 'realism', options),
    (service, options) => service.generateViabilityReport(idea, options),
    (service, options) => service.analyzeCompetitors(idea, options),
    (service, options) => service.extractKeywords(idea, options),
    (service, options) => service.chat('hi', [], idea, options),
    (service, options) => service.brainstorm('hi', [], options),
    (service, options) => service.summarizeIdeaFromChat([], options)
  ];
  for (const run of workflows) {
    const controller = new AbortController();
    let upstreamSignal: AbortSignal | undefined;
    let started!: () => void;
    const fetched = new Promise<void>(resolve => { started = resolve; });
    const service = new BackendAiService(async () => ({ connection: connection('openai'), apiKey: 'secret' }), async (_url, init) => {
      assert.equal(JSON.parse(String(init?.body)).max_output_tokens, 16);
      upstreamSignal = init?.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        upstreamSignal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        started();
      });
    });
    const request = run(service, { signal: controller.signal, maxOutputTokens: 16, timeoutMs: 1000 });
    const rejected = assert.rejects(request, errorCode('AI_CANCELLED'));
    await fetched;
    controller.abort();
    await rejected;
    assert.equal(upstreamSignal?.aborted, true);
  }
});
function structured(raw: string) {
  const service = new BackendAiService(async () => ({ connection: proxy }));
  service.generateResponse = async () => raw;
  return service;
}
test('strict structured validation rejects semantic failures and preserves raw output', async () => {
  const cases: Array<[string, (service: BackendAiService) => Promise<unknown>]> = [
    ['[]', service => service.generateIdeas('hi')],
    ['[{"title":" ","details":"text"}]', service => service.generateIdeas('hi')],
    ['[{"title":"Title","details":"text","extra":1}]', service => service.generateIdeas('hi')],
    ['[{"ideaId":"one","score":"9","reason":"ok"}]', service => service.vetIdeas([idea], 'realism')],
    ['[{"ideaId":"one","score":11,"reason":"ok"}]', service => service.findSimplestMVP([idea])],
    ['[{"ideaId":"unknown","score":9,"reason":"ok"}]', service => service.findSimplestMVP([idea])],
    ['[{"ideaId":"one","score":9,"reason":"ok"},{"ideaId":"one","score":9,"reason":"ok"}]', service => service.vetIdeas([idea], 'realism')],
    ['[{"name":"A","description":"a","ideaIds":["one"]},{"name":"B","description":"b","ideaIds":["one"]}]', service => service.suggestFolders([idea], [])],
    ['{"title":"Title"}', service => service.summarizeIdeaFromChat([])],
    ['{"title":"Title","details":"text"} trailing', service => service.summarizeIdeaFromChat([])]
  ];
  for (const [raw, run] of cases) await assert.rejects(run(structured(raw)), (error: unknown) => {
    assert.ok(error instanceof StructuredParseError); assert.equal(error.rawOutput, raw); return true;
  });
});
test('valid structured outputs allow subsets and preserve scores without coercion', async () => {
  const second = { ...idea, id: 'two' };
  const scores = '[{"ideaId":"one","score":2,"reason":"Reason"}]';
  assert.deepEqual(await structured(scores).findSimplestMVP([idea, second]), JSON.parse(scores));
  assert.equal((await structured(scores).vetIdeas([idea, second], 'realism'))[0].score, 2);
  const folders = '[{"name":"A","description":"a","ideaIds":["one"]}]';
  assert.deepEqual(await structured(folders).suggestFolders([idea, second], []), JSON.parse(folders));
  assert.deepEqual(await structured('```json\n[{"title":"Title","details":"Details"}]\n```').generateIdeas('hi'), [{ title: 'Title', details: 'Details' }]);
});
