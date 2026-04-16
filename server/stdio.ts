import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BackendAiService } from './ai.js';
import { DATABASE_PATH, LEGACY_DB_JSON_PATH } from './config.js';
import { createIdeaMcpServer } from './mcp.js';
import { AppStore, createSqliteDatabase, initializeSchema } from './store.js';

const sqlite = createSqliteDatabase(DATABASE_PATH);
initializeSchema(sqlite);

const store = new AppStore(sqlite);
await store.maybeMigrateLegacyJson(LEGACY_DB_JSON_PATH);

const aiService = new BackendAiService(() => store.getSettings());
const server = createIdeaMcpServer(store, aiService);
const transport = new StdioServerTransport();

await server.connect(transport);
