import type { AuthOptions } from '../chatgptAuth.js';
import { BackendAiService } from '../ai.js';
import { ConnectionService } from '../connections/ConnectionService.js';
import { MacKeychainCredentialStore, type CredentialStore } from '../credentials/CredentialStore.js';
import type { AppStore } from '../store.js';
import { migrateSettings } from './migrateSettings.js';

export async function createAiRuntime(store: AppStore, credentials: CredentialStore = new MacKeychainCredentialStore(), authOptions?: AuthOptions) {
  const connections = new ConnectionService(store, credentials, authOptions);
  await connections.cleanupCredentials();
  await migrateSettings(connections);
  const aiService = new BackendAiService(() => connections.resolve());
  connections.setTester((resolved) => new BackendAiService(async () => resolved).generateResponse('Reply with only OK.', false, false, undefined, { maxOutputTokens: 16 }));
  return { connections, aiService };
}
