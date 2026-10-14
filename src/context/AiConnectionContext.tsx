import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { connectionsService, type AiStatus } from '../services/connections';

interface AiConnectionValue {
    status: AiStatus | null;
    ready: boolean;
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
}

const AiConnectionContext = createContext<AiConnectionValue | undefined>(undefined);

export function AiConnectionProvider({ children }: { children: ReactNode }) {
    const [status, setStatus] = useState<AiStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const generation = useRef(0);
    const refresh = useCallback(async () => {
        const current = ++generation.current;
        setLoading(true);
        setError(null);
        try {
            await connectionsService.initialize();
            const next = await connectionsService.status();
            if (current === generation.current) setStatus(next);
        } catch (cause) {
            if (current === generation.current) {
                setStatus(null);
                setError(cause instanceof Error ? cause.message : 'Unable to load AI connection');
            }
        } finally {
            if (current === generation.current) setLoading(false);
        }
    }, []);
    useEffect(() => { void refresh(); return () => { generation.current++; }; }, [refresh]);
    return <AiConnectionContext.Provider value={{ status, ready: !loading && !error && status?.state === 'configured' && Boolean(status.connection), loading, error, refresh }}>
        {children}
    </AiConnectionContext.Provider>;
}

export function useAiConnection() {
    const context = useContext(AiConnectionContext);
    if (!context) throw new Error('useAiConnection must be used within AiConnectionProvider');
    return context;
}
