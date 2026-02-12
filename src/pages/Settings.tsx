import React, { useEffect, useState } from 'react';
import { dbService } from '../services/db';
import { AppSettings } from '../types';
import { useTheme } from '../context/ThemeContext';
import { Sun, Moon, Monitor, FolderInput } from 'lucide-react';

export const SettingsPage: React.FC = () => {
    const { theme, setTheme } = useTheme();
    const [settings, setSettings] = useState<AppSettings>({
        provider: 'gemini',
        geminiKey: '',
        ollamaEndpoint: 'http://localhost:11434',
        ollamaModel: 'llama3',
        editorCommand: 'cursor',
        agentProvider: 'custom',
        agentCommand: '',
        projectsBaseDir: '../'
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
        <div className="max-w-[600px] mx-auto">
            <h2 className="text-2xl font-bold mb-6">Settings</h2>

            <div className="card flex flex-col gap-4">
                <div>
                    <h3 className="text-xl mb-4 font-semibold">Appearance</h3>
                    <div className="flex bg-background border border-border p-1 rounded-xl w-full sm:w-fit">
                        <button
                            onClick={() => setTheme('light')}
                            className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${theme === 'light'
                                ? 'bg-white shadow-sm text-accent'
                                : 'text-text-secondary hover:text-text-primary'
                                }`}
                        >
                            <Sun size={18} /> Light
                        </button>
                        <button
                            onClick={() => setTheme('dark')}
                            className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${theme === 'dark'
                                ? 'bg-slate-700 shadow-sm text-white'
                                : 'text-text-secondary hover:text-text-primary'
                                }`}
                        >
                            <Moon size={18} /> Dark
                        </button>
                        <button
                            onClick={() => setTheme('system')}
                            className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${theme === 'system'
                                ? 'bg-white dark:bg-slate-700 shadow-sm text-accent'
                                : 'text-text-secondary hover:text-text-primary'
                                }`}
                        >
                            <Monitor size={18} /> System
                        </button>
                    </div>
                </div>

                <div className="pt-4 border-t border-border">
                    <label className="block mb-2 font-medium">AI Provider</label>
                    <div className="flex flex-col gap-4 sm:flex-row">
                        <label className="flex gap-2 items-center cursor-pointer">
                            <input
                                type="radio"
                                checked={settings.provider === 'gemini'}
                                onChange={() => handleChange('provider', 'gemini')}
                                className="accent-accent"
                            />
                            Google Gemini
                        </label>
                        <label className="flex gap-2 items-center cursor-pointer">
                            <input
                                type="radio"
                                checked={settings.provider === 'ollama'}
                                onChange={() => handleChange('provider', 'ollama')}
                                className="accent-accent"
                            />
                            Ollama (Local)
                        </label>
                    </div>
                </div>

                {settings.provider === 'gemini' ? (
                    <div>
                        <label className="block mb-2 font-medium">Gemini API Key</label>
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
                            <label className="block mb-2 font-medium">Ollama Endpoint</label>
                            <input
                                className="input"
                                type="text"
                                value={settings.ollamaEndpoint}
                                onChange={(e) => handleChange('ollamaEndpoint', e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block mb-2 font-medium">Model Name</label>
                            <input
                                className="input"
                                type="text"
                                value={settings.ollamaModel}
                                onChange={(e) => handleChange('ollamaModel', e.target.value)}
                            />
                        </div>
                    </>
                )}

                <div className="pt-4 border-t border-border">
                    <h3 className="text-xl mb-4 font-semibold">Local Agent Integration</h3>
                    <div className="flex flex-col gap-4">
                        <div>
                            <label className="block mb-2 font-medium">Projects Base Directory</label>
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-secondary">
                                        <FolderInput size={18} />
                                    </div>
                                    <input
                                        className="input pl-10"
                                        type="text"
                                        value={settings.projectsBaseDir || '../'}
                                        readOnly
                                        placeholder="/Users/name/startups/"
                                    />
                                </div>
                                <button
                                    className="btn-primary whitespace-nowrap"
                                    onClick={async () => {
                                        const path = await dbService.selectBaseDirectory();
                                        if (path) {
                                            handleChange('projectsBaseDir', path);
                                        }
                                    }}
                                >
                                    Browse...
                                </button>
                            </div>
                            <p className="text-xs text-text-secondary mt-1">Default location where new project folders will be created.</p>
                        </div>
                        <div>
                            <label className="block mb-2 font-medium">Editor Command</label>
                            <input
                                className="input"
                                type="text"
                                value={settings.editorCommand || 'cursor'}
                                onChange={(e) => handleChange('editorCommand', e.target.value)}
                                placeholder="code, cursor, atom, etc."
                            />
                            <p className="text-xs text-text-secondary mt-1">Command to open your editor (e.g. <code>code .</code> or <code>cursor .</code>)</p>
                        </div>

                        <div>
                            <label className="block mb-2 font-medium">Agent Provider</label>
                            <select
                                className="input"
                                value={settings.agentProvider || 'custom'}
                                onChange={(e) => {
                                    const provider = e.target.value as any;
                                    let defaultCommand = settings.agentCommand;

                                    switch (provider) {
                                        case 'opencode':
                                            defaultCommand = 'opencode run "Build MVP from PROMPT.md"';
                                            break;
                                        case 'aider':
                                            defaultCommand = 'aider --message "Build MVP from PROMPT.md" --auto-commits --test-cmd "npm run build"';
                                            break;
                                        case 'goose':
                                            defaultCommand = 'goose run --instruction-file PROMPT.md';
                                            break;
                                        case 'gemini':
                                            defaultCommand = 'gemini prompt PROMPT.md';
                                            break;
                                        case 'copilot':
                                            defaultCommand = 'gh copilot suggest -t shell < PROMPT.md';
                                            break;
                                    }
                                    setSettings(prev => ({ ...prev, agentProvider: provider, agentCommand: defaultCommand }));
                                    setSaved(false);
                                }}
                            >
                                <option value="custom">Custom</option>
                                <option value="opencode">OpenCode</option>
                                <option value="aider">Aider</option>
                                <option value="goose">Goose</option>
                                <option value="gemini">Gemini CLI</option>
                                <option value="copilot">GitHub Copilot CLI</option>
                            </select>
                        </div>

                        <div>
                            <label className="block mb-2 font-medium">Agent Launch Command</label>
                            <input
                                className="input"
                                type="text"
                                value={settings.agentCommand || ''}
                                onChange={(e) => handleChange('agentCommand', e.target.value)}
                                placeholder="Command to run agent..."
                            />
                            <p className="text-xs text-text-secondary mt-1">
                                This command will be executed in a new Terminal window. Ensure the tool is installed in your PATH.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="pt-4 border-t border-border">
                    <h3 className="text-xl mb-4 font-semibold">Data Management</h3>
                    <div className="flex flex-col gap-4 sm:flex-row">
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

                        <label className="btn-primary bg-surface border border-border text-text-primary hover:bg-background cursor-pointer flex items-center justify-center">
                            Import Backup
                            <input
                                type="file"
                                accept=".json"
                                className="hidden"
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
                <div className="pt-4 border-t border-border">
                    <button className="btn-primary" onClick={save}>
                        {saved ? 'Saved!' : 'Save Settings'}
                    </button>
                </div>
            </div>
        </div>
    );
};
