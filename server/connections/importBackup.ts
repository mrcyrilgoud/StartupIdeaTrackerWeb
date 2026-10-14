import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { importDataSchema } from '../contracts.js';
import { LEGACY_DEFAULT_APP_SETTINGS, type Idea } from '../../src/types.js';
import { AiConnectionError } from '../errors.js';
import { CredentialStoreError } from '../credentials/CredentialStore.js';
import type { ConnectionService } from './ConnectionService.js';
import { connectionInputSchema, credentialWriteSchema, type StoredConnection } from './contracts.js';

/** Prepare all external credential writes before atomically importing SQLite data. */
export async function importBackup(service: ConnectionService, payload: z.infer<typeof importDataSchema>) {
  const planned: Array<{ connection: StoredConnection; key?: string }> = [];
  const add = (input: unknown, key?: string) => {
    const metadata = connectionInputSchema.parse(input);
    if (key) credentialWriteSchema.parse({ apiKey: key });
    const id = randomUUID();
    planned.push({ connection: { ...metadata, id, revision: 1, testedRevision: null,
      credentialRef: key ? `${service.store.getDatabaseIdentity()}:${id}:${randomUUID()}` : null }, key });
  };
  for (const connection of payload.connections ?? []) add(connection);
  if (payload.settings && 'provider' in payload.settings) {
    const legacy = { ...LEGACY_DEFAULT_APP_SETTINGS, ...payload.settings };
    if (legacy.geminiKey && !payload.importCredentials) throw new AiConnectionError('AI_CREDENTIAL_IMPORT_CONFIRMATION_REQUIRED', 'Confirm importing embedded API keys to Keychain.', 400);
    if (legacy.geminiKey || legacy.provider === 'gemini')
      add({ kind: 'api', provider: 'gemini', name: 'Imported Gemini', model: 'gemini-2.0-flash' }, legacy.geminiKey || undefined);
    if (legacy.provider === 'ollama') add({ kind: 'api', provider: 'ollama', name: 'Imported Ollama', model: legacy.ollamaModel, baseUrl: legacy.ollamaEndpoint });
    else if (legacy.provider === 'cli_proxy') {
      const tool = legacy.cliCommandTemplate.trim().split(/\s+/)[0];
      if (!['codex','gemini','opencode','cursor','claude','kiro'].includes(tool)) throw new AiConnectionError('AI_TOOL_UNSUPPORTED', 'The imported CLI tool is unsupported. Correct the backup settings first.', 400);
      add({ kind: 'cli_proxy', name: `Imported ${tool}`, tool });
    }
  }
  const written: string[] = [];
  try {
    for (const { connection, key } of planned) {
      if (connection.credentialRef && key) {
        written.push(connection.credentialRef);
        await service.credentials.set(connection.credentialRef, key);
        if (await service.credentials.get(connection.credentialRef) !== key) throw new CredentialStoreError();
      }
    }
    service.store.importConnectionBackup({
      ideas: payload.ideas?.map(idea => ({ ...idea, folder_id: idea.folder_id ?? undefined })) as Idea[] | undefined,
      folders: payload.folders, connections: planned.map(item => item.connection)
    });
  } catch (error) {
    for (const reference of written) service.store.journalCredentialCleanup(reference);
    await service.cleanupCredentials();
    throw error;
  }
}
