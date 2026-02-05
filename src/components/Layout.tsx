import React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Lightbulb, Settings, Sparkles, Gamepad2 } from 'lucide-react';

export const Layout: React.FC = () => {
    const location = useLocation();

    const isActive = (path: string) => location.pathname === path;

    return (
        <div className="flex flex-col h-screen bg-background">
            <header className="px-6 py-4 glass-panel flex justify-between items-center shadow-sm">
                <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity" title="Back to Home">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-purple-600 flex items-center justify-center text-white shadow-lg shadow-accent/20">
                        <Sparkles size={18} fill="currentColor" />
                    </div>
                    <h1 className="m-0 text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-text-primary to-text-secondary">
                        Startup Tracker
                    </h1>
                </Link>
                <nav className="flex gap-2 bg-background/50 p-1 rounded-2xl border border-border/50">
                    <Link
                        to="/"
                        className={`p-2 rounded-xl transition-all duration-200 ${isActive('/')
                            ? 'bg-white dark:bg-slate-700 text-accent shadow-sm'
                            : 'text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/5'
                            }`}
                        title="Home"
                    >
                        <Lightbulb size={20} className={isActive('/') ? "fill-current" : ""} />
                    </Link>
                    <Link
                        to="/generate"
                        className={`p-2 rounded-xl transition-all duration-200 ${isActive('/generate')
                            ? 'bg-white dark:bg-slate-700 text-accent shadow-sm'
                            : 'text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/5'
                            }`}
                        title="Generator"
                    >
                        <Sparkles size={20} className={isActive('/generate') ? "fill-current" : ""} />
                    </Link>
                    <Link
                        to="/spark"
                        className={`p-2 rounded-xl transition-all duration-200 ${isActive('/spark')
                            ? 'bg-white dark:bg-slate-700 text-accent shadow-sm'
                            : 'text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/5'
                            }`}
                        title="Idea Spark Game"
                    >
                        <Gamepad2 size={20} className={isActive('/spark') ? "fill-current" : ""} />
                    </Link>
                    <Link
                        to="/settings"
                        className={`p-2 rounded-xl transition-all duration-200 ${isActive('/settings')
                            ? 'bg-white dark:bg-slate-700 text-accent shadow-sm'
                            : 'text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/5'
                            }`}
                        title="Settings"
                    >
                        <Settings size={20} className={isActive('/settings') ? "fill-current" : ""} />
                    </Link>
                </nav>
            </header>

            <main className="flex-1 overflow-auto p-4">
                <Outlet />
            </main>
        </div>
    );
};
