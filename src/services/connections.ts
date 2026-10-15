import type { AiConnection, AiConnectionStatus, AppSettings } from '../types';

export type AiStatus = AiConnectionStatus;
export type OpenAiAuthStatus = { state: 'authenticated' | 'signed_out' | 'pending' | 'unavailable'; message: string; authorizationUrl?: string };

export interface ProxyTools {
    requestCredentials?: boolean;
    authStatus?: boolean;
    defaultTool: string | null;
    tools: string[];
    toolDetails: Array<{
        id: string;
        available: boolean | null;
        capabilities: { image: boolean; streaming: boolean; model: boolean };
        authenticationInstructions: string;
        authenticationStatus: string;
    }>;
}

export type ConnectionInput =
    | { name: string; kind: 'api'; provider: Extract<AiConnection, { kind: 'api' }>['provider']; model: string; baseUrl?: string }
    | { name: string; kind: 'cli_proxy'; tool: string; model?: string }
    | { name: string; kind: 'chatgpt'; model?: string };
export type ConnectionAuthStatus = { state: 'signed_out' | 'pending' | 'authenticated' | 'plan_disabled' | 'error'; message: string; authorizationUrl?: string; account?: { email: string; planUsageEnabled: boolean }; effectiveMethod?: 'cli_account' | 'api_key' | 'unknown' };

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await fetch(`/api${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(String(payload.error || payload.message || response.statusText));
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return text ? JSON.parse(text) as T : undefined as T;
}

const connectionPath = (id: string) => `/ai/connections/${encodeURIComponent(id)}`;
let initialization: Promise<void> | undefined;

export const connectionsService = {
    getSettings: () => request<AppSettings>('/settings'),
    saveSettings: (settings: AppSettings) => request<AppSettings>('/settings', 'PUT', settings),
    list: () => request<AiConnection[]>('/ai/connections'),
    create: (input: ConnectionInput) => request<AiConnection>('/ai/connections', 'POST', input),
    update: (id: string, input: ConnectionInput) => request<AiConnection>(connectionPath(id), 'PATCH', { ...input, ...(input.kind !== 'api' && !input.model ? { model: null } : {}), ...(input.kind === 'api' && !input.baseUrl ? { baseUrl: null } : {}) }),
    remove: (id: string) => request<{ message: string } | void>(connectionPath(id), 'DELETE'),
    setCredential: (id: string, apiKey: string) => request<void>(`${connectionPath(id)}/credential`, 'PUT', { apiKey }),
    removeCredential: (id: string) => request<void>(`${connectionPath(id)}/credential`, 'DELETE'),
    test: (id: string) => request<{ ok?: boolean; state?: string; message?: string; success?: boolean }>(`${connectionPath(id)}/test`, 'POST'),
    authStatus: (id: string) => request<ConnectionAuthStatus>(`${connectionPath(id)}/auth`),
    startAuth: (id: string) => request<ConnectionAuthStatus>(`${connectionPath(id)}/auth/start`, 'POST'),
    cancelAuth: (id: string) => request<ConnectionAuthStatus>(`${connectionPath(id)}/auth/cancel`, 'POST'),
    disconnectAuth: (id: string) => request<ConnectionAuthStatus>(`${connectionPath(id)}/auth/disconnect`, 'POST'),
    status: () => request<AiStatus>('/ai/status'),
    openAiAuthStatus: () => request<OpenAiAuthStatus>('/ai/openai-auth'),
    startOpenAiAuth: () => request<OpenAiAuthStatus>('/ai/openai-auth/start', 'POST'),
    logoutOpenAiAuth: () => request<OpenAiAuthStatus>('/ai/openai-auth/logout', 'POST'),
    retryMigration: () => request<void>('/ai/retry-migration', 'POST'),
    models: (id: string) => request<{ supported: boolean; models: string[]; options?: Array<{ id: string; label: string }> }>(`${connectionPath(id)}/models`),
    proxyTools: () => request<ProxyTools>('/ai/proxy-tools'),
    importBackup: (payload: Record<string, unknown>, importCredentials: boolean) => request<void>('/import', 'POST', { ...payload, importCredentials }),
    initialize: (): Promise<void> => {
        if (!initialization) {
            initialization = (async () => {
                // The backend decides precedence and recognizes interrupted browser migration.
                // Always offer the retained source so a denied Keychain write can be retried.
                let stored: string | null;
                try { stored = localStorage.getItem('app-settings'); } catch { return; }
                if (!stored) return;
                let legacy: unknown;
                try { legacy = JSON.parse(stored); } catch { return; }
                if (!legacy || typeof legacy !== 'object' || !('provider' in legacy)) return;
                await request('/ai/migrate-legacy-settings', 'POST', { settings: legacy });
                try { localStorage.removeItem('app-settings'); } catch { /* Migration already persisted. */ }
            })().catch(error => {
                initialization = undefined;
                throw error;
            });
        }
        return initialization;
    }
};
