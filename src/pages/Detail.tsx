import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { dbService } from '../services/db';
import { aiService } from '../services/ai';
import { Idea, AppSettings, ChatMessage, STATUS_LABELS, STATUS_COLORS } from '../types';
import { Chat } from '../components/features/Chat';
import { ConfirmModal } from '../components/ConfirmModal';
import { OpenCodeModal } from '../components/OpenCodeModal';
import { BusinessViabilityModal } from '../components/BusinessViabilityModal';
import { CompetitorAnalysisModal } from '../components/CompetitorAnalysisModal';
import { ArrowLeft, Sparkles, Trash2, Terminal, Search, Swords } from 'lucide-react';

export const Detail: React.FC = () => {
    const STREAM_UPDATE_INTERVAL_MS = 100;
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const location = useLocation();
    const [idea, setIdea] = useState<Idea | null>(null);
    const [loading, setLoading] = useState(true);
    const [settings, setSettings] = useState<AppSettings | null>(null);

    // Viability analysis state
    const [viabilityLoading, setViabilityLoading] = useState(false);
    const [viabilityReport, setViabilityReport] = useState('');
    const [viabilityError, setViabilityError] = useState<string | null>(null);
    const [showViabilityModal, setShowViabilityModal] = useState(false);

    // Competitor analysis state
    const [competitorLoading, setCompetitorLoading] = useState(false);
    const [competitorReport, setCompetitorReport] = useState('');
    const [competitorError, setCompetitorError] = useState<string | null>(null);
    const [showCompetitorModal, setShowCompetitorModal] = useState(false);
    const viabilityStreamAbortRef = useRef<AbortController | null>(null);
    const competitorStreamAbortRef = useRef<AbortController | null>(null);
    const viabilityStreamBufferRef = useRef('');
    const competitorStreamBufferRef = useRef('');
    const viabilityStreamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const competitorStreamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isMountedRef = useRef(true);

    // Ref to track the latest idea state for debounced saving
    const latestIdeaRef = useRef<Idea | null>(null);
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const isNewDraftRef = useRef(false);

    // Keep ref in sync
    useEffect(() => {
        latestIdeaRef.current = idea;
    }, [idea]);

    const isAbortError = (error: unknown): boolean => {
        if (!error || typeof error !== 'object') return false;
        const maybeError = error as { name?: string; message?: string };
        return maybeError.name === 'AbortError' || maybeError.message?.toLowerCase().includes('aborted') === true;
    };

    const flushViabilityStreamBuffer = useCallback(() => {
        if (viabilityStreamTimerRef.current) {
            clearTimeout(viabilityStreamTimerRef.current);
            viabilityStreamTimerRef.current = null;
        }

        if (!viabilityStreamBufferRef.current) return;

        const buffered = viabilityStreamBufferRef.current;
        viabilityStreamBufferRef.current = '';
        setViabilityReport(prev => prev + buffered);
    }, []);

    const queueViabilityStreamChunk = useCallback((delta: string) => {
        if (!delta) return;

        viabilityStreamBufferRef.current += delta;
        if (viabilityStreamTimerRef.current) return;

        viabilityStreamTimerRef.current = setTimeout(() => {
            viabilityStreamTimerRef.current = null;
            if (!viabilityStreamBufferRef.current) return;
            const buffered = viabilityStreamBufferRef.current;
            viabilityStreamBufferRef.current = '';
            setViabilityReport(prev => prev + buffered);
        }, STREAM_UPDATE_INTERVAL_MS);
    }, [STREAM_UPDATE_INTERVAL_MS]);

    const flushCompetitorStreamBuffer = useCallback(() => {
        if (competitorStreamTimerRef.current) {
            clearTimeout(competitorStreamTimerRef.current);
            competitorStreamTimerRef.current = null;
        }

        if (!competitorStreamBufferRef.current) return;

        const buffered = competitorStreamBufferRef.current;
        competitorStreamBufferRef.current = '';
        setCompetitorReport(prev => prev + buffered);
    }, []);

    const queueCompetitorStreamChunk = useCallback((delta: string) => {
        if (!delta) return;

        competitorStreamBufferRef.current += delta;
        if (competitorStreamTimerRef.current) return;

        competitorStreamTimerRef.current = setTimeout(() => {
            competitorStreamTimerRef.current = null;
            if (!competitorStreamBufferRef.current) return;
            const buffered = competitorStreamBufferRef.current;
            competitorStreamBufferRef.current = '';
            setCompetitorReport(prev => prev + buffered);
        }, STREAM_UPDATE_INTERVAL_MS);
    }, [STREAM_UPDATE_INTERVAL_MS]);

    const clearNewDraftState = useCallback(() => {
        if (!isNewDraftRef.current) return;
        isNewDraftRef.current = false;
        navigate(location.pathname, { replace: true });
    }, [location.pathname, navigate]);

    const persistIdea = useCallback((ideaToSave: Idea, options?: RequestInit) => {
        latestIdeaRef.current = ideaToSave;
        return dbService.saveIdea(ideaToSave, options).then((savedId) => {
            clearNewDraftState();
            return savedId;
        });
    }, [clearNewDraftState]);

    // Cleanup timeout on unmount AND flush any pending save
    useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
                // Flush any pending save immediately on unmount
                if (latestIdeaRef.current) {
                    void persistIdea(latestIdeaRef.current, { keepalive: true });
                }
            }
        };
    }, [persistIdea]);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            viabilityStreamAbortRef.current?.abort();
            competitorStreamAbortRef.current?.abort();

            if (viabilityStreamTimerRef.current) {
                clearTimeout(viabilityStreamTimerRef.current);
            }
            if (competitorStreamTimerRef.current) {
                clearTimeout(competitorStreamTimerRef.current);
            }

            viabilityStreamBufferRef.current = '';
            competitorStreamBufferRef.current = '';
        };
    }, []);

    const triggerDebouncedSave = (ideaToSave: Idea) => {
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        // Keep this in sync immediately so unmount flushes save the latest edits.
        latestIdeaRef.current = ideaToSave;

        saveTimeoutRef.current = setTimeout(() => {
            if (latestIdeaRef.current) {
                void persistIdea(latestIdeaRef.current);
            }
        }, 1000);
    };

    const persistIdeaImmediately = useCallback((ideaToSave: Idea, options?: RequestInit) => {
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = null;
        }

        latestIdeaRef.current = ideaToSave;
        return persistIdea(ideaToSave, options);
    }, [persistIdea]);

    useEffect(() => {
        const init = async () => {
            // Check if we have state from navigation (new idea draft)
            const state = location.state as { idea?: Idea, isNew?: boolean } | null;
            const navigationIdea = state?.idea;
            const isDraftFromNavigation = state?.isNew && navigationIdea?.id === id;
            isNewDraftRef.current = Boolean(isDraftFromNavigation);

            if (id) {
                if (isDraftFromNavigation && navigationIdea) {
                    // New drafts are created in memory first and may not exist in json-server yet.
                    setIdea(navigationIdea);
                } else {
                    const loaded = await dbService.getIdea(id);
                    if (loaded) {
                        setIdea(loaded);
                    } else if (navigationIdea && navigationIdea.id === id) {
                        // Fallback for first render before the new draft exists in DB.
                        setIdea(navigationIdea);
                    }
                }
            } else if (state?.isNew && navigationIdea) {
                setIdea(navigationIdea);
            }
            const s = await dbService.getSettings();
            setSettings(s);
            setLoading(false);
        };
        init();
    }, [id, location.state]);

    // This function now only updates local state and DB for *user text edits*.
    const handleTextChange = (field: keyof Idea, value: string) => {
        setIdea(prev => {
            if (!prev) return null;
            const updated = { ...prev, [field]: value };
            triggerDebouncedSave(updated);
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
            try {
                await dbService.deleteIdea(id);
                navigate('/');
            } catch (e) {
                console.error('Failed to delete idea:', e);
                alert('Failed to delete idea. Please try again.');
            } finally {
                setShowDeleteModal(false);
            }
        }
    };

    const extractKeywords = async () => {
        if (!idea || !settings) return;
        setExtracting(true);
        try {
            const keywords = await aiService.extractKeywords(idea, settings);

            setIdea(prev => {
                if (!prev) return null;
                const updated = { ...prev, keywords: (keywords || []) };
                void persistIdeaImmediately(updated);
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
            void persistIdeaImmediately(updated);
            return updated;
        });
    }, [persistIdeaImmediately]);

    // Callback to append text to the idea details (e.g. from Chat)
    const handleAppendToNote = useCallback((text: string) => {
        setIdea(prev => {
            if (!prev) return null;
            // Append with a newline if details is not empty
            const newDetails = prev.details ? `${prev.details}\n\n${text}` : text;
            const updated = { ...prev, details: newDetails };
            void persistIdeaImmediately(updated);
            return updated;
        });
    }, [persistIdeaImmediately]);

    const handleStatusChange = (newStatus: any) => {
        setIdea(prev => {
            if (!prev) return null;
            const updated = { ...prev, status: newStatus };
            void persistIdeaImmediately(updated);
            return updated;
        });
    };

    const handleAddKeyword = (value: string) => {
        const keyword = value.trim();
        if (!keyword) return;

        setIdea(prev => {
            if (!prev) return null;
            const existingKeywords = prev.keywords || [];
            if (existingKeywords.includes(keyword)) {
                return prev;
            }

            const updated = { ...prev, keywords: [...existingKeywords, keyword] };
            void persistIdeaImmediately(updated);
            return updated;
        });
    };

    const handleRemoveKeyword = (indexToRemove: number) => {
        setIdea(prev => {
            if (!prev) return null;
            const updated = {
                ...prev,
                keywords: (prev.keywords || []).filter((_, index) => index !== indexToRemove)
            };
            void persistIdeaImmediately(updated);
            return updated;
        });
    };

    // Handler for viability analysis
    const handleAnalyzeViability = async () => {
        if (!idea || !settings) return;
        let controller: AbortController | null = null;

        try {
            viabilityStreamAbortRef.current?.abort();
            viabilityStreamAbortRef.current = null;
            setViabilityReport('');
            setViabilityError(null);
            setShowViabilityModal(true);
            setViabilityLoading(true);
            viabilityStreamBufferRef.current = '';
            if (viabilityStreamTimerRef.current) {
                clearTimeout(viabilityStreamTimerRef.current);
                viabilityStreamTimerRef.current = null;
            }

            if (settings.provider === 'gemini' && !settings.geminiKey) {
                setViabilityLoading(false);
                setViabilityError("Please configure your Gemini API Key in Settings first.");
                return;
            }

            controller = new AbortController();
            viabilityStreamAbortRef.current = controller;

            await aiService.generateViabilityReportStream(
                idea,
                settings,
                queueViabilityStreamChunk,
                { emitDelta: true, signal: controller.signal }
            );
            flushViabilityStreamBuffer();
        } catch (e) {
            if (!isMountedRef.current || controller?.signal.aborted || isAbortError(e)) return;
            console.error(e);
            setViabilityError(`Error generating report: ${(e as Error).message}`);
        } finally {
            viabilityStreamAbortRef.current = null;
            controller = null;
            if (isMountedRef.current) {
                setViabilityLoading(false);
            }
        }
    };

    // Handler for competitor analysis
    const handleAnalyzeCompetitors = async () => {
        if (!idea || !settings) return;
        let controller: AbortController | null = null;

        try {
            competitorStreamAbortRef.current?.abort();
            competitorStreamAbortRef.current = null;
            setCompetitorReport('');
            setCompetitorError(null);
            setShowCompetitorModal(true);
            setCompetitorLoading(true);
            competitorStreamBufferRef.current = '';
            if (competitorStreamTimerRef.current) {
                clearTimeout(competitorStreamTimerRef.current);
                competitorStreamTimerRef.current = null;
            }

            if (settings.provider === 'gemini' && !settings.geminiKey) {
                setCompetitorLoading(false);
                setCompetitorError("Please configure your Gemini API Key in Settings first.");
                return;
            }

            controller = new AbortController();
            competitorStreamAbortRef.current = controller;

            await aiService.analyzeCompetitorsStream(
                idea,
                settings,
                queueCompetitorStreamChunk,
                { emitDelta: true, signal: controller.signal }
            );
            flushCompetitorStreamBuffer();
        } catch (e) {
            if (!isMountedRef.current || controller?.signal.aborted || isAbortError(e)) return;
            console.error(e);
            setCompetitorError(`Error generating report: ${(e as Error).message}`);
        } finally {
            competitorStreamAbortRef.current = null;
            controller = null;
            if (isMountedRef.current) {
                setCompetitorLoading(false);
            }
        }
    };

    const cancelViabilityAnalysis = useCallback(() => {
        flushViabilityStreamBuffer();
        viabilityStreamAbortRef.current?.abort();
        viabilityStreamAbortRef.current = null;
        if (viabilityStreamTimerRef.current) {
            clearTimeout(viabilityStreamTimerRef.current);
            viabilityStreamTimerRef.current = null;
        }
        viabilityStreamBufferRef.current = '';
        setViabilityLoading(false);
    }, [flushViabilityStreamBuffer]);

    const cancelCompetitorAnalysis = useCallback(() => {
        flushCompetitorStreamBuffer();
        competitorStreamAbortRef.current?.abort();
        competitorStreamAbortRef.current = null;
        if (competitorStreamTimerRef.current) {
            clearTimeout(competitorStreamTimerRef.current);
            competitorStreamTimerRef.current = null;
        }
        competitorStreamBufferRef.current = '';
        setCompetitorLoading(false);
    }, [flushCompetitorStreamBuffer]);

    if (loading) return <div className="p-5">Loading...</div>;
    if (!idea) return <div className="p-5">Idea not found</div>;

    return (
        <div className="max-w-[1200px] mx-auto h-full flex flex-col w-full">
            <div className="flex justify-between items-center mb-4">
                <button
                    onClick={() => navigate('/')}
                    className="btn-icon"
                >
                    <ArrowLeft size={20} /> Back
                </button>
                <div className="flex gap-2 items-center">
                    <div className="relative mr-2">
                        <select
                            value={idea.status || 'draft'}
                            onChange={(e) => handleStatusChange(e.target.value)}
                            className="appearance-none pl-3 pr-8 py-1.5 rounded-2xl text-sm font-semibold cursor-pointer outline-none text-center"
                            style={{
                                backgroundColor: STATUS_COLORS[idea.status || 'draft'] + '20',
                                color: STATUS_COLORS[idea.status || 'draft'],
                                border: `1px solid ${STATUS_COLORS[idea.status || 'draft']}`
                            }}
                        >
                            {Object.entries(STATUS_LABELS).map(([key, label]) => (
                                <option key={key} value={key} style={{ color: 'black' }}>
                                    {label}
                                </option>
                            ))}
                        </select>
                        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: STATUS_COLORS[idea.status || 'draft'] }}>
                            <svg width="10" height="6" viewBox="0 0 10 6" fill="currentColor">
                                <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                            </svg>
                        </div>
                    </div>
                    <button
                        onClick={handleAnalyzeViability}
                        className="btn-icon text-accent"
                        title="Examine Business Viability"
                        disabled={viabilityLoading}
                    >
                        <Search size={20} />
                    </button>
                    <button
                        onClick={handleAnalyzeCompetitors}
                        className="btn-icon text-[#ff3b30]"
                        title="Competitor Analysis"
                        disabled={competitorLoading}
                    >
                        <Swords size={20} />
                    </button>
                    <button
                        onClick={() => setShowOpenCodeModal(true)}
                        className="btn-icon text-accent"
                        title="Build with OpenCode"
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
                <div className="card flex flex-col overflow-hidden">
                    <input
                        value={idea.title}
                        onChange={e => handleTextChange('title', e.target.value)}
                        placeholder="Idea Title"
                        className="text-2xl font-bold border-none bg-transparent mb-4 text-text-primary outline-none"
                    />
                    <textarea
                        value={idea.details}
                        onChange={e => handleTextChange('details', e.target.value)}
                        placeholder="Describe your idea in detail..."
                        className="flex-1 border-none bg-transparent resize-none text-text-primary text-base outline-none leading-relaxed"
                    />

                    <div className="mt-4 border-t border-border pt-4">
                        <div className="flex justify-between items-center mb-2">
                            <span className="text-xs font-bold text-text-secondary">KEYWORDS</span>
                            <button
                                onClick={extractKeywords}
                                className="btn-text"
                                disabled={extracting}
                            >
                                <Sparkles size={12} /> {extracting ? 'Extracting...' : 'Extract'}
                            </button>
                        </div>
                        <div className="flex gap-2 mb-3">
                            <input
                                className="bg-background border border-border rounded-lg px-2 py-1 text-sm flex-1 outline-none focus:border-accent"
                                placeholder="Add keyword..."
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        handleAddKeyword((e.target as HTMLInputElement).value);
                                        (e.target as HTMLInputElement).value = '';
                                    }
                                }}
                            />
                        </div>
                        <div className="flex gap-2 flex-wrap">
                            {(idea.keywords || []).map((kw, idx) => (
                                <span key={idx} className="text-xs bg-background px-3 py-1 rounded-2xl flex items-center gap-1 group">
                                    {kw}
                                    <button
                                        className="opacity-0 group-hover:opacity-100 transition-opacity text-text-secondary hover:text-danger"
                                        onClick={() => handleRemoveKeyword(idx)}
                                    >
                                        &times;
                                    </button>
                                </span>
                            ))}
                            {!(idea.keywords?.length) && <span className="text-text-secondary text-xs">No keywords extracted yet.</span>}
                        </div>
                    </div>
                </div>

                {/* Right Column: Chat */}
                <div className="h-full">
                    <Chat idea={idea} onChatUpdate={handleChatUpdate} onAppendToNote={handleAppendToNote} />
                </div>
            </div>

            <BusinessViabilityModal
                isOpen={showViabilityModal}
                loading={viabilityLoading}
                ideaTitle={idea.title}
                report={viabilityReport}
                error={viabilityError}
                onCancel={cancelViabilityAnalysis}
                onClose={() => setShowViabilityModal(false)}
            />

            <CompetitorAnalysisModal
                isOpen={showCompetitorModal}
                loading={competitorLoading}
                ideaTitle={idea.title}
                report={competitorReport}
                error={competitorError}
                onCancel={cancelCompetitorAnalysis}
                onClose={() => setShowCompetitorModal(false)}
            />

            {/* Floating indicator for background report generation */}
            {!showViabilityModal && (viabilityLoading || viabilityReport) && (
                <div
                    onClick={() => setShowViabilityModal(true)}
                    className={`fixed bottom-6 right-6 text-white px-5 py-3 rounded-xl shadow-lg cursor-pointer flex items-center gap-2.5 text-sm font-medium z-[999] transition-transform duration-200 hover:scale-105 ${viabilityLoading ? 'bg-accent' : 'bg-success'}`}
                >
                    {viabilityLoading ? (
                        <>
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Generating report...
                        </>
                    ) : (
                        <>
                            ✓ Report ready! Click to view
                        </>
                    )}
                </div>
            )}
            {/* Floating indicator for competitor analysis */}
            {!showCompetitorModal && (competitorLoading || competitorReport) && (
                <div
                    onClick={() => setShowCompetitorModal(true)}
                    className={`fixed bottom-6 text-white px-5 py-3 rounded-xl shadow-lg cursor-pointer flex items-center gap-2.5 text-sm font-medium z-[999] transition-all duration-200 hover:scale-105 ${competitorLoading ? 'bg-[#ff3b30]' : 'bg-success'}`}
                    style={{
                        right: (viabilityLoading || viabilityReport) ? '280px' : '24px',
                    }}
                >
                    {competitorLoading ? (
                        <>
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Analyzing competitors...
                        </>
                    ) : (
                        <>
                            ✓ Competitor report ready!
                        </>
                    )}
                </div>
            )}
        </div>
    );
};
