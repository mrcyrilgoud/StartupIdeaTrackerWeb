import React, { useState } from 'react';
import { dbService } from '../services/db';
import { connectionsService } from '../services/connections';
import { useTheme } from '../context/ThemeContext';
import { AiConnectionEditor } from '../components/settings/AiConnectionEditor';
import { Sun, Moon, Monitor } from 'lucide-react';

export const SettingsPage: React.FC = () => {
    const { theme, setTheme } = useTheme();
    const [dataBusy, setDataBusy] = useState(false);
    const [dataError, setDataError] = useState('');
    const [dataMessage, setDataMessage] = useState('');

    async function exportBackup() {
        setDataBusy(true); setDataError(''); setDataMessage('');
        try {
            const json = await dbService.exportAllData();
            const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `startup_ideas_backup_${new Date().toISOString().split('T')[0]}.json`;
            anchor.click();
            URL.revokeObjectURL(url);
            setDataMessage('Backup exported.');
        } catch (cause) {
            setDataError(cause instanceof Error ? cause.message : 'Failed to export backup');
        } finally { setDataBusy(false); }
    }

    async function importBackup(file: File) {
        setDataBusy(true); setDataError(''); setDataMessage('');
        try {
            const payload: unknown = JSON.parse(await file.text());
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid backup file');
            const backup = payload as Record<string, unknown>;
            const legacySettings = backup.settings;
            const hasLegacyKey = legacySettings && typeof legacySettings === 'object'
                && 'geminiKey' in legacySettings && typeof legacySettings.geminiKey === 'string'
                && Boolean(legacySettings.geminiKey.trim())
                && (!('version' in legacySettings) || legacySettings.version === 1);
            const importCredentials = Boolean(hasLegacyKey) && window.confirm(
                'This legacy backup contains a Gemini API key. Import this credential into the backend? Choose Cancel to import the data without the key.'
            );
            const importPayload = hasLegacyKey && !importCredentials
                ? { ...backup, settings: { ...legacySettings as Record<string, unknown>, geminiKey: '' } }
                : backup;
            await connectionsService.importBackup(importPayload, importCredentials);
            window.alert('Data imported successfully! Reloading...');
            window.location.reload();
        } catch (cause) {
            setDataError(cause instanceof Error ? cause.message : 'Failed to import backup');
        } finally { setDataBusy(false); }
    }

    return (
        <div className="max-w-[760px] mx-auto pb-12">
            <h2 className="text-2xl font-bold mb-6">Settings</h2>
            <div className="card flex flex-col gap-4">
                <section>
                    <h3 className="text-xl mb-4 font-semibold">Appearance</h3>
                    <div className="flex bg-background border border-border p-1 rounded-xl w-full sm:w-fit">
                        {([
                            { value: 'light', label: 'Light', Icon: Sun },
                            { value: 'dark', label: 'Dark', Icon: Moon },
                            { value: 'system', label: 'System', Icon: Monitor }
                        ] as const).map(({ value, label, Icon }) => (
                            <button key={value} type="button" aria-pressed={theme === value}
                                onClick={() => setTheme(value)}
                                className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${theme === value
                                    ? 'bg-white dark:bg-slate-700 shadow-sm text-accent'
                                    : 'text-text-secondary hover:text-text-primary'}`}>
                                <Icon size={18} /> {label}
                            </button>
                        ))}
                    </div>
                </section>
                <div className="pt-4 border-t border-border"><AiConnectionEditor /></div>
                <section className="pt-4 border-t border-border">
                    <h3 className="text-xl mb-4 font-semibold">Data Management</h3>
                    {dataError && <p role="alert" className="text-red-600 dark:text-red-400 mb-3">{dataError}</p>}
                    {dataMessage && <p role="status" className="mb-3">{dataMessage}</p>}
                    <div className="flex flex-col gap-4 sm:flex-row">
                        <button type="button" className="btn-primary" disabled={dataBusy} onClick={() => void exportBackup()}>Export Backup</button>
                        <label className={`btn-primary bg-surface border border-border text-text-primary hover:bg-background cursor-pointer flex items-center justify-center ${dataBusy ? 'opacity-50' : ''}`}>
                            Import Backup
                            <input type="file" accept=".json,application/json" className="hidden" disabled={dataBusy}
                                onChange={event => {
                                    const file = event.target.files?.[0];
                                    event.target.value = '';
                                    if (file) void importBackup(file);
                                }} />
                        </label>
                    </div>
                </section>
            </div>
        </div>
    );
};
