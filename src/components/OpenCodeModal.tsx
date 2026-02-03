import React, { useState, useEffect } from 'react';
import { Terminal, Copy, Check, X, FolderInput } from 'lucide-react';
import { Idea } from '../types';

interface OpenCodeModalProps {
    isOpen: boolean;
    onClose: () => void;
    idea: Idea;
}

export const OpenCodeModal: React.FC<OpenCodeModalProps> = ({ isOpen, onClose, idea }) => {
    const [copied, setCopied] = useState(false);

    // State for user inputs
    const [projectName, setProjectName] = useState('');
    const [parentPath, setParentPath] = useState('../');
    const [includeDirectorySetup, setIncludeDirectorySetup] = useState(true);

    // Initialize project name from idea title when modal opens
    useEffect(() => {
        if (isOpen && idea.title) {
            const sanitized = idea.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            setProjectName(`${sanitized}-mvp`);
        }
    }, [isOpen, idea.title]);

    if (!isOpen) return null;

    const fullPath = `${parentPath.replace(/\/$/, '')}/${projectName}`;

    const directoryInstructions = includeDirectorySetup
        ? `   - Create a new directory at: '${fullPath}'
   - Initialize the project in that directory.`
        : `   - Initialize the project in the current directory.`;

    const prompt = `I have a startup idea I want to build as a LOCAL MVP.

Title: ${idea.title}
Details: ${idea.details}
Keywords: ${idea.keywords.join(', ')}

Please act as a Senior Software Engineer and help me build this.

1. ANALYZE FOR LOCAL EXECUTION:
   - Determine the best technical approach for a standalone, locally-running prototype.
   - Use local alternatives for infrastructure (e.g., SQLite/JSON instead of cloud DBs).
   - If AI is required, prefer local LLMs (Ollama) or minimal API usage.

2. EXECUTE BUILD PLAN:
   - Create a build plan.
${directoryInstructions}
   - Start scaffolding and building the MVP immediately.`;

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(prompt);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy text: ', err);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-[1000] backdrop-blur-[4px]">
            <div className="bg-surface rounded-2xl max-w-[600px] w-[90%] max-h-[90vh] flex flex-col p-6 animate-slideIn relative shadow-xl border border-border/50">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 bg-transparent border-none cursor-pointer text-text-secondary"
                >
                    <X size={20} />
                </button>

                <div className="flex items-center gap-3 mb-6">
                    <div className="bg-black/5 p-2.5 rounded-full text-text-primary">
                        <Terminal size={24} />
                    </div>
                    <div>
                        <h3 className="m-0 text-xl font-bold">Build with OpenCode</h3>
                        <p className="m-0 mt-1 text-sm text-text-secondary">
                            Generate a prompt to kickstart your local MVP.
                        </p>
                    </div>
                </div>

                <div className="mb-5 flex flex-col gap-3">
                    <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-text-primary">
                        <input
                            type="checkbox"
                            checked={includeDirectorySetup}
                            onChange={(e) => setIncludeDirectorySetup(e.target.checked)}
                            className="w-[18px] h-[18px] cursor-pointer accent-accent"
                        />
                        Include directory setup instructions
                    </label>

                    {includeDirectorySetup && (
                        <>
                            <div>
                                <label className="block text-xs font-semibold mb-1 text-text-secondary">
                                    Project Name (Folder Name)
                                </label>
                                <input
                                    className="input"
                                    value={projectName}
                                    onChange={(e) => setProjectName(e.target.value)}
                                    placeholder="my-idea-mvp"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-semibold mb-1 text-text-secondary">
                                    Target Location (Parent Directory)
                                </label>
                                <div className="flex gap-2">
                                    <div className="flex items-center bg-background px-3 border border-border rounded-lg text-text-secondary">
                                        <FolderInput size={16} />
                                    </div>
                                    <input
                                        className="input"
                                        value={parentPath}
                                        onChange={(e) => setParentPath(e.target.value)}
                                        placeholder="../ (Sibling directory)"
                                    />
                                </div>
                                <p className="text-xs text-text-secondary mt-1">
                                    Use <code>../</code> for a sibling folder, or specify an absolute path like <code>/Users/name/repos/</code>
                                </p>
                            </div>
                        </>
                    )}
                </div>

                <div className="relative mb-6 flex-1 min-h-[200px] flex flex-col">
                    <label className="block text-xs font-semibold mb-1 text-text-secondary">
                        Generated Prompt
                    </label>
                    <textarea
                        readOnly
                        value={prompt}
                        className="flex-1 w-full p-4 pr-12 rounded-lg border border-border bg-background text-text-primary font-mono text-xs resize-none outline-none leading-relaxed"
                    />
                    <button
                        onClick={handleCopy}
                        title="Copy to clipboard"
                        className={`absolute top-8 right-2 p-2 rounded-md border border-border cursor-pointer flex items-center justify-center transition-all shadow-sm
                            ${copied
                                ? 'bg-success text-white border-transparent'
                                : 'bg-surface text-text-primary hover:bg-background'
                            }`}
                    >
                        {copied ? <Check size={16} /> : <Copy size={16} />}
                    </button>
                </div>

                <div className="flex justify-end">
                    <button
                        onClick={onClose}
                        className="btn-primary"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
};
