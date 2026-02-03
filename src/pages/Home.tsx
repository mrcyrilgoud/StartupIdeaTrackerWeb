import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Sparkles, Search, Trash2, ArrowRight } from 'lucide-react';
import { dbService } from '../services/db';
import { aiService, MVPAnalysisResult } from '../services/ai';
import { Idea } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { MVPResultModal } from '../components/MVPResultModal';
import { BusinessViabilityModal } from '../components/BusinessViabilityModal';
import { ConfirmModal } from '../components/ConfirmModal';

export const Home: React.FC = () => {
    const [ideas, setIdeas] = useState<Idea[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [analyzingMVP, setAnalyzingMVP] = useState(false);
    const [mvpResult, setMvpResult] = useState<MVPAnalysisResult | null>(null);
    const [showMVPModal, setShowMVPModal] = useState(false);

    // Viability analysis state
    const [viabilityLoading, setViabilityLoading] = useState(false);
    const [viabilityReport, setViabilityReport] = useState('');
    const [viabilityIdeaTitle, setViabilityIdeaTitle] = useState('');
    const [showViabilityModal, setShowViabilityModal] = useState(false);

    // Delete confirmation state
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [ideaToDelete, setIdeaToDelete] = useState<Idea | null>(null);

    const navigate = useNavigate();

    useEffect(() => {
        loadIdeas();
    }, []);

    const loadIdeas = async () => {
        try {
            setError(null);
            const loaded = await dbService.getAllIdeas();
            setIdeas(loaded.sort((a, b) => b.timestamp - a.timestamp)); // Newest first
        } catch (e) {
            setError("Could not connect to the database. Make sure 'npm run dev' is running.");
        }
    };

    const createNewIdea = async () => {
        const newIdea: Idea = {
            id: uuidv4(),
            title: 'New Idea',
            details: '',
            timestamp: Date.now(),
            keywords: [],
            chatHistory: [],
            relatedIdeaIds: []
        };
        // Don't save immediately - wait for user input
        // navigate(`/idea/${newIdea.id}`);
        // We pass the new object in state so Detail page can load it without DB
        navigate(`/idea/${newIdea.id}`, { state: { idea: newIdea, isNew: true } });
    };

    const handleAnalyzeViability = async (e: React.MouseEvent, idea: Idea) => {
        e.preventDefault(); // Prevent navigation to detail page
        e.stopPropagation();

        try {
            setViabilityIdeaTitle(idea.title);
            setViabilityReport('');
            setShowViabilityModal(true);
            setViabilityLoading(true);

            const settings = await dbService.getSettings();

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

    const handleAnalyzeMVP = async () => {
        if (ideas.length === 0) {
            alert("No ideas to analyze!");
            return;
        }

        try {
            setAnalyzingMVP(true);
            const settings = await dbService.getSettings();

            // Check if key is configured for Gemini (default)
            if (settings.provider === 'gemini' && !settings.geminiKey) {
                alert("Please configure your Gemini API Key in Settings first.");
                setAnalyzingMVP(false);
                return;
            }

            const result = await aiService.findSimplestMVP(ideas, settings);
            setMvpResult(result);
            setShowMVPModal(true);
        } catch (e) {
            console.error(e);
            alert("Failed to analyze MVP. Please check your AI settings and try again.");
        } finally {
            setAnalyzingMVP(false);
        }
    };

    const handleDeleteIdea = (e: React.MouseEvent, idea: Idea) => {
        e.preventDefault();
        e.stopPropagation();
        setIdeaToDelete(idea);
        setShowDeleteModal(true);
    };

    const confirmDeleteIdea = async () => {
        if (!ideaToDelete) return;

        try {
            await dbService.deleteIdea(ideaToDelete.id);
            setIdeas(prev => prev.filter(i => i.id !== ideaToDelete.id));
        } catch (e) {
            console.error('Failed to delete idea:', e);
            alert('Failed to delete idea. Please try again.');
        } finally {
            setShowDeleteModal(false);
            setIdeaToDelete(null);
        }
    };

    const getWinningIdeaTitle = () => {
        if (!mvpResult) return "";
        const idea = ideas.find(i => i.id === mvpResult.ideaId);
        return idea ? idea.title : "Unknown Idea";
    };

    return (
        <div className="max-w-6xl mx-auto w-full pb-20">
            {/* Hero Section */}
            <div className="mb-10 text-center py-10">
                <h2 className="text-4xl font-extrabold mb-3 bg-clip-text text-transparent bg-gradient-to-r from-accent via-purple-500 to-indigo-600">
                    Your Idea Garden, <br />
                    Powered by AI.
                </h2>
                <p className="text-text-secondary text-lg max-w-2xl mx-auto">
                    Capture, analyze, and refine your next big thing. Let AI handle the heavy lifting while you focus on the vision.
                </p>
                <div className="flex justify-center gap-4 mt-8">
                    <button
                        className={`btn-primary flex items-center gap-2 ${(analyzingMVP || ideas.length === 0) ? 'cursor-not-allowed opacity-60' : 'cursor-pointer opacity-100'
                            }`}
                        onClick={handleAnalyzeMVP}
                        disabled={analyzingMVP || ideas.length === 0}
                    >
                        <Sparkles size={18} className={analyzingMVP ? "dot-animate" : ""} />
                        {analyzingMVP ? 'Analyzing...' : 'Find Simplest MVP'}
                    </button>
                    <button className="btn-primary bg-surface !bg-none !text-text-primary border border-border shadow-sm hover:bg-background" onClick={createNewIdea}>
                        <Plus size={18} />
                        New Idea
                    </button>
                </div>
            </div>

            {error && (
                <div className="p-4 mb-6 bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-2xl border border-red-200 dark:border-red-800 flex items-center gap-3">
                    <div className="p-2 bg-red-200 dark:bg-red-800 rounded-full">!</div>
                    {error}
                </div>
            )}

            {ideas.length === 0 && !error ? (
                <div className="text-center p-16 border-2 border-dashed border-border rounded-3xl bg-surface/50">
                    <div className="w-16 h-16 bg-accent/10 text-accent rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <Plus size={32} />
                    </div>
                    <h3 className="text-xl font-bold mb-2">No ideas yet?</h3>
                    <p className="text-text-secondary mb-6 max-w-md mx-auto">
                        Every great startup begins with a simple note. Click the "New Idea" button to plant your first seed.
                    </p>
                    <button className="btn-primary" onClick={createNewIdea}>
                        Create First Idea
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-6 w-full">
                    {ideas.map(idea => (
                        <div
                            key={idea.id}
                            className="card group relative flex flex-col h-full cursor-pointer overflow-hidden border-t-4 border-t-transparent hover:border-t-accent"
                            onClick={(e) => {
                                if ((e.target as HTMLElement).closest('button')) return;
                                navigate(`/idea/${idea.id}`);
                            }}
                        >
                            <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                <ArrowRight size={20} className="text-accent" />
                            </div>

                            <h3 className="m-0 mb-3 text-lg font-bold pr-8 text-text-primary leading-tight">{idea.title}</h3>
                            <p className="flex-1 text-text-secondary line-clamp-3 overflow-hidden text-sm leading-relaxed mb-4">
                                {idea.details || 'No details provided...'}
                            </p>

                            <div className="flex flex-wrap gap-2 mb-4">
                                {idea.keywords.slice(0, 3).map((kw, idx) => (
                                    <span key={idx} className="text-[10px] font-bold uppercase tracking-wider bg-accent/5 text-accent px-2 py-1 rounded-md border border-accent/10">
                                        {kw}
                                    </span>
                                ))}
                            </div>

                            <div className="mt-auto pt-4 border-t border-border/50 flex gap-2" onClick={(e) => e.stopPropagation()}>
                                <button
                                    onClick={(e) => handleAnalyzeViability(e, idea)}
                                    className="flex-1 btn-text text-xs justify-center bg-background hover:bg-accent hover:text-white border border-border/50"
                                >
                                    <Search size={14} /> Viability
                                </button>
                                <button
                                    onClick={(e) => handleDeleteIdea(e, idea)}
                                    className="btn-icon p-1.5 text-text-secondary hover:text-danger hover:bg-danger/10 rounded-lg transition-colors"
                                    title="Delete this idea"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <MVPResultModal
                isOpen={showMVPModal}
                title={getWinningIdeaTitle()}
                reason={mvpResult?.reason || ""}
                ideaId={mvpResult?.ideaId || ""}
                onClose={() => setShowMVPModal(false)}
            />

            <BusinessViabilityModal
                isOpen={showViabilityModal}
                loading={viabilityLoading}
                ideaTitle={viabilityIdeaTitle}
                report={viabilityReport}
                onClose={() => setShowViabilityModal(false)}
            />

            <ConfirmModal
                isOpen={showDeleteModal}
                title="Delete Idea"
                message={`Are you sure you want to delete "${ideaToDelete?.title}"? This action cannot be undone.`}
                onConfirm={confirmDeleteIdea}
                onCancel={() => {
                    setShowDeleteModal(false);
                    setIdeaToDelete(null);
                }}
            />

            {/* Floating indicator for background report generation */}
            {!showViabilityModal && (viabilityLoading || viabilityReport) && (
                <div
                    onClick={() => setShowViabilityModal(true)}
                    className={`fixed bottom-8 right-8 text-white px-6 py-4 rounded-2xl shadow-xl shadow-accent/20 cursor-pointer flex items-center gap-3 text-sm font-bold z-[999] transition-transform duration-200 hover:scale-105 hover:-translate-y-1 ${viabilityLoading ? 'bg-accent' : 'bg-success'}`}
                >
                    {viabilityLoading ? (
                        <>
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            <div>
                                <div className="text-xs opacity-80 uppercase tracking-wider">AI Agent</div>
                                Generating Report...
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="p-1 bg-white/20 rounded-full">
                                <Sparkles size={16} className="fill-current" />
                            </div>
                            <div>
                                <div className="text-xs opacity-80 uppercase tracking-wider">Done</div>
                                Report Ready!
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};
