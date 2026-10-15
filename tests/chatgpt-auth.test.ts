import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHttpApp } from '../server/app.js';
import { BackendAiService } from '../server/ai.js';
import type { AddressInfo } from 'node:net';
import { AppStore, initializeSchema } from '../server/store.js';
import { ConnectionService } from '../server/connections/ConnectionService.js';
import { MemoryCredentialStore } from '../server/credentials/CredentialStore.js';
import { importDataSchema } from '../server/contracts.js';
import { importBackup } from '../server/connections/importBackup.js';
import { createProvider } from '../server/ai/providers/index.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const clientId = 'oaiapp_fixture', scope = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
function token(claims: object = {}, header: object = {}) {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fixture', ...header })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ iss: 'https://auth.openai.com', aud: clientId, sub: 'user-1', email: 'user@example.com', exp: Date.now() / 1000 + 3600, ...claims })).toString('base64url');
  return `${h}.${p}.${sign('sha256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url')}`;
}
function fixture(databasePath = ':memory:') {
  const sqlite = new Database(databasePath); initializeSchema(sqlite);
  const store = new AppStore(sqlite), credentials = new MemoryCredentialStore();
  let browserUrl = '', grants: URLSearchParams[] = [], refreshes = 0, revokeFailed = false;
  const state = { claims: {} as Record<string, unknown>, scope, tokenFailure: false, expires: 3600 };
  const fetchImpl: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith('openid-configuration')) return json({ jwks_uri: 'https://auth.openai.com/jwks', revocation_endpoint: 'https://auth.openai.com/revoke' });
    if (path === '/jwks') return json({ keys: [{ kid: 'fixture', ...publicKey.export({ format: 'jwk' }) }] });
    if (path === '/revoke') return new Response('', { status: revokeFailed ? 503 : 200 });
    assert.equal(String(url), 'https://auth.openai.com/api/accounts/oauth/token');
    const grant = new URLSearchParams(String(init?.body)); grants.push(grant);
    if (state.tokenFailure) return new Response('', { status: 400 });
    if (grant.get('grant_type') === 'refresh_token') {
      refreshes++; await new Promise(resolve => setTimeout(resolve, 10));
      return json({ access_token: 'renewed-access-secret', refresh_token: 'rotated-refresh-secret', expires_in: 3600, token_type: 'Bearer', scope: state.scope });
    }
    const nonce = new URL(browserUrl).searchParams.get('nonce');
    return json({ access_token: 'access-secret', refresh_token: 'refresh-secret', id_token: token({ nonce, ...state.claims }), expires_in: state.expires, token_type: 'Bearer', scope: state.scope });
  };
  const options = { fetchImpl, openBrowser: async (url: string) => { browserUrl = url; } };
  const service = new ConnectionService(store, credentials, options);
  service.setTester(async () => 'OK');
  const connection = service.create({ kind: 'chatgpt', name: 'ChatGPT' });
  const auth = service.chatGptAuth;
  async function start(id = connection.id) { await auth.start(id); return new URL(browserUrl); }
  async function callback(url: URL, extra: Record<string, string> = {}, id = connection.id) {
    const callbackUrl = new URL(url.searchParams.get('redirect_uri')!);
    callbackUrl.search = new URLSearchParams({ state: url.searchParams.get('state')!, code: 'fixture-code', client_id: clientId, ...extra }).toString();
    const result = await fetch(callbackUrl);
    await result.text();
    for (let n = 0; n < 20 && (await auth.status(id)).state === 'pending'; n++) await new Promise(resolve => setTimeout(resolve, 5));
    return result.status;
  }
  return { sqlite, store, credentials, service, connection, auth, options, state, start, callback, grants, get refreshes() { return refreshes; }, set revokeFailed(value: boolean) { revokeFailed = value; } };
}

test('ChatGPT OAuth validates signed identity and PKCE, keeps tokens out of SQLite and backups', async () => {
  const f = fixture(); try {
    const url = await f.start();
    assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client');
    assert.match(url.searchParams.get('ext_agent_host_id')!, /^urn:uuid:/);
    assert.equal(await f.callback(url), 200);
    const grant = f.grants[0];
    assert.equal(createHash('sha256').update(grant.get('code_verifier')!).digest('base64url'), url.searchParams.get('code_challenge'));
    assert.equal(grant.get('redirect_uri'), url.searchParams.get('redirect_uri'));
    assert.equal(grant.get('client_id'), clientId);
    const status = await f.auth.status(f.connection.id);
    assert.equal(status.state, 'authenticated'); assert.equal(status.account?.email, 'user@example.com');
    const exported = await f.store.exportData();
    for (const value of [JSON.stringify(exported), JSON.stringify(f.service.list()), JSON.stringify(f.sqlite.prepare('SELECT * FROM app_metadata').all()), JSON.stringify(f.sqlite.prepare('SELECT * FROM ai_connections').all())]) assert.ok(!/access-secret|refresh-secret|id_token|code_verifier/.test(value));
    assert.ok(!JSON.stringify(exported).includes(clientId));
    await assert.rejects(f.service.resolve(f.connection.id), /Select a ChatGPT model/);
    await f.service.update(f.connection.id, { model: 'fixture-model' }); await f.service.test(f.connection.id); await f.service.activate(f.connection.id);
    assert.equal((await f.service.resolve()).accessToken, 'access-secret');
    await importBackup(f.service, importDataSchema.parse(exported));
    const imported = f.store.listConnections().find(c => c.id !== f.connection.id)!;
    assert.equal(imported.kind, 'chatgpt'); assert.equal(imported.credentialRef, null); assert.equal(imported.testedRevision, null); assert.equal(f.auth.registration(imported.id), null);
  } finally { f.auth.dispose(); f.sqlite.close(); }
});

test('invalid state is rejected without consuming the valid OAuth attempt', async () => {
  const f = fixture(); try { const url = await f.start(); assert.equal(await f.callback(url, { state: 'wrong-state' }), 400); assert.equal((await f.auth.status(f.connection.id)).state, 'pending'); assert.equal(await f.callback(url), 200); assert.equal(f.grants.length, 1); } finally { f.auth.dispose(); f.sqlite.close(); }
});
for (const [name, claims, header] of [
  ['nonce', { nonce: 'wrong' }, {}], ['issuer', { iss: 'https://attacker.invalid' }, {}],
  ['audience', { aud: 'another-client' }, {}], ['expiration', { exp: 1 }, {}], ['subject', { sub: '' }, {}], ['algorithm', {}, { alg: 'none' }]
] as const) test(`ChatGPT rejects invalid JWT ${name} before storing credentials`, async () => {
  const f = fixture(); try {
    const url = await f.start(); f.state.claims = { ...claims };
    if (name === 'algorithm') await assert.rejects(f.auth.verifyIdentity(token({}, header), clientId));
    else { assert.equal(await f.callback(url), 400); assert.equal(f.store.getConnection(f.connection.id)?.credentialRef, null); assert.equal((await f.auth.status(f.connection.id)).state, 'error'); }
  } finally { f.auth.dispose(); f.sqlite.close(); }
});

test('identity-only consent remains connected but cannot perform inference', async () => {
  const f = fixture(); try { f.state.scope = 'openid email profile'; assert.equal(await f.callback(await f.start()), 200); assert.equal((await f.auth.status(f.connection.id)).state, 'plan_disabled'); await assert.rejects(f.auth.accessToken(f.connection.id), /Enable ChatGPT plan usage/); const reconnect = await f.start(); assert.equal(reconnect.searchParams.get('client_id'), clientId); assert.equal(reconnect.searchParams.get('prompt'), 'consent'); } finally { f.auth.dispose(); f.sqlite.close(); }
});

test('declined, incomplete, cancelled and expired-code attempts do not save credentials', async () => {
  for (const action of ['deny', 'incomplete', 'cancel', 'expired-code']) {
    const f = fixture(); try {
      const url = await f.start();
      if (action === 'cancel') { f.auth.cancel(f.connection.id); assert.equal((await f.auth.status(f.connection.id)).state, 'signed_out'); }
      else if (action === 'deny') assert.equal(await f.callback(url, { error: 'access_denied' }), 400);
      else if (action === 'incomplete') assert.equal(await f.callback(url, { client_id: '' }), 400);
      else { f.state.tokenFailure = true; assert.equal(await f.callback(url), 400); assert.equal((await f.start()).searchParams.get('client_id'), clientId); }
      assert.equal(f.store.getConnection(f.connection.id)?.credentialRef, null);
    } finally { f.auth.dispose(); f.sqlite.close(); }
  }
});

test('reconnect reuses host/client identities and rejects a different account', async () => {
  const f = fixture(); try {
    const first = await f.start(); await f.callback(first);
    const second = await f.start(); assert.equal(second.searchParams.get('client_id'), clientId); assert.equal(second.searchParams.get('ext_agent_host_id'), first.searchParams.get('ext_agent_host_id')); assert.ok(!second.searchParams.has('id_token_hint'));
    f.state.claims = { sub: 'other-account' }; assert.equal(await f.callback(second), 400);
    assert.equal(await f.auth.accessToken(f.connection.id), 'access-secret'); assert.equal(f.auth.registration(f.connection.id)?.subject, 'user-1'); assert.equal((await f.auth.status(f.connection.id)).state, 'authenticated');
  } finally { f.auth.dispose(); f.sqlite.close(); }
});

test('refresh is serialized across runtime instances and survives restarts without invalidating tests', async () => {
  const f = fixture(); try {
    await f.callback(await f.start()); await f.service.update(f.connection.id, { model: 'fixture-model' }); await f.service.test(f.connection.id); await f.service.activate(f.connection.id);
    const row = f.store.getConnection(f.connection.id)!;
    const session = JSON.parse((await f.credentials.get(row.credentialRef!))!); session.expiresAt = 1;
    await f.credentials.set(row.credentialRef!, JSON.stringify(session));
    const second = new ConnectionService(f.store, f.credentials, f.options);
    const values = await Promise.all([f.auth.accessToken(f.connection.id), second.chatGptAuth.accessToken(f.connection.id)]);
    assert.deepEqual(values, ['renewed-access-secret', 'renewed-access-secret']); assert.equal(f.refreshes, 1);
    const refreshed = f.store.getConnection(f.connection.id)!; assert.equal(refreshed.testedRevision, refreshed.revision);
    assert.equal((await second.resolve()).accessToken, 'renewed-access-secret');
    const stored = JSON.parse((await f.credentials.get(refreshed.credentialRef!))!); assert.equal(stored.refreshToken, 'rotated-refresh-secret');
  } finally { f.auth.dispose(); f.sqlite.close(); }
});

test('disconnect clears only its registration tokens and reports unconfirmed revocation', async () => {
  const f = fixture(); try {
    await f.callback(await f.start()); const other = f.service.create({ kind: 'chatgpt', name: 'Other account' });
    await f.service.saveOAuthSession(other.id, { accessToken: 'other-secret', idToken: 'other-id', expiresAt: Date.now() + 3600000, scopes: scope.split(' ') }, { clientId: 'oaiapp_other', subject: 'other' });
    f.revokeFailed = true; const result = await f.auth.disconnect(f.connection.id);
    assert.equal(result.state, 'signed_out'); assert.match(result.message, /revocation was not confirmed/);
    assert.equal(f.store.getConnection(f.connection.id)?.credentialRef, null); assert.equal(await f.auth.accessToken(other.id), 'other-secret');
    assert.equal(f.auth.registration(f.connection.id)?.clientId, clientId);
    assert.equal((await f.start()).searchParams.get('client_id'), clientId);
  } finally { f.auth.dispose(); f.sqlite.close(); }
});

const chatgpt = { id: 'chat', name: 'ChatGPT', revision: 1, kind: 'chatgpt' as const, model: 'fixture-model', hasSession: true };
const events = (...values: unknown[]) => new Response(values.map(value => `data: ${JSON.stringify(value)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
test('ChatGPT buffered and streaming workflows use SSE without unsupported fields', async () => {
  const bodies: Record<string, unknown>[] = [];
  const provider = createProvider(chatgpt, undefined, async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer oauth-secret');
    bodies.push(JSON.parse(String(init?.body)));
    return events({ type: 'response.output_text.delta', delta: 'OK' }, { type: 'response.completed' });
  }, 'oauth-secret');
  assert.equal(await provider.generate({ prompt: 'Reply OK', model: chatgpt.model, maxOutputTokens: 16 }), 'OK');
  const chunks: string[] = []; assert.equal(await provider.stream({ prompt: 'Reply OK', model: chatgpt.model }, chunk => chunks.push(chunk)), 'OK');
  assert.deepEqual(chunks, ['OK']); assert.ok(bodies.every(body => body.stream === true && body.store === false && !('max_output_tokens' in body)));
});
test('ChatGPT does not accept truncated or late-failed streams as completed output', async () => {
  for (const terminal of [null, { type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } }, { type: 'response.incomplete' }]) {
    const provider = createProvider(chatgpt, undefined, async () => events({ type: 'response.output_text.delta', delta: 'partial' }, ...(terminal ? [terminal] : [])), 'oauth-secret');
    await assert.rejects(provider.generate({ prompt: 'hello', model: chatgpt.model }));
    await assert.rejects(provider.stream({ prompt: 'hello', model: chatgpt.model }, () => {}));
  }
});
test('Cursor and Kiro provider requests carry only their connection credential', async () => {
  const bodies: Record<string, unknown>[] = [];
  await Promise.all(['cursor', 'kiro'].map(async tool => {
    const provider = createProvider({ kind: 'cli_proxy', id: tool, tool, name: tool, revision: 1 }, `${tool}-key`, async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return json({ response: 'OK' }); });
    assert.equal(await provider.generate({ prompt: 'hello', model: '' }), 'OK');
  }));
  assert.deepEqual(bodies.map(body => [body.tool, body.apiKey]), [['cursor', 'cursor-key'], ['kiro', 'kiro-key']]);
});

test('refresh lease coordinates independent SQLite handles', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'chatgpt-lease-'));
  const databasePath = path.join(directory, 'test.sqlite'), f = fixture(databasePath);
  const otherDb = new Database(databasePath), other = new ConnectionService(new AppStore(otherDb), f.credentials, f.options);
  try {
    await f.callback(await f.start());
    const row = f.store.getConnection(f.connection.id)!, session = JSON.parse((await f.credentials.get(row.credentialRef!))!); session.expiresAt = 1;
    await f.credentials.set(row.credentialRef!, JSON.stringify(session));
    await Promise.all([f.auth.accessToken(f.connection.id), other.chatGptAuth.accessToken(f.connection.id)]);
    assert.equal(f.refreshes, 1); assert.equal(f.sqlite.prepare('SELECT count(*) n FROM ai_auth_leases').get()?.n, 0);
  } finally { f.auth.dispose(); other.chatGptAuth.dispose(); otherDb.close(); f.sqlite.close(); rmSync(directory, { recursive: true }); }
});
test('cancelling sign-in during a Keychain write cannot commit the abandoned session', { timeout: 5000 }, async () => {
  const f = fixture();
  let release!: () => void, began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; }), originalSet = f.credentials.set.bind(f.credentials);
  f.credentials.set = async (ref, value) => { began(); await new Promise<void>(resolve => { release = resolve; }); await originalSet(ref, value); };
  try {
    const callback = f.callback(await f.start()); await started;
    f.auth.cancel(f.connection.id); release(); assert.equal(await callback, 400);
    assert.equal(f.store.getConnection(f.connection.id)?.credentialRef, null); assert.equal((await f.auth.status(f.connection.id)).state, 'signed_out');
  } finally { f.auth.dispose(); f.sqlite.close(); }
});
test('stale connection edits and replayed callbacks cannot overwrite a session', async () => {
  const f = fixture(); try {
    const stale = await f.start(); await f.service.update(f.connection.id, { name: 'Changed' }); assert.equal(await f.callback(stale), 400);
    assert.equal(f.store.getConnection(f.connection.id)?.credentialRef, null);
    const valid = await f.start(); await f.callback(valid); const grantCount = f.grants.length;
    const callback = new URL(valid.searchParams.get('redirect_uri')!); callback.search = new URLSearchParams({ state: valid.searchParams.get('state')!, code: 'replay', client_id: clientId }).toString();
    try { const response = await fetch(callback, { signal: AbortSignal.timeout(300) }); assert.equal(response.status, 400); await response.text(); } catch (error) { assert.ok(error instanceof TypeError || error instanceof DOMException); }
    assert.equal(f.grants.length, grantCount);
  } finally { f.auth.dispose(); f.sqlite.close(); }
});
test('refresh rejection requires reconnection without losing profile metadata or using API billing', async () => {
  const f = fixture(); try {
    await f.callback(await f.start()); const row = f.store.getConnection(f.connection.id)!;
    const value = JSON.parse((await f.credentials.get(row.credentialRef!))!); value.expiresAt = 1; await f.credentials.set(row.credentialRef!, JSON.stringify(value));
    f.state.tokenFailure = true; await assert.rejects(f.auth.accessToken(f.connection.id), { code: 'AI_AUTH_REQUIRED' });
    assert.equal(f.store.getConnection(f.connection.id)?.credentialRef, row.credentialRef);
  } finally { f.auth.dispose(); f.sqlite.close(); }
});
test('HTTP connection auth operations expose safe status and reject OAuth tokens in API-key routes', async () => {
  const f = fixture(); const server = createHttpApp(f.store, new BackendAiService(() => f.service.resolve()), f.service).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/ai/connections/${f.connection.id}`;
  try {
    const post = (route: string) => fetch(endpoint + route, { method: 'POST' });
    assert.equal((await (await post('/auth/start')).json()).state, 'pending');
    const cancelled = await (await post('/auth/cancel')).json(); assert.equal(cancelled.state, 'signed_out');
    assert.ok(!/accessToken|refreshToken|idToken|verifier/.test(JSON.stringify(cancelled)));
    assert.equal((await fetch(endpoint + '/credential', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: 'fake-oauth-token' }) })).status, 400);
    assert.equal((await fetch(endpoint + '/credential', { method: 'DELETE' })).status, 400);
    assert.equal((await post('/auth/disconnect')).status, 200);
  } finally { f.auth.dispose(); await new Promise<void>(resolve => server.close(() => resolve())); f.sqlite.close(); }
});
test('CLI connection credentials are independently replaceable, removable and vendor-locked', async () => {
  const f = fixture(); try {
    const cursor = f.service.create({ kind: 'cli_proxy', tool: 'cursor', name: 'Cursor' }), kiro = f.service.create({ kind: 'cli_proxy', tool: 'kiro', name: 'Kiro' });
    await f.service.setCredential(cursor.id, 'cursor-key'); await f.service.setCredential(kiro.id, 'kiro-key');
    const firstRef = f.store.getConnection(cursor.id)!.credentialRef!;
    await f.service.setCredential(cursor.id, 'cursor-replacement'); assert.equal(await f.credentials.get(firstRef), null);
    assert.equal(await f.credentials.get(f.store.getConnection(kiro.id)!.credentialRef!), 'kiro-key');
    await assert.rejects(f.service.update(cursor.id, { tool: 'kiro' }), { code: 'AI_CONNECTION_TYPE_CHANGE' });
    const codex = f.service.create({ kind: 'cli_proxy', tool: 'codex', name: 'Codex' }); await assert.rejects(f.service.setCredential(codex.id, 'key'), { code: 'AI_CREDENTIAL_UNSUPPORTED' });
    await f.service.deleteCredential(cursor.id); assert.equal((f.service.list().find(c => c.id === cursor.id) as { hasKey: boolean }).hasKey, false);
    assert.ok(!/cursor-replacement|kiro-key/.test(JSON.stringify(await f.store.exportData())));
  } finally { f.auth.dispose(); f.sqlite.close(); }
});
test('old companion proxies reject connection-specific keys before inference', async () => {
  const f = fixture(), originalFetch = globalThis.fetch;
  try {
    const connection = f.service.create({ kind: 'cli_proxy', tool: 'cursor', name: 'Cursor' }); await f.service.setCredential(connection.id, 'cursor-key');
    globalThis.fetch = async () => json({ tools: ['cursor'], defaultTool: 'cursor' });
    await assert.rejects(f.service.resolve(connection.id), { code: 'AI_PROXY_UPDATE_REQUIRED' });
    assert.equal((await f.service.proxyTools()).requestCredentials, false);
  } finally { globalThis.fetch = originalFetch; f.auth.dispose(); f.sqlite.close(); }
});
test('ChatGPT handles HTTP eligibility and usage errors with actionable messages', async () => {
  for (const [status, code, message] of [[403, 'subscription_sharing_user_not_eligible', /eligible/], [429, 'subscription_sharing_usage_limit_exceeded', /Manage usage/]] as const) {
    const provider = createProvider(chatgpt, undefined, async () => new Response(JSON.stringify({ error: { code } }), { status }), 'oauth-secret');
    await assert.rejects(provider.generate({ prompt: 'test', model: chatgpt.model }), message);
  }
});

test('partial updates preserve existing CLI configuration and explicit null restores tool defaults', async () => {
  const f = fixture(); try {
    const connection = f.service.create({ kind: 'cli_proxy', tool: 'cursor', name: 'Cursor', model: 'explicit-model' });
    await f.service.update(connection.id, { kind: 'cli_proxy', name: 'Renamed' });
    assert.equal(f.store.getConnection(connection.id)?.model, 'explicit-model');
    await f.service.update(connection.id, { model: null });
    assert.equal(f.store.getConnection(connection.id)?.model, undefined);
    const ollama = f.service.create({ kind: 'api', provider: 'ollama', name: 'Ollama', model: 'local-model', baseUrl: 'http://127.0.0.1:1234' });
    await f.service.update(ollama.id, { baseUrl: null });
    assert.equal((f.store.getConnection(ollama.id) as { baseUrl?: string }).baseUrl, undefined);
  } finally { f.auth.dispose(); f.sqlite.close(); }
});

test('ChatGPT model discovery keeps account catalog ordering, visibility and display labels', async () => {
  const f = fixture(), originalFetch = globalThis.fetch;
  try {
    await f.callback(await f.start());
    globalThis.fetch = async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/models'); assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer access-secret');
      return json({ models: [{ slug: 'model-b', display_name: 'Friendly model B', visibility: 'list' }, { slug: 'hidden', visibility: 'hidden' }, { slug: 'model-a', display_name: 'Friendly model A', visibility: 'list' }] });
    };
    const catalog = await f.service.models(f.connection.id);
    assert.deepEqual(catalog.models, ['model-b', 'model-a']); assert.deepEqual(catalog.options, [{ id: 'model-b', label: 'Friendly model B' }, { id: 'model-a', label: 'Friendly model A' }]);
  } finally { globalThis.fetch = originalFetch; f.auth.dispose(); f.sqlite.close(); }
});

test('concurrent sign-in starts share one attempt and callback listener', async () => {
  const f = fixture(); try {
    const statuses = await Promise.all([f.auth.start(f.connection.id), f.auth.start(f.connection.id)]);
    assert.equal(statuses[0].authorizationUrl, statuses[1].authorizationUrl);
    assert.equal(await f.callback(new URL(statuses[0].authorizationUrl!)), 200); assert.equal(f.grants.length, 1);
  } finally { f.auth.dispose(); f.sqlite.close(); }
});
test('active ChatGPT resolution rechecks test validity after a concurrent account update', async () => {
  const f = fixture(); try {
    await f.callback(await f.start()); await f.service.update(f.connection.id, { model: 'fixture-model' }); await f.service.test(f.connection.id); await f.service.activate(f.connection.id);
    const originalAccessToken = f.auth.accessToken.bind(f.auth);
    f.auth.accessToken = async id => { const token = await originalAccessToken(id); await f.service.update(id, { model: 'untested-model' }); return token; };
    await assert.rejects(f.service.resolve(), { code: 'AI_SETUP_REQUIRED' });
  } finally { f.auth.dispose(); f.sqlite.close(); }
});

test('pending reauthorization keeps the previously tested ChatGPT account active until credentials change', async () => {
  const f = fixture(); try {
    await f.callback(await f.start()); await f.service.update(f.connection.id, { model: 'fixture-model' }); await f.service.test(f.connection.id); await f.service.activate(f.connection.id);
    const url = await f.start(); assert.equal((await f.auth.status(f.connection.id)).state, 'pending'); assert.equal((await f.service.status()).state, 'configured');
    assert.equal((await f.service.resolve()).accessToken, 'access-secret');
    await f.callback(url); assert.equal((await f.service.status()).state, 'needs_setup');
  } finally { f.auth.dispose(); f.sqlite.close(); }
});
