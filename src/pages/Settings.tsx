import React, { useEffect, useState } from 'react';
import { dbService } from '../services/db';
import { AppSettings } from '../types';

export const SettingsPage: React.FC = () => {
    const [settings, setSettings] = useState<AppSettings>({
        provider: 'gemini',
        geminiKey: '',
        ollamaEndpoint: 'http://localhost:11434',
        ollamaModel: 'llama3'
    });
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        dbService.getSettings().then(setSettings);
    }, []);

    const handleChange = (field: keyof AppSettings, value: string) => {
        setSettings(prev => ({ ...prev, [field]: value }));
        setSaved(false);
    };

    const save = async () => {
        await dbService.saveSettings(settings);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    return (
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '24px' }}>Settings</h2>

            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>AI Provider</label>
                    <div className="flex-stack-mobile">
                        <label style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <input
                                type="radio"
                                checked={settings.provider === 'gemini'}
                                onChange={() => handleChange('provider', 'gemini')}
                            />
                            Google Gemini
                        </label>
                        <label style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <input
                                type="radio"
                                checked={settings.provider === 'ollama'}
                                onChange={() => handleChange('provider', 'ollama')}
                            />
                            Ollama (Local)
                        </label>
                    </div>
                </div>

                {settings.provider === 'gemini' ? (
                    <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>Gemini API Key</label>
                        <input
                            className="input"
                            type="password"
                            value={settings.geminiKey}
                            onChange={(e) => handleChange('geminiKey', e.target.value)}
                            placeholder="Enter your API Key"
                        />
                    </div>
                ) : (
                    <>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>Ollama Endpoint</label>
                            <input
                                className="input"
                                type="text"
                                value={settings.ollamaEndpoint}
                                onChange={(e) => handleChange('ollamaEndpoint', e.target.value)}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>Model Name</label>
                            <input
                                className="input"
                                type="text"
                                value={settings.ollamaModel}
                                onChange={(e) => handleChange('ollamaModel', e.target.value)}
                            />
                        </div>
                    </>
                )}

                <div style={{ paddingTop: '16px', borderTop: '1px solid var(--color-border)' }}>
                    <h3 style={{ fontSize: '1.2rem', marginBottom: '16px' }}>Data Management</h3>
                    <div className="flex-stack-mobile">
                        <button
                            className="btn-primary"
                            onClick={async () => {
                                const json = await dbService.exportAllData();
                                const blob = new Blob([json], { type: 'application/json' });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = `startup_ideas_backup_${new Date().toISOString().split('T')[0]}.json`;
                                a.click();
                            }}
                        >
                            Export Backup
                        </button>

                        <label className="btn-primary" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            Import Backup
                            <input
                                type="file"
                                accept=".json"
                                style={{ display: 'none' }}
                                onChange={async (e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                        const text = await file.text();
                                        try {
                                            await dbService.importData(text);
                                            alert('Data imported successfully! Reloading...');
                                            window.location.reload();
                                        } catch (err) {
                                            alert('Failed to import data');
                                        }
                                    }
                                }}
                            />
                        </label>
                    </div>
                </div>

                <div style={{ paddingTop: '16px', borderTop: '1px solid var(--color-border)' }}>
                    <button className="btn-primary" onClick={save}>
                        {saved ? 'Saved!' : 'Save Settings'}
                    </button>
                </div>
            </div>
        </div>
    );
};
