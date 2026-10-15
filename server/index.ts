import path from 'node:path';
import { createAiRuntime } from './ai/runtime.js';
import { createHttpApp, serveFrontend } from './app.js';
import { DATABASE_PATH, LEGACY_DB_JSON_PATH, SERVER_HOST, SERVER_PORT } from './config.js';
import { AppStore, createSqliteDatabase, initializeSchema } from './store.js';

const sqlite = createSqliteDatabase(DATABASE_PATH);
initializeSchema(sqlite);

const store = new AppStore(sqlite);
await store.maybeMigrateLegacyJson(LEGACY_DB_JSON_PATH);

const { aiService, connections } = await createAiRuntime(store);
const app = createHttpApp(store, aiService, connections);
if (process.env.NODE_ENV === 'production') serveFrontend(app, path.resolve(process.cwd(), 'dist'));

app.listen(SERVER_PORT, SERVER_HOST, () => {
  console.log(`Startup Idea Tracker backend listening on http://${SERVER_HOST}:${SERVER_PORT}`);
});
