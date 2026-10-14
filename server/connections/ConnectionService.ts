import { randomUUID } from 'node:crypto';
import type { AiConnection, AiConnectionStatus } from '../../src/types.js';
import type { AppStore } from '../store.js';
import { CLI_PROXY_BASE_URL } from '../config.js';
import { AiConnectionError, NotFoundError } from '../errors.js';
import { CredentialStoreError, type CredentialStore } from '../credentials/CredentialStore.js';
import { connectionInputSchema, publicConnectionSchema, type ConnectionInput, type StoredConnection } from './contracts.js';

export type ResolvedConnection = { connection: AiConnection; apiKey?: string };
export class ConnectionService {
  migrationError: string | null = null;
  private testGeneration?: (resolved: ResolvedConnection) => Promise<string>;
  private queues = new Map<string, Promise<unknown>>();
  private readonly cleanupOwner = `${process.pid}:${randomUUID()}`;
  constructor(readonly store: AppStore, readonly credentials: CredentialStore) {}
  setTester(test: (resolved: ResolvedConnection) => Promise<string>) { this.testGeneration = test; }
  private async serialize<T>(id: string, work: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(id) ?? Promise.resolve()).catch(() => {}).then(work);
    this.queues.set(id, next);
    try { return await next; } finally { if (this.queues.get(id) === next) this.queues.delete(id); }
  }
  private require(id: string): StoredConnection {
    const value = this.store.getConnection(id);
    if (!value) throw new NotFoundError('AI connection not found.');
    return value;
  }
  public(connection: StoredConnection): AiConnection {
    const { credentialRef, testedRevision: _tested, ...metadata } = connection;
    return publicConnectionSchema.parse({ ...metadata, ...(connection.kind === 'api' ? { hasKey: Boolean(credentialRef) } : {}) }) as AiConnection;
  }
  list(): AiConnection[] { return this.store.listConnections().map((connection) => this.public(connection)); }
  create(input: unknown, id: string = randomUUID()): AiConnection {
    const metadata = connectionInputSchema.parse(input);
    const connection = { ...metadata, id, revision: 1, credentialRef: null, testedRevision: null };
    this.store.saveConnection(connection);
    return this.public(this.require(id));
  }
  async update(id: string, input: unknown): Promise<AiConnection> {
    return this.serialize(id, async () => {
      const previous = this.require(id);
      const { id: _id, revision: _r, credentialRef: _ref, testedRevision: _t, ...old } = previous;
      const metadata = connectionInputSchema.parse({ ...old, ...(input as object) });
      // Provider/kind changes need a new profile, so credentials cannot move to a different vendor.
      if (metadata.kind !== previous.kind || (metadata.kind === 'api' && previous.kind === 'api' && metadata.provider !== previous.provider))
        throw new AiConnectionError('AI_CONNECTION_TYPE_CHANGE', 'Create a new connection to change its provider.');
      const changed = JSON.stringify({ ...old, name: '' }) !== JSON.stringify({ ...metadata, name: '' });
      const revision = previous.revision + 1;
      const next = { ...metadata, id, credentialRef: previous.credentialRef, revision, testedRevision: !changed && previous.testedRevision === previous.revision ? revision : null };
      this.store.updateConnection(next, previous.revision);
      return this.public(next);
    });
  }
  async setCredential(id: string, key: string): Promise<void> {
    await this.serialize(id, async () => {
      const connection = this.require(id);
      if (connection.kind !== 'api' || connection.provider === 'ollama') throw new AiConnectionError('AI_CREDENTIAL_UNSUPPORTED', 'This connection does not store an API key.');
      const reference = `${this.store.getDatabaseIdentity()}:${id}:${randomUUID()}`;
      try {
        await this.credentials.set(reference, key);
        if (await this.credentials.get(reference) !== key) throw new CredentialStoreError();
        this.store.atomic(() => {
          if (connection.credentialRef) this.store.journalCredentialCleanup(connection.credentialRef);
          this.store.updateConnection({ ...connection, credentialRef: reference, revision: connection.revision + 1, testedRevision: null }, connection.revision);
        });
      } catch (error) {
        // A failed preparation/CAS never changes the live reference or revision.
        this.store.journalCredentialCleanup(reference);
        await this.cleanupCredentials();
        throw error;
      }
      await this.cleanupCredentials();
    });
  }
  async deleteCredential(id: string): Promise<void> {
    await this.serialize(id, async () => {
      const connection = this.require(id);
      const revision = connection.revision + 1;
      this.store.atomic(() => {
        this.store.updateConnection({ ...connection, credentialRef: null, revision, testedRevision: null }, connection.revision);
        if (connection.credentialRef) this.reserveDeletion(connection.credentialRef);
      });
      if (!connection.credentialRef) return;
      try {
        await this.credentials.delete(connection.credentialRef);
        this.store.completeCredentialCleanup(connection.credentialRef);
      } catch (error) {
        this.store.atomic(() => {
          const current = this.store.getConnection(id);
          if (current?.revision !== revision || current.credentialRef !== null) return;
          const restoredRevision = revision + 1;
          this.store.updateConnection({ ...connection, revision: restoredRevision,
            testedRevision: connection.testedRevision === connection.revision ? restoredRevision : null }, revision);
          this.store.completeCredentialCleanup(connection.credentialRef!);
        });
        throw error;
      } finally {
        this.store.releaseCredentialCleanup(connection.credentialRef);
      }
    });
  }
  async delete(id: string): Promise<void> {
    await this.serialize(id, async () => {
      const connection = this.require(id);
      const wasActive = this.store.atomic(() => {
        const active = this.store.getMetadata('active_ai_connection') === id;
        this.store.deleteConnection(id, connection.revision);
        if (connection.credentialRef) this.reserveDeletion(connection.credentialRef);
        return active;
      });
      if (!connection.credentialRef) return;
      try {
        await this.credentials.delete(connection.credentialRef);
        this.store.completeCredentialCleanup(connection.credentialRef);
      } catch (error) {
        this.store.restoreDeletedConnection(connection, wasActive);
        throw error;
      } finally {
        this.store.releaseCredentialCleanup(connection.credentialRef);
      }
    });
  }
  private claimCleanup(reference: string): boolean {
    // A durable owner prevents a second cleaner from deleting a key being restored
    // by compensation. A later process can reclaim cleanup after its owner exits.
    return this.store.atomic(() => {
      if (this.store.isCredentialReferenced(reference) || !this.store.getMetadata(`credential_cleanup:${reference}`)) return false;
      const owner = this.store.getMetadata(`credential_cleanup_owner:${reference}`);
      if (owner) {
        const pid = Number(owner.split(':')[0]);
        try { process.kill(pid, 0); return false; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return false; }
      }
      this.store.setMetadata(`credential_cleanup_owner:${reference}`, this.cleanupOwner);
      return true;
    });
  }
  private reserveDeletion(reference: string): void {
    this.store.journalCredentialCleanup(reference);
    if (!this.claimCleanup(reference)) throw new AiConnectionError('AI_CONNECTION_CHANGED', 'Credential cleanup is already in progress. Retry later.');
  }
  async cleanupCredentials(): Promise<void> {
    for (const reference of this.store.pendingCredentialCleanup()) {
      if (!this.claimCleanup(reference)) continue;
      try {
        await this.credentials.delete(reference);
        this.store.completeCredentialCleanup(reference);
      } catch { /* Keep the durable journal entry for a later retry. */ }
      finally { this.store.releaseCredentialCleanup(reference); }
    }
  }
  async resolve(id?: string): Promise<ResolvedConnection> {
    const selected = id ?? (await this.store.getSettings()).activeConnectionId;
    if (!selected) throw new AiConnectionError('AI_SETUP_REQUIRED', this.migrationError ?? 'Choose an AI connection in Settings.');
    const stored = this.require(selected);
    if (!id && stored.testedRevision !== stored.revision) throw new AiConnectionError('AI_SETUP_REQUIRED', 'Test and activate this connection in Settings.');
    let apiKey: string | undefined;
    if (stored.kind === 'api' && stored.provider !== 'ollama') {
      apiKey = stored.credentialRef ? (await this.credentials.get(stored.credentialRef)) ?? undefined : undefined;
      if (!apiKey) throw new AiConnectionError('AI_CREDENTIAL_MISSING', 'Add an API key in Settings.');
    }
    return { connection: this.public(stored), apiKey };
  }
  async test(id: string): Promise<{ ok: true }> {
    const connection = this.require(id);
    if (!this.testGeneration) throw new Error('Connection tester is not initialized.');
    const output = await this.testGeneration(await this.resolve(id));
    if (!output.trim()) throw new AiConnectionError('AI_EMPTY_RESPONSE', 'The provider returned no text.', 502);
    const current = this.require(id);
    if (current.revision !== connection.revision) throw new AiConnectionError('AI_CONNECTION_CHANGED', 'Connection changed during the test. Test it again.');
    this.store.markConnectionTested(id, connection.revision);
    return { ok: true };
  }
  async activate(id: string | null) {
    if (id) {
      await this.resolve(id);
      this.store.activateTestedConnection(id);
    } else await this.store.saveSettings({ version: 2, activeConnectionId: null });
    return this.store.getSettings();
  }
  async proxyTools() {
    try {
      const response = await fetch(`${CLI_PROXY_BASE_URL}/api/tools`, { redirect: 'error', signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error();
      const payload = await response.json() as Record<string, unknown>;
      const allowed = ['codex', 'claude', 'cursor', 'kiro', 'gemini', 'opencode'];
      const tools = Array.isArray(payload.tools) ? payload.tools.filter((tool): tool is string => typeof tool === 'string' && allowed.includes(tool)) : [];
      const rawDetails = Array.isArray(payload.toolDetails) ? payload.toolDetails : [];
      const toolDetails = tools.map((id) => {
        const raw = rawDetails.find((entry) => entry?.id === id) ?? {};
        return { id, available: typeof raw.available === 'boolean' ? raw.available : null,
          capabilities: { image: false, streaming: raw.capabilities?.streaming !== false, model: raw.capabilities?.model === true },
          authenticationInstructions: String(raw.authenticationInstructions ?? `Sign in using the official ${id} CLI, then test the connection.`),
          authenticationStatus: ['authenticated', 'authentication_required'].includes(raw.authenticationStatus) ? raw.authenticationStatus : 'unknown' };
      });
      return { defaultTool: tools.includes(String(payload.defaultTool)) ? String(payload.defaultTool) : null, tools, toolDetails };
    } catch { throw new AiConnectionError('AI_PROXY_UNAVAILABLE', 'Start the companion CLI proxy and retry.', 503); }
  }
  async models(id: string): Promise<{ supported: boolean; models: string[] }> {
    const { connection, apiKey } = await this.resolve(id);
    if (connection.kind !== 'api') return { supported: false, models: [] };
    let url: string;
    const headers: Record<string, string> = {};
    switch (connection.provider) {
      case 'openai': url = 'https://api.openai.com/v1/models'; headers.Authorization = `Bearer ${apiKey}`; break;
      case 'anthropic': url = 'https://api.anthropic.com/v1/models'; headers['x-api-key'] = apiKey!; headers['anthropic-version'] = '2023-06-01'; break;
      case 'gemini': url = 'https://generativelanguage.googleapis.com/v1beta/models'; headers['x-goog-api-key'] = apiKey!; break;
      case 'openai_compatible': url = `${connection.baseUrl!.replace(/\/$/, '')}/models`; headers.Authorization = `Bearer ${apiKey}`; break;
      case 'ollama': url = `${(connection.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '')}/api/tags`; break;
    }
    try {
      const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (response.status === 404 || response.status === 405) return { supported: false, models: [] };
      if (response.status === 401 || response.status === 403) throw new AiConnectionError('AI_AUTH_FAILED', 'The provider rejected these credentials.', 502);
      if (!response.ok) throw new AiConnectionError('AI_MODEL_DISCOVERY_FAILED', 'Unable to retrieve provider models. Enter a model ID manually.', 502);
      const payload = await response.json();
      const entries = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : [];
      const models = entries.map((item: { id?: string; name?: string }) => connection.provider === 'gemini' ? item.name?.replace(/^models\//, '') : item.id ?? item.name)
        .filter((item: unknown): item is string => typeof item === 'string' && item.length > 0 && item.length <= 200);
      return { supported: true, models: [...new Set<string>(models)].sort().slice(0, 1000) };
    } catch (error) {
      if (error instanceof AiConnectionError) throw error;
      throw new AiConnectionError('AI_MODEL_DISCOVERY_FAILED', 'Unable to retrieve provider models. Enter a model ID manually.', 502);
    }
  }
  async status(): Promise<AiConnectionStatus> {
    const id = (await this.store.getSettings()).activeConnectionId;
    const stored = id ? this.store.getConnection(id) : undefined;
    const connection = stored ? this.public(stored) : null;
    const capabilities = { image: connection?.kind === 'api' && ['openai', 'anthropic', 'gemini'].includes(connection.provider), streaming: true };
    if (this.migrationError) return { state: 'credential_store_unavailable', connection, capabilities, message: this.migrationError };
    if (!id || !stored) return { state: 'needs_setup', connection: null, capabilities, message: 'Choose an AI connection in Settings.' };
    try {
      await this.resolve(id);
      if (connection?.kind === 'cli_proxy') {
        const tool = (await this.proxyTools()).toolDetails.find((item) => item.id === connection.tool);
        if (!tool || tool.available === false) return { state: 'tool_unavailable', connection, capabilities, message: 'Install or configure this CLI in the companion proxy.' };
        if (tool.authenticationStatus === 'authentication_required') return { state: 'authentication_required', connection, capabilities, message: tool.authenticationInstructions };
      }
      if (stored.testedRevision !== stored.revision) return { state: 'needs_setup', connection, capabilities, message: 'Test and activate this connection in Settings.' };
      return { state: 'configured', connection, capabilities };
    } catch (error) {
      const code = (error as { code?: string }).code;
      const state = code === 'AI_PROXY_UNAVAILABLE' ? 'proxy_unavailable' : code === 'AI_CREDENTIAL_STORE_UNAVAILABLE' ? 'credential_store_unavailable' : 'missing_credential';
      return { state, connection, capabilities, message: error instanceof Error ? error.message : 'Connection unavailable.' };
    }
  }
}
