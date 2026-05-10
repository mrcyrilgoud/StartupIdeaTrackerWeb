import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { appSettingsTable, foldersTable, schema } from './schema.js';
import { NotFoundError } from './errors.js';
import { DEFAULT_APP_SETTINGS, type AppSettings, type Folder, type Idea, type VettingCriteria, type VettingResult } from '../src/types.js';
import type { IdeaListQuery, UpdateIdeaInput } from './contracts.js';

type SqliteDatabase = Database.Database;
const LEGACY_JSON_MIGRATION_FLAG = 'legacy_json_migrated';

type IdeaRow = {
  id: string;
  title: string;
  details: string;
  analysis: string | null;
  status: Idea['status'];
  folder_id: string | null;
  created_at: number;
  updated_at: number;
};

type FolderRow = {
  id: string;
  name: string;
  created_at: number;
};

type KeywordRow = {
  idea_id: string;
  keyword: string;
};

type RelatedRow = {
  idea_id: string;
  related_idea_id: string;
};

type ChatRow = {
  id: string;
  idea_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: number;
};

type VettingRow = {
  idea_id: string;
  criteria: VettingCriteria;
  score: number;
  reason: string;
  created_at: number;
};

type ExportPayload = {
  version: number;
  timestamp: number;
  ideas: Idea[];
  folders: Folder[];
  settings: AppSettings;
};

type CountRow = {
  count: number;
};

type MetadataRow = {
  value: string;
};

function ensureDirectory(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function buildPlaceholders(values: readonly string[]): string {
  return values.map(() => '?').join(', ');
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function createSqliteDatabase(databasePath: string): SqliteDatabase {
  ensureDirectory(databasePath);
  const sqlite = new Database(databasePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  return sqlite;
}

export function initializeSchema(sqlite: SqliteDatabase): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS ideas (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      details TEXT NOT NULL,
      analysis TEXT,
      status TEXT NOT NULL,
      folder_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS idea_keywords (
      idea_id TEXT NOT NULL,
      keyword TEXT NOT NULL,
      PRIMARY KEY (idea_id, keyword),
      FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS idea_related (
      idea_id TEXT NOT NULL,
      related_idea_id TEXT NOT NULL,
      PRIMARY KEY (idea_id, related_idea_id),
      FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS idea_chat_messages (
      id TEXT PRIMARY KEY,
      idea_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS idea_vetting_results (
      idea_id TEXT NOT NULL,
      criteria TEXT NOT NULL,
      score INTEGER NOT NULL,
      reason TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (idea_id, criteria),
      FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      gemini_key TEXT NOT NULL,
      ollama_endpoint TEXT NOT NULL,
      ollama_model TEXT NOT NULL,
      cli_command_template TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

export class AppStore {
  private readonly sqlite: SqliteDatabase;
  private readonly db: ReturnType<typeof drizzle>;
  private readonly importTransaction: (payload: {
    ideas?: Idea[];
    folders?: Folder[];
    settings?: Partial<AppSettings>;
  }) => void;

  constructor(sqlite: SqliteDatabase) {
    this.sqlite = sqlite;
    this.db = drizzle(sqlite, { schema });
    this.importTransaction = this.sqlite.transaction((payload: {
      ideas?: Idea[];
      folders?: Folder[];
      settings?: Partial<AppSettings>;
    }) => {
      for (const folder of payload.folders ?? []) {
        this.saveFolderSync(folder);
      }

      for (const idea of payload.ideas ?? []) {
        this.saveIdeaSync(idea);
      }

      if (payload.settings) {
        const current = this.getSettingsSync();
        this.saveSettingsSync({
          ...current,
          ...payload.settings
        });
      }
    });
  }

  private getRowCount(tableName: 'ideas' | 'folders' | 'app_settings'): number {
    const row = this.sqlite.prepare(`SELECT count(*) as count FROM ${tableName}`).get() as CountRow;
    return row.count;
  }

  private hasCompletedLegacyJsonMigration(): boolean {
    const row = this.sqlite.prepare('SELECT value FROM app_metadata WHERE key = ?').get(LEGACY_JSON_MIGRATION_FLAG) as MetadataRow | undefined;
    return row?.value === 'true';
  }

  private markLegacyJsonMigrationComplete(): void {
    const now = Date.now();
    this.sqlite.prepare(`
      INSERT INTO app_metadata (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).run(LEGACY_JSON_MIGRATION_FLAG, 'true', now);
  }

  private saveIdeaSync(idea: Idea): void {
    const now = Date.now();
    const createdAt = idea.timestamp || now;

    this.sqlite.prepare(`
      INSERT INTO ideas (id, title, details, analysis, status, folder_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        details = excluded.details,
        analysis = excluded.analysis,
        status = excluded.status,
        folder_id = excluded.folder_id,
        created_at = MIN(ideas.created_at, excluded.created_at),
        updated_at = excluded.updated_at
    `).run(
      idea.id,
      idea.title,
      idea.details,
      idea.analysis ?? null,
      idea.status,
      idea.folder_id ?? null,
      createdAt,
      now
    );

    this.overwriteIdeaRelations({
      ...idea,
      keywords: uniqueStrings(idea.keywords),
      relatedIdeas: uniqueStrings(idea.relatedIdeas)
    });
  }

  private saveFolderSync(folder: Folder): void {
    const now = Date.now();
    this.sqlite.prepare(`
      INSERT INTO folders (id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        updated_at = excluded.updated_at
    `).run(
      folder.id,
      folder.name,
      folder.timestamp || now,
      now
    );
  }

  private getSettingsSync(): AppSettings {
    const existing = this.sqlite.prepare(`
      SELECT provider, gemini_key, ollama_endpoint, ollama_model, cli_command_template
      FROM app_settings
      WHERE id = ?
    `).get('default') as {
      provider: AppSettings['provider'];
      gemini_key: string;
      ollama_endpoint: string;
      ollama_model: string;
      cli_command_template: string;
    } | undefined;

    if (!existing) {
      this.saveSettingsSync(DEFAULT_APP_SETTINGS);
      return DEFAULT_APP_SETTINGS;
    }

    return {
      provider: existing.provider,
      geminiKey: existing.gemini_key,
      ollamaEndpoint: existing.ollama_endpoint,
      ollamaModel: existing.ollama_model,
      cliCommandTemplate: existing.cli_command_template
    };
  }

  private saveSettingsSync(settings: AppSettings): void {
    this.sqlite.prepare(`
      INSERT INTO app_settings (id, provider, gemini_key, ollama_endpoint, ollama_model, cli_command_template, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider = excluded.provider,
        gemini_key = excluded.gemini_key,
        ollama_endpoint = excluded.ollama_endpoint,
        ollama_model = excluded.ollama_model,
        cli_command_template = excluded.cli_command_template,
        updated_at = excluded.updated_at
    `).run(
      'default',
      settings.provider,
      settings.geminiKey,
      settings.ollamaEndpoint,
      settings.ollamaModel,
      settings.cliCommandTemplate,
      Date.now()
    );
  }

  private hydrateIdeas(baseRows: IdeaRow[]): Idea[] {
    if (baseRows.length === 0) {
      return [];
    }

    const ids = baseRows.map((row) => row.id);
    const placeholders = buildPlaceholders(ids);

    const ideas = new Map<string, Idea>();
    for (const row of baseRows) {
      ideas.set(row.id, {
        id: row.id,
        title: row.title,
        details: row.details,
        analysis: row.analysis ?? undefined,
        timestamp: row.created_at,
        keywords: [],
        chatHistory: [],
        relatedIdeas: [],
        status: row.status,
        folder_id: row.folder_id ?? undefined
      });
    }

    const keywordRows = this.sqlite.prepare(`
      SELECT idea_id, keyword
      FROM idea_keywords
      WHERE idea_id IN (${placeholders})
      ORDER BY rowid
    `).all(...ids) as KeywordRow[];

    for (const row of keywordRows) {
      ideas.get(row.idea_id)?.keywords.push(row.keyword);
    }

    const relatedRows = this.sqlite.prepare(`
      SELECT idea_id, related_idea_id
      FROM idea_related
      WHERE idea_id IN (${placeholders})
      ORDER BY rowid
    `).all(...ids) as RelatedRow[];

    for (const row of relatedRows) {
      ideas.get(row.idea_id)?.relatedIdeas.push(row.related_idea_id);
    }

    const chatRows = this.sqlite.prepare(`
      SELECT id, idea_id, role, content, created_at
      FROM idea_chat_messages
      WHERE idea_id IN (${placeholders})
      ORDER BY created_at ASC
    `).all(...ids) as ChatRow[];

    for (const row of chatRows) {
      ideas.get(row.idea_id)?.chatHistory.push({
        id: row.id,
        role: row.role,
        content: row.content,
        timestamp: row.created_at
      });
    }

    const vettingRows = this.sqlite.prepare(`
      SELECT idea_id, criteria, score, reason, created_at
      FROM idea_vetting_results
      WHERE idea_id IN (${placeholders})
      ORDER BY created_at ASC
    `).all(...ids) as VettingRow[];

    for (const row of vettingRows) {
      const idea = ideas.get(row.idea_id);
      if (!idea) continue;

      const result: VettingResult = {
        ideaId: row.idea_id,
        criteria: row.criteria,
        score: row.score,
        reason: row.reason,
        timestamp: row.created_at
      };

      idea.vetting = {
        ...idea.vetting,
        [row.criteria]: result
      };
    }

    return baseRows.map((row) => ideas.get(row.id) as Idea);
  }

  private overwriteIdeaRelations(idea: Idea): void {
    this.sqlite.prepare('DELETE FROM idea_keywords WHERE idea_id = ?').run(idea.id);
    this.sqlite.prepare('DELETE FROM idea_related WHERE idea_id = ?').run(idea.id);
    this.sqlite.prepare('DELETE FROM idea_chat_messages WHERE idea_id = ?').run(idea.id);
    this.sqlite.prepare('DELETE FROM idea_vetting_results WHERE idea_id = ?').run(idea.id);

    const keywordInsert = this.sqlite.prepare('INSERT INTO idea_keywords (idea_id, keyword) VALUES (?, ?)');
    for (const keyword of uniqueStrings(idea.keywords)) {
      keywordInsert.run(idea.id, keyword);
    }

    const relatedInsert = this.sqlite.prepare('INSERT INTO idea_related (idea_id, related_idea_id) VALUES (?, ?)');
    for (const relatedIdeaId of uniqueStrings(idea.relatedIdeas)) {
      relatedInsert.run(idea.id, relatedIdeaId);
    }

    const chatInsert = this.sqlite.prepare(`
      INSERT INTO idea_chat_messages (id, idea_id, role, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const message of idea.chatHistory) {
      chatInsert.run(message.id, idea.id, message.role, message.content, message.timestamp);
    }

    const vettingInsert = this.sqlite.prepare(`
      INSERT INTO idea_vetting_results (idea_id, criteria, score, reason, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const result of Object.values(idea.vetting ?? {})) {
      if (!result) continue;
      vettingInsert.run(idea.id, result.criteria, result.score, result.reason, result.timestamp);
    }
  }

  async listIdeas(query: IdeaListQuery = {}): Promise<Idea[]> {
    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (query.query) {
      conditions.push(`(
        LOWER(ideas.title) LIKE ?
        OR LOWER(ideas.details) LIKE ?
        OR EXISTS (
          SELECT 1 FROM idea_keywords keywords
          WHERE keywords.idea_id = ideas.id AND LOWER(keywords.keyword) LIKE ?
        )
      )`);
      const searchValue = `%${query.query.toLowerCase()}%`;
      params.push(searchValue, searchValue, searchValue);
    }

    if (query.status) {
      conditions.push('ideas.status = ?');
      params.push(query.status);
    }

    if (query.folderId) {
      conditions.push('ideas.folder_id = ?');
      params.push(query.folderId);
    }

    let sqlText = `
      SELECT ideas.id, ideas.title, ideas.details, ideas.analysis, ideas.status, ideas.folder_id, ideas.created_at, ideas.updated_at
      FROM ideas
    `;

    if (conditions.length > 0) {
      sqlText += ` WHERE ${conditions.join(' AND ')}`;
    }

    sqlText += ' ORDER BY ideas.updated_at DESC';

    if (query.limit) {
      sqlText += ' LIMIT ?';
      params.push(query.limit);
    }

    const rows = this.sqlite.prepare(sqlText).all(...params) as IdeaRow[];
    return this.hydrateIdeas(rows);
  }

  async getIdea(id: string): Promise<Idea | undefined> {
    const row = this.sqlite.prepare(`
      SELECT id, title, details, analysis, status, folder_id, created_at, updated_at
      FROM ideas
      WHERE id = ?
    `).get(id) as IdeaRow | undefined;

    if (!row) {
      return undefined;
    }

    return this.hydrateIdeas([row])[0];
  }

  async saveIdea(idea: Idea): Promise<Idea> {
    this.saveIdeaSync(idea);
    return (await this.getIdea(idea.id)) as Idea;
  }

  async updateIdea(id: string, patch: UpdateIdeaInput): Promise<Idea> {
    const existing = await this.getIdea(id);
    if (!existing) {
      throw new NotFoundError(`Idea ${id} not found`);
    }

    const mergedVetting = patch.vetting
      ? patch.vetting
      : patch.vettingMerge
        ? {
            ...existing.vetting,
            ...Object.fromEntries(patch.vettingMerge.map((result) => [result.criteria, result]))
          }
        : existing.vetting;

    const nextIdea: Idea = {
      ...existing,
      title: patch.title ?? existing.title,
      details: patch.details ?? existing.details,
      analysis: patch.analysis ?? existing.analysis,
      timestamp: patch.timestamp ?? existing.timestamp,
      keywords: patch.keywords ?? existing.keywords,
      chatHistory: patch.chatHistory ?? [...existing.chatHistory, ...(patch.chatAppend ?? [])],
      relatedIdeas: patch.relatedIdeas ?? existing.relatedIdeas,
      status: patch.status ?? existing.status,
      folder_id: patch.folder_id === null ? undefined : (patch.folder_id ?? existing.folder_id),
      vetting: mergedVetting
    };

    return this.saveIdea(nextIdea);
  }

  async deleteIdea(id: string): Promise<void> {
    this.sqlite.prepare('DELETE FROM ideas WHERE id = ?').run(id);
  }

  async listFolders(): Promise<Folder[]> {
    const rows = await this.db.select({
      id: foldersTable.id,
      name: foldersTable.name,
      createdAt: foldersTable.createdAt
    }).from(foldersTable).orderBy(foldersTable.createdAt);

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      timestamp: row.createdAt
    }));
  }

  async saveFolder(folder: Folder): Promise<Folder> {
    this.saveFolderSync(folder);
    return {
      id: folder.id,
      name: folder.name,
      timestamp: folder.timestamp || Date.now()
    };
  }

  async deleteFolder(id: string): Promise<void> {
    this.sqlite.prepare('UPDATE ideas SET folder_id = NULL WHERE folder_id = ?').run(id);
    this.sqlite.prepare('DELETE FROM folders WHERE id = ?').run(id);
  }

  async getSettings(): Promise<AppSettings> {
    return this.getSettingsSync();
  }

  async saveSettings(settings: AppSettings): Promise<AppSettings> {
    this.saveSettingsSync(settings);
    return settings;
  }

  async exportData(): Promise<ExportPayload> {
    const [ideas, folders, settings] = await Promise.all([
      this.listIdeas(),
      this.listFolders(),
      this.getSettings()
    ]);

    return {
      version: 1,
      timestamp: Date.now(),
      ideas,
      folders,
      settings
    };
  }

  async importData(payload: {
    ideas?: Idea[];
    folders?: Folder[];
    settings?: Partial<AppSettings>;
  }): Promise<void> {
    this.importTransaction(payload);
  }

  async maybeMigrateLegacyJson(legacyPath: string): Promise<boolean> {
    if (this.hasCompletedLegacyJsonMigration()) {
      return false;
    }

    const ideaCount = this.getRowCount('ideas');
    const folderCount = this.getRowCount('folders');
    const settingsCount = this.getRowCount('app_settings');

    // Backfill the flag for databases that were already initialized before this safeguard existed.
    if (ideaCount > 0 || folderCount > 0 || settingsCount > 0) {
      this.markLegacyJsonMigrationComplete();
      return false;
    }

    if (!fs.existsSync(legacyPath)) {
      return false;
    }

    let payload: {
      ideas?: Idea[];
      folders?: Folder[];
    };
    try {
      payload = JSON.parse(fs.readFileSync(legacyPath, 'utf8')) as {
        ideas?: Idea[];
        folders?: Folder[];
      };
    } catch (error) {
      console.warn(`Skipping legacy JSON migration due to unreadable payload at ${legacyPath}.`, error);
      return false;
    }

    try {
      await this.importData(payload);
      this.markLegacyJsonMigrationComplete();
      return true;
    } catch (error) {
      console.warn(`Skipping legacy JSON migration due to import failure from ${legacyPath}.`, error);
      return false;
    }
  }

  async search(query: string, limit = 10): Promise<Array<{ type: 'idea' | 'folder'; id: string; title: string; snippet: string }>> {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      return [];
    }

    const ideaResults = (await this.listIdeas({ query: trimmed, limit })).map((idea) => ({
      type: 'idea' as const,
      id: idea.id,
      title: idea.title,
      snippet: idea.details.slice(0, 180)
    }));

    const folders = await this.listFolders();
    const folderResults = folders
      .filter((folder) => folder.name.toLowerCase().includes(trimmed))
      .slice(0, limit)
      .map((folder) => ({
        type: 'folder' as const,
        id: folder.id,
        title: folder.name,
        snippet: `Folder created at ${new Date(folder.timestamp).toISOString()}`
      }));

    return [...ideaResults, ...folderResults].slice(0, limit);
  }
}
