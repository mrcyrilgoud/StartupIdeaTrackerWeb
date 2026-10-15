import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAiConnection } from '../context/AiConnectionContext';
import { AiConnectionEditor } from './settings/AiConnectionEditor';

export function AiSetupNotice() {
    const { status, ready, loading, error, refresh } = useAiConnection();
    const [editing, setEditing] = useState(false);
    const [continued, setContinued] = useState(false);
    if (loading) return <p className="text-sm text-text-secondary mb-4" role="status">Checking AI connection…</p>;
    if (ready) return null;
    return <aside className="card mb-4" aria-label="AI setup">
        <p className="font-medium">{error ? 'Unable to check AI connection' : status?.connection ? 'AI connection needs attention' : 'Set up AI when you’re ready'}</p>
        <p className="text-sm text-text-secondary mt-1">{error || status?.message || 'Connect an API provider or an authenticated local CLI to use AI features. Your ideas remain available without AI.'}</p>
        <div className="flex flex-wrap gap-3 mt-3 items-center">
            <Link className="text-accent" to="/settings">AI settings</Link>
            {!continued && !status?.connection && <>
                <button type="button" className="btn-primary" onClick={() => setEditing(value => !value)}>{editing ? 'Close setup' : 'Set up AI'}</button>
                <button type="button" className="text-sm text-accent" onClick={() => { setContinued(true); setEditing(false); }}>Continue without AI</button>
            </>}
            {(error || status?.connection) && <button type="button" className="text-sm text-accent" onClick={() => void refresh()}>Retry</button>}
        </div>
        {editing && <div className="mt-4 border-t border-border pt-4"><AiConnectionEditor initialMode="add" setupOnly onClose={() => setEditing(false)} /></div>}
    </aside>;
}
