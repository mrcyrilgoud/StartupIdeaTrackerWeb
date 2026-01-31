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
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000,
            backdropFilter: 'blur(4px)'
        }}>
            <div className="card" style={{
                maxWidth: '600px',
                width: '90%',
                maxHeight: '90vh',
                display: 'flex',
                flexDirection: 'column',
                padding: '24px',
                animation: 'slideIn 0.2s ease-out',
                position: 'relative'
            }}>
                <button
                    onClick={onClose}
                    style={{
                        position: 'absolute',
                        top: '16px',
                        right: '16px',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--color-text-secondary)'
                    }}
                >
                    <X size={20} />
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
                    <div style={{
                        backgroundColor: 'rgba(0, 0, 0, 0.05)',
                        padding: '10px',
                        borderRadius: '50%',
                        color: 'var(--color-text-primary)'
                    }}>
                        <Terminal size={24} />
                    </div>
                    <div>
                        <h3 style={{ margin: 0, fontSize: '1.25rem' }}>Build with OpenCode</h3>
                        <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                            Generate a prompt to kickstart your local MVP.
                        </p>
                    </div>
                </div>

                <div style={{ marginBottom: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <label style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                        fontWeight: 500,
                        color: 'var(--color-text-primary)'
                    }}>
                        <input
                            type="checkbox"
                            checked={includeDirectorySetup}
                            onChange={(e) => setIncludeDirectorySetup(e.target.checked)}
                            style={{
                                width: '18px',
                                height: '18px',
                                cursor: 'pointer',
                                accentColor: 'var(--color-primary)'
                            }}
                        />
                        Include directory setup instructions
                    </label>

                    {includeDirectorySetup && (
                        <>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px', color: 'var(--color-text-secondary)' }}>
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
                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px', color: 'var(--color-text-secondary)' }}>
                                    Target Location (Parent Directory)
                                </label>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        backgroundColor: 'var(--color-background)',
                                        padding: '0 12px',
                                        border: '1px solid var(--color-border)',
                                        borderRadius: '8px',
                                        color: 'var(--color-text-secondary)'
                                    }}>
                                        <FolderInput size={16} />
                                    </div>
                                    <input
                                        className="input"
                                        value={parentPath}
                                        onChange={(e) => setParentPath(e.target.value)}
                                        placeholder="../ (Sibling directory)"
                                    />
                                </div>
                                <p style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                                    Use <code>../</code> for a sibling folder, or specify an absolute path like <code>/Users/name/repos/</code>
                                </p>
                            </div>
                        </>
                    )}
                </div>

                <div style={{ position: 'relative', marginBottom: '24px', flex: 1, minHeight: '200px', display: 'flex', flexDirection: 'column' }}>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px', color: 'var(--color-text-secondary)' }}>
                        Generated Prompt
                    </label>
                    <textarea
                        readOnly
                        value={prompt}
                        style={{
                            flex: 1,
                            width: '100%',
                            padding: '16px',
                            paddingRight: '48px', // Space for copy button
                            borderRadius: '8px',
                            border: '1px solid var(--color-border)',
                            backgroundColor: 'var(--color-background)',
                            color: 'var(--color-text-primary)',
                            fontFamily: 'monospace',
                            fontSize: '0.85rem',
                            resize: 'none',
                            outline: 'none',
                            lineHeight: '1.5'
                        }}
                    />
                    <button
                        onClick={handleCopy}
                        title="Copy to clipboard"
                        style={{
                            position: 'absolute',
                            top: '32px', // Adjusted for label
                            right: '8px',
                            padding: '8px',
                            background: copied ? 'var(--color-success)' : 'var(--color-surface)',
                            border: '1px solid var(--color-border)',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            color: copied ? 'white' : 'var(--color-text-primary)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.2s',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                        }}
                    >
                        {copied ? <Check size={16} /> : <Copy size={16} />}
                    </button>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
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
