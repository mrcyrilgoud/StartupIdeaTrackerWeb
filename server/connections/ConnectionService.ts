import { randomUUID } from 'node:crypto';
import { ChatGptAuthService, type ChatGptSession, type AuthOptions } from '../chatgptAuth.js';
import type { AiConnection, AiConnectionStatus } from '../../src/types.js';
import type { AppStore } from '../store.js';
import { CLI_PROXY_BASE_URL } from '../config.js';
import { AiConnectionError, NotFoundError } from '../errors.js';
import { CredentialStoreError, type CredentialStore } from '../credentials/CredentialStore.js';
import { connectionInputSchema, publicConnectionSchema, isSafeEndpoint, type ConnectionInput, type StoredConnection } from './contracts.js';

export type ResolvedConnection = { connection: AiConnection; apiKey?: string; accessToken?: string };
export class ConnectionService {
  migrationError: string | null = null;
  private testGeneration?: (resolved: ResolvedConnection) => Promise<string>;
  private queues = new Map<string, Promise<unknown>>();
  private readonly cleanupOwner = `${process.pid}:${randomUUID()}`;
  readonly chatGptAuth: ChatGptAuthService;
  constructor(readonly store: AppStore, readonly credentials: CredentialStore, authOptions?: AuthOptions) { this.chatGptAuth = new ChatGptAuthService(this, authOptions); }
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
    const registration = connection.kind === 'chatgpt' ? this.chatGptAuth.registration(connection.id) : null;
    return publicConnectionSchema.parse({ ...metadata, ...(connection.kind === 'chatgpt'
      ? { hasSession: Boolean(credentialRef), ...(registration?.subject ? { account: { email: registration.email ?? 'ChatGPT account', planUsageEnabled: Boolean(registration.planUsageEnabled) } } : {}) }
      : { hasKey: Boolean(credentialRef) }) }) as AiConnection;
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
      const metadataInput: Record<string, unknown> = { ...old, ...(input as object) };
      // PATCH keeps omitted values. Explicit null clears optional configuration fields.
      if (metadataInput.model === null) delete metadataInput.model;
      if (metadataInput.baseUrl === null) delete metadataInput.baseUrl;
      const metadata = connectionInputSchema.parse(metadataInput);
      // Provider/kind changes need a new profile, so credentials cannot move to a different vendor.
      if (metadata.kind !== previous.kind || (metadata.kind === 'api' && previous.kind === 'api' && metadata.provider !== previous.provider) || (metadata.kind === 'cli_proxy' && previous.kind === 'cli_proxy' && metadata.tool !== previous.tool))
        throw new AiConnectionError('AI_CONNECTION_TYPE_CHANGE', 'Create a new connection to change its provider.');
      const changed = JSON.stringify({ ...old, name: '' }) !== JSON.stringify({ ...metadata, name: '' });
      const revision = previous.revision + 1;
      const next = { ...metadata, id, credentialRef: previous.credentialRef, revision, testedRevision: !changed && previous.testedRevision === previous.revision ? revision : null };
      this.store.updateConnection(next, previous.revision);
      return this.public(next);
    });
  }
  async setCredential(id: string, key: string): Promise<void> {
    const connection = this.require(id);
    if (!((connection.kind === 'api' && connection.provider !== 'ollama') || (connection.kind === 'cli_proxy' && ['cursor', 'kiro'].includes(connection.tool))))
      throw new AiConnectionError('AI_CREDENTIAL_UNSUPPORTED', 'This connection does not store an API key.', 400);
    await this.writeCredential(id, key);
  }
  async saveOAuthSession(id: string, session: ChatGptSession, registration: object, preserveTest = false, expectedRevision?: number, signal?: AbortSignal): Promise<void> {
    if (this.require(id).kind !== 'chatgpt') throw new AiConnectionError('AI_AUTH_UNSUPPORTED', 'Choose a ChatGPT connection.');
    await this.writeCredential(id, JSON.stringify(session), preserveTest, registration, expectedRevision, signal);
  }
  private async writeCredential(id: string, key: string, preserveTest = false, registration?: object, expectedRevision?: number, signal?: AbortSignal): Promise<void> {
    await this.serialize(id, async () => {
      const connection = this.require(id);
      if (registration ? connection.kind !== 'chatgpt' : !((connection.kind === 'api' && connection.provider !== 'ollama') || (connection.kind === 'cli_proxy' && ['cursor', 'kiro'].includes(connection.tool)))) throw new AiConnectionError('AI_CREDENTIAL_UNSUPPORTED', 'Credentials cannot move to another provider.', 400);
      if (expectedRevision !== undefined && connection.revision !== expectedRevision) throw new AiConnectionError('AI_CONNECTION_CHANGED', 'Connection changed. Start sign-in again.');
      signal?.throwIfAborted();
      const reference = `${this.store.getDatabaseIdentity()}:${id}:${randomUUID()}`;
      try {
        await this.credentials.set(reference, key);
        if (await this.credentials.get(reference) !== key) throw new CredentialStoreError();
        signal?.throwIfAborted();
        this.store.atomic(() => {
          if (connection.credentialRef) this.store.journalCredentialCleanup(connection.credentialRef);
          this.store.updateConnection({ ...connection, credentialRef: reference, revision: connection.revision + 1, testedRevision: preserveTest && connection.testedRevision === connection.revision ? connection.revision + 1 : null }, connection.revision);
          if (registration) this.store.setMetadata(`chatgpt_registration:${id}`, JSON.stringify(registration));
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
  async deleteApiCredential(id: string): Promise<void> {
    if (this.require(id).kind === 'chatgpt') throw new AiConnectionError('AI_CREDENTIAL_UNSUPPORTED', 'Use Disconnect account to remove a ChatGPT session.', 400);
    await this.deleteCredential(id);
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
  async delete(id: string): Promise<void | { message: string }> {
    const disconnected = this.require(id).kind === 'chatgpt' ? await this.chatGptAuth.disconnect(id) : undefined;
    await this.serialize(id, async () => {
      const connection = this.require(id);
      const wasActive = this.store.atomic(() => {
        const active = this.store.getMetadata('active_ai_connection') === id;
        this.store.deleteConnection(id, connection.revision);
        if (connection.kind === 'chatgpt') this.store.deleteMetadata(`chatgpt_registration:${id}`);
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
    return disconnected ? { message: `Connection deleted. ${disconnected.message}` } : undefined;
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
    if (stored.kind === 'cli_proxy' && stored.credentialRef) {
      apiKey = (await this.credentials.get(stored.credentialRef)) ?? undefined;
      if (!apiKey) throw new AiConnectionError('AI_CREDENTIAL_MISSING', 'Add this connection’s API key in Settings.');
      if (!(await this.proxyTools()).requestCredentials) throw new AiConnectionError('AI_PROXY_UPDATE_REQUIRED', 'Update the companion CLI proxy to support connection-specific Cursor and Kiro keys.', 503);
    }
    if (stored.kind === 'chatgpt') {
      const accessToken = await this.chatGptAuth.accessToken(selected);
      const current = this.require(selected);
      if (current.kind !== 'chatgpt' || (!id && current.testedRevision !== current.revision)) throw new AiConnectionError('AI_SETUP_REQUIRED', 'Connection changed. Test and activate it again in Settings.');
      if (!current.model) throw new AiConnectionError('AI_SETUP_REQUIRED', 'Select a ChatGPT model in Settings.');
      return { connection: this.public(current), accessToken };
    }
    return { connection: this.public(stored), apiKey };
  }
  async test(id: string): Promise<{ ok: true }> {
    if (!this.testGeneration) throw new Error('Connection tester is not initialized.');
    const resolved = await this.resolve(id);
    const connection = resolved.connection;
    const output = await this.testGeneration(resolved);
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
      if (!isSafeEndpoint(CLI_PROXY_BASE_URL)) throw new Error('Unsafe proxy endpoint');
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
      return { defaultTool: tools.includes(String(payload.defaultTool)) ? String(payload.defaultTool) : null, tools, toolDetails, requestCredentials: payload.requestCredentials === true, authStatus: payload.authStatus === true };
    } catch { throw new AiConnectionError('AI_PROXY_UNAVAILABLE', 'Start the companion CLI proxy and retry.', 503); }
  }
  async authStatus(id: string) {
    const connection = this.require(id);
    if (connection.kind === 'chatgpt') return this.chatGptAuth.status(id);
    if (connection.kind !== 'cli_proxy' || !['cursor', 'kiro'].includes(connection.tool)) throw new AiConnectionError('AI_AUTH_UNSUPPORTED', 'This connection does not use CLI account authentication.');
    const tools = await this.proxyTools();
    if (!tools.authStatus) throw new AiConnectionError('AI_PROXY_UPDATE_REQUIRED', 'Update the companion CLI proxy to check Cursor and Kiro authentication.', 503);
    const apiKey = connection.credentialRef ? await this.credentials.get(connection.credentialRef) : undefined;
    const response = await fetch(`${CLI_PROXY_BASE_URL}/api/tools/${connection.tool}/auth-status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(apiKey ? { apiKey } : {}), redirect: 'error', signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new AiConnectionError('AI_AUTH_FAILED', 'Unable to check CLI authentication. Install the CLI and try again.', 502);
    const payload = await response.json();
    return { state: payload.state === 'authenticated' ? 'authenticated' : 'signed_out', effectiveMethod: ['cli_account', 'api_key'].includes(payload.effectiveMethod) ? payload.effectiveMethod : 'unknown', message: String(payload.message ?? 'Check the official CLI login.') };
  }
  async models(id: string): Promise<{ supported: boolean; models: string[]; options?: Array<{ id: string; label: string }> }> {
    const stored = this.require(id);
    if (stored.kind === 'chatgpt') {
      const accessToken = await this.chatGptAuth.accessToken(id);
      const response = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${accessToken}` }, redirect: 'error', signal: AbortSignal.timeout(10_000) });
      if (!response.ok) { await response.body?.cancel(); throw new AiConnectionError('AI_MODEL_DISCOVERY_FAILED', 'Unable to load your ChatGPT models. Reconnect or try again.', 502); }
      const payload = await response.json();
      const options = (Array.isArray(payload.models) ? payload.models : []).filter((m: { visibility?: string; slug?: string }) => m.visibility === 'list' && typeof m.slug === 'string' && m.slug.length > 0 && m.slug.length <= 200).slice(0, 1000).map((m: { slug: string; display_name?: string }) => ({ id: m.slug, label: typeof m.display_name === 'string' ? m.display_name.slice(0, 200) : m.slug }));
      return { supported: true, models: options.map((m: { id: string }) => m.id), options };
    }
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
    const capabilities = { image: connection?.kind === 'chatgpt' || connection?.kind === 'api' && ['openai', 'anthropic', 'gemini'].includes(connection.provider), streaming: true };
    if (this.migrationError) return { state: 'credential_store_unavailable', connection, capabilities, message: this.migrationError };
    if (!id || !stored) return { state: 'needs_setup', connection: null, capabilities, message: 'Choose an AI connection in Settings.' };
    try {
      if (connection?.kind === 'chatgpt') {
        const auth = await this.chatGptAuth.status(id, false);
        if (auth.state !== 'authenticated') return { state: 'authentication_required', connection, capabilities, message: auth.message };
      } else await this.resolve(id);
      if (connection?.kind === 'cli_proxy') {
        const tool = (await this.proxyTools()).toolDetails.find((item) => item.id === connection.tool);
        if (!tool || tool.available === false) return { state: 'tool_unavailable', connection, capabilities, message: 'Install or configure this CLI in the companion proxy.' };
        if (tool.authenticationStatus === 'authentication_required') return { state: 'authentication_required', connection, capabilities, message: tool.authenticationInstructions };
      }
      if (stored.testedRevision !== stored.revision) return { state: 'needs_setup', connection, capabilities, message: 'Test and activate this connection in Settings.' };
      return { state: 'configured', connection, capabilities };
    } catch (error) {
      const code = (error as { code?: string }).code;
      const state = code === 'AI_PROXY_UNAVAILABLE' ? 'proxy_unavailable' : code === 'AI_CREDENTIAL_STORE_UNAVAILABLE' ? 'credential_store_unavailable' : code === 'AI_AUTH_REQUIRED' ? 'authentication_required' : code === 'AI_SETUP_REQUIRED' ? 'needs_setup' : code === 'AI_PROXY_UPDATE_REQUIRED' ? 'proxy_unavailable' : 'missing_credential';
      return { state, connection, capabilities, message: error instanceof Error ? error.message : 'Connection unavailable.' };
    }
  }
}
