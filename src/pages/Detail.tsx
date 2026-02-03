import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { dbService } from '../services/db';
import { aiService } from '../services/ai';
import { Idea, AppSettings, ChatMessage } from '../types';
import { Chat } from '../components/features/Chat';
import { ConfirmModal } from '../components/ConfirmModal';
import { OpenCodeModal } from '../components/OpenCodeModal';
import { BusinessViabilityModal } from '../components/BusinessViabilityModal';
import { CompetitorAnalysisModal } from '../components/CompetitorAnalysisModal';
import { ArrowLeft, Sparkles, Trash2, Terminal, Search, Swords } from 'lucide-react';

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

    // Competitor analysis state
    const [competitorLoading, setCompetitorLoading] = useState(false);
    const [competitorReport, setCompetitorReport] = useState('');
    const [showCompetitorModal, setShowCompetitorModal] = useState(false);

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

    // Handler for competitor analysis
    const handleAnalyzeCompetitors = async () => {
        if (!idea || !settings) return;

        try {
            setCompetitorReport('');
            setShowCompetitorModal(true);
            setCompetitorLoading(true);

            if (settings.provider === 'gemini' && !settings.geminiKey) {
                setCompetitorLoading(false);
                setShowCompetitorModal(false);
                alert("Please configure your Gemini API Key in Settings first.");
                return;
            }

            const report = await aiService.analyzeCompetitors(idea, settings);
            setCompetitorReport(report);
        } catch (e) {
            console.error(e);
            setCompetitorReport(`Error generating report: ${(e as Error).message}`);
        } finally {
            setCompetitorLoading(false);
        }
    };

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
                <div className="flex gap-2">
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
                        <div className="flex gap-2 flex-wrap">
                            {idea.keywords.map((kw, idx) => (
                                <span key={idx} className="text-xs bg-background px-3 py-1 rounded-2xl">
                                    {kw}
                                </span>
                            ))}
                            {idea.keywords.length === 0 && <span className="text-text-secondary text-xs">No keywords extracted yet.</span>}
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
                onClose={() => setShowViabilityModal(false)}
            />

            <CompetitorAnalysisModal
                isOpen={showCompetitorModal}
                loading={competitorLoading}
                ideaTitle={idea.title}
                report={competitorReport}
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
