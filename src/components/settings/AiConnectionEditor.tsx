import { useEffect, useId, useRef, useState } from 'react';
import type { AiConnection, AppSettings } from '../../types';
import { connectionsService, type ConnectionInput, type ProxyTools } from '../../services/connections';
import { useAiConnection } from '../../context/AiConnectionContext';

type ApiProvider = Extract<AiConnection, { kind: 'api' }>['provider'];
type EditorMode = 'closed' | 'add' | 'edit';
type Draft = {
    name: string;
    kind: 'api' | 'cli_proxy';
    provider: ApiProvider;
    model: string;
    baseUrl: string;
    tool: string;
    apiKey: string;
};

const providers: Array<{ id: ApiProvider; label: string }> = [
    { id: 'openai', label: 'OpenAI' }, { id: 'anthropic', label: 'Anthropic' },
    { id: 'gemini', label: 'Google Gemini' }, { id: 'openai_compatible', label: 'OpenAI compatible' },
    { id: 'ollama', label: 'Ollama' }
];

function draftSignature(draft: Draft) {
    return JSON.stringify(draft);
}

export function AiConnectionEditor({ initialMode = 'closed' }: { initialMode?: Exclude<EditorMode, 'edit'> }) {
    const { refresh, status } = useAiConnection();
    const [connections, setConnections] = useState<AiConnection[]>([]);
    const [settings, setSettings] = useState<AppSettings | null>(null);
    const [tools, setTools] = useState<ProxyTools | null>(null);
    const [toolsError, setToolsError] = useState('');
    const [toolsLoading, setToolsLoading] = useState(false);
    const [editorMode, setEditorMode] = useState<EditorMode>(initialMode);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [draftBaseline, setDraftBaseline] = useState('');
    const [focusToken, setFocusToken] = useState(0);
    const [kind, setKind] = useState<'api' | 'cli_proxy'>('api');
    const [name, setName] = useState('');
    const [provider, setProvider] = useState<ApiProvider>('openai');
    const [model, setModel] = useState('');
    const [models, setModels] = useState<string[]>([]);
    const modelListId = useId();
    const editorId = useId();
    const [baseUrl, setBaseUrl] = useState('');
    const [tool, setTool] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const formRef = useRef<HTMLFormElement>(null);
    const nameInputRef = useRef<HTMLInputElement>(null);
    const returnFocusRef = useRef<HTMLButtonElement | null>(null);
    const mountedRef = useRef(true);
    const selected = connections.find(connection => connection.id === editingId);
    const toolDetail = tools?.toolDetails.find(detail => detail.id === tool);
    const currentDraft: Draft = { name, kind, provider, model, baseUrl, tool, apiKey };
    const isDirty = editorMode !== 'closed' && draftSignature(currentDraft) !== draftBaseline;

    async function reloadConnections() {
        const [nextConnections, nextSettings] = await Promise.all([connectionsService.list(), connectionsService.getSettings()]);
        setConnections(nextConnections);
        setSettings(nextSettings);
    }

    async function loadProxyTools() {
        setToolsLoading(true);
        try {
            const nextTools = await connectionsService.proxyTools();
            if (!mountedRef.current) return;
            setTools(nextTools);
            setToolsError('');
            setTool(currentTool => currentTool || nextTools.defaultTool || '');
        } catch (cause) {
            if (mountedRef.current) setToolsError(cause instanceof Error ? cause.message : 'Unable to load CLI tools');
        } finally {
            if (mountedRef.current) setToolsLoading(false);
        }
    }

    useEffect(() => {
        mountedRef.current = true;
        let cancelled = false;
        void (async () => {
            try {
                await connectionsService.initialize();
                const [nextConnections, nextSettings] = await Promise.all([connectionsService.list(), connectionsService.getSettings()]);
                if (!cancelled) { setConnections(nextConnections); setSettings(nextSettings); }
            } catch (cause) {
                if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load connections');
            } finally { if (!cancelled) setBusy(false); }
        })();
        void loadProxyTools();
        return () => { cancelled = true; mountedRef.current = false; };
    }, []);

    useEffect(() => {
        if (editorMode === 'closed' || busy || !settings) return;
        const frame = window.requestAnimationFrame(() => {
            formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            nameInputRef.current?.focus();
        });
        return () => window.cancelAnimationFrame(frame);
    }, [editorMode, focusToken, busy]);

    function snapshot(connection?: AiConnection): Draft {
        return {
            name: connection?.name ?? '',
            kind: connection?.kind ?? 'api',
            provider: connection?.kind === 'api' ? connection.provider : 'openai',
            model: connection?.model ?? '',
            baseUrl: connection?.kind === 'api' ? connection.baseUrl ?? '' : '',
            tool: connection?.kind === 'cli_proxy' ? connection.tool : tools?.defaultTool ?? '',
            apiKey: ''
        };
    }

    function applyDraft(next: Draft) {
        setName(next.name);
        setKind(next.kind);
        setProvider(next.provider);
        setModel(next.model);
        setModels([]);
        setBaseUrl(next.baseUrl);
        setTool(next.tool);
        setApiKey(next.apiKey);
    }

    function canDiscardDraft() {
        return !isDirty || window.confirm('You have unsaved changes. Discard them?');
    }

    function openEditor(connection?: AiConnection) {
        if (!canDiscardDraft()) return;
        const next = snapshot(connection);
        applyDraft(next);
        setEditingId(connection?.id ?? null);
        setEditorMode(connection ? 'edit' : 'add');
        setDraftBaseline(draftSignature(next));
        setError('');
        setMessage('');
        setFocusToken(token => token + 1);
    }

    function closeEditor(force = false) {
        if (!force && !canDiscardDraft()) return;
        setEditorMode('closed');
        setEditingId(null);
        setDraftBaseline('');
        setError('');
        window.requestAnimationFrame(() => returnFocusRef.current?.focus());
    }

    async function run(action: () => Promise<string>) {
        const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setBusy(true); setError(''); setMessage('');
        try {
            const result = await action();
            await reloadConnections();
            await refresh();
            setMessage(result);
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Connection update failed'); }
        finally {
            setBusy(false);
            window.requestAnimationFrame(() => {
                if (activeElement?.isConnected && !activeElement.hasAttribute('disabled')) activeElement.focus();
                else if (editorMode !== 'closed') nameInputRef.current?.focus();
            });
        }
    }

    async function save() {
        if (!name.trim() || (kind === 'api' && !model.trim()) || (kind === 'cli_proxy' && !tool)) {
            setError('Enter a name and select a tool or enter an API model.'); return;
        }
        if (kind === 'api' && provider === 'openai_compatible' && !baseUrl.trim()) {
            setError('Enter the base URL for the compatible API.'); return;
        }
        const input: ConnectionInput = kind === 'api'
            ? { name: name.trim(), kind, provider, model: model.trim(), ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}) }
            : { name: name.trim(), kind, tool, ...(model.trim() ? { model: model.trim() } : {}) };
        await run(async () => {
            setModels([]);
            const connection = editingId ? await connectionsService.update(editingId, input) : await connectionsService.create(input);
            setEditingId(connection.id);
            setEditorMode('edit');
            if (kind === 'api' && apiKey.trim()) {
                try { await connectionsService.setCredential(connection.id, apiKey.trim()); }
                catch (cause) {
                    await reloadConnections(); await refresh();
                    throw new Error(`Connection saved, but credential was not saved: ${cause instanceof Error ? cause.message : 'request failed'}`);
                } finally { setApiKey(''); }
            } else { setApiKey(''); }
            setDraftBaseline(draftSignature({ ...currentDraft, name: name.trim(), model: model.trim(), baseUrl: baseUrl.trim(), apiKey: '' }));
            return 'Connection saved. Test it, then choose “Make active” to use it for AI features.';
        });
    }

    function changeKind(nextKind: 'api' | 'cli_proxy') {
        setKind(nextKind);
        setModel('');
        setBaseUrl('');
        setApiKey('');
        setTool(nextKind === 'cli_proxy' ? tools?.defaultTool ?? '' : '');
    }

    function changeProvider(nextProvider: ApiProvider) {
        setProvider(nextProvider);
        setModel('');
        setBaseUrl('');
        setApiKey('');
    }

    return <section className="flex flex-col gap-4" aria-label="AI connections">
        <div>
            <h3 className="text-xl font-semibold">AI connections</h3>
            <p className="text-sm text-text-secondary mt-1">Save a connection, test it, then make it active. You can use the tracker without AI.</p>
            {status && <p className="text-sm text-text-secondary mt-2" role="status">AI status: {status.state.replace(/_/g, ' ')}{status.message ? ` · ${status.message}` : ''}</p>}
        </div>
        {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
        {message && <p role="status" className="text-sm">{message}</p>}
        {!settings && busy && <p role="status">Loading connections…</p>}
        <div className="flex flex-col gap-2">
            {connections.map(connection => {
                const active = settings?.activeConnectionId === connection.id;
                return <div key={connection.id} className="border border-border rounded-lg p-3 grid gap-3 sm:flex sm:items-center">
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium break-words">{connection.name}</p>
                            {active && <span className="text-xs font-semibold text-green-700 dark:text-green-300 border border-green-300 dark:border-green-700 rounded-full px-2 py-0.5" aria-label="Active connection">Active</span>}
                        </div>
                        <p className="text-sm text-text-secondary break-words">{connection.kind === 'api' ? connection.provider : connection.tool} · {connection.model || 'Tool default model'}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end sm:items-center">
                        <button type="button" className="btn-secondary" disabled={busy} aria-expanded={editorMode !== 'closed' && editingId === connection.id} aria-controls={editorId} onClick={event => { returnFocusRef.current = event.currentTarget; openEditor(connection); }}>Edit</button>
                        {!active && <button type="button" className="btn-secondary" disabled={busy || !settings} onClick={() => void run(async () => {
                            await connectionsService.saveSettings({ version: 2, activeConnectionId: connection.id });
                            return `${connection.name} is active.`;
                        })}>Make active</button>}
                        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void run(async () => {
                            const result = await connectionsService.test(connection.id);
                            if (result?.success === false || result?.ok === false) throw new Error(result.message || 'Connection test failed');
                            return result?.message || (result?.state ? `Test result: ${result.state}` : 'Connection test passed. You can now make it active.');
                        })}>Test</button>
                        <button type="button" className="text-red-600 dark:text-red-400 px-2 py-2 text-center" disabled={busy} onClick={() => {
                            if (!window.confirm(`Delete connection “${connection.name}” and its stored credential?`)) return;
                            void run(async () => { await connectionsService.remove(connection.id); if (editingId === connection.id) closeEditor(true); return 'Connection deleted.'; });
                        }}>Delete</button>
                    </div>
                </div>;
            })}
            {settings && !connections.length && <p className="text-sm text-text-secondary">No AI connections configured.</p>}
        </div>
        <div className="flex flex-wrap gap-3">
            <button type="button" className="btn-primary" disabled={busy} aria-expanded={editorMode !== 'closed'} aria-controls={editorId} onClick={event => { returnFocusRef.current = event.currentTarget; openEditor(); }}>New connection</button>
            <button type="button" className="btn-secondary" disabled={busy || !settings?.activeConnectionId} onClick={() => void run(async () => {
                await connectionsService.saveSettings({ version: 2, activeConnectionId: null }); return 'AI disabled. You can continue using the tracker.';
            })}>Use without AI</button>
        </div>
        {editorMode !== 'closed' && <form id={editorId} ref={formRef} className="border-t border-border pt-4 flex flex-col gap-4 scroll-mt-4" onSubmit={event => { event.preventDefault(); void save(); }}>
            <div>
                <h4 className="font-semibold">{editorMode === 'edit' ? 'Edit connection' : 'Add connection'}</h4>
                {editorMode === 'edit' && <p className="text-sm text-text-secondary mt-1">Provider and connection type are locked after creation. To change either, create a new connection.</p>}
            </div>
            <fieldset disabled={busy || !settings} className="flex flex-col gap-4">
                <label className="block">Name<input ref={nameInputRef} className="input mt-1" value={name} required onChange={event => setName(event.target.value)} /></label>
                <label className="block">Connection type<select className="input mt-1" value={kind} disabled={editorMode === 'edit'} onChange={event => changeKind(event.target.value as typeof kind)}>
                    <option value="api">API provider</option><option value="cli_proxy">Local CLI proxy</option>
                </select></label>
                {kind === 'api' ? <>
                    <label className="block">Provider<select className="input mt-1" value={provider} disabled={editorMode === 'edit'} onChange={event => changeProvider(event.target.value as ApiProvider)}>
                        {providers.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </select></label>
                    <label className="block">Model<input className="input mt-1" required list={modelListId} value={model} onChange={event => setModel(event.target.value)} placeholder="Enter the exact model ID" /></label>
                    <datalist id={modelListId}>{models.map(id => <option key={id} value={id} />)}</datalist>
                    {editingId && selected?.kind === 'api' && <div>
                        <button type="button" className="text-sm text-accent" disabled={busy} onClick={() => void run(async () => {
                            setModels([]);
                            const result = await connectionsService.models(selected.id);
                            if (!result.supported) return 'Model discovery is unavailable for this connection. Enter an explicit model ID.';
                            setModels([...new Set(result.models)]);
                            return result.models.length ? 'Models loaded from the saved connection. Select a suggestion or enter an explicit model ID.' : 'No models returned. You can still enter an explicit model ID.';
                        })}>Load models</button>
                        <p className="text-sm text-text-secondary mt-1">Uses the saved connection and credential. You can always enter a model ID directly.</p>
                    </div>}
                    {(provider === 'openai_compatible' || provider === 'ollama') && <label className="block">Base URL<input className="input mt-1" type="url" required={provider === 'openai_compatible'} value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder={provider === 'ollama' ? 'http://localhost:11434' : 'https://api.example.com/v1'} /></label>}
                    {provider === 'ollama' ? <p className="text-sm text-text-secondary">Ollama does not require an API key. Make sure Ollama is running at {baseUrl || 'the configured Base URL'}.</p> : <>
                        <label className="block">API key {editingId && selected?.kind === 'api' && selected.hasKey ? '(stored; leave blank to keep)' : '(required before testing)'}
                            <input className="input mt-1" type="password" autoComplete="new-password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="Enter a new key" />
                        </label>
                        <p className="text-sm text-text-secondary">API keys are stored securely in macOS Keychain by the backend and never displayed here. Allow Keychain access if macOS prompts you.</p>
                    </>}
                    {editingId && selected?.kind === 'api' && selected.hasKey && <button type="button" className="text-red-600 dark:text-red-400 text-left" disabled={busy} onClick={() => {
                        if (!window.confirm('Remove the stored API key for this connection?')) return;
                        void run(async () => { await connectionsService.removeCredential(selected.id); setApiKey(''); return 'Stored credential removed.'; });
                    }}>Remove stored key</button>}
                </> : <>
                    {toolsError && <div role="alert" className="border border-red-300 dark:border-red-700 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
                        <p>CLI tools unavailable: {toolsError}</p>
                        <button type="button" className="btn-secondary" disabled={toolsLoading || busy} onClick={() => void loadProxyTools()}>{toolsLoading ? 'Retrying…' : 'Retry'}</button>
                    </div>}
                    {toolsLoading && !toolsError && <p role="status" aria-live="polite" className="text-sm text-text-secondary">Loading CLI tools…</p>}
                    <label className="block">Tool<select className="input mt-1" required value={tool} onChange={event => { setTool(event.target.value); setModel(''); }}>
                        <option value="">Select a tool</option>
                        {tool && !tools?.tools.includes(tool) && <option value={tool}>{tool} (unavailable)</option>}
                        {tools?.tools.map(id => {
                            const availability = tools.toolDetails.find(detail => detail.id === id)?.available;
                            return <option key={id} value={id}>{id}{availability === false ? ' (unavailable)' : availability == null ? ' (availability unknown)' : ''}</option>;
                        })}
                    </select></label>
                    {toolDetail && <div className="bg-background border border-border p-3 rounded-lg text-sm">
                        <p>{toolDetail.available === true ? 'Tool available' : toolDetail.available === false ? 'Tool unavailable' : 'Tool availability unknown'} · Authentication: {toolDetail.authenticationStatus}</p>
                        <p className="whitespace-pre-wrap mt-2">{toolDetail.authenticationInstructions}</p>
                        <p className="mt-2">Images: {toolDetail.capabilities.image ? 'supported' : 'unsupported'} · Streaming: {toolDetail.capabilities.streaming ? 'supported' : 'unsupported'}</p>
                    </div>}
                    {toolDetail?.capabilities.model && <label className="block">Model (optional)<input className="input mt-1" value={model} onChange={event => setModel(event.target.value)} placeholder="Leave blank to use the authenticated tool's default" /></label>}
                </>}
                <div className="flex flex-wrap gap-3 items-center">
                    <button type="submit" className="btn-primary">{busy ? 'Saving…' : editorMode === 'edit' ? 'Save changes' : 'Create connection'}</button>
                    <button type="button" className="btn-secondary" disabled={busy} onClick={() => closeEditor()}>Cancel</button>
                </div>
            </fieldset>
        </form>}
        <button type="button" className="text-sm text-accent self-start" disabled={busy} onClick={() => void run(async () => {
            if (status?.state === 'credential_store_unavailable') await connectionsService.retryMigration();
            return 'Connection status refreshed.';
        })}>Refresh connections</button>
    </section>;
}
