import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const ideasTable = sqliteTable('ideas', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  details: text('details').notNull(),
  analysis: text('analysis'),
  status: text('status').notNull(),
  folderId: text('folder_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
});

export const foldersTable = sqliteTable('folders', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
});

export const ideaKeywordsTable = sqliteTable('idea_keywords', {
  ideaId: text('idea_id').notNull(),
  keyword: text('keyword').notNull()
}, (table) => ({
  pk: primaryKey({ columns: [table.ideaId, table.keyword] })
}));

export const ideaRelatedTable = sqliteTable('idea_related', {
  ideaId: text('idea_id').notNull(),
  relatedIdeaId: text('related_idea_id').notNull()
}, (table) => ({
  pk: primaryKey({ columns: [table.ideaId, table.relatedIdeaId] })
}));

export const ideaChatMessagesTable = sqliteTable('idea_chat_messages', {
  id: text('id').primaryKey(),
  ideaId: text('idea_id').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  createdAt: integer('created_at').notNull()
});

export const ideaVettingResultsTable = sqliteTable('idea_vetting_results', {
  ideaId: text('idea_id').notNull(),
  criteria: text('criteria').notNull(),
  score: integer('score').notNull(),
  reason: text('reason').notNull(),
  createdAt: integer('created_at').notNull()
}, (table) => ({
  pk: primaryKey({ columns: [table.ideaId, table.criteria] })
}));

export const appSettingsTable = sqliteTable('app_settings', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  geminiKey: text('gemini_key').notNull(),
  ollamaEndpoint: text('ollama_endpoint').notNull(),
  ollamaModel: text('ollama_model').notNull(),
  cliCommandTemplate: text('cli_command_template').notNull(),
  updatedAt: integer('updated_at').notNull()
});

export const appMetadataTable = sqliteTable('app_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull()
});

export const schema = {
  ideasTable,
  foldersTable,
  ideaKeywordsTable,
  ideaRelatedTable,
  ideaChatMessagesTable,
  ideaVettingResultsTable,
  appSettingsTable,
  appMetadataTable
};
