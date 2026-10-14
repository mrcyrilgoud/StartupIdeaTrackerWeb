import { useEffect, useId, useState } from 'react';
import type { AiConnection, AppSettings } from '../../types';
import { connectionsService, type ConnectionInput, type ProxyTools } from '../../services/connections';
import { useAiConnection } from '../../context/AiConnectionContext';

type ApiProvider = Extract<AiConnection, { kind: 'api' }>['provider'];
const providers: Array<{ id: ApiProvider; label: string }> = [
    { id: 'openai', label: 'OpenAI' }, { id: 'anthropic', label: 'Anthropic' },
    { id: 'gemini', label: 'Google Gemini' }, { id: 'openai_compatible', label: 'OpenAI compatible' },
    { id: 'ollama', label: 'Ollama' }
];

export function AiConnectionEditor() {
    const { refresh, status } = useAiConnection();
    const [connections, setConnections] = useState<AiConnection[]>([]);
    const [settings, setSettings] = useState<AppSettings | null>(null);
    const [tools, setTools] = useState<ProxyTools | null>(null);
    const [toolsError, setToolsError] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [kind, setKind] = useState<'api' | 'cli_proxy'>('api');
    const [name, setName] = useState('');
    const [provider, setProvider] = useState<ApiProvider>('openai');
    const [model, setModel] = useState('');
    const [models, setModels] = useState<string[]>([]);
    const modelListId = useId();
    const [baseUrl, setBaseUrl] = useState('');
    const [tool, setTool] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const selected = connections.find(connection => connection.id === selectedId);
    const toolDetail = tools?.toolDetails.find(detail => detail.id === tool);

    async function reload() {
        const [nextConnections, nextSettings] = await Promise.all([connectionsService.list(), connectionsService.getSettings()]);
        setConnections(nextConnections);
        setSettings(nextSettings);
        try {
            setTools(await connectionsService.proxyTools());
            setToolsError('');
        } catch (cause) { setToolsError(cause instanceof Error ? cause.message : 'Unable to load CLI tools'); }
    }

    useEffect(() => {
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
        void connectionsService.proxyTools().then(next => {
            if (!cancelled) { setTools(next); setTool(next.defaultTool ?? ''); }
        }).catch(cause => { if (!cancelled) setToolsError(cause instanceof Error ? cause.message : 'Unable to load CLI tools'); });
        return () => { cancelled = true; };
    }, []);

    function edit(connection?: AiConnection) {
        setSelectedId(connection?.id ?? null);
        setName(connection?.name ?? '');
        setKind(connection?.kind ?? 'api');
        setModel(connection?.model ?? '');
        setModels([]);
        setProvider(connection?.kind === 'api' ? connection.provider : 'openai');
        setBaseUrl(connection?.kind === 'api' ? connection.baseUrl ?? '' : '');
        setTool(connection?.kind === 'cli_proxy' ? connection.tool : tools?.defaultTool ?? '');
        setApiKey('');
        setError('');
        setMessage('');
    }

    async function run(action: () => Promise<string>) {
        setBusy(true); setError(''); setMessage('');
        try {
            const result = await action();
            await reload();
            await refresh();
            setMessage(result);
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Connection update failed'); }
        finally { setBusy(false); }
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
            const connection = selectedId ? await connectionsService.update(selectedId, input) : await connectionsService.create(input);
            setSelectedId(connection.id);
            if (kind === 'api' && apiKey.trim()) {
                try { await connectionsService.setCredential(connection.id, apiKey.trim()); }
                catch (cause) {
                    await reload(); await refresh();
                    throw new Error(`Connection saved, but credential was not saved: ${cause instanceof Error ? cause.message : 'request failed'}`);
                } finally { setApiKey(''); }
            } else { setApiKey(''); }
            return 'Connection saved. Test it, then choose “Make active” to use it for AI features.';
        });
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
            {connections.map(connection => <div key={connection.id} className="border border-border rounded-lg p-3 flex flex-wrap items-center gap-2">
                <div className="flex-1 min-w-0">
                    <p className="font-medium break-words">{connection.name}{settings?.activeConnectionId === connection.id ? ' · Active' : ''}</p>
                    <p className="text-sm text-text-secondary">{connection.kind === 'api' ? connection.provider : connection.tool} · {connection.model || 'Tool default model'}</p>
                </div>
                <button type="button" className="btn-primary" disabled={busy} onClick={() => edit(connection)}>Edit</button>
                <button type="button" className="btn-primary" disabled={busy || !settings || settings.activeConnectionId === connection.id} onClick={() => void run(async () => {
                    await connectionsService.saveSettings({ version: 2, activeConnectionId: connection.id });
                    return `${connection.name} is active.`;
                })}>Make active</button>
                <button type="button" className="btn-primary" disabled={busy} onClick={() => void run(async () => {
                    const result = await connectionsService.test(connection.id);
                    if (result?.success === false || result?.ok === false) throw new Error(result.message || 'Connection test failed');
                    return result?.message || (result?.state ? `Test result: ${result.state}` : 'Connection test passed. You can now make it active.');
                })}>Test</button>
                <button type="button" className="text-red-600 dark:text-red-400 px-2 py-1" disabled={busy} onClick={() => {
                    if (!window.confirm(`Delete connection “${connection.name}” and its stored credential?`)) return;
                    void run(async () => { await connectionsService.remove(connection.id); if (selectedId === connection.id) edit(); return 'Connection deleted.'; });
                }}>Delete</button>
            </div>)}
            {settings && !connections.length && <p className="text-sm text-text-secondary">No AI connections configured.</p>}
        </div>
        <div className="flex flex-wrap gap-3">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => edit()}>New connection</button>
            <button type="button" className="btn-primary" disabled={busy || !settings?.activeConnectionId} onClick={() => void run(async () => {
                await connectionsService.saveSettings({ version: 2, activeConnectionId: null }); return 'AI disabled. You can continue using the tracker.';
            })}>Use without AI</button>
        </div>
        <form className="border-t border-border pt-4 flex flex-col gap-4" onSubmit={event => { event.preventDefault(); void save(); }}>
            <h4 className="font-semibold">{selectedId ? 'Edit connection' : 'Add connection'}</h4>
            <fieldset disabled={busy || !settings} className="flex flex-col gap-4">
                <label className="block">Name<input className="input mt-1" value={name} required onChange={event => setName(event.target.value)} /></label>
                <label className="block">Connection type<select className="input mt-1" value={kind} disabled={Boolean(selectedId)} onChange={event => { setKind(event.target.value as typeof kind); setModel(''); setApiKey(''); }}>
                    <option value="api">API provider</option><option value="cli_proxy">Local CLI proxy</option>
                </select></label>
                {kind === 'api' ? <>
                    <label className="block">Provider<select className="input mt-1" value={provider} disabled={Boolean(selectedId)} onChange={event => { setProvider(event.target.value as ApiProvider); setModel(''); setBaseUrl(''); setApiKey(''); }}>
                        {providers.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </select></label>
                    <label className="block">Model<input className="input mt-1" required list={modelListId} value={model} onChange={event => setModel(event.target.value)} placeholder="Enter the exact model ID" /></label>
                    <datalist id={modelListId}>{models.map(id => <option key={id} value={id} />)}</datalist>
                    {selected?.kind === 'api' && <div>
                        <button type="button" className="text-sm text-accent" onClick={() => void run(async () => {
                            setModels([]);
                            const result = await connectionsService.models(selected.id);
                            if (!result.supported) return 'Model discovery is unavailable for this connection. Enter an explicit model ID.';
                            setModels([...new Set(result.models)]);
                            return result.models.length ? 'Models loaded from the saved connection. Select a suggestion or enter an explicit model ID.' : 'No models returned. You can still enter an explicit model ID.';
                        })}>Load models</button>
                        <p className="text-sm text-text-secondary mt-1">Uses the saved connection and credential. You can always enter a model ID directly.</p>
                    </div>}
                    {(provider === 'openai_compatible' || provider === 'ollama') && <label className="block">Base URL<input className="input mt-1" type="url" required={provider === 'openai_compatible'} value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder={provider === 'ollama' ? 'http://localhost:11434' : 'https://api.example.com/v1'} /></label>}
                    {provider !== 'ollama' && <label className="block">API key {selected?.kind === 'api' && selected.hasKey ? '(stored; leave blank to keep)' : '(required before testing)'}
                        <input className="input mt-1" type="password" autoComplete="new-password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="Enter a new key" />
                    </label>}
                    <p className="text-sm text-text-secondary">API keys are stored securely in macOS Keychain by the backend and never displayed here. Allow Keychain access if macOS prompts you.</p>
                    {selected?.kind === 'api' && selected.hasKey && <button type="button" className="text-red-600 dark:text-red-400 text-left" onClick={() => {
                        if (!window.confirm('Remove the stored API key for this connection?')) return;
                        void run(async () => { await connectionsService.removeCredential(selected.id); setApiKey(''); return 'Stored credential removed.'; });
                    }}>Remove stored key</button>}
                </> : <>
                    {toolsError && <p role="alert">CLI tools unavailable: {toolsError}</p>}
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
                <button type="submit" className="btn-primary">{busy ? 'Saving…' : 'Save connection'}</button>
            </fieldset>
        </form>
        <button type="button" className="text-sm text-accent self-start" disabled={busy} onClick={() => void run(async () => {
            if (status?.state === 'credential_store_unavailable') await connectionsService.retryMigration();
            return 'Connection status refreshed.';
        })}>Refresh connections</button>
    </section>;
}
