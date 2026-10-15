import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { AiConnection, AppSettings, ApiProvider } from '../../types';
import { connectionsService, type ConnectionInput, type ProxyTools, type ConnectionAuthStatus } from '../../services/connections';
import { useAiConnection } from '../../context/AiConnectionContext';

const choices = [
    ['openai', 'OpenAI'], ['cursor', 'Cursor'], ['kiro', 'Kiro'], ['anthropic', 'Anthropic'],
    ['gemini', 'Google Gemini'], ['ollama', 'Ollama'], ['openai_compatible', 'OpenAI compatible'],
    ['codex', 'Codex CLI'], ['claude_cli', 'Claude Code CLI'], ['gemini_cli', 'Gemini CLI'], ['opencode', 'OpenCode']
] as const;
const apiProviders = ['openai', 'anthropic', 'gemini', 'ollama', 'openai_compatible'];
const cliTool = (provider: string) => provider === 'claude_cli' ? 'claude' : provider === 'gemini_cli' ? 'gemini' : provider;
type Draft = { provider: string; method: 'chatgpt' | 'api_key'; name: string; model: string; baseUrl: string; apiKey: string };
const emptyDraft = (): Draft => ({ provider: 'openai', method: 'chatgpt', name: '', model: '', baseUrl: '', apiKey: '' });
function snapshot(connection?: AiConnection): Draft {
    if (!connection) return emptyDraft();
    const provider = connection.kind === 'chatgpt' ? 'openai' : connection.kind === 'api' ? connection.provider : connection.tool === 'claude' ? 'claude_cli' : connection.tool === 'gemini' ? 'gemini_cli' : connection.tool;
    return { provider, method: connection.kind === 'chatgpt' ? 'chatgpt' : 'api_key', name: connection.name, model: connection.model ?? '', baseUrl: connection.kind === 'api' ? connection.baseUrl ?? '' : '', apiKey: '' };
}
function describe(connection: AiConnection) {
    const provider = connection.kind === 'chatgpt' ? 'OpenAI · ChatGPT account' : connection.kind === 'api' ? choices.find(([id]) => id === connection.provider)?.[1] : connection.tool;
    return `${provider} · ${connection.model || 'Tool default model'}`;
}
const usage = <a className="text-accent underline" href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">Manage usage</a>;

export function AiConnectionEditor({ initialMode = 'closed', onClose, setupOnly = false }: { initialMode?: 'closed' | 'add'; onClose?: () => void; setupOnly?: boolean }) {
    const { refresh, status } = useAiConnection();
    const [connections, setConnections] = useState<AiConnection[]>([]);
    const [settings, setSettings] = useState<AppSettings | null>(null);
    const [draft, setDraft] = useState<Draft | null>(initialMode === 'add' ? emptyDraft() : null);
    const [baseline, setBaseline] = useState(JSON.stringify(emptyDraft()));
    const [editingId, setEditingId] = useState<string | null>(null);
    const [tested, setTested] = useState(false);
    const [tools, setTools] = useState<ProxyTools | null>(null);
    const [toolsError, setToolsError] = useState('');
    const [toolsLoading, setToolsLoading] = useState(false);
    const [models, setModels] = useState<string[]>([]);
    const [modelLabels, setModelLabels] = useState<Record<string, string>>({});
    const [auth, setAuth] = useState<ConnectionAuthStatus | null>(null);
    const [codexAuth, setCodexAuth] = useState<Awaited<ReturnType<typeof connectionsService.openAiAuthStatus>> | null>(null);
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const dialogRef = useRef<HTMLDialogElement>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const nameRef = useRef<HTMLInputElement>(null);
    const returnFocus = useRef<HTMLElement | null>(null);
    const mounted = useRef(true);
    const titleId = useId(), modelListId = useId();
    const kind = draft?.provider === 'openai' && draft.method === 'chatgpt' ? 'chatgpt' : draft && apiProviders.includes(draft.provider) ? 'api' : 'cli_proxy';
    const tool = draft ? cliTool(draft.provider) : '';
    const selected = connections.find(connection => connection.id === editingId);
    const dirty = draft !== null && JSON.stringify(draft) !== baseline;
    const active = connections.find(connection => connection.id === settings?.activeConnectionId);

    function trapFocus(event: KeyboardEvent<HTMLDialogElement>) {
        if (event.key !== 'Tab') return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], summary, [tabindex="0"]')).filter(element => element.getClientRects().length > 0);
        event.preventDefault();
        if (!controls.length) { event.currentTarget.focus(); return; }
        const index = controls.indexOf(document.activeElement as HTMLElement);
        controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
    }
    async function reload() {
        const [list, nextSettings] = await Promise.all([connectionsService.list(), connectionsService.getSettings()]);
        if (mounted.current) { setConnections(list); setSettings(nextSettings); }
    }
    async function loadTools() {
        setToolsLoading(true);
        try { const result = await connectionsService.proxyTools(); if (mounted.current) { setTools(result); setToolsError(''); } }
        catch (cause) { if (mounted.current) setToolsError(cause instanceof Error ? cause.message : 'Unable to load CLI tools'); }
        finally { if (mounted.current) setToolsLoading(false); }
    }
    useEffect(() => {
        mounted.current = true;
        void connectionsService.initialize().then(reload).catch(cause => { if (mounted.current) setError(cause.message); }).finally(() => { if (mounted.current) setBusy(false); });
        return () => { mounted.current = false; };
    }, []);
    useEffect(() => {
        if (!dirty) return;
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty]);
    const open = Boolean(draft);
    useEffect(() => {
        if (!open) return;
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        if (!returnFocus.current) returnFocus.current = document.activeElement as HTMLElement;
        const dialog = dialogRef.current;
        dialog?.showModal();
        nameRef.current?.focus();
        return () => { dialog?.close(); document.body.style.overflow = previous; };
    }, [open]);
    useEffect(() => { if (open && !busy && !editingId) nameRef.current?.focus(); }, [open, busy, editingId]);
    useEffect(() => { if (open && kind === 'cli_proxy') void loadTools(); }, [open, kind]);
    useEffect(() => {
        if (!open || !editingId || !(kind === 'chatgpt' || ['cursor', 'kiro'].includes(tool))) return;
        let cancelled = false, polling = false, pending = false;
        const check = async () => {
            if (polling) return; polling = true;
            try {
                const result = await connectionsService.authStatus(editingId);
                if (!cancelled) {
                    pending = result.state === 'pending';
                    setAuth(result);
                    if (result.state !== 'pending') setMessage(current => current === 'Complete ChatGPT sign-in in your browser.' ? '' : current);
                    if (kind === 'chatgpt' && result.state === 'authenticated') {
                        await reload();
                        const catalog = await connectionsService.models(editingId);
                        if (!cancelled) { setModels(catalog.models); setModelLabels(Object.fromEntries((catalog.options ?? []).map(option => [option.id, option.label]))); }
                    }
                }
            } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to check authentication'); }
            finally { polling = false; }
        };
        void check();
        const timer = setInterval(() => { if (pending && document.visibilityState === 'visible') void check(); }, 2000);
        return () => { cancelled = true; clearInterval(timer); };
    }, [open, editingId, kind, tool, auth?.state]);

    function patch(changes: Partial<Draft>) { setDraft(current => current ? { ...current, ...changes } : null); setTested(false); }
    function show(connection?: AiConnection, trigger?: HTMLElement) {
        if (dirty && !window.confirm('You have unsaved changes. Discard them?')) return;
        const next = snapshot(connection);
        returnFocus.current = trigger ?? document.activeElement as HTMLElement;
        setDraft(next); setBaseline(JSON.stringify(next)); setEditingId(connection?.id ?? null); setModels([]); setAuth(null); setCodexAuth(null); setError(''); setMessage('');
        setTested(Boolean(connection && settings?.activeConnectionId === connection.id && status?.state === 'configured'));
    }
    async function close() {
        if ((busy && settings) || (dirty && !window.confirm('You have unsaved changes. Discard them?'))) return;
        if (editingId && auth?.state === 'pending') {
            try { await connectionsService.cancelAuth(editingId); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to cancel sign-in'); return; }
        }
        setDraft(null); setEditingId(null); setError(''); setAuth(null);
        window.requestAnimationFrame(() => { returnFocus.current?.focus(); onClose?.(); });
    }
    async function run(action: () => Promise<string>) {
        const focus = document.activeElement as HTMLElement | null;
        setBusy(true); setError(''); setMessage('');
        try { const result = await action(); await reload(); await refresh(); if (mounted.current) setMessage(result); }
        catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Connection update failed'); }
        finally { if (mounted.current) { setBusy(false); window.requestAnimationFrame(() => { if (focus?.isConnected && !focus.hasAttribute('disabled')) focus.focus(); }); } }
    }
    async function saveDraft(): Promise<string> {
        if (!draft || !draft.name.trim()) throw new Error('Enter a connection name.');
        if (kind === 'api' && !draft.model.trim()) throw new Error('Enter the exact API model ID.');
        const model = draft.model.trim();
        const input: ConnectionInput = kind === 'chatgpt'
            ? { kind, name: draft.name.trim(), ...(model ? { model } : {}) }
            : kind === 'api'
                ? { kind, name: draft.name.trim(), provider: draft.provider as ApiProvider, model, ...(draft.baseUrl.trim() ? { baseUrl: draft.baseUrl.trim() } : {}) }
                : { kind, name: draft.name.trim(), tool, ...(model ? { model } : {}) };
        const connection = editingId ? await connectionsService.update(editingId, input) : await connectionsService.create(input);
        setEditingId(connection.id); setTested(false);
        const clean = { ...draft, name: draft.name.trim(), model, baseUrl: draft.baseUrl.trim(), apiKey: '' };
        setDraft(clean); setBaseline(JSON.stringify(clean));
        if (draft.apiKey.trim()) {
            try { await connectionsService.setCredential(connection.id, draft.apiKey.trim()); }
            catch (cause) { throw new Error(`Connection saved, but the key was not stored. Enter it again and retry. ${cause instanceof Error ? cause.message : ''}`); }
        }
        return connection.id;
    }
    async function testConnection(id: string) {
        const result = await connectionsService.test(id);
        if (result.ok === false || result.success === false) throw new Error(result.message || 'Connection test failed');
        if (id === editingId) setTested(true);
        return 'Connection test passed. You can now make it active.';
    }
    const keySupported = kind === 'api' && draft?.provider !== 'ollama' || kind === 'cli_proxy' && ['cursor', 'kiro'].includes(tool);
    const hasKey = selected && 'hasKey' in selected && selected.hasKey;

    return <section className="flex flex-col gap-4" aria-label="AI connections">
        {!setupOnly && <>
        <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h3 className="text-xl font-semibold">AI connections</h3><p className="text-sm text-text-secondary mt-1">{active ? `Active: ${active.name}` : 'Connect AI when you’re ready.'}</p>
                {active?.kind === 'chatgpt' && status?.state === 'configured' && <p className="text-sm mt-1">Using ChatGPT plan · {usage}</p>}
                {status?.connection && status.state !== 'configured' && <p role="status" className="text-sm text-text-secondary mt-1">{status.message}</p>}
            </div>
            <button type="button" className="btn-primary" disabled={busy} onClick={event => show(undefined, event.currentTarget)}>Add connection</button>
        </div>
        {!draft && error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
        {!draft && message && <p role="status" className="text-sm">{message}</p>}
        {!settings && <p role="status">Loading connections…</p>}
        {settings && !connections.length && <p className="text-sm text-text-secondary">No AI connections configured. You can use the tracker without AI.</p>}
        <div className="flex flex-col gap-2">{connections.map(connection => {
            const isActive = settings?.activeConnectionId === connection.id;
            return <div key={connection.id} data-testid="ai-connection-row" className="border border-border rounded-lg p-3 grid gap-3 sm:flex sm:items-center">
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-medium break-words">{connection.name}</p>{isActive && <span aria-label="Active connection" className="text-xs rounded-full border border-green-600 text-green-700 dark:text-green-300 px-2 py-0.5">Active</span>}</div><p className="text-sm text-text-secondary break-words">{describe(connection)}</p>{connection.kind === 'chatgpt' && connection.account && <p className="text-xs text-text-secondary break-words">{connection.account.email}</p>}</div>
                <div className="flex flex-wrap gap-2 items-center">
                    <button type="button" className="btn-secondary" disabled={busy} onClick={event => show(connection, event.currentTarget)}>Edit</button>
                    {!isActive && <button type="button" className="btn-secondary" disabled={busy} onClick={() => void run(async () => { await connectionsService.saveSettings({ version: 2, activeConnectionId: connection.id }); return `${connection.name} is active.`; })}>Make active</button>}
                    <details className="relative"><summary className="btn-secondary cursor-pointer" aria-label={`More actions for ${connection.name}`}>More</summary><div className="absolute right-0 z-10 mt-1 p-2 bg-surface border border-border rounded-lg shadow-lg flex flex-col gap-2 min-w-36">
                        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void run(() => testConnection(connection.id))}>Test</button>
                        <button type="button" className="text-red-600 dark:text-red-400 p-2" disabled={busy} onClick={() => { if (window.confirm(`Delete connection “${connection.name}” and its stored credential?`)) void run(async () => { const result = await connectionsService.remove(connection.id); return result?.message ?? 'Connection deleted.'; }); }}>Delete</button>
                    </div></details>
                </div>
            </div>;
        })}</div>
        <details><summary className="text-sm text-text-secondary cursor-pointer w-fit">Connection options</summary><div className="flex flex-wrap gap-3 mt-3">
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => void run(async () => { if (status?.state === 'credential_store_unavailable') await connectionsService.retryMigration(); return 'Connection status refreshed.'; })}>Refresh connections</button>
            <button type="button" className="btn-secondary" disabled={busy || !settings?.activeConnectionId} onClick={() => void run(async () => { await connectionsService.saveSettings({ version: 2, activeConnectionId: null }); return 'AI disabled. You can continue using the tracker.'; })}>Use without AI</button>
        </div></details>
        </>}
        {draft && <dialog ref={dialogRef} tabIndex={-1} onKeyDown={trapFocus} aria-labelledby={titleId} className="m-auto w-[calc(100%-2rem)] max-w-[640px] max-h-[90dvh] overflow-y-auto rounded-xl border border-border bg-surface text-text-primary p-0 shadow-2xl backdrop:bg-black/50" onCancel={event => { event.preventDefault(); void close(); }} onClick={event => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) void close(); } }}>
            <form ref={formRef} className="p-4 sm:p-6 flex flex-col gap-4" onSubmit={event => { event.preventDefault(); void run(async () => { await saveDraft(); return 'Connection saved. Test it, then choose “Make active” to use it for AI features.'; }); }}>
                <div className="flex items-center justify-between gap-3"><h4 id={titleId} className="text-xl font-semibold">{editingId ? 'Edit connection' : 'Add connection'}</h4><button type="button" className="btn-secondary" disabled={busy && Boolean(settings)} aria-label="Close connection dialog" onClick={() => void close()}>×</button></div>
                {busy && <p role="status" className="text-sm text-text-secondary">{settings ? 'Updating connection…' : 'Loading connections…'}</p>}
                {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}{kind === 'chatgpt' && <> {usage}</>}</p>}
                {message && <p role="status" className="text-sm">{message}</p>}
                <fieldset disabled={busy || !settings} className="flex flex-col gap-4">
                    <label>Provider<select aria-label="Provider" className="input mt-1" value={draft.provider} disabled={Boolean(editingId)} onChange={event => { patch({ provider: event.target.value, method: event.target.value === 'openai' ? 'chatgpt' : 'api_key', model: '', baseUrl: '', apiKey: '' }); setModels([]); setAuth(null); }}>
                        {choices.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                    </select></label>
                    {draft.provider === 'openai' && <label>Authentication<select aria-label="Authentication" className="input mt-1" value={draft.method} disabled={Boolean(editingId)} onChange={event => { patch({ method: event.target.value as Draft['method'], model: '', apiKey: '' }); setModels([]); }}><option value="chatgpt">ChatGPT account</option><option value="api_key">API key</option></select></label>}
                    {editingId && <p className="text-xs text-text-secondary">Provider and authentication are locked after creation. Create another connection to change them.</p>}
                    <label>Name<input ref={nameRef} className="input mt-1" required maxLength={100} value={draft.name} onChange={event => patch({ name: event.target.value })} /></label>
                    {kind === 'chatgpt' && <div className="rounded-lg border border-border p-3 flex flex-col gap-2">
                        <p className="text-sm">Use your eligible ChatGPT plan for AI requests in this app.</p>
                        <p role="status" className="text-sm text-text-secondary">{auth?.message ?? 'Continue with ChatGPT to connect your account.'}</p>
                        {auth?.account && <p className="text-sm break-words">{auth.account.email} · {auth.account.planUsageEnabled ? 'Using ChatGPT plan' : 'Plan usage disabled'} · {usage}</p>}
                        <div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary !bg-black !text-white hover:!bg-neutral-800" disabled={auth?.state === 'pending'} onClick={() => { if (formRef.current?.reportValidity()) void run(async () => { const id = editingId && !dirty ? editingId : await saveDraft(); setAuth(await connectionsService.startAuth(id)); return 'Complete ChatGPT sign-in in your browser.'; }); }}>Continue with ChatGPT</button>
                            {auth?.state === 'pending' && <button type="button" className="btn-secondary" onClick={() => void run(async () => { setAuth(await connectionsService.cancelAuth(editingId!)); return 'Sign-in cancelled.'; })}>Cancel sign-in</button>}
                            {selected?.kind === 'chatgpt' && selected.hasSession && <button type="button" className="text-red-600 dark:text-red-400" onClick={() => void run(async () => { const result = await connectionsService.disconnectAuth(editingId!); setAuth(result); setTested(false); return result.message; })}>Disconnect account</button>}
                        </div>
                        {auth?.authorizationUrl && <a className="text-sm text-accent underline" href={auth.authorizationUrl} target="_blank" rel="noreferrer">Open sign-in page</a>}
                    </div>}
                    {(kind !== 'cli_proxy' || tools?.toolDetails.find(detail => detail.id === tool)?.capabilities.model !== false) && <label>{kind === 'cli_proxy' ? 'Model (optional)' : 'Model'}<input className="input mt-1" required={kind === 'api'} list={modelListId} value={draft.model} onChange={event => patch({ model: event.target.value })} placeholder={kind === 'cli_proxy' ? 'Leave blank to use the tool default' : kind === 'chatgpt' ? 'Choose an available model after sign-in' : 'Enter the exact model ID'} /></label>}
                    <datalist id={modelListId}>{models.map(model => <option key={model} value={model} label={modelLabels[model] ?? model} />)}</datalist>
                    {editingId && kind !== 'cli_proxy' && <button type="button" className="text-sm text-accent text-left" onClick={() => void run(async () => { const result = await connectionsService.models(editingId); setModels(result.models); setModelLabels(Object.fromEntries((result.options ?? []).map(option => [option.id, option.label]))); return result.supported ? 'Models loaded. Choose a suggestion or enter a model ID.' : 'Model discovery is unavailable. Enter an explicit model ID.'; })}>Load models</button>}
                    {kind === 'api' && ['ollama', 'openai_compatible'].includes(draft.provider) && <label>Base URL<input className="input mt-1" type="url" required={draft.provider === 'openai_compatible'} value={draft.baseUrl} onChange={event => patch({ baseUrl: event.target.value })} placeholder={draft.provider === 'ollama' ? 'http://localhost:11434' : 'https://api.example.com/v1'} /></label>}
                    {keySupported && <>
                        <label>API key {hasKey ? '(stored; leave blank to keep)' : tool === 'kiro' ? '(optional fallback)' : kind === 'api' ? '(required before testing)' : '(or use your CLI account)'}<input className="input mt-1" type="password" autoComplete="new-password" value={draft.apiKey} onChange={event => patch({ apiKey: event.target.value })} placeholder="Enter a new key" /></label>
                        <p className="text-xs text-text-secondary">Stored securely in macOS Keychain. The key is never displayed here.</p>
                        {hasKey && <button type="button" className="text-red-600 dark:text-red-400 text-left text-sm" onClick={() => { if (window.confirm('Remove the stored API key for this connection?')) void run(async () => { await connectionsService.removeCredential(editingId!); patch({ apiKey: '' }); return 'Stored credential removed.'; }); }}>Remove stored key</button>}
                    </>}
                    {kind === 'cli_proxy' && <>
                        {toolsError && <div role="alert" className="flex flex-wrap gap-2 items-center"><p className="text-sm">CLI tools unavailable: {toolsError}</p><button type="button" className="btn-secondary" disabled={toolsLoading} onClick={() => void loadTools()}>Retry</button></div>}
                        {toolsLoading && <p role="status" className="text-sm">Loading CLI tools…</p>}
                        {['cursor', 'kiro'].includes(tool) && <div className="text-sm"><p role="status">{auth?.message ?? 'Use an API key or your existing official CLI account.'}</p>{editingId && <button type="button" className="text-accent mt-2" onClick={() => void run(async () => { setAuth(await connectionsService.authStatus(editingId)); return 'Authentication status checked.'; })}>Check status</button>}</div>}
                        {tool === 'codex' && <div className="text-sm flex flex-col gap-2"><p className="font-medium">OpenAI sign-in</p><p role="status">{codexAuth?.message ?? 'Use the existing Codex CLI account, or connect ChatGPT directly through OpenAI.'}</p><div className="flex flex-wrap gap-3"><button type="button" className="btn-secondary" onClick={() => void run(async () => { setCodexAuth(await connectionsService.startOpenAiAuth()); return 'Codex sign-in started.'; })}>Sign in with OpenAI</button><button type="button" className="text-accent" onClick={() => void run(async () => { setCodexAuth(await connectionsService.openAiAuthStatus()); return 'Codex status checked.'; })}>Check status</button>{codexAuth?.state === 'authenticated' && <button type="button" className="text-red-600 dark:text-red-400" onClick={() => void run(async () => { setCodexAuth(await connectionsService.logoutOpenAiAuth()); return 'Codex signed out.'; })}>Sign out</button>}</div></div>}
                        <details><summary className="text-sm text-text-secondary cursor-pointer">CLI setup and capabilities</summary><div className="text-sm text-text-secondary mt-2 space-y-2"><p>Install the official {tool === 'kiro' ? 'Kiro' : tool} CLI on the machine running the companion proxy.</p><p className="whitespace-pre-wrap">{tools?.toolDetails.find(detail => detail.id === tool)?.authenticationInstructions ?? `Sign in using the official ${tool} CLI, then test the connection.`}</p>{tool === 'kiro' && <p>Run <code>kiro-cli login</code> to sign in. The CLI account takes priority over a key; no shared account is signed out by this app.</p>}<p>Images: unsupported · Streaming: supported</p>{tools?.toolDetails.find(detail => detail.id === tool)?.available === false && <p role="alert">This CLI is unavailable. Install it and retry.</p>}</div></details>
                    </>}
                    {draft.provider === 'ollama' && <p className="text-sm text-text-secondary">Ollama does not require an API key. Make sure it is running.</p>}
                    <div className="flex flex-wrap gap-2 items-center pt-2 border-t border-border"><button type="submit" className="btn-primary">{editingId ? 'Save changes' : 'Create connection'}</button>
                        {editingId && <><button type="button" className="btn-secondary" disabled={dirty || auth?.state === 'pending' || kind === 'chatgpt' && (!selected?.model || auth?.state !== 'authenticated')} onClick={() => void run(() => testConnection(editingId))}>Test connection</button><button type="button" className="btn-secondary" disabled={dirty || !tested} onClick={() => void run(async () => { await connectionsService.saveSettings({ version: 2, activeConnectionId: editingId }); return `${draft.name} is active.`; })}>Make active</button></>}
                        <button type="button" className="btn-secondary" onClick={() => void close()}>{editingId && !dirty ? 'Done' : 'Cancel'}</button>
                    </div>
                    <p className="text-xs text-text-secondary">Tests send a small inference request and can consume usage.</p>
                </fieldset>
            </form>
        </dialog>}
    </section>;
}
