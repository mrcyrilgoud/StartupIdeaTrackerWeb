import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { appSettingsTable, foldersTable, schema } from './schema.js';
import { AiConnectionError, BadRequestError, NotFoundError } from './errors.js';
import { DEFAULT_APP_SETTINGS, LEGACY_DEFAULT_APP_SETTINGS, type AppSettings, type LegacyAppSettings, type Folder, type Idea, type IdeaEvent, type IdeaEventType, type IdeaSummary, type VettingCriteria, type VettingResult } from '../src/types.js';
import { connectionInputSchema, type ConnectionInput, type StoredConnection } from './connections/contracts.js';
import type { IdeaListQuery, IdeaSummaryQuery, UpdateIdeaInput } from './contracts.js';

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

type IdeaSummaryRow = Pick<IdeaRow, 'id' | 'title' | 'details' | 'status' | 'folder_id' | 'created_at' | 'updated_at'>;

type IdeaSummaryCursor = {
  updatedAt: number;
  id: string;
};

type IdeaBase = Pick<Idea, 'id' | 'title' | 'details' | 'analysis' | 'timestamp' | 'status' | 'folder_id'>;

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

type IdeaEventRow = {
  id: number;
  idea_id: string;
  live_idea_id: string | null;
  type: IdeaEventType;
  payload_json: string;
  snapshot_json: string;
  created_at: number;
};

type ExportPayload = {
  version: number;
  timestamp: number;
  ideas: Idea[];
  folders: Folder[];
  settings: AppSettings;
  connections: Array<ConnectionInput & { id: string }>;
};

type CountRow = {
  count: number;
};

type MetadataRow = {
  value: string;
};

type SaveIdeaEventContext = {
  type: IdeaEventType;
  payload?: Record<string, unknown>;
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

function encodeIdeaSummaryCursor(cursor: IdeaSummaryCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeIdeaSummaryCursor(value: string): IdeaSummaryCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<IdeaSummaryCursor>;
    if (!Number.isSafeInteger(parsed.updatedAt) || typeof parsed.id !== 'string' || parsed.id.length === 0) {
      throw new Error('invalid cursor shape');
    }
    return { updatedAt: parsed.updatedAt as number, id: parsed.id };
  } catch {
    throw new BadRequestError('Invalid idea summary cursor');
  }
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

    CREATE TABLE IF NOT EXISTS idea_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      idea_id TEXT NOT NULL,
      live_idea_id TEXT,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (live_idea_id) REFERENCES ideas(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idea_events_idea_id_idx
    ON idea_events (idea_id, id DESC);

    CREATE INDEX IF NOT EXISTS ideas_updated_at_id_idx
    ON ideas (updated_at DESC, id DESC);

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
    CREATE TABLE IF NOT EXISTS ai_connections (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
      provider TEXT, model TEXT, base_url TEXT, cli_tool TEXT,
      credential_ref TEXT, revision INTEGER NOT NULL DEFAULT 1,
      tested_revision INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
  `);

  const ideaEventsColumns = sqlite.prepare('PRAGMA table_info(idea_events)').all() as Array<{ name: string }>;
  const hasLiveIdeaId = ideaEventsColumns.some((column) => column.name === 'live_idea_id');
  if (!hasLiveIdeaId) {
    sqlite.exec('ALTER TABLE idea_events ADD COLUMN live_idea_id TEXT REFERENCES ideas(id) ON DELETE SET NULL');
  }

  sqlite.exec(`
    UPDATE idea_events
    SET live_idea_id = idea_id
    WHERE live_idea_id IS NULL
      AND EXISTS (SELECT 1 FROM ideas WHERE ideas.id = idea_events.idea_id)
  `);
}

export class AppStore {
  private readonly sqlite: SqliteDatabase;
  private readonly db: ReturnType<typeof drizzle>;
  private readonly importTransaction: (payload: {
    ideas?: Idea[];
    folders?: Folder[];
    settings?: Partial<LegacyAppSettings>;
  }) => void;
  private readonly saveIdeaTransaction: (idea: Idea, eventContext?: SaveIdeaEventContext) => Idea;
  private readonly appendIdeaChatTransaction: (id: string, patch: UpdateIdeaInput) => Idea;
  private readonly deleteIdeaTransaction: (id: string, payload?: Record<string, unknown>) => void;

  constructor(sqlite: SqliteDatabase) {
    this.sqlite = sqlite;
    this.db = drizzle(sqlite, { schema });
    this.importTransaction = this.sqlite.transaction((payload: {
      ideas?: Idea[];
      folders?: Folder[];
      settings?: Partial<LegacyAppSettings>;
    }) => {
      for (const folder of payload.folders ?? []) {
        this.saveFolderSync(folder);
      }

      for (const idea of payload.ideas ?? []) {
        this.saveIdeaSync(idea);
      }

      if (payload.settings) {
        const current = this.getLegacySettingsSync();
        this.saveSettingsSync({
          ...current,
          ...payload.settings
        });
      }
    });
    this.saveIdeaTransaction = this.sqlite.transaction((idea: Idea, eventContext?: SaveIdeaEventContext) => {
      const existing = this.getIdeaSync(idea.id);
      this.saveIdeaSync(idea);
      const snapshot = this.getIdeaSync(idea.id);
      if (!snapshot) {
        throw new Error(`Failed to reload idea ${idea.id} after save`);
      }

      const mutationType = this.deriveIdeaSaveEventType(existing, snapshot);
      const mutationPayload = this.buildDefaultIdeaEventPayload(mutationType, existing, snapshot);
      this.insertIdeaEventSync(snapshot.id, mutationType, mutationPayload, snapshot);

      if (eventContext && eventContext.type !== mutationType) {
        this.insertIdeaEventSync(snapshot.id, eventContext.type, eventContext.payload ?? {}, snapshot);
      }
      return snapshot;
    });
    this.appendIdeaChatTransaction = this.sqlite.transaction((id: string, patch: UpdateIdeaInput) => {
      const existing = this.getIdeaBaseSync(id);
      if (!existing) {
        throw new NotFoundError(`Idea ${id} not found`);
      }

      const nextFolderId = patch.folder_id === null ? null : (patch.folder_id ?? existing.folder_id ?? null);
      const nextTimestamp = patch.timestamp ?? existing.timestamp;
      this.sqlite.prepare(`
        UPDATE ideas
        SET title = ?, details = ?, analysis = ?, status = ?, folder_id = ?,
            created_at = MIN(created_at, ?), updated_at = ?
        WHERE id = ?
      `).run(
        patch.title ?? existing.title,
        patch.details ?? existing.details,
        patch.analysis ?? existing.analysis ?? null,
        patch.status ?? existing.status,
        nextFolderId,
        nextTimestamp,
        Date.now(),
        id
      );

      const chatInsert = this.sqlite.prepare(`
        INSERT INTO idea_chat_messages (id, idea_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const message of patch.chatAppend ?? []) {
        chatInsert.run(message.id, id, message.role, message.content, message.timestamp);
      }

      const snapshot = this.getIdeaSync(id);
      if (!snapshot) {
        throw new Error(`Failed to reload idea ${id} after chat append`);
      }

      const mutationType: IdeaEventType = existing.folder_id !== snapshot.folder_id ? 'idea_moved' : 'idea_updated';
      const mutationPayload = mutationType === 'idea_moved'
        ? {
            fromFolderId: existing.folder_id ?? null,
            toFolderId: snapshot.folder_id ?? null
          }
        : {
            updatedFields: [
              ...(patch.title !== undefined ? ['title'] : []),
              ...(patch.details !== undefined ? ['details'] : []),
              ...(patch.analysis !== undefined ? ['analysis'] : []),
              ...(patch.status !== undefined ? ['status'] : []),
              ...(patch.chatAppend !== undefined ? ['chatHistory'] : []),
              ...(patch.folder_id !== undefined ? ['folder_id'] : [])
            ]
          };
      this.insertIdeaEventSync(snapshot.id, mutationType, mutationPayload, snapshot);
      return snapshot;
    });
    this.deleteIdeaTransaction = this.sqlite.transaction((id: string, payload?: Record<string, unknown>) => {
      const existing = this.getIdeaSync(id);
      if (!existing) {
        return;
      }

      this.insertIdeaEventSync(id, 'idea_deleted', payload ?? this.buildDefaultDeletePayload(existing), existing);
      this.sqlite.prepare('DELETE FROM ideas WHERE id = ?').run(id);
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

  private getLegacySettingsSync(): LegacyAppSettings {
    const existing = this.sqlite.prepare(`
      SELECT provider, gemini_key, ollama_endpoint, ollama_model, cli_command_template
      FROM app_settings
      WHERE id = ?
    `).get('default') as {
      provider: LegacyAppSettings['provider'];
      gemini_key: string;
      ollama_endpoint: string;
      ollama_model: string;
      cli_command_template: string;
    } | undefined;

    if (!existing) {
      return LEGACY_DEFAULT_APP_SETTINGS;
    }

    return {
      provider: existing.provider,
      geminiKey: existing.gemini_key,
      ollamaEndpoint: existing.ollama_endpoint,
      ollamaModel: existing.ollama_model,
      cliCommandTemplate: existing.cli_command_template
    };
  }

  private saveSettingsSync(settings: LegacyAppSettings): void {
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

  private getIdeaSync(id: string): Idea | undefined {
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

  private getIdeaBaseSync(id: string): IdeaBase | undefined {
    const row = this.sqlite.prepare(`
      SELECT id, title, details, analysis, status, folder_id, created_at, updated_at
      FROM ideas
      WHERE id = ?
    `).get(id) as IdeaRow | undefined;

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      title: row.title,
      details: row.details,
      analysis: row.analysis ?? undefined,
      timestamp: row.created_at,
      status: row.status,
      folder_id: row.folder_id ?? undefined
    };
  }

  private deriveIdeaSaveEventType(previous: Idea | undefined, next: Idea): IdeaEventType {
    if (!previous) {
      return 'idea_created';
    }

    if (previous.folder_id !== next.folder_id) {
      return 'idea_moved';
    }

    return 'idea_updated';
  }

  private buildDefaultIdeaEventPayload(type: IdeaEventType, previous: Idea | undefined, next: Idea): Record<string, unknown> {
    if (type === 'idea_created') {
      return {
        createdAt: next.timestamp
      };
    }

    if (type === 'idea_moved') {
      return {
        fromFolderId: previous?.folder_id ?? null,
        toFolderId: next.folder_id ?? null
      };
    }

    return {
      updatedFields: this.collectChangedIdeaFields(previous, next)
    };
  }

  private buildDefaultDeletePayload(idea: Idea): Record<string, unknown> {
    return {
      title: idea.title,
      status: idea.status,
      folderId: idea.folder_id ?? null
    };
  }

  private collectChangedIdeaFields(previous: Idea | undefined, next: Idea): string[] {
    if (!previous) {
      return [];
    }

    const changedFields: string[] = [];
    if (previous.title !== next.title) changedFields.push('title');
    if (previous.details !== next.details) changedFields.push('details');
    if ((previous.analysis ?? null) !== (next.analysis ?? null)) changedFields.push('analysis');
    if (previous.status !== next.status) changedFields.push('status');
    if ((previous.folder_id ?? null) !== (next.folder_id ?? null)) changedFields.push('folder_id');
    if (JSON.stringify(previous.keywords) !== JSON.stringify(next.keywords)) changedFields.push('keywords');
    if (JSON.stringify(previous.relatedIdeas) !== JSON.stringify(next.relatedIdeas)) changedFields.push('relatedIdeas');
    if (JSON.stringify(previous.chatHistory) !== JSON.stringify(next.chatHistory)) changedFields.push('chatHistory');
    if (JSON.stringify(previous.vetting ?? {}) !== JSON.stringify(next.vetting ?? {})) changedFields.push('vetting');
    return changedFields;
  }

  private insertIdeaEventSync(
    ideaId: string,
    type: IdeaEventType,
    payload: Record<string, unknown>,
    snapshot: Idea,
    createdAt = Date.now()
  ): number {
    const result = this.sqlite.prepare(`
      INSERT INTO idea_events (idea_id, live_idea_id, type, payload_json, snapshot_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      ideaId,
      snapshot.id,
      type,
      JSON.stringify(payload),
      JSON.stringify(snapshot),
      createdAt
    );

    return Number(result.lastInsertRowid);
  }

  private hydrateIdeaEvents(rows: IdeaEventRow[]): IdeaEvent[] {
    return rows.map((row) => ({
      id: row.id,
      ideaId: row.idea_id,
      type: row.type,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      snapshot: JSON.parse(row.snapshot_json) as Idea,
      createdAt: row.created_at
    }));
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

  async listIdeaSummaries(query: IdeaSummaryQuery): Promise<{ items: IdeaSummary[]; nextCursor: string | null }> {
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
      if (query.folderId === 'uncategorized') {
        conditions.push(`(
          ideas.folder_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM folders WHERE folders.id = ideas.folder_id
          )
        )`);
      } else {
        conditions.push('ideas.folder_id = ?');
        params.push(query.folderId);
      }
    }

    if (query.cursor) {
      const cursor = decodeIdeaSummaryCursor(query.cursor);
      conditions.push('(ideas.updated_at < ? OR (ideas.updated_at = ? AND ideas.id < ?))');
      params.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
    }

    let sqlText = `
      SELECT ideas.id, ideas.title, ideas.details, ideas.status, ideas.folder_id, ideas.created_at, ideas.updated_at
      FROM ideas
    `;

    if (conditions.length > 0) {
      sqlText += ` WHERE ${conditions.join(' AND ')}`;
    }

    sqlText += ' ORDER BY ideas.updated_at DESC, ideas.id DESC LIMIT ?';
    params.push(query.limit + 1);

    const rows = this.sqlite.prepare(sqlText).all(...params) as IdeaSummaryRow[];
    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
    const items = pageRows.map((row) => ({
      id: row.id,
      title: row.title,
      details: row.details,
      timestamp: row.created_at,
      keywords: [] as string[],
      status: row.status,
      ...(row.folder_id ? { folder_id: row.folder_id } : {})
    }));

    if (pageRows.length === 0) {
      return { items, nextCursor: null };
    }

    const ids = pageRows.map((row) => row.id);
    const keywords = this.sqlite.prepare(`
      SELECT idea_id, keyword
      FROM idea_keywords
      WHERE idea_id IN (${buildPlaceholders(ids)})
      ORDER BY rowid
    `).all(...ids) as KeywordRow[];
    const itemsById = new Map(items.map((item) => [item.id, item]));
    for (const keyword of keywords) {
      itemsById.get(keyword.idea_id)?.keywords.push(keyword.keyword);
    }

    const lastRow = pageRows[pageRows.length - 1];
    return {
      items,
      nextCursor: hasMore ? encodeIdeaSummaryCursor({ updatedAt: lastRow.updated_at, id: lastRow.id }) : null
    };
  }

  async getIdea(id: string): Promise<Idea | undefined> {
    return this.getIdeaSync(id);
  }

  async saveIdea(idea: Idea): Promise<Idea> {
    return this.saveIdeaTransaction(idea);
  }

  async saveIdeaWithEventContext(idea: Idea, eventContext?: SaveIdeaEventContext): Promise<Idea> {
    return this.saveIdeaTransaction(idea, eventContext);
  }

  async updateIdea(id: string, patch: UpdateIdeaInput): Promise<Idea> {
    if (
      patch.chatAppend !== undefined
      && patch.chatHistory === undefined
      && patch.keywords === undefined
      && patch.relatedIdeas === undefined
      && patch.vetting === undefined
      && patch.vettingMerge === undefined
    ) {
      return this.appendIdeaChatTransaction(id, patch);
    }

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

    return this.saveIdeaTransaction(nextIdea);
  }

  async deleteIdea(id: string): Promise<void> {
    this.deleteIdeaTransaction(id);
  }

  async appendIdeaEvent(
    ideaId: string,
    type: IdeaEventType,
    payload: Record<string, unknown> = {}
  ): Promise<IdeaEvent> {
    const snapshot = await this.getIdea(ideaId);
    if (!snapshot) {
      throw new NotFoundError(`Idea ${ideaId} not found`);
    }

    const eventId = this.insertIdeaEventSync(ideaId, type, payload, snapshot);
    const event = await this.getIdeaEvent(eventId);
    if (!event) {
      throw new Error(`Failed to reload idea event ${eventId}`);
    }
    return event;
  }

  async listIdeaEvents(ideaId: string, options: { limit?: number; before?: number } = {}): Promise<IdeaEvent[]> {
    const params: Array<string | number> = [ideaId];
    let sqlText = `
      SELECT id, idea_id, live_idea_id, type, payload_json, snapshot_json, created_at
      FROM idea_events
      WHERE idea_id = ?
    `;

    if (options.before !== undefined) {
      sqlText += ' AND id < ?';
      params.push(options.before);
    }

    sqlText += ' ORDER BY id DESC LIMIT ?';
    params.push(options.limit ?? 25);

    const rows = this.sqlite.prepare(sqlText).all(...params) as IdeaEventRow[];
    return this.hydrateIdeaEvents(rows);
  }

  async getIdeaEvent(id: number): Promise<IdeaEvent | undefined> {
    const row = this.sqlite.prepare(`
      SELECT id, idea_id, live_idea_id, type, payload_json, snapshot_json, created_at
      FROM idea_events
      WHERE id = ?
    `).get(id) as IdeaEventRow | undefined;

    if (!row) {
      return undefined;
    }

    return this.hydrateIdeaEvents([row])[0];
  }

  async getPreviousIdeaEvent(ideaId: string, beforeEventId: number): Promise<IdeaEvent | undefined> {
    const row = this.sqlite.prepare(`
      SELECT id, idea_id, live_idea_id, type, payload_json, snapshot_json, created_at
      FROM idea_events
      WHERE idea_id = ? AND id < ?
      ORDER BY id DESC
      LIMIT 1
    `).get(ideaId, beforeEventId) as IdeaEventRow | undefined;

    if (!row) {
      return undefined;
    }

    return this.hydrateIdeaEvents([row])[0];
  }

  async listIdeaEventsInRange(ideaId: string, fromId: number, toId: number): Promise<IdeaEvent[]> {
    const rows = this.sqlite.prepare(`
      SELECT id, idea_id, live_idea_id, type, payload_json, snapshot_json, created_at
      FROM idea_events
      WHERE idea_id = ? AND id >= ? AND id <= ?
      ORDER BY id ASC
    `).all(ideaId, fromId, toId) as IdeaEventRow[];

    return this.hydrateIdeaEvents(rows);
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
    return { ...DEFAULT_APP_SETTINGS, activeConnectionId: this.getMetadata('active_ai_connection') };
  }

  async saveSettings(settings: AppSettings): Promise<AppSettings> {
    this.setMetadata('active_ai_connection', settings.activeConnectionId ?? '');
    return settings;
  }

  async exportData(): Promise<ExportPayload> {
    const [ideas, folders, settings] = await Promise.all([
      this.listIdeas(),
      this.listFolders(),
      this.getSettings()
    ]);

    return {
      version: 2,
      timestamp: Date.now(),
      ideas,
      folders,
      settings,
      connections: this.listConnections().map(({ credentialRef: _ref, testedRevision: _tested, revision: _revision, ...input }) => input)
    };
  }

  async importData(payload: {
    ideas?: Idea[];
    folders?: Folder[];
    settings?: Partial<LegacyAppSettings>;
  }): Promise<void> {
    this.importTransaction(payload);
  }

  getMetadata(key: string): string | null {
    const row = this.sqlite.prepare('SELECT value FROM app_metadata WHERE key = ?').get(key) as MetadataRow | undefined;
    return row?.value || null;
  }
  atomic<T>(fn: () => T): T {
    try { return this.sqlite.transaction(fn)(); }
    catch (error) {
      if (/^SQLITE_BUSY/.test(String((error as { code?: string }).code)))
        throw new AiConnectionError('AI_CONNECTION_CHANGED', 'The database changed during this operation. Retry with the current configuration.');
      throw error;
    }
  }
  importConnectionBackup(payload: { ideas?: Idea[]; folders?: Folder[]; connections: StoredConnection[] }): void {
    this.atomic(() => {
      this.importTransaction({ ideas: payload.ideas, folders: payload.folders });
      for (const connection of payload.connections) {
        if (!this.saveConnection(connection)) throw new Error(`Connection already exists: ${connection.id}`);
      }
    });
  }
  pendingCredentialCleanup(): string[] {
    return (this.sqlite.prepare("SELECT value FROM app_metadata WHERE key LIKE 'credential_cleanup:%'").all() as MetadataRow[]).map(row => row.value);
  }
  journalCredentialCleanup(reference: string): void { this.setMetadata(`credential_cleanup:${reference}`, reference); }
  completeCredentialCleanup(reference: string): void {
    this.sqlite.prepare('DELETE FROM app_metadata WHERE key=?').run(`credential_cleanup:${reference}`);
    this.releaseCredentialCleanup(reference);
  }
  releaseCredentialCleanup(reference: string): void {
    this.sqlite.prepare('DELETE FROM app_metadata WHERE key=?').run(`credential_cleanup_owner:${reference}`);
  }
  isCredentialReferenced(reference: string): boolean {
    return Boolean(this.sqlite.prepare('SELECT 1 FROM ai_connections WHERE credential_ref=? LIMIT 1').get(reference));
  }
  setMetadata(key: string, value: string): void {
    this.sqlite.prepare('INSERT INTO app_metadata(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(key, value, Date.now());
  }
  getDatabaseIdentity(): string {
    // INSERT OR IGNORE makes concurrent web and stdio initialization agree.
    this.sqlite.prepare('INSERT OR IGNORE INTO app_metadata(key,value,updated_at) VALUES(?,?,?)').run('credential_namespace', randomUUID(), Date.now());
    return this.getMetadata('credential_namespace')!;
  }
  getLegacySettings(): LegacyAppSettings { return this.getLegacySettingsSync(); }
  saveLegacySettings(settings: LegacyAppSettings): void { this.saveSettingsSync(settings); }
  clearLegacyKey(): void { this.sqlite.prepare("UPDATE app_settings SET gemini_key = '' WHERE id = 'default'").run(); }
  listConnections(): StoredConnection[] {
    const rows = this.sqlite.prepare('SELECT * FROM ai_connections ORDER BY created_at,id').all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id), revision: Number(row.revision),
      credentialRef: row.credential_ref ? String(row.credential_ref) : null,
      testedRevision: row.tested_revision === null ? null : Number(row.tested_revision),
      ...connectionInputSchema.parse(row.kind === 'api'
        ? { name: String(row.name), kind: 'api', provider: String(row.provider), model: String(row.model), ...(row.base_url ? { baseUrl: String(row.base_url) } : {}) }
        : { name: String(row.name), kind: 'cli_proxy', tool: String(row.cli_tool), ...(row.model ? { model: String(row.model) } : {}) })
    }));
  }
  getConnection(id: string): StoredConnection | undefined { return this.listConnections().find((connection) => connection.id === id); }
  saveConnection(connection: StoredConnection): boolean {
    return this.atomic(() => {
      // Retain a revision floor after deletion so reusing an ID cannot produce an ABA match.
      const revision = Math.max(connection.revision, Number(this.getMetadata(`connection_revision:${connection.id}`) ?? 0) + 1);
      const result = this.sqlite.prepare(`INSERT OR IGNORE INTO ai_connections(id,name,kind,provider,model,base_url,cli_tool,credential_ref,revision,tested_revision,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      connection.id, connection.name, connection.kind, connection.kind === 'api' ? connection.provider : null,
      connection.model ?? null, connection.kind === 'api' ? connection.baseUrl ?? null : null,
      connection.kind === 'cli_proxy' ? connection.tool : null, connection.credentialRef, revision,
      connection.testedRevision === connection.revision ? revision : null, Date.now(), Date.now());
      return result.changes === 1;
    });
  }
  updateConnection(connection: StoredConnection, expectedRevision: number): void {
    if (connection.revision !== expectedRevision + 1) throw new Error('Connection revisions must increase by one.');
    const result = this.sqlite.prepare(`UPDATE ai_connections SET name=?,kind=?,provider=?,model=?,base_url=?,cli_tool=?,credential_ref=?,revision=?,tested_revision=?,updated_at=? WHERE id=? AND revision=?`).run(
      connection.name, connection.kind, connection.kind === 'api' ? connection.provider : null,
      connection.model ?? null, connection.kind === 'api' ? connection.baseUrl ?? null : null,
      connection.kind === 'cli_proxy' ? connection.tool : null, connection.credentialRef, connection.revision,
      connection.testedRevision, Date.now(), connection.id, expectedRevision);
    if (result.changes !== 1) throw new AiConnectionError('AI_CONNECTION_CHANGED', 'Connection changed. Retry with the current configuration.');
  }
  deleteConnection(id: string, expectedRevision?: number): void {
    this.sqlite.transaction(() => {
      const connection = this.getConnection(id);
      const result = expectedRevision === undefined
        ? this.sqlite.prepare('DELETE FROM ai_connections WHERE id=?').run(id)
        : this.sqlite.prepare('DELETE FROM ai_connections WHERE id=? AND revision=?').run(id, expectedRevision);
      if (expectedRevision !== undefined && result.changes !== 1) throw new AiConnectionError('AI_CONNECTION_CHANGED', 'Connection changed. Retry with the current configuration.');
      if (connection && result.changes === 1) this.setMetadata(`connection_revision:${id}`, String(connection.revision + 1));
      if (this.getMetadata('active_ai_connection') === id) this.setMetadata('active_ai_connection', '');
    })();
  }
  restoreDeletedConnection(connection: StoredConnection, wasActive: boolean): boolean {
    return this.atomic(() => {
      // A recreated (even subsequently deleted) profile takes precedence over compensation.
      if (this.getConnection(connection.id) || Number(this.getMetadata(`connection_revision:${connection.id}`)) !== connection.revision + 1) return false;
      const revision = connection.revision + 2;
      if (!this.saveConnection({ ...connection, revision, testedRevision: connection.testedRevision === connection.revision ? revision : null })) return false;
      if (connection.credentialRef) this.completeCredentialCleanup(connection.credentialRef);
      if (wasActive && !this.getMetadata('active_ai_connection')) this.setMetadata('active_ai_connection', connection.id);
      return true;
    });
  }
  markConnectionTested(id: string, revision: number): void {
    const result = this.sqlite.prepare('UPDATE ai_connections SET tested_revision=? WHERE id=? AND revision=?').run(revision, id, revision);
    if (result.changes !== 1) throw new AiConnectionError('AI_CONNECTION_CHANGED', 'Connection changed during the test. Test it again.');
  }
  activateTestedConnection(id: string): void {
    this.sqlite.transaction(() => {
      const connection = this.getConnection(id);
      if (!connection || connection.testedRevision !== connection.revision) throw new AiConnectionError('AI_CONNECTION_UNTESTED', 'Test this connection before activating it.', 409);
      this.setMetadata('active_ai_connection', id);
    })();
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
