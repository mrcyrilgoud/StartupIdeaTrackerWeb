import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import type { AddressInfo } from 'node:net';
import { AppStore, initializeSchema } from '../server/store.js';
import { ConnectionService } from '../server/connections/ConnectionService.js';
import { MemoryCredentialStore, CredentialStoreError } from '../server/credentials/CredentialStore.js';
import { migrateSettings } from '../server/ai/migrateSettings.js';
import { LEGACY_DEFAULT_APP_SETTINGS } from '../src/types.js';
import { createHttpApp, serveFrontend } from '../server/app.js';
import { createAiRuntime } from '../server/ai/runtime.js';

function fixture() {
  const sqlite = new Database(':memory:'); initializeSchema(sqlite);
  const store = new AppStore(sqlite), credentials = new MemoryCredentialStore();
  const connections = new ConnectionService(store, credentials);
  connections.setTester(async () => 'OK');
  return { sqlite, store, credentials, connections };
}
const input = { kind: 'api', provider: 'openai', name: 'Test', model: 'test-model' } as const;

function parseClientStream(body: string) {
  let fullText = '';
  const chunks: string[] = [];
  let result = '';

  for (const line of body.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const payload = JSON.parse(line.slice(6).trim()) as {
      delta?: string;
      fullText?: string;
      done?: boolean;
    };
    if (payload.delta) {
      fullText = payload.fullText ?? `${fullText}${payload.delta}`;
      chunks.push(fullText);
    }
    if (payload.done) {
      result = payload.fullText ?? fullText;
    }
  }

  return { chunks, result };
}

test('fresh databases require setup and never default to credential-free Gemini', async () => {
  const { store, connections } = fixture(); await migrateSettings(connections);
  assert.deepEqual(await store.getSettings(), { version: 2, activeConnectionId: null });
  assert.equal((await connections.status()).state, 'needs_setup');
  await assert.rejects(connections.resolve(), { code: 'AI_SETUP_REQUIRED' });
});
test('credentials are write-only, revision-gated and excluded from exports', async () => {
  const { store, connections, sqlite } = fixture();
  const profile = connections.create(input);
  await assert.rejects(connections.activate(profile.id), { code: 'AI_CREDENTIAL_MISSING' });
  await connections.setCredential(profile.id, 'secret-test-key');
  await assert.rejects(connections.activate(profile.id), /Test this connection/);
  await connections.test(profile.id); await connections.activate(profile.id);
  assert.equal((await connections.status()).state, 'configured');
  assert.equal((await connections.resolve()).apiKey, 'secret-test-key');
  assert.ok(!JSON.stringify(connections.list()).includes('secret-test-key'));
  const exported = JSON.stringify(await store.exportData());
  assert.ok(!exported.includes('secret-test-key')); assert.ok(!exported.includes('credentialRef')); assert.ok(!exported.includes('testedRevision'));
  assert.ok(!JSON.stringify(sqlite.prepare('SELECT * FROM ai_connections').all()).includes('secret-test-key'));
  await connections.update(profile.id, { model: 'another-model' });
  await assert.rejects(connections.resolve(), { code: 'AI_SETUP_REQUIRED' });
  await connections.test(profile.id); await connections.activate(profile.id);
  await connections.setCredential(profile.id, 'replacement');
  await assert.rejects(connections.resolve(), { code: 'AI_SETUP_REQUIRED' });
  await connections.delete(profile.id);
  assert.equal((await store.getSettings()).activeConnectionId, null);
});
test('failed or stale tests do not permit activation', async () => {
  const { connections } = fixture(); const profile = connections.create({ kind: 'api', provider: 'ollama', name: 'Local', model: 'llama3' });
  let finish!: () => void;
  connections.setTester(async () => { await new Promise<void>(resolve => { finish = resolve; }); return 'OK'; });
  const pending = connections.test(profile.id);
  await new Promise(resolve => setImmediate(resolve));
  await connections.update(profile.id, { model: 'different' }); finish();
  await assert.rejects(pending, { code: 'AI_CONNECTION_CHANGED' });
  await assert.rejects(connections.activate(profile.id), /Test this connection/);
});
test('legacy keys migrate with verified Keychain write and can retry after access denial', async () => {
  const { sqlite, store, credentials } = fixture();
  store.saveLegacySettings({ ...LEGACY_DEFAULT_APP_SETTINGS, geminiKey: 'migration-secret' });
  let denied = true;
  const connections = new ConnectionService(store, {
    set: async (ref, value) => { if (denied) throw new CredentialStoreError(); await credentials.set(ref, value); },
    get: ref => credentials.get(ref), delete: ref => credentials.delete(ref)
  });
  await migrateSettings(connections);
  assert.ok(connections.migrationError); assert.equal(store.getLegacySettings().geminiKey, 'migration-secret');
  assert.equal(store.getMetadata('ai_connections_migrated'), null);
  assert.ok(!JSON.stringify(await store.exportData()).includes('migration-secret'));
  denied = false; await migrateSettings(connections);
  assert.equal(connections.migrationError, null); assert.equal(store.getLegacySettings().geminiKey, '');
  assert.equal((await connections.resolve()).apiKey, 'migration-secret');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM ai_connections').get()?.n, 1);
  await migrateSettings(connections); assert.equal(store.listConnections().length, 1);
});
test('customized legacy connections survive migration and unknown tools require setup', async () => {
  for (const settings of [
    { ...LEGACY_DEFAULT_APP_SETTINGS, provider: 'ollama' as const, ollamaModel: 'my-model', ollamaEndpoint: 'http://127.0.0.1:11434' },
    { ...LEGACY_DEFAULT_APP_SETTINGS, provider: 'cli_proxy' as const, cliCommandTemplate: 'codex "{{prompt}}"' }
  ]) {
    const { store, connections } = fixture(); store.saveLegacySettings(settings); await migrateSettings(connections);
    assert.equal(store.listConnections().length, 1); assert.ok((await store.getSettings()).activeConnectionId);
  }
  const { store, connections } = fixture();
  store.saveLegacySettings({ ...LEGACY_DEFAULT_APP_SETTINGS, provider: 'cli_proxy', cliCommandTemplate: 'unknown-tool {{prompt}}' });
  await migrateSettings(connections); assert.equal((await store.getSettings()).activeConnectionId, null);
});
test('failed credential deletion preserves profile and active metadata', async () => {
  const { store, credentials } = fixture();
  const connections = new ConnectionService(store, { set: (r,k) => credentials.set(r,k), get: r => credentials.get(r), delete: async () => { throw new CredentialStoreError(); } });
  connections.setTester(async () => 'OK'); const profile = connections.create(input);
  await connections.setCredential(profile.id, 'key'); await connections.test(profile.id); await connections.activate(profile.id);
  await assert.rejects(connections.delete(profile.id));
  assert.ok(store.getConnection(profile.id)); assert.equal((await store.getSettings()).activeConnectionId, profile.id);
});
test('endpoint policy rejects remote HTTP and credential-bearing URLs', () => {
  const { connections } = fixture();
  for (const baseUrl of ['http://example.com/v1', 'https://user:password@example.com/v1', 'https://example.com/?key=secret']) {
    assert.throws(() => connections.create({ ...input, provider: 'openai_compatible', baseUrl }));
  }
});
test('HTTP settings, credentials and backup import honor public contracts', async () => {
  const { store } = fixture(); const { connections, aiService } = await createAiRuntime(store, new MemoryCredentialStore());
  connections.setTester(async () => 'OK');
  const server = createHttpApp(store, aiService, connections).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (path: string, method = 'GET', body?: unknown) => fetch(url + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    assert.equal((await (await call('/api/settings')).json()).activeConnectionId, null);
    const created = await (await call('/api/ai/connections', 'POST', input)).json();
    assert.equal((await call(`/api/ai/connections/${created.id}/credential`, 'PUT', { apiKey: 'http-secret' })).status, 204);
    await call(`/api/ai/connections/${created.id}/test`, 'POST');
    assert.equal((await call('/api/settings', 'PUT', { activeConnectionId: created.id })).status, 200);
    assert.ok(!(await (await call('/api/ai/connections')).text()).includes('http-secret'));
    const backup = await (await call('/api/export')).json();
    assert.equal(backup.version, 2); assert.ok(!JSON.stringify(backup).includes('http-secret'));
    await call('/api/import', 'POST', backup);
    assert.equal((await store.getSettings()).activeConnectionId, created.id);
    const imported = store.listConnections().filter(c => c.id !== created.id);
    assert.equal(imported.length, 1); assert.equal(imported[0].testedRevision, null); assert.equal(imported[0].credentialRef, null);
    assert.equal((await call('/api/import', 'POST', { settings: { ...LEGACY_DEFAULT_APP_SETTINGS, geminiKey: 'legacy-secret' } })).status, 400);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('production server hosts built assets and SPA routes without masking API 404s', async () => {
  const { store } = fixture();
  const staticRoot = await mkdtemp(path.join(tmpdir(), 'startup-static-'));
  await mkdir(path.join(staticRoot, 'assets'));
  await writeFile(path.join(staticRoot, 'index.html'), '<!doctype html><title>Startup fixture</title>');
  await writeFile(path.join(staticRoot, 'assets', 'app.js'), 'globalThis.fixture = true;');
  const app = createHttpApp(store, {} as never);
  serveFrontend(app, staticRoot);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.match(await (await fetch(`${url}/`)).text(), /Startup fixture/);
    assert.match(await (await fetch(`${url}/idea/example`, { headers: { Accept: 'text/html' } })).text(), /Startup fixture/);
    assert.match(await (await fetch(`${url}/assets/app.js`)).text(), /fixture = true/);
    assert.equal((await fetch(`${url}/assets/missing.js`)).status, 404);
    const missingApi = await fetch(`${url}/api/not-a-route`, { headers: { Accept: 'text/html' } });
    assert.equal(missingApi.status, 404);
    assert.doesNotMatch(await missingApi.text(), /Startup fixture/);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(staticRoot, { recursive: true, force: true });
  }
});

test('HTTP streams survive request-body completion and cancel upstream on disconnect', async () => {
  const { store } = fixture();
  let upstreamAborted = false;
  const ai = {
    generateResponseStream: async (prompt: string, emit: (text: string) => void, _thinking: boolean, _image: string, options: { signal: AbortSignal }) => {
      if (prompt === 'complete') {
        await new Promise(resolve => setTimeout(resolve, 15));
        assert.equal(options.signal.aborted, false); emit('delayed'); return 'delayed';
      }
      emit('started');
      await new Promise<void>(resolve => options.signal.addEventListener('abort', () => { upstreamAborted = true; resolve(); }, { once: true }));
      return '';
    }
  };
  const server = createHttpApp(store, ai as never).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/ai/raw-response`;
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'complete', stream: true }) });
    assert.match(await response.text(), /"done":true,"fullText":"delayed"/);
    const controller = new AbortController();
    const streaming = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'cancel', stream: true }), signal: controller.signal });
    await streaming.body!.getReader().read(); controller.abort();
    for (let attempt = 0; attempt < 50 && !upstreamAborted; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(upstreamAborted, true);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('HTTP stream deltas stay incremental and remain compatible with the client parser', async () => {
  const { store } = fixture();
  const ai = {
    generateResponseStream: async (_prompt: string, emit: (text: string) => void) => {
      for (const delta of ['a', 'bb', 'ccc']) emit(delta);
      return 'abbccc';
    }
  };
  const server = createHttpApp(store, ai as never).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/ai/raw-response`;

  try {
    const body = await (await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'incremental', stream: true })
    })).text();
    const events = body.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)) as Record<string, unknown>);

    assert.deepEqual(events.slice(0, 3).map(event => event.delta), ['a', 'bb', 'ccc']);
    assert.ok(events.slice(0, 3).every(event => !('fullText' in event)));
    assert.deepEqual(events.at(-1), { done: true, fullText: 'abbccc' });
    assert.deepEqual(parseClientStream(body), { chunks: ['a', 'abb', 'abbccc'], result: 'abbccc' });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
