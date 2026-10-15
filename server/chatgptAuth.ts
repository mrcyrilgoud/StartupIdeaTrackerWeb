import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { ConnectionService } from './connections/ConnectionService.js';
import { AiConnectionError } from './errors.js';

const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const registrationSchema = z.object({ clientId: z.string(), subject: z.string().optional(), email: z.string().optional(), planUsageEnabled: z.boolean().optional() });
const sessionSchema = z.object({ accessToken: z.string().optional(), refreshToken: z.string().optional(), idToken: z.string(), expiresAt: z.number(), scopes: z.array(z.string()) });
export type ChatGptSession = z.infer<typeof sessionSchema>;
export interface ConnectionAuthStatus {
  state: 'signed_out' | 'pending' | 'authenticated' | 'plan_disabled' | 'error';
  message: string;
  account?: { email: string; planUsageEnabled: boolean };
  authorizationUrl?: string;
  effectiveMethod?: 'cli_account' | 'api_key' | 'unknown';
}
type Registration = z.infer<typeof registrationSchema>;
type Attempt = { state: string; nonce: string; verifier: string; redirectUri: string; server: Server; timer: ReturnType<typeof setTimeout>; controller: AbortController; revision: number; registration: Registration | null; used: boolean; authorizationUrl: string };
type Identity = { subject: string; email: string };
export interface AuthOptions {
  fetchImpl?: typeof fetch;
  openBrowser?: (url: string) => Promise<void>;
  verifyIdentity?: (token: string, clientId: string, nonce?: string) => Promise<Identity>;
  attemptTimeoutMs?: number;
}
const command = promisify(execFile);
async function openBrowser(url: string) {
  if (process.platform === 'darwin') await command('open', [url]);
  else if (process.platform === 'linux') await command('xdg-open', [url]);
  else throw new Error('Open the sign-in link in your browser.');
}
const fail = (code: string, message: string) => new AiConnectionError(code, message, 400);

/** OAuth tokens are held only by the backend's credential store, never by renderer code. */
export class ChatGptAuthService {
  private attempts = new Map<string, Attempt>();
  private starts = new Map<string, Promise<ConnectionAuthStatus>>();
  private cancelledStarts = new Set<string>();
  private results = new Map<string, ConnectionAuthStatus>();
  private fetchImpl: typeof fetch;
  constructor(private service: ConnectionService, private options: AuthOptions = {}) { this.fetchImpl = options.fetchImpl ?? fetch; }
  registration(id: string): Registration | null {
    const value = this.service.store.getMetadata(`chatgpt_registration:${id}`);
    if (!value) return null;
    try { return registrationSchema.parse(JSON.parse(value)); } catch { return null; }
  }
  private require(id: string) {
    const connection = this.service.store.getConnection(id);
    if (!connection || connection.kind !== 'chatgpt') throw fail('AI_AUTH_UNSUPPORTED', 'Choose a ChatGPT connection.');
    return connection;
  }
  private async session(id: string): Promise<ChatGptSession | null> {
    const ref = this.require(id).credentialRef;
    if (!ref) return null;
    const value = await this.service.credentials.get(ref);
    if (!value) return null;
    try { return sessionSchema.parse(JSON.parse(value)); }
    catch { throw fail('AI_AUTH_REQUIRED', 'Reconnect this ChatGPT account.'); }
  }
  async status(id: string, includePending = true): Promise<ConnectionAuthStatus> {
    this.require(id);
    const pending = this.attempts.get(id);
    if (includePending && pending) return { state: 'pending', message: 'Complete ChatGPT sign-in in your browser.', authorizationUrl: pending.authorizationUrl };
    const result = this.results.get(id);
    const session = await this.session(id), registration = this.registration(id);
    if (result?.state === 'error' && !session) return result;
    if (!session || !registration?.subject) return { state: 'signed_out', message: 'Connect your ChatGPT account to use an eligible plan.' };
    const sharing = session.scopes.includes('chatgpt.tokens.use.direct') && Boolean(session.accessToken);
    const account = { email: registration.email ?? 'ChatGPT account', planUsageEnabled: sharing };
    if (!sharing) return { state: 'plan_disabled', account, message: 'Signed in. ChatGPT plan use is not enabled. Continue with ChatGPT to grant permission.' };
    if (session.expiresAt <= Date.now() && !session.refreshToken) return { state: 'signed_out', account, message: 'Your session expired. Reconnect this account.' };
    return { state: 'authenticated', account, message: result?.state === 'error' ? `Your existing account is still connected. ${result.message}` : 'ChatGPT plan usage is enabled.' };
  }
  async start(id: string): Promise<ConnectionAuthStatus> {
    const existing = this.starts.get(id);
    if (existing) return existing;
    const task = this.startAttempt(id); this.starts.set(id, task);
    try { return await task; } finally { this.starts.delete(id); this.cancelledStarts.delete(id); }
  }
  private async startAttempt(id: string): Promise<ConnectionAuthStatus> {
    const connection = this.require(id);
    if (this.attempts.has(id)) return this.status(id);
    this.results.delete(id);
    const registration = this.registration(id);
    const hostId = this.service.store.atomic(() => {
      const existing = this.service.store.getMetadata('chatgpt_host_id');
      if (existing) return existing;
      const value = `urn:uuid:${randomUUID()}`;
      this.service.store.setMetadata('chatgpt_host_id', value); return value;
    });
    const state = randomBytes(32).toString('base64url'), nonce = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
    const server = createServer((req, res) => {
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
      let url: URL;
      try { url = new URL(req.url ?? '/', 'http://127.0.0.1'); } catch { res.writeHead(400); res.end('Invalid callback.'); return; }
      const attempt = this.attempts.get(id);
      if (req.method !== 'GET' || url.pathname !== '/auth/callback' || !attempt || attempt.used || url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== attempt.state) {
        res.writeHead(400); res.end('Invalid or expired sign-in attempt.'); return;
      }
      attempt.used = true;
      void this.complete(id, attempt, url.searchParams).then(() => {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('ChatGPT connected. Return to Startup Idea Tracker.');
      }).catch(() => {
        res.writeHead(400); res.end('Sign-in could not be completed. Return to Startup Idea Tracker to retry.');
      }).finally(() => { this.stop(id, attempt); });
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
    const address = server.address();
    if (!address || typeof address === 'string') { server.close(); throw fail('AI_AUTH_FAILED', 'Unable to open the sign-in callback.'); }
    if (this.cancelledStarts.has(id)) { server.close(); return { state: 'signed_out', message: 'Sign-in cancelled.' }; }
    const redirectUri = `http://127.0.0.1:${address.port}/auth/callback`;
    const url = new URL(`${ISSUER}/api/accounts/authorize`);
    url.search = new URLSearchParams({ client_id: registration?.clientId ?? 'dynamic_agent_client', ext_agent_host_id: hostId, response_type: 'code', redirect_uri: redirectUri,
      scope: SCOPES, resource: RESOURCE, state, nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') }).toString();
    if (!registration) url.searchParams.set('agent_name_hint', 'Startup Idea Tracker');
    // ID-token hints are deliberately omitted so returned authorization URLs contain no tokens.
    if (registration?.email) url.searchParams.set('login_hint', registration.email);
    if (registration && !registration.planUsageEnabled) url.searchParams.set('prompt', 'consent');
    const timer = setTimeout(() => {
      this.results.set(id, { state: 'error', message: 'Sign-in timed out. Try again.' }); this.cancel(id);
    }, this.options.attemptTimeoutMs ?? 300_000);
    timer.unref();
    const attempt: Attempt = { state, nonce, verifier, redirectUri, server, timer, controller: new AbortController(), revision: connection.revision, registration, used: false, authorizationUrl: url.toString() };
    this.attempts.set(id, attempt);
    try { await (this.options.openBrowser ?? openBrowser)(url.toString()); } catch { /* Safe authorization URL is available as a manual link. */ }
    return this.status(id);
  }
  private stop(id: string, attempt: Attempt) {
    clearTimeout(attempt.timer); attempt.controller.abort(); attempt.server.close();
    if (this.attempts.get(id) === attempt) this.attempts.delete(id);
  }
  cancel(id: string): void { if (this.starts.has(id)) this.cancelledStarts.add(id); const attempt = this.attempts.get(id); if (attempt) this.stop(id, attempt); }
  dispose(): void { for (const id of this.starts.keys()) this.cancel(id); for (const [id, attempt] of this.attempts) this.stop(id, attempt); }
  private async json(url: string, init?: RequestInit) {
    const response = await this.fetchImpl(url, { ...init, redirect: 'error', signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) });
    if (!response.ok) { await response.body?.cancel(); throw fail('AI_AUTH_FAILED', 'ChatGPT authorization failed. Reconnect or check your account eligibility.'); }
    return response.json();
  }
  private async token(params: Record<string, string>, signal?: AbortSignal) {
    return this.json(`${ISSUER}/api/accounts/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...params, resource: RESOURCE }), signal });
  }
  async verifyIdentity(token: string, clientId: string, nonce?: string): Promise<Identity> {
    if (token.length > 32_768) throw fail('AI_AUTH_FAILED', 'Invalid ChatGPT identity.');
    const parts = token.split('.');
    if (parts.length !== 3) throw fail('AI_AUTH_FAILED', 'Invalid ChatGPT identity.');
    let header, claims;
    try { header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()); claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString()); }
    catch { throw fail('AI_AUTH_FAILED', 'Invalid ChatGPT identity.'); }
    if (!['RS256', 'ES256'].includes(header.alg) || typeof header.kid !== 'string') throw fail('AI_AUTH_FAILED', 'Invalid ChatGPT identity signature.');
    const discovery = await this.json(`${ISSUER}/.well-known/openid-configuration`);
    const uri = new URL(discovery.jwks_uri);
    if (uri.origin !== ISSUER) throw fail('AI_AUTH_FAILED', 'Invalid OpenAI identity configuration.');
    const jwks = await this.json(uri.toString());
    const jwk = jwks.keys?.find((key: Record<string, string>) => key.kid === header.kid && (!key.alg || key.alg === header.alg) && (!key.use || key.use === 'sig'));
    if (!jwk) throw fail('AI_AUTH_FAILED', 'Invalid ChatGPT identity signature.');
    const key = createPublicKey({ key: jwk, format: 'jwk' });
    if (header.alg === 'RS256' ? key.asymmetricKeyType !== 'rsa' : key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw fail('AI_AUTH_FAILED', 'Invalid ChatGPT identity signature.');
    if (!verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(parts[2], 'base64url')) || claims.iss !== ISSUER ||
      !(Array.isArray(claims.aud) ? claims.aud.includes(clientId) : claims.aud === clientId) || typeof claims.exp !== 'number' || claims.exp <= Date.now() / 1000 ||
      (nonce !== undefined && claims.nonce !== nonce) || typeof claims.sub !== 'string' || !claims.sub) throw fail('AI_AUTH_FAILED', 'ChatGPT identity validation failed.');
    return { subject: claims.sub, email: typeof claims.email === 'string' ? claims.email : 'ChatGPT account' };
  }
  private tokenSession(data: Record<string, unknown>, previous?: ChatGptSession): ChatGptSession {
    if (typeof data.expires_in !== 'number' || data.expires_in <= 0 || !Number.isFinite(data.expires_in)) throw fail('AI_AUTH_FAILED', 'Invalid ChatGPT token response.');
    const scopes = typeof data.scope === 'string' ? data.scope.split(/\s+/).filter(Boolean) : previous?.scopes ?? [];
    if (scopes.includes('chatgpt.tokens.use.direct') && (typeof data.access_token !== 'string' || !data.access_token || data.token_type !== 'Bearer')) throw fail('AI_AUTH_FAILED', 'Invalid ChatGPT plan credentials.');
    return sessionSchema.parse({ accessToken: data.access_token, refreshToken: data.refresh_token ?? previous?.refreshToken,
      idToken: data.id_token ?? previous?.idToken, expiresAt: Date.now() + data.expires_in * 1000,
      scopes });
  }
  private async complete(id: string, attempt: Attempt, params: URLSearchParams) {
    try {
      if (params.has('error')) throw fail('AI_AUTH_DENIED', 'ChatGPT sign-in was declined. You can try again or choose an API key connection.');
      const clientId = params.get('client_id') ?? attempt.registration?.clientId;
      if (params.getAll('client_id').length > 1 || !clientId || !/^oaiapp_[A-Za-z0-9_-]+$/.test(clientId) || (attempt.registration && clientId !== attempt.registration.clientId) || params.getAll('code').length !== 1 || !params.get('code'))
        throw fail('AI_AUTH_FAILED', 'ChatGPT registration was incomplete or did not match this account.');
      if (this.require(id).revision !== attempt.revision) throw fail('AI_CONNECTION_CHANGED', 'Connection changed. Start sign-in again.');
      // Keep the issued registration even if the one-time code expires before exchange.
      if (!attempt.registration) this.service.store.setMetadata(`chatgpt_registration:${id}`, JSON.stringify({ clientId }));
      const data = await this.token({ grant_type: 'authorization_code', client_id: clientId, code: params.get('code')!, code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri }, attempt.controller.signal);
      if (typeof data.id_token !== 'string') throw fail('AI_AUTH_FAILED', 'ChatGPT did not return a verified identity.');
      const identity = await (this.options.verifyIdentity ?? this.verifyIdentity.bind(this))(data.id_token, clientId, attempt.nonce);
      if (attempt.registration?.subject && identity.subject !== attempt.registration.subject) throw fail('AI_AUTH_FAILED', 'This is a different account. Add a separate connection to use it.');
      const session = this.tokenSession(data);
      attempt.controller.signal.throwIfAborted();
      await this.withLease(id, async () => {
        attempt.controller.signal.throwIfAborted();
        if (this.require(id).revision !== attempt.revision) throw fail('AI_CONNECTION_CHANGED', 'Connection changed. Start sign-in again.');
        await this.service.saveOAuthSession(id, session, { clientId, ...identity, planUsageEnabled: session.scopes.includes('chatgpt.tokens.use.direct') && Boolean(session.accessToken) }, false, attempt.revision, attempt.controller.signal);
      });
      this.results.delete(id);
    } catch (error) {
      if (!attempt.controller.signal.aborted) this.results.set(id, { state: 'error', message: error instanceof AiConnectionError ? error.message : 'Unable to complete ChatGPT sign-in. Check Keychain access and try again.' }); throw error;
    }
  }
  async withLease<T>(id: string, work: () => Promise<T>): Promise<T> {
    const owner = randomUUID(), deadline = Date.now() + 20_000;
    while (!this.service.store.acquireAuthLease(id, owner)) {
      if (Date.now() > deadline) throw fail('AI_AUTH_BUSY', 'Account update is still running. Try again.');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const renewal = setInterval(() => this.service.store.renewAuthLease(id, owner), 10_000); renewal.unref();
    try { return await work(); } finally { clearInterval(renewal); this.service.store.releaseAuthLease(id, owner); }
  }
  async accessToken(id: string): Promise<string> {
    return this.withLease(id, async () => {
      let session = await this.session(id); const registration = this.registration(id);
      if (!session || !registration?.subject) throw fail('AI_AUTH_REQUIRED', 'Connect your ChatGPT account in Settings.');
      if (!session.scopes.includes('chatgpt.tokens.use.direct') || !session.accessToken) throw fail('AI_AUTH_REQUIRED', 'Enable ChatGPT plan usage in Settings before using AI.');
      if (session.expiresAt <= Date.now() + 60_000) {
        if (!session.refreshToken) throw fail('AI_AUTH_REQUIRED', 'Your ChatGPT session expired. Reconnect in Settings.');
        let data;
        try { data = await this.token({ grant_type: 'refresh_token', client_id: registration.clientId, refresh_token: session.refreshToken }); }
        catch { throw fail('AI_AUTH_REQUIRED', 'Unable to renew your ChatGPT session. Reconnect in Settings.'); }
        if (data.id_token) {
          const identity = await (this.options.verifyIdentity ?? this.verifyIdentity.bind(this))(data.id_token, registration.clientId);
          if (identity.subject !== registration.subject) throw fail('AI_AUTH_REQUIRED', 'ChatGPT account changed. Reconnect in Settings.');
        }
        session = this.tokenSession(data, session);
        await this.service.saveOAuthSession(id, session, { ...registration, planUsageEnabled: session.scopes.includes('chatgpt.tokens.use.direct') && Boolean(session.accessToken) }, true);
        if (!session.scopes.includes('chatgpt.tokens.use.direct') || !session.accessToken) throw fail('AI_AUTH_REQUIRED', 'ChatGPT plan permission is no longer available. Reconnect in Settings.');
      }
      return session.accessToken!;
    });
  }
  async disconnect(id: string): Promise<ConnectionAuthStatus> {
    this.cancel(id); this.results.delete(id);
    return this.withLease(id, async () => {
      const session = await this.session(id), registration = this.registration(id);
      let revoked = true;
      if (session?.refreshToken && registration) {
        revoked = false;
        for (let attempt = 0; attempt < 2 && !revoked; attempt++) {
          try {
            const discovery = await this.json(`${ISSUER}/.well-known/openid-configuration`);
            const endpoint = new URL(discovery.revocation_endpoint);
            if (endpoint.origin !== ISSUER) throw new Error();
            const response = await this.fetchImpl(endpoint.toString(), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: session.refreshToken, token_type_hint: 'refresh_token', client_id: registration.clientId }) });
            revoked = response.status === 200; await response.body?.cancel();
          } catch { /* Local disconnect still clears credentials; report unconfirmed revocation. */ }
          if (!revoked && attempt === 0) await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      await this.service.deleteCredential(id);
      return { state: 'signed_out', message: revoked ? 'Disconnected this ChatGPT account.' : 'Disconnected locally. Remote revocation was not confirmed; disconnect the app in ChatGPT Settings → Usage.' };
    });
  }
}
