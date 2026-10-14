import { useAiConnection } from '../context/AiConnectionContext';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { dbService } from '../services/db';
import { aiService } from '../services/ai';
import { Idea, ChatMessage, IdeaEvent, IdeaEventDiff, STATUS_LABELS, STATUS_COLORS, StructuredAiFallbackPayload } from '../types';
import { Chat } from '../components/features/Chat';
import { createStreamBatcher, StreamBatcher } from '../components/features/streamBatching';
import { ConfirmModal } from '../components/ConfirmModal';
import { OpenCodeModal } from '../components/OpenCodeModal';
import { BusinessViabilityModal } from '../components/BusinessViabilityModal';
import { CompetitorAnalysisModal } from '../components/CompetitorAnalysisModal';
import { StructuredAiFallback } from '../components/StructuredAiFallback';
import { ArrowLeft, ArrowRightLeft, Pencil, PlusCircle, Search, Sparkles, Swords, Terminal, Trash2, type LucideIcon } from 'lucide-react';

const TITLE_REQUIRED_MESSAGE = 'Title is required. Changes stay local and AI tools are disabled until you enter one.';
const CHAT_BLOCKED_MESSAGE = 'Enter a title to save changes and use AI tools.';

const TIMELINE_PAGE_SIZE = 10;

const EVENT_LABELS: Record<IdeaEvent['type'], string> = {
    idea_created: 'Created',
    idea_updated: 'Updated',
    idea_moved: 'Moved',
    idea_deleted: 'Deleted',
    ai_keywords_extracted: 'Keywords extracted',
    ai_viability_report_generated: 'Viability report',
    ai_competitor_analysis_generated: 'Competitor analysis',
    ai_brainstorm_summarized: 'Brainstorm summarized'
};

const EVENT_ICONS: Record<IdeaEvent['type'], LucideIcon> = {
    idea_created: PlusCircle,
    idea_updated: Pencil,
    idea_moved: ArrowRightLeft,
    idea_deleted: Trash2,
    ai_keywords_extracted: Sparkles,
    ai_viability_report_generated: Search,
    ai_competitor_analysis_generated: Swords,
    ai_brainstorm_summarized: Sparkles
};

function getTitleValidationMessage(title: string): string | null {
    return title.trim().length > 0 ? null : TITLE_REQUIRED_MESSAGE;
}

function canPersistIdea(idea: Idea): boolean {
    return getTitleValidationMessage(idea.title) === null;
}

function formatRelativeTimestamp(timestamp: number): string {
    const diffMs = Date.now() - timestamp;
    const diffMinutes = Math.max(1, Math.floor(diffMs / 60000));

    if (diffMinutes < 60) {
        return `${diffMinutes}m ago`;
    }

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
        return `${diffHours}h ago`;
    }

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) {
        return `${diffDays}d ago`;
    }

    return new Date(timestamp).toLocaleString();
}

function renderDiffValue(value: unknown): string {
    if (value === null || value === undefined) {
        return 'None';
    }

    if (typeof value === 'string') {
        return value || '(empty)';
    }

    return JSON.stringify(value, null, 2);
}

export const Detail: React.FC = () => {
    const STREAM_UPDATE_INTERVAL_MS = 100;
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [idea, setIdea] = useState<Idea | null>(null);
    const [loading, setLoading] = useState(true);
    const { ready } = useAiConnection();
    const [keywordError, setKeywordError] = useState<string | null>(null);

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
    const [timelineEvents, setTimelineEvents] = useState<IdeaEvent[]>([]);
    const [timelineLoading, setTimelineLoading] = useState(false);
    const [timelineError, setTimelineError] = useState<string | null>(null);
    const [hasOlderEvents, setHasOlderEvents] = useState(false);
    const [eventDiffs, setEventDiffs] = useState<Record<number, IdeaEventDiff>>({});
    const [loadingDiffIds, setLoadingDiffIds] = useState<number[]>([]);
    const [expandedDiffIds, setExpandedDiffIds] = useState<number[]>([]);
    const [summaryFromId, setSummaryFromId] = useState<number | null>(null);
    const [summaryToId, setSummaryToId] = useState<number | null>(null);
    const [historySummary, setHistorySummary] = useState('');
    const [historySummaryError, setHistorySummaryError] = useState<string | null>(null);
    const [historySummaryFallback, setHistorySummaryFallback] = useState<StructuredAiFallbackPayload | null>(null);
    const [historySummaryLoading, setHistorySummaryLoading] = useState(false);
    const viabilityStreamAbortRef = useRef<AbortController | null>(null);
    const competitorStreamAbortRef = useRef<AbortController | null>(null);
    const historySummaryAbortRef = useRef<AbortController | null>(null);
    const historySummaryStreamBatcherRef = useRef<StreamBatcher | null>(null);
    const viabilityStreamBatcherRef = useRef<StreamBatcher | null>(null);
    const competitorStreamBatcherRef = useRef<StreamBatcher | null>(null);
    const isMountedRef = useRef(true);

    if (!historySummaryStreamBatcherRef.current) {
        historySummaryStreamBatcherRef.current = createStreamBatcher(
            content => setHistorySummary(prev => prev + content),
            STREAM_UPDATE_INTERVAL_MS
        );
    }
    if (!viabilityStreamBatcherRef.current) {
        viabilityStreamBatcherRef.current = createStreamBatcher(
            content => setViabilityReport(prev => prev + content),
            STREAM_UPDATE_INTERVAL_MS
        );
    }
    if (!competitorStreamBatcherRef.current) {
        competitorStreamBatcherRef.current = createStreamBatcher(
            content => setCompetitorReport(prev => prev + content),
            STREAM_UPDATE_INTERVAL_MS
        );
    }

    // Ref to track the latest idea state for debounced saving
    const latestIdeaRef = useRef<Idea | null>(null);
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Keep ref in sync
    useEffect(() => {
        latestIdeaRef.current = idea;
    }, [idea]);

    const isAbortError = useCallback((error: unknown): boolean => {
        if (!error || typeof error !== 'object') return false;
        const maybeError = error as { name?: string; message?: string };
        return maybeError.name === 'AbortError' || maybeError.message?.toLowerCase().includes('aborted') === true;
    }, []);

    const flushViabilityStreamBuffer = useCallback(() => {
        viabilityStreamBatcherRef.current?.flush();
    }, []);

    const queueViabilityStreamChunk = useCallback((delta: string) => {
        viabilityStreamBatcherRef.current?.push(delta);
    }, []);

    const flushCompetitorStreamBuffer = useCallback(() => {
        competitorStreamBatcherRef.current?.flush();
    }, []);

    const queueCompetitorStreamChunk = useCallback((delta: string) => {
        competitorStreamBatcherRef.current?.push(delta);
    }, []);

    const persistIdea = useCallback((ideaToSave: Idea, options?: RequestInit) => {
        latestIdeaRef.current = ideaToSave;
        if (!canPersistIdea(ideaToSave)) {
            return Promise.resolve(ideaToSave.id);
        }
        return dbService.saveIdea(ideaToSave, options);
    }, []);

    const handlePersistFailure = useCallback((error: unknown) => {
        if (isAbortError(error)) return;

        const message = error instanceof Error ? error.message.toLowerCase() : '';
        const isTransientNetworkError = (
            message.includes('network error')
            || message.includes('failed to fetch')
            || message.includes('load failed')
        );

        // Navigation/unmount can interrupt background saves in some browsers.
        if (!isMountedRef.current && isTransientNetworkError) {
            return;
        }

        console.warn('Failed to persist idea changes:', error);
    }, [isAbortError]);

    const persistIdeaFireAndForget = useCallback((ideaToSave: Idea, options?: RequestInit) => {
        void persistIdea(ideaToSave, options).catch(handlePersistFailure);
    }, [persistIdea, handlePersistFailure]);

    // Cleanup timeout on unmount AND flush any pending save
    useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
                // Flush any pending save immediately on unmount
                if (latestIdeaRef.current && canPersistIdea(latestIdeaRef.current)) {
                    persistIdeaFireAndForget(latestIdeaRef.current, { keepalive: true });
                }
            }
        };
    }, [persistIdeaFireAndForget]);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            viabilityStreamAbortRef.current?.abort();
            competitorStreamAbortRef.current?.abort();
            historySummaryAbortRef.current?.abort();

            historySummaryStreamBatcherRef.current?.dispose();
            viabilityStreamBatcherRef.current?.dispose();
            competitorStreamBatcherRef.current?.dispose();
        };
    }, []);

    const triggerDebouncedSave = (ideaToSave: Idea) => {
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        // Keep this in sync immediately so unmount flushes save the latest edits.
        latestIdeaRef.current = ideaToSave;

        if (!canPersistIdea(ideaToSave)) {
            return;
        }

        saveTimeoutRef.current = setTimeout(() => {
            if (latestIdeaRef.current) {
                persistIdeaFireAndForget(latestIdeaRef.current);
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

    const persistIdeaImmediatelyFireAndForget = useCallback((ideaToSave: Idea, options?: RequestInit) => {
        void persistIdeaImmediately(ideaToSave, options).catch(handlePersistFailure);
    }, [persistIdeaImmediately, handlePersistFailure]);

    useEffect(() => {
        historySummaryAbortRef.current?.abort();
        setTimelineEvents([]);
        setTimelineError(null);
        setHasOlderEvents(false);
        setEventDiffs({});
        setLoadingDiffIds([]);
        setExpandedDiffIds([]);
        setSummaryFromId(null);
        setSummaryToId(null);
        setHistorySummary('');
        setHistorySummaryError(null);
        setHistorySummaryFallback(null);
        setHistorySummaryLoading(false);
    }, [id]);

    useEffect(() => {
        const init = async () => {
            if (!id) {
                setLoading(false);
                return;
            }

            try {
                const loadedIdea = await dbService.getIdea(id);

                setIdea(loadedIdea ?? null);
            } catch (error) {
                console.error('Failed to load idea detail:', error);
                setIdea(null);
            } finally {
                setLoading(false);
            }
        };
        init();
    }, [id]);

    const loadTimeline = useCallback(async (options: { before?: number; append?: boolean } = {}) => {
        if (!id) return;

        setTimelineLoading(true);
        setTimelineError(null);

        try {
            const events = await dbService.listIdeaEvents(id, {
                limit: TIMELINE_PAGE_SIZE,
                before: options.before
            });

            let nextEvents: IdeaEvent[] = events;
            setTimelineEvents((prev) => {
                nextEvents = options.append ? [...prev, ...events] : events;
                return nextEvents;
            });
            setHasOlderEvents(events.length === TIMELINE_PAGE_SIZE);

            const oldestFirst = [...nextEvents].reverse();
            setSummaryFromId((current) => current ?? oldestFirst[0]?.id ?? null);
            setSummaryToId((current) => current ?? oldestFirst[oldestFirst.length - 1]?.id ?? null);
        } catch (error) {
            setTimelineError(error instanceof Error ? error.message : 'Failed to load timeline');
        } finally {
            setTimelineLoading(false);
        }
    }, [id]);

    useEffect(() => {
        if (!id) return;
        void loadTimeline();
    }, [id, loadTimeline]);

    const handleLoadOlderEvents = useCallback(async () => {
        const lastEventId = timelineEvents[timelineEvents.length - 1]?.id;
        if (!lastEventId) return;
        await loadTimeline({ before: lastEventId, append: true });
    }, [loadTimeline, timelineEvents]);

    const handleToggleDiff = useCallback(async (eventId: number) => {
        const isExpanded = expandedDiffIds.includes(eventId);
        if (isExpanded) {
            setExpandedDiffIds((prev) => prev.filter((idValue) => idValue !== eventId));
            return;
        }

        setExpandedDiffIds((prev) => [...prev, eventId]);
        if (eventDiffs[eventId] || !id) {
            return;
        }

        setLoadingDiffIds((prev) => [...prev, eventId]);
        try {
            const diff = await dbService.diffIdeaEvent(id, eventId);
            setEventDiffs((prev) => ({
                ...prev,
                [eventId]: diff
            }));
        } catch (error) {
            setTimelineError(error instanceof Error ? error.message : 'Failed to load event diff');
        } finally {
            setLoadingDiffIds((prev) => prev.filter((idValue) => idValue !== eventId));
        }
    }, [eventDiffs, expandedDiffIds, id]);

    const handleSummarizeHistory = useCallback(async () => {
        if (!ready || !id || summaryFromId === null || summaryToId === null) return;

        const fromId = Math.min(summaryFromId, summaryToId);
        const toId = Math.max(summaryFromId, summaryToId);
        const controller = new AbortController();

        historySummaryAbortRef.current?.abort();
        historySummaryAbortRef.current = controller;
        setHistorySummary('');
        setHistorySummaryError(null);
        setHistorySummaryFallback(null);
        setHistorySummaryLoading(true);
        historySummaryStreamBatcherRef.current?.clear();

        try {
            const result = await aiService.summarizeIdeaHistoryStream(
                id,
                { from: fromId, to: toId },
                content => historySummaryStreamBatcherRef.current?.push(content),
                { signal: controller.signal }
            );
            historySummaryStreamBatcherRef.current?.flush();
            setHistorySummary(result.fullText);
            if (result.fallback) {
                setHistorySummaryFallback(result.fallback);
            }
        } catch (error) {
            if (controller.signal.aborted || isAbortError(error)) return;
            setHistorySummaryError(error instanceof Error ? error.message : 'Failed to summarize history');
        } finally {
            if (historySummaryAbortRef.current === controller) {
                historySummaryAbortRef.current = null;
            }
            setHistorySummaryLoading(false);
        }
    }, [ready, id, isAbortError, summaryFromId, summaryToId]);

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
        if (!idea || !ready || !canPersistIdea(idea)) return;
        setExtracting(true);
        setKeywordError(null);
        try {
            const keywords = await aiService.extractKeywords(idea);

            setIdea(prev => {
                if (!prev) return null;
                const updated = { ...prev, keywords: (keywords || []) };
                persistIdeaImmediatelyFireAndForget(updated);
                return updated;
            });
        } catch (e) {
            setKeywordError((e as Error).message);
        } finally {
            setExtracting(false);
        }
    };

    // New handler for Chat updates
    const handleChatUpdate = useCallback(async (newHistory: ChatMessage[]) => {
        setIdea(prev => {
            if (!prev) return null;
            const updated = { ...prev, chatHistory: newHistory };
            persistIdeaImmediatelyFireAndForget(updated);
            return updated;
        });
    }, [persistIdeaImmediatelyFireAndForget]);

    // Callback to append text to the idea details (e.g. from Chat)
    const handleAppendToNote = useCallback((text: string) => {
        setIdea(prev => {
            if (!prev) return null;
            // Append with a newline if details is not empty
            const newDetails = prev.details ? `${prev.details}\n\n${text}` : text;
            const updated = { ...prev, details: newDetails };
            persistIdeaImmediatelyFireAndForget(updated);
            return updated;
        });
    }, [persistIdeaImmediatelyFireAndForget]);

    const handleStatusChange = (newStatus: any) => {
        setIdea(prev => {
            if (!prev || !canPersistIdea(prev)) return prev;
            const updated = { ...prev, status: newStatus };
            persistIdeaImmediatelyFireAndForget(updated);
            return updated;
        });
    };

    const handleAddKeyword = (value: string) => {
        const keyword = value.trim();
        if (!keyword) return;

        setIdea(prev => {
            if (!prev || !canPersistIdea(prev)) return prev;
            const existingKeywords = prev.keywords || [];
            if (existingKeywords.includes(keyword)) {
                return prev;
            }

            const updated = { ...prev, keywords: [...existingKeywords, keyword] };
            persistIdeaImmediatelyFireAndForget(updated);
            return updated;
        });
    };

    const handleRemoveKeyword = (indexToRemove: number) => {
        setIdea(prev => {
            if (!prev || !canPersistIdea(prev)) return prev;
            const updated = {
                ...prev,
                keywords: (prev.keywords || []).filter((_, index) => index !== indexToRemove)
            };
            persistIdeaImmediatelyFireAndForget(updated);
            return updated;
        });
    };

    // Handler for viability analysis
    const handleAnalyzeViability = async () => {
        if (!idea || !ready || !canPersistIdea(idea)) return;
        let controller: AbortController | null = null;

        try {
            viabilityStreamAbortRef.current?.abort();
            viabilityStreamAbortRef.current = null;
            setViabilityReport('');
            setViabilityError(null);
            setShowViabilityModal(true);
            setViabilityLoading(true);
            viabilityStreamBatcherRef.current?.clear();

            controller = new AbortController();
            viabilityStreamAbortRef.current = controller;

            await aiService.generateViabilityReportStream(
                idea,
                queueViabilityStreamChunk,
                { emitDelta: true, signal: controller.signal }
            );
            flushViabilityStreamBuffer();
        } catch (e) {
            if (!isMountedRef.current || controller?.signal.aborted || isAbortError(e)) return;
            setViabilityError(`Error generating report: ${(e as Error).message}`);
        } finally {
            if (!controller) {
                if (isMountedRef.current) {
                    setViabilityLoading(false);
                }
            } else if (viabilityStreamAbortRef.current === controller) {
                viabilityStreamAbortRef.current = null;
                if (isMountedRef.current) {
                    setViabilityLoading(false);
                }
            }
            controller = null;
        }
    };

    // Handler for competitor analysis
    const handleAnalyzeCompetitors = async () => {
        if (!idea || !ready || !canPersistIdea(idea)) return;
        let controller: AbortController | null = null;

        try {
            competitorStreamAbortRef.current?.abort();
            competitorStreamAbortRef.current = null;
            setCompetitorReport('');
            setCompetitorError(null);
            setShowCompetitorModal(true);
            setCompetitorLoading(true);
            competitorStreamBatcherRef.current?.clear();

            controller = new AbortController();
            competitorStreamAbortRef.current = controller;

            await aiService.analyzeCompetitorsStream(
                idea,
                queueCompetitorStreamChunk,
                { emitDelta: true, signal: controller.signal }
            );
            flushCompetitorStreamBuffer();
        } catch (e) {
            if (!isMountedRef.current || controller?.signal.aborted || isAbortError(e)) return;
            setCompetitorError(`Error generating report: ${(e as Error).message}`);
        } finally {
            if (!controller) {
                if (isMountedRef.current) {
                    setCompetitorLoading(false);
                }
            } else if (competitorStreamAbortRef.current === controller) {
                competitorStreamAbortRef.current = null;
                if (isMountedRef.current) {
                    setCompetitorLoading(false);
                }
            }
            controller = null;
        }
    };

    const cancelViabilityAnalysis = useCallback(() => {
        flushViabilityStreamBuffer();
        viabilityStreamAbortRef.current?.abort();
        viabilityStreamAbortRef.current = null;
        viabilityStreamBatcherRef.current?.clear();
        setViabilityLoading(false);
    }, [flushViabilityStreamBuffer]);

    const cancelCompetitorAnalysis = useCallback(() => {
        flushCompetitorStreamBuffer();
        competitorStreamAbortRef.current?.abort();
        competitorStreamAbortRef.current = null;
        competitorStreamBatcherRef.current?.clear();
        setCompetitorLoading(false);
    }, [flushCompetitorStreamBuffer]);

    if (loading) return <div className="p-5">Loading...</div>;
    if (!idea) return <div className="p-5">Idea not found</div>;

    const titleValidationMessage = getTitleValidationMessage(idea.title);
    const hasPersistableTitle = titleValidationMessage === null;
    const summaryEventOptions = [...timelineEvents].reverse();

    return (
        <div className="max-w-[1200px] mx-auto h-full flex flex-col w-full">
            {keywordError && <p role="alert" className="text-danger mb-4">{keywordError}</p>}
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
                            disabled={!hasPersistableTitle}
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
                        disabled={!ready || viabilityLoading || !hasPersistableTitle}
                    >
                        <Search size={20} />
                    </button>
                    <button
                        onClick={handleAnalyzeCompetitors}
                        className="btn-icon text-[#ff3b30]"
                        title="Competitor Analysis"
                        disabled={!ready || competitorLoading || !hasPersistableTitle}
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
                        className={`text-2xl font-bold border-none bg-transparent text-text-primary outline-none ${titleValidationMessage ? 'mb-2' : 'mb-4'}`}
                    />
                    {titleValidationMessage && (
                        <p className="mt-2 mb-4 text-sm text-danger">
                            {titleValidationMessage}
                        </p>
                    )}
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
                                disabled={!ready || extracting || !hasPersistableTitle}
                            >
                                <Sparkles size={12} /> {extracting ? 'Extracting...' : 'Extract'}
                            </button>
                        </div>
                        <div className="flex gap-2 mb-3">
                            <input
                                className="bg-background border border-border rounded-lg px-2 py-1 text-sm flex-1 outline-none focus:border-accent"
                                placeholder="Add keyword..."
                                disabled={!hasPersistableTitle}
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
                                        disabled={!hasPersistableTitle}
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
                    <Chat
                        idea={idea}
                        onChatUpdate={handleChatUpdate}
                        onAppendToNote={handleAppendToNote}
                        interactionBlockedReason={titleValidationMessage ? CHAT_BLOCKED_MESSAGE : null}
                    />
                </div>
            </div>

            <div className="card mt-6">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                        <h2 className="text-lg font-bold text-text-primary">Timeline</h2>
                        <p className="mt-1 text-sm text-text-secondary">
                            Event history, diffs, and an AI summary of how this idea evolved.
                        </p>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 md:min-w-[420px]">
                        <select
                            value={summaryFromId ?? ''}
                            onChange={(e) => setSummaryFromId(e.target.value ? Number(e.target.value) : null)}
                            className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-text-primary outline-none"
                        >
                            <option value="">From event</option>
                            {summaryEventOptions.map((event) => (
                                <option key={`from-${event.id}`} value={event.id}>
                                    #{event.id} {EVENT_LABELS[event.type]}
                                </option>
                            ))}
                        </select>
                        <select
                            value={summaryToId ?? ''}
                            onChange={(e) => setSummaryToId(e.target.value ? Number(e.target.value) : null)}
                            className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-text-primary outline-none"
                        >
                            <option value="">To event</option>
                            {summaryEventOptions.map((event) => (
                                <option key={`to-${event.id}`} value={event.id}>
                                    #{event.id} {EVENT_LABELS[event.type]}
                                </option>
                            ))}
                        </select>
                        <button
                            onClick={handleSummarizeHistory}
                            disabled={!ready || historySummaryLoading || summaryFromId === null || summaryToId === null}
                            className="btn-text justify-center rounded-xl border border-border px-4 py-2 text-sm md:col-span-2"
                        >
                            {historySummaryLoading ? 'Summarizing...' : 'Summarize selected range'}
                        </button>
                    </div>
                </div>

                {(historySummaryLoading || historySummary || historySummaryFallback || historySummaryError) && (
                    <div className="mt-4 rounded-2xl border border-border bg-background p-4">
                        {historySummaryError && (
                            <p className="text-sm text-danger">{historySummaryError}</p>
                        )}
                        {historySummaryFallback ? (
                            <StructuredAiFallback
                                rawOutput={historySummaryFallback.rawOutput}
                                title={historySummaryFallback.title}
                                message={historySummaryFallback.message}
                            />
                        ) : (
                            <div className="markdown-body text-sm leading-relaxed text-text-primary">
                                <ReactMarkdown>{historySummary || (historySummaryLoading ? 'Generating summary...' : '')}</ReactMarkdown>
                            </div>
                        )}
                    </div>
                )}

                <div className="mt-6 space-y-3">
                    {timelineError && (
                        <p className="text-sm text-danger">{timelineError}</p>
                    )}
                    {!timelineLoading && timelineEvents.length === 0 && !timelineError && (
                        <p className="text-sm text-text-secondary">No events recorded yet.</p>
                    )}
                    {timelineEvents.map((event) => {
                        const Icon = EVENT_ICONS[event.type];
                        const diff = eventDiffs[event.id];
                        const isDiffExpanded = expandedDiffIds.includes(event.id);
                        const isDiffLoading = loadingDiffIds.includes(event.id);

                        return (
                            <div key={event.id} className="rounded-2xl border border-border bg-background p-4">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex items-start gap-3">
                                        <div className="rounded-xl bg-accent/10 p-2 text-accent">
                                            <Icon size={16} />
                                        </div>
                                        <div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-sm font-semibold text-text-primary">{EVENT_LABELS[event.type]}</span>
                                                <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-text-secondary">#{event.id}</span>
                                            </div>
                                            <p className="mt-1 text-xs text-text-secondary">
                                                {formatRelativeTimestamp(event.createdAt)}
                                            </p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => void handleToggleDiff(event.id)}
                                        className="btn-text text-xs"
                                    >
                                        {isDiffExpanded ? 'Hide diff' : 'Show diff'}
                                    </button>
                                </div>

                                {isDiffExpanded && (
                                    <div className="mt-4 rounded-xl border border-border/80 bg-surface p-4">
                                        {isDiffLoading && (
                                            <p className="text-sm text-text-secondary">Loading diff...</p>
                                        )}
                                        {!isDiffLoading && diff && (
                                            <div className="space-y-4 text-sm text-text-primary">
                                                {diff.fields.length > 0 ? diff.fields.map((field) => (
                                                    <div key={field.name} className="grid gap-2 md:grid-cols-2">
                                                        <div>
                                                            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-text-secondary">{field.name} before</p>
                                                            <pre className="whitespace-pre-wrap break-words rounded-lg bg-background p-3 text-xs">{renderDiffValue(field.before)}</pre>
                                                        </div>
                                                        <div>
                                                            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-text-secondary">{field.name} after</p>
                                                            <pre className="whitespace-pre-wrap break-words rounded-lg bg-background p-3 text-xs">{renderDiffValue(field.after)}</pre>
                                                        </div>
                                                    </div>
                                                )) : (
                                                    <p className="text-sm text-text-secondary">No top-level field changes in this event.</p>
                                                )}
                                                <div className="flex flex-wrap gap-3 text-xs text-text-secondary">
                                                    <span>Chat turns added: {diff.chatTurnsAdded}</span>
                                                    <span>Keywords added: {diff.keywordsAdded.join(', ') || 'None'}</span>
                                                    <span>Keywords removed: {diff.keywordsRemoved.join(', ') || 'None'}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {hasOlderEvents && (
                        <button
                            onClick={() => void handleLoadOlderEvents()}
                            disabled={timelineLoading}
                            className="btn-text"
                        >
                            {timelineLoading ? 'Loading...' : 'Load older'}
                        </button>
                    )}
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
