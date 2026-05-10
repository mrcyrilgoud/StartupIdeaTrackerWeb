import { BackendAiService } from './ai.js';
import { createHttpApp } from './app.js';
import { DATABASE_PATH, LEGACY_DB_JSON_PATH, SERVER_HOST, SERVER_PORT } from './config.js';
import { AppStore, createSqliteDatabase, initializeSchema } from './store.js';

const sqlite = createSqliteDatabase(DATABASE_PATH);
initializeSchema(sqlite);

const store = new AppStore(sqlite);
await store.maybeMigrateLegacyJson(LEGACY_DB_JSON_PATH);

const aiService = new BackendAiService(() => store.getSettings());
const app = createHttpApp(store, aiService);

app.listen(SERVER_PORT, SERVER_HOST, () => {
  console.log(`Startup Idea Tracker backend listening on http://${SERVER_HOST}:${SERVER_PORT}`);
});
