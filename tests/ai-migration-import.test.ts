import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { AppStore, initializeSchema } from '../server/store.js';
import { ConnectionService } from '../server/connections/ConnectionService.js';
import { MemoryCredentialStore, CredentialStoreError } from '../server/credentials/CredentialStore.js';
import { migrateSettings } from '../server/ai/migrateSettings.js';
import { importBackup } from '../server/connections/importBackup.js';
import { importDataSchema } from '../server/contracts.js';
import { LEGACY_DEFAULT_APP_SETTINGS } from '../src/types.js';

function fixture() {
  const sqlite = new Database(':memory:'); initializeSchema(sqlite);
  const store = new AppStore(sqlite), keys = new MemoryCredentialStore();
  const connections = new ConnectionService(store, keys);
  return { sqlite, store, keys, connections };
}
const idea = { id: 'existing', title: 'Original', details: '', timestamp: 1, keywords: [], chatHistory: [], relatedIdeas: [], status: 'draft' as const };

test('migration moves inactive retained Gemini keys while preserving the selected provider', async () => {
  for (const provider of ['ollama', 'cli_proxy'] as const) {
    const { store, connections } = fixture();
    store.saveLegacySettings({ ...LEGACY_DEFAULT_APP_SETTINGS, provider, geminiKey: 'inactive-key', cliCommandTemplate: 'codex {{prompt}}' });
    await migrateSettings(connections);
    assert.equal(connections.migrationError, null);
    assert.equal(store.getLegacySettings().geminiKey, '');
    const gemini = store.listConnections().find(c => c.kind === 'api' && c.provider === 'gemini')!;
    assert.equal((await connections.resolve(gemini.id)).apiKey, 'inactive-key');
    const selected = await connections.resolve();
    assert.equal(selected.connection.kind === 'api' ? selected.connection.provider : 'cli_proxy', provider);
    assert.equal(store.listConnections().length, 2);
  }
});
test('migration completion, plaintext cleanup and selection roll back together and retry', async () => {
  const { store, connections } = fixture();
  store.saveLegacySettings({ ...LEGACY_DEFAULT_APP_SETTINGS, geminiKey: 'source-key' });
  const setMetadata = store.setMetadata.bind(store);
  store.setMetadata = (key, value) => { if (key === 'ai_connections_migrated') throw new Error('Simulated commit failure'); setMetadata(key, value); };
  await migrateSettings(connections);
  assert.ok(connections.migrationError); assert.equal(store.getLegacySettings().geminiKey, 'source-key');
  assert.equal((await store.getSettings()).activeConnectionId, null);
  assert.equal(store.getMetadata('ai_connections_migrated'), null);
  store.setMetadata = setMetadata; await migrateSettings(connections);
  assert.equal(connections.migrationError, null); assert.equal(store.getLegacySettings().geminiKey, '');
  assert.equal((await connections.resolve()).apiKey, 'source-key');
  assert.equal(store.listConnections().length, 1);
});
test('migration resumes previously persisted profile after the old plaintext source was cleared', async () => {
  const { store, connections } = fixture();
  store.saveLegacySettings({ ...LEGACY_DEFAULT_APP_SETTINGS, geminiKey: '' });
  const id = `legacy-${store.getDatabaseIdentity()}`;
  connections.create({ kind: 'api', name: 'Interrupted Gemini', provider: 'gemini', model: 'gemini-2.0-flash' }, id);
  await connections.setCredential(id, 'already-migrated-key');
  await migrateSettings(connections);
  assert.equal(connections.migrationError, null);
  assert.equal((await store.getSettings()).activeConnectionId, id);
  assert.equal((await connections.resolve()).apiKey, 'already-migrated-key');
});
test('invalid legacy backup connections never overwrite ideas before failing', async () => {
  const { store, connections } = fixture(); await store.saveIdea(idea);
  const payload = importDataSchema.parse({ ideas: [{ ...idea, title: 'Overwrite' }], settings: { ...LEGACY_DEFAULT_APP_SETTINGS, provider: 'ollama', ollamaEndpoint: 'http://remote.example' } });
  await assert.rejects(importBackup(connections, payload));
  assert.equal((await store.getIdea(idea.id))?.title, 'Original');
  assert.equal(store.listConnections().length, 0);
});
test('credential import denial leaves both ideas and profile metadata untouched', async () => {
  const { store, keys } = fixture(); await store.saveIdea(idea);
  const connections = new ConnectionService(store, { set: async () => { throw new CredentialStoreError(); }, get: r => keys.get(r), delete: r => keys.delete(r) });
  const payload = importDataSchema.parse({ ideas: [{ ...idea, title: 'Overwrite' }], settings: { ...LEGACY_DEFAULT_APP_SETTINGS, geminiKey: 'backup-key' }, importCredentials: true });
  await assert.rejects(importBackup(connections, payload), { code: 'AI_CREDENTIAL_STORE_UNAVAILABLE' });
  assert.equal((await store.getIdea(idea.id))?.title, 'Original'); assert.equal(store.listConnections().length, 0);
});
test('browser legacy credential migration can retry while retaining its original source', async () => {
  const { store, keys } = fixture(); let deny = true;
  const connections = new ConnectionService(store, { set: async (r,k) => { if (deny) throw new CredentialStoreError(); await keys.set(r,k); }, get: r => keys.get(r), delete: r => keys.delete(r) });
  await migrateSettings(connections);
  const source = { ...LEGACY_DEFAULT_APP_SETTINGS, geminiKey: 'browser-key' };
  await migrateSettings(connections, source); assert.ok(connections.migrationError);
  assert.equal(store.getMetadata('legacy_browser_migration_pending'), '1');
  deny = false; await migrateSettings(connections, source);
  assert.equal(connections.migrationError, null); assert.equal((await connections.resolve()).apiKey, 'browser-key');
  assert.equal(store.getMetadata('legacy_browser_migration_pending'), null);
});

test('migration never marks a concurrently edited model tested', async () => {
  const { store, keys } = fixture();
  store.saveLegacySettings({ ...LEGACY_DEFAULT_APP_SETTINGS, geminiKey: 'original-key' });
  const id = `legacy-gemini-${store.getDatabaseIdentity()}`;
  const preparation = new ConnectionService(store, keys);
  preparation.create({ kind: 'api', provider: 'gemini', name: 'Pending migration', model: 'gemini-2.0-flash' }, id);
  await preparation.setCredential(id, 'original-key');
  let resume!: () => void, entered!: () => void;
  const blocked = new Promise<void>(resolve => { resume = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let paused = false;
  const migrating = new ConnectionService(store, { set: (r,k) => keys.set(r,k), delete: r => keys.delete(r), get: async r => {
    if (!paused) { paused = true; entered(); await blocked; } return keys.get(r);
  } });
  const pending = migrateSettings(migrating); await started;
  await preparation.update(id, { model: 'never-tested-model' }); resume(); await pending;
  assert.ok(migrating.migrationError); assert.equal(store.getConnection(id)!.testedRevision, null);
  assert.equal((await store.getSettings()).activeConnectionId, null);
  // Retrying completes credential cleanup, but does not grandfather the edited model.
  await migrateSettings(migrating); assert.equal(migrating.migrationError, null);
  assert.equal(store.getLegacySettings().geminiKey, ''); assert.equal(store.getConnection(id)!.testedRevision, null);
  assert.equal((await store.getSettings()).activeConnectionId, null);
});
