import React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Lightbulb, Settings, Sparkles } from 'lucide-react';

export const Layout: React.FC = () => {
    const location = useLocation();

    const isActive = (path: string) => location.pathname === path;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
            <header style={{
                padding: '16px',
                borderBottom: '1px solid var(--color-border)',
                backgroundColor: 'var(--color-surface)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
            }}>
                <h1 style={{ margin: 0, fontSize: '1.2rem' }}>Startup Tracker</h1>
                <nav style={{ display: 'flex', gap: '16px' }}>
                    <Link to="/" style={{ color: isActive('/') ? 'var(--color-accent)' : 'var(--color-text-secondary)' }}>
                        <Lightbulb size={24} />
                    </Link>
                    <Link to="/generate" style={{ color: isActive('/generate') ? 'var(--color-accent)' : 'var(--color-text-secondary)' }}>
                        <Sparkles size={24} />
                    </Link>
                    <Link to="/settings" style={{ color: isActive('/settings') ? 'var(--color-accent)' : 'var(--color-text-secondary)' }}>
                        <Settings size={24} />
                    </Link>
                </nav>
            </header>

            <main style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
                <Outlet />
            </main>
        </div>
    );
};
