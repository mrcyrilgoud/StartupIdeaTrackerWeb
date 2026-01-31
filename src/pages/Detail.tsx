import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { dbService } from '../services/db';
import { aiService } from '../services/ai';
import { Idea, AppSettings, ChatMessage } from '../types';
import { Chat } from '../components/features/Chat';
import { ConfirmModal } from '../components/ConfirmModal';
import { OpenCodeModal } from '../components/OpenCodeModal';
import { BusinessViabilityModal } from '../components/BusinessViabilityModal';
import { ArrowLeft, Sparkles, Trash2, Terminal, Search } from 'lucide-react';

export const Detail: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [idea, setIdea] = useState<Idea | null>(null);
    const [loading, setLoading] = useState(true);
    const [settings, setSettings] = useState<AppSettings | null>(null);

    // Viability analysis state
    const [viabilityLoading, setViabilityLoading] = useState(false);
    const [viabilityReport, setViabilityReport] = useState('');
    const [showViabilityModal, setShowViabilityModal] = useState(false);

    // Ref to track the latest idea state for debounced saving
    const latestIdeaRef = useRef<Idea | null>(null);
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Keep ref in sync
    useEffect(() => {
        latestIdeaRef.current = idea;
    }, [idea]);

    // Cleanup timeout on unmount AND flush any pending save
    useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
                // Flush any pending save immediately on unmount
                if (latestIdeaRef.current) {
                    dbService.saveIdea(latestIdeaRef.current);
                }
            }
        };
    }, []);

    const triggerDebouncedSave = () => {
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }
        saveTimeoutRef.current = setTimeout(() => {
            if (latestIdeaRef.current) {
                dbService.saveIdea(latestIdeaRef.current);
            }
        }, 1000);
    };

    const location = useLocation();

    useEffect(() => {
        const init = async () => {
            // Check if we have state from navigation (new idea draft)
            const state = location.state as { idea?: Idea, isNew?: boolean } | null;

            if (state?.isNew && state.idea) {
                setIdea(state.idea);
            } else if (id) {
                const loaded = await dbService.getIdea(id);
                if (loaded) setIdea(loaded);
            }
            const s = await dbService.getSettings();
            setSettings(s);
            setLoading(false);
        };
        init();
    }, [id, location.state]);

    // This function now only updates local state and DB for *user text edits*.
    // Using functional updates is critical if we were debouncing, but here we are direct.
    // However, to be safe against race conditions from *other* sources (like chat),
    // we should really use a functional update and then save the RESULT.
    const handleTextChange = (field: keyof Idea, value: string) => {
        setIdea(prev => {
            if (!prev) return null;
            const updated = { ...prev, [field]: value };
            triggerDebouncedSave();
            return updated;
        });
    };

    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [showOpenCodeModal, setShowOpenCodeModal] = useState(false);
    const [extracting, setExtracting] = useState(false);

    const handleDeleteClick = () => {
        setShowDeleteModal(true);
    };

    const confirmDelete = async () => {
        if (id) {
            await dbService.deleteIdea(id);
            navigate('/');
        }
    };

    const extractKeywords = async () => {
        if (!idea || !settings) return;
        setExtracting(true);
        try {
            // We can't rely on 'idea' state variable here being fresh after the await
            // so we should pass the idea to the service, but when updating state, use functional.
            const keywords = await aiService.extractKeywords(idea, settings);

            setIdea(prev => {
                if (!prev) return null;
                const updated = { ...prev, keywords };
                dbService.saveIdea(updated);
                return updated;
            });
        } catch (e) {
            alert('Failed to extract keywords');
        } finally {
            setExtracting(false);
        }
    };

    // New handler for Chat updates
    const handleChatUpdate = useCallback(async (newHistory: ChatMessage[]) => {
        setIdea(prev => {
            if (!prev) return null;
            const updated = { ...prev, chatHistory: newHistory };
            dbService.saveIdea(updated);
            return updated;
        });
    }, []);

    // Callback to append text to the idea details (e.g. from Chat)
    const handleAppendToNote = useCallback((text: string) => {
        setIdea(prev => {
            if (!prev) return null;
            // Append with a newline if details is not empty
            const newDetails = prev.details ? `${prev.details}\n\n${text}` : text;
            const updated = { ...prev, details: newDetails };
            dbService.saveIdea(updated);
            return updated;
        });
    }, []);

    // Handler for viability analysis
    const handleAnalyzeViability = async () => {
        if (!idea || !settings) return;

        try {
            setViabilityReport('');
            setShowViabilityModal(true);
            setViabilityLoading(true);

            if (settings.provider === 'gemini' && !settings.geminiKey) {
                setViabilityLoading(false);
                setShowViabilityModal(false);
                alert("Please configure your Gemini API Key in Settings first.");
                return;
            }

            const report = await aiService.generateViabilityReport(idea, settings);
            setViabilityReport(report);
        } catch (e) {
            console.error(e);
            setViabilityReport(`Error generating report: ${(e as Error).message}`);
        } finally {
            setViabilityLoading(false);
        }
    };

    if (loading) return <div style={{ padding: '20px' }}>Loading...</div>;
    if (!idea) return <div style={{ padding: '20px' }}>Idea not found</div>;

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <button
                    onClick={() => navigate('/')}
                    className="btn-icon"
                >
                    <ArrowLeft size={20} /> Back
                </button>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        onClick={handleAnalyzeViability}
                        className="btn-icon"
                        title="Examine Business Viability"
                        style={{ color: 'var(--color-accent)' }}
                        disabled={viabilityLoading}
                    >
                        <Search size={20} />
                    </button>
                    <button
                        onClick={() => setShowOpenCodeModal(true)}
                        className="btn-icon"
                        title="Build with OpenCode"
                        style={{ color: 'var(--color-accent)' }}
                    >
                        <Terminal size={20} />
                    </button>
                    <button
                        onClick={handleDeleteClick}
                        className="btn-icon danger"
                        title="Delete Idea"
                    >
                        <Trash2 size={20} />
                    </button>
                </div>
            </div>

            <ConfirmModal
                isOpen={showDeleteModal}
                title="Delete Idea"
                message="Are you sure you want to delete this idea? This action cannot be undone."
                onConfirm={confirmDelete}
                onCancel={() => setShowDeleteModal(false)}
            />

            <OpenCodeModal
                isOpen={showOpenCodeModal}
                onClose={() => setShowOpenCodeModal(false)}
                idea={idea}
            />

            <div className="responsive-grid">
                {/* Left Column: Editor */}
                <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <input
                        value={idea.title}
                        onChange={e => handleTextChange('title', e.target.value)}
                        placeholder="Idea Title"
                        style={{
                            fontSize: '1.5rem',
                            fontWeight: 'bold',
                            border: 'none',
                            background: 'transparent',
                            marginBottom: '16px',
                            color: 'var(--color-text-primary)',
                            outline: 'none'
                        }}
                    />
                    <textarea
                        value={idea.details}
                        onChange={e => handleTextChange('details', e.target.value)}
                        placeholder="Describe your idea in detail..."
                        style={{
                            flex: 1,
                            border: 'none',
                            background: 'transparent',
                            resize: 'none',
                            color: 'var(--color-text-primary)',
                            fontSize: '1rem',
                            outline: 'none',
                            lineHeight: '1.6'
                        }}
                    />

                    <div style={{ marginTop: '16px', borderTop: '1px solid var(--color-border)', paddingTop: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--color-text-secondary)' }}>KEYWORDS</span>
                            <button
                                onClick={extractKeywords}
                                className="btn-text"
                                disabled={extracting}
                            >
                                <Sparkles size={12} /> {extracting ? 'Extracting...' : 'Extract'}
                            </button>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {idea.keywords.map((kw, idx) => (
                                <span key={idx} style={{ fontSize: '0.8rem', backgroundColor: 'var(--color-background)', padding: '4px 12px', borderRadius: '16px' }}>
                                    {kw}
                                </span>
                            ))}
                            {idea.keywords.length === 0 && <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.8rem' }}>No keywords extracted yet.</span>}
                        </div>
                    </div>
                </div>

                {/* Right Column: Chat */}
                <div style={{ height: '100%' }}>
                    <Chat idea={idea} onChatUpdate={handleChatUpdate} onAppendToNote={handleAppendToNote} />
                </div>
            </div>

            <BusinessViabilityModal
                isOpen={showViabilityModal}
                loading={viabilityLoading}
                ideaTitle={idea.title}
                report={viabilityReport}
                onClose={() => setShowViabilityModal(false)}
            />

            {/* Floating indicator for background report generation */}
            {!showViabilityModal && (viabilityLoading || viabilityReport) && (
                <div
                    onClick={() => setShowViabilityModal(true)}
                    style={{
                        position: 'fixed',
                        bottom: '24px',
                        right: '24px',
                        backgroundColor: viabilityLoading ? 'var(--color-accent)' : 'var(--color-success)',
                        color: 'white',
                        padding: '12px 20px',
                        borderRadius: '12px',
                        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        fontSize: '0.9rem',
                        fontWeight: '500',
                        zIndex: 999,
                        transition: 'transform 0.2s ease',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                >
                    {viabilityLoading ? (
                        <>
                            <div style={{
                                width: '16px',
                                height: '16px',
                                border: '2px solid rgba(255,255,255,0.3)',
                                borderTopColor: 'white',
                                borderRadius: '50%',
                                animation: 'spin 1s linear infinite'
                            }} />
                            Generating report...
                            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                        </>
                    ) : (
                        <>
                            ✓ Report ready! Click to view
                        </>
                    )}
                </div>
            )}
        </div>
    );
};
