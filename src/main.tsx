import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { ThemeProvider } from './context/ThemeContext'

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ThemeProvider>
            <App />
        </ThemeProvider>
    </React.StrictMode>,
)

// Service-worker checks are useful after startup, but should not compete with
// the first render for module evaluation or network capacity.
const scheduleIdle = window.requestIdleCallback ?? ((callback: IdleRequestCallback) => window.setTimeout(callback, 0));
scheduleIdle(() => {
    void import('virtual:pwa-register').then(({ registerSW }) => {
        const updateSW = registerSW({
            onNeedRefresh() {
                if (confirm('New content available. Reload?')) {
                    void updateSW(true)
                }
            },
        });
    });
});
