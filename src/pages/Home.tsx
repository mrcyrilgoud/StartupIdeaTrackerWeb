import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Sparkles, Search, Trash2 } from 'lucide-react';
import { dbService } from '../services/db';
import { aiService, MVPAnalysisResult } from '../services/ai';
import { Idea, IdeaStatus, STATUS_COLORS, STATUS_LABELS } from '../types';
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
    const [viabilityError, setViabilityError] = useState<string | null>(null);
    const [viabilityIdeaTitle, setViabilityIdeaTitle] = useState('');
    const [showViabilityModal, setShowViabilityModal] = useState(false);

    // Delete confirmation state
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [ideaToDelete, setIdeaToDelete] = useState<Idea | null>(null);

    // Filter & Search State
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<IdeaStatus | 'all'>('all');
    const [sortOption, setSortOption] = useState<'newest' | 'oldest' | 'az'>('newest');

    const navigate = useNavigate();

    useEffect(() => {
        loadIdeas();
    }, []);

    const loadIdeas = async () => {
        try {
            setError(null);
            const loaded = await dbService.getAllIdeas();
            // Ensure status exists for backward compatibility
            const cleaned = loaded.map(i => ({
                ...i,
                status: i.status || 'draft'
            }));
            setIdeas(cleaned);
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
            relatedIdeaIds: [],
            status: 'draft'
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
            setViabilityError(null);
            setShowViabilityModal(true);
            setViabilityLoading(true);

            const settings = await dbService.getSettings();

            if (settings.provider === 'gemini' && !settings.geminiKey) {
                setViabilityLoading(false);
                setViabilityError("Please configure your Gemini API Key in Settings first.");
                return;
            }

            const report = await aiService.generateViabilityReport(idea, settings);
            setViabilityReport(report);
        } catch (e) {
            console.error(e);
            setViabilityError(`Error generating report: ${(e as Error).message}`);
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

    // Filter and Sort Logic
    const filteredIdeas = ideas
        .filter(idea => {
            const matchesSearch = (idea.title + idea.details + idea.keywords.join(' ')).toLowerCase().includes(searchQuery.toLowerCase());
            const matchesStatus = statusFilter === 'all' || idea.status === statusFilter;
            return matchesSearch && matchesStatus;
        })
        .sort((a, b) => {
            if (sortOption === 'newest') return b.timestamp - a.timestamp;
            if (sortOption === 'oldest') return a.timestamp - b.timestamp;
            if (sortOption === 'az') return a.title.localeCompare(b.title);
            return 0;
        });

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

            {/* Controls Bar */}
            <div className="card mb-6 p-3 flex gap-4 flex-wrap items-center">
                <div className="flex-1 min-w-[200px] flex items-center border border-border rounded-lg px-3 bg-background">
                    <Search size={18} className="text-text-secondary" />
                    <input
                        className="input border-none bg-transparent shadow-none"
                        placeholder="Search ideas..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>

                <div className="flex items-center gap-2">
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value as any)}
                        className="input w-auto cursor-pointer"
                    >
                        <option value="all">All Statuses</option>
                        {Object.entries(STATUS_LABELS).map(([key, label]) => (
                            <option key={key} value={key}>{label}</option>
                        ))}
                    </select>
                </div>

                <div className="flex items-center gap-2">
                    <select
                        value={sortOption}
                        onChange={(e) => setSortOption(e.target.value as any)}
                        className="input w-auto cursor-pointer"
                    >
                        <option value="newest">Newest First</option>
                        <option value="oldest">Oldest First</option>
                        <option value="az">A-Z</option>
                    </select>
                </div>
            </div>

            {error && (
                <div className="p-4 mb-6 bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-2xl border border-red-200 dark:border-red-800 flex items-center gap-3">
                    <div className="p-2 bg-red-200 dark:bg-red-800 rounded-full">!</div>
                    {error}
                </div>
            )}

            {filteredIdeas.length === 0 && !error ? (
                <div className="text-center p-16 border-2 border-dashed border-border rounded-3xl bg-surface/50">
                    <div className="w-16 h-16 bg-accent/10 text-accent rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <Plus size={32} />
                    </div>
                    <h3 className="text-xl font-bold mb-2">
                        {ideas.length === 0 ? "No ideas yet?" : "No matching ideas"}
                    </h3>
                    <p className="text-text-secondary mb-6 max-w-md mx-auto">
                        {ideas.length === 0
                            ? "Every great startup begins with a simple note. Click the \"New Idea\" button to plant your first seed."
                            : "Try adjusting your search or filters to find what you're looking for."}
                    </p>
                    {ideas.length === 0 && (
                        <button className="btn-primary" onClick={createNewIdea}>
                            Create First Idea
                        </button>
                    )}
                </div>
            ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-6 w-full">
                    {filteredIdeas.map(idea => (
                        <div
                            key={idea.id}
                            className="card group relative flex flex-col h-full cursor-pointer overflow-hidden border-t-4 border-t-transparent hover:border-t-accent transition-all duration-200 hover:-translate-y-1 hover:shadow-lg"
                            onClick={(e) => {
                                if ((e.target as HTMLElement).closest('button')) return;
                                navigate(`/idea/${idea.id}`);
                            }}
                        >
                            <div className="flex justify-between items-start mb-3">
                                <h3 className="m-0 text-lg font-bold pr-2 text-text-primary leading-tight">{idea.title}</h3>
                                {idea.status && (
                                    <span
                                        className="text-[10px] uppercase font-bold px-2 py-1 rounded-full whitespace-nowrap"
                                        style={{
                                            backgroundColor: `${STATUS_COLORS[idea.status]}20`,
                                            color: STATUS_COLORS[idea.status],
                                            border: `1px solid ${STATUS_COLORS[idea.status]}40`
                                        }}
                                    >
                                        {STATUS_LABELS[idea.status]}
                                    </span>
                                )}
                            </div>

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
                error={viabilityError}
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
