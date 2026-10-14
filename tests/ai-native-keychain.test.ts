import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { AppStore, createSqliteDatabase, initializeSchema } from '../server/store.js';
import { createAiRuntime } from '../server/ai/runtime.js';
import { MacKeychainCredentialStore } from '../server/credentials/CredentialStore.js';

test('native Keychain-backed connection saves, tests, replaces and deletes using loopback inference', {
  skip: process.platform !== 'darwin' || process.env.NATIVE_KEYCHAIN_TEST !== '1'
}, async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'startup-native-keychain-'));
  const sqlite = createSqliteDatabase(path.join(directory, 'app.sqlite')); initializeSchema(sqlite);
  const store = new AppStore(sqlite);
  const seen: string[] = [];
  const provider = http.createServer((req, res) => {
    seen.push(String(req.headers.authorization));
    req.resume(); req.once('end', () => {
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
    });
  }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => provider.once('listening', resolve));
  const { connections, aiService } = await createAiRuntime(store);
  const profile = connections.create({ kind: 'api', provider: 'openai_compatible', name: 'Disposable native verification', model: 'test-only-model', baseUrl: `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1` });
  const references: string[] = [];
  const credentials = new MacKeychainCredentialStore();
  try {
    await connections.setCredential(profile.id, 'disposable-native-first'); references.push(store.getConnection(profile.id)!.credentialRef!);
    await connections.test(profile.id); await connections.activate(profile.id);
    assert.equal(await aiService.generateResponse('Local verification only.'), 'OK');
    await connections.setCredential(profile.id, 'disposable-native-second'); references.push(store.getConnection(profile.id)!.credentialRef!);
    assert.equal(await credentials.get(references[0]), null);
    await connections.test(profile.id); await connections.activate(profile.id);
    assert.equal(await aiService.generateResponse('Local replacement verification.'), 'OK');
    assert.deepEqual(seen, ['Bearer disposable-native-first', 'Bearer disposable-native-first', 'Bearer disposable-native-second', 'Bearer disposable-native-second']);
    assert.ok(!JSON.stringify(await store.exportData()).includes('disposable-native-'));
    await connections.delete(profile.id);
    assert.equal(await credentials.get(references[1]), null);
    assert.equal((await store.getSettings()).activeConnectionId, null);
  } finally {
    for (const reference of references) await credentials.delete(reference);
    await connections.cleanupCredentials();
    provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve()));
    sqlite.close(); rmSync(directory, { recursive: true, force: true });
  }
});
