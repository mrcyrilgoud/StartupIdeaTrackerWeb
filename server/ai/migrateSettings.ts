import type { LegacyAppSettings } from '../../src/types.js';
import type { ConnectionService } from '../connections/ConnectionService.js';
import type { StoredConnection } from '../connections/contracts.js';
import { AiConnectionError } from '../errors.js';

export async function migrateSettings(connections: ConnectionService, override?: LegacyAppSettings): Promise<void> {
  const { store } = connections;
  const browserPending = store.getMetadata('legacy_browser_migration_pending') === '1';
  if (!override && store.getMetadata('ai_connections_migrated') === '2' && !browserPending) return;
  if (override && store.listConnections().length > 0 && !browserPending && !connections.migrationError) return;
  const settings = override ?? store.getLegacySettings();
  const namespace = store.getDatabaseIdentity();
  const id = `legacy-${namespace}`;
  const existingPrimary = store.getConnection(id);
  const geminiId = existingPrimary?.kind === 'api' && existingPrimary.provider === 'gemini'
    ? id : `legacy-gemini-${namespace}`;
  const snapshots = new Map<string, { connection: StoredConnection; testable: boolean }>();
  let selectedId: string | null = null;
  const assertRevision = (snapshot: StoredConnection) => {
    if (store.getConnection(snapshot.id)?.revision !== snapshot.revision)
      throw new AiConnectionError('AI_CONNECTION_CHANGED', 'Connection changed during migration. Retry migration; edited connections require testing.');
  };
  try {
    if (override) store.setMetadata('legacy_browser_migration_pending', '1');
    // Migrate retained keys even when Ollama or the proxy was selected.
    if (settings.geminiKey.trim() || store.getConnection(geminiId)?.credentialRef) {
      if (!store.getConnection(geminiId)) connections.create({ kind: 'api', provider: 'gemini', name: 'Migrated Gemini', model: 'gemini-2.0-flash' }, geminiId);
      const previous = store.getConnection(geminiId)!;
      let snapshot = previous;
      const previousKey = previous.credentialRef ? await connections.credentials.get(previous.credentialRef) : null;
      assertRevision(previous);
      if (settings.geminiKey.trim() && previousKey !== settings.geminiKey) {
        await connections.setCredential(geminiId, settings.geminiKey);
        snapshot = store.getConnection(geminiId)!;
        if (snapshot.revision !== previous.revision + 1) throw new AiConnectionError('AI_CONNECTION_CHANGED', 'Connection changed during credential migration. Retry.');
      }
      // Capture configuration BEFORE waiting for Keychain; never bless a later revision.
      if (!snapshot.credentialRef || !await connections.credentials.get(snapshot.credentialRef)) throw new AiConnectionError('AI_CREDENTIAL_MISSING', 'Legacy API key migration is incomplete.');
      assertRevision(snapshot);
      const testable = snapshot.kind === 'api' && snapshot.provider === 'gemini' && snapshot.model === 'gemini-2.0-flash';
      snapshots.set(geminiId, { connection: snapshot, testable });
      if (settings.provider === 'gemini' && testable) selectedId = geminiId;
    }
    if (browserPending && !override && settings.provider === 'gemini' && !snapshots.has(geminiId))
      throw new Error('Retry migration from the browser that contains the legacy settings.');
    if (settings.provider === 'ollama') {
      if (!store.getConnection(id)) connections.create({ kind: 'api', provider: 'ollama', name: 'Migrated Ollama', model: settings.ollamaModel, baseUrl: settings.ollamaEndpoint }, id);
      const snapshot = store.getConnection(id)!;
      const testable = snapshot.kind === 'api' && snapshot.provider === 'ollama' && snapshot.model === settings.ollamaModel && snapshot.baseUrl === settings.ollamaEndpoint;
      snapshots.set(id, { connection: snapshot, testable }); if (testable) selectedId = id;
    } else if (settings.provider === 'cli_proxy') {
      const tool = settings.cliCommandTemplate.trim().split(/\s+/)[0];
      if (['codex', 'gemini', 'opencode', 'cursor', 'claude', 'kiro'].includes(tool)) {
        if (!store.getConnection(id)) connections.create({ kind: 'cli_proxy', name: `Migrated ${tool}`, tool }, id);
        const snapshot = store.getConnection(id)!;
        const testable = snapshot.kind === 'cli_proxy' && snapshot.tool === tool && !snapshot.model;
        snapshots.set(id, { connection: snapshot, testable }); if (testable) selectedId = id;
      }
    }
    if (selectedId) store.setMetadata('ai_connections_migration_selected', selectedId);
    store.atomic(() => {
      for (const { connection: snapshot, testable } of snapshots.values()) {
        assertRevision(snapshot);
        if (testable) store.markConnectionTested(snapshot.id, snapshot.revision);
      }
      store.clearLegacyKey();
      if (selectedId && !store.getMetadata('active_ai_connection')) store.activateTestedConnection(selectedId);
      store.setMetadata('ai_connections_migrated', '2');
      store.setMetadata('legacy_browser_migration_pending', '');
      store.setMetadata('ai_connections_migration_selected', '');
    });
    connections.migrationError = null;
  } catch (error) {
    connections.migrationError = error instanceof Error ? error.message : 'AI settings migration failed. Retry in Settings.';
  }
}
