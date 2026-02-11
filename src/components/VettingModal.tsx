import React from 'react';
import { Idea, VettingResult, VettingCriteria } from '../types';
import { X, Trash2, AlertTriangle, CheckCircle, Lightbulb, Fingerprint, Scale, Zap } from 'lucide-react';

interface VettingModalProps {
    isOpen: boolean;
    loading: boolean;
    results: VettingResult[];
    ideas: Idea[];
    currentCriteria: VettingCriteria | null;
    onClose: () => void;
    onDelete: (ideaId: string) => void;
    onRunVetting: (criteria: VettingCriteria) => void;
}

export const VettingModal: React.FC<VettingModalProps> = ({ isOpen, loading, results, ideas, currentCriteria, onClose, onDelete, onRunVetting }) => {
    if (!isOpen) return null;

    // Derived state for display
    const getCriteriaLabel = (c: VettingCriteria) => {
        switch (c) {
            case 'realism': return 'Realism';
            case 'creativity': return 'Creativity';
            case 'uniqueness': return 'Uniqueness';
            case 'legality': return 'Legality';
            default: return 'Vetting';
        }
    };

    const getBadLabel = (c: VettingCriteria) => {
        switch (c) {
            case 'realism': return 'Unrealistic';
            case 'creativity': return 'Boring / Cliché';
            case 'uniqueness': return 'Generic / Saturated';
            case 'legality': return 'Illegal / Risky';
            default: return 'Low Score';
        }
    };

    const getGoodLabel = (c: VettingCriteria) => {
        switch (c) {
            case 'realism': return 'Realistic';
            case 'creativity': return 'Creative';
            case 'uniqueness': return 'Unique';
            case 'legality': return 'Safe';
            default: return 'High Score';
        }
    };

    const getIcon = (c: VettingCriteria) => {
        switch (c) {
            case 'realism': return <AlertTriangle className="text-amber-500" />;
            case 'creativity': return <Lightbulb className="text-yellow-500" />;
            case 'uniqueness': return <Fingerprint className="text-purple-500" />;
            case 'legality': return <Scale className="text-blue-500" />;
            default: return <Zap />;
        }
    };

    // Results Phase (includes Loading)
    // Filter results to match current criteria to prevent race conditions
    const relevantResults = currentCriteria
        ? results.filter(r => r.criteria === currentCriteria)
        : [];

    // Filter to show only low scores (e.g., < 6) or separate them
    const unrealisticIdeas = relevantResults
        .filter(r => r.score < 6)
        .sort((a, b) => a.score - b.score);

    const realisticIdeas = relevantResults.filter(r => r.score >= 6);

    const getIdeaTitle = (id: string) => ideas.find(i => i.id === id)?.title || "Unknown Idea";

    // Setup Phase
    if (!loading && results.length === 0) {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
                <div className="bg-background rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col border border-border">
                    <div className="p-6 border-b border-border flex justify-between items-center bg-surface/50 rounded-t-2xl">
                        <h2 className="text-2xl font-bold flex items-center gap-2">
                            <Zap className="text-accent" />
                            Vet Ideas
                        </h2>
                        <button onClick={onClose} className="p-2 hover:bg-accent/10 rounded-full transition-colors">
                            <X size={20} />
                        </button>
                    </div>
                    <div className="p-8">
                        <h3 className="text-lg font-semibold mb-6 text-center">What should we analyze for?</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <button
                                onClick={() => onRunVetting('realism')}
                                className="p-6 rounded-xl border border-border hover:border-amber-500 hover:bg-amber-500/5 transition-all text-left group"
                            >
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500 group-hover:bg-amber-500 group-hover:text-white transition-colors">
                                        <AlertTriangle size={24} />
                                    </div>
                                    <span className="font-bold text-lg">Realism</span>
                                </div>
                                <p className="text-sm text-text-secondary">Identify sci-fi, impossible, or physically unfeasible ideas.</p>
                            </button>

                            <button
                                onClick={() => onRunVetting('creativity')}
                                className="p-6 rounded-xl border border-border hover:border-yellow-500 hover:bg-yellow-500/5 transition-all text-left group"
                            >
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="p-2 rounded-lg bg-yellow-500/10 text-yellow-500 group-hover:bg-yellow-500 group-hover:text-white transition-colors">
                                        <Lightbulb size={24} />
                                    </div>
                                    <span className="font-bold text-lg">Creativity</span>
                                </div>
                                <p className="text-sm text-text-secondary">Find boring, cliché, or repetitive ideas that lack spark.</p>
                            </button>

                            <button
                                onClick={() => onRunVetting('uniqueness')}
                                className="p-6 rounded-xl border border-border hover:border-purple-500 hover:bg-purple-500/5 transition-all text-left group"
                            >
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="p-2 rounded-lg bg-purple-500/10 text-purple-500 group-hover:bg-purple-500 group-hover:text-white transition-colors">
                                        <Fingerprint size={24} />
                                    </div>
                                    <span className="font-bold text-lg">Uniqueness</span>
                                </div>
                                <p className="text-sm text-text-secondary">Highlight generic ideas in saturated markets.</p>
                            </button>

                            <button
                                onClick={() => onRunVetting('legality')}
                                className="p-6 rounded-xl border border-border hover:border-blue-500 hover:bg-blue-500/5 transition-all text-left group"
                            >
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500 group-hover:bg-blue-500 group-hover:text-white transition-colors">
                                        <Scale size={24} />
                                    </div>
                                    <span className="font-bold text-lg">Legality</span>
                                </div>
                                <p className="text-sm text-text-secondary">Flag illegal, unethical, or dangerous concepts.</p>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Results Phase (includes Loading)
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-background rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col border border-border">
                <div className="p-6 border-b border-border flex justify-between items-center bg-surface/50 rounded-t-2xl">
                    <h2 className="text-2xl font-bold flex items-center gap-2">
                        {currentCriteria ? getIcon(currentCriteria) : <Zap />}
                        {currentCriteria ? `Vetting: ${getCriteriaLabel(currentCriteria)}` : 'Vetting Ideas'}
                    </h2>
                    <button onClick={onClose} className="p-2 hover:bg-accent/10 rounded-full transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="overflow-y-auto p-6 space-y-6">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-12 space-y-4">
                            <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin"></div>
                            <p className="text-text-secondary animate-pulse">Consulting the oracle...</p>
                        </div>
                    ) : relevantResults.length === 0 ? (
                        <div className="text-center py-12 text-text-secondary">
                            No results found.
                        </div>
                    ) : (
                        <>
                            {unrealisticIdeas.length > 0 && (
                                <div className="space-y-4">
                                    <h3 className="font-bold text-red-500 flex items-center gap-2">
                                        <AlertTriangle size={18} />
                                        {currentCriteria ? getBadLabel(currentCriteria) : 'Low Score'} (Score &lt; 6)
                                    </h3>
                                    <p className="text-sm text-text-secondary">Consider removing these to clean up your list.</p>

                                    <div className="space-y-3">
                                        {unrealisticIdeas.map(result => (
                                            <div key={result.ideaId} className="p-4 rounded-xl border border-red-500/20 bg-red-500/5 hover:bg-red-500/10 transition-colors flex items-start gap-4 group">
                                                <div className="flex-1">
                                                    <div className="flex justify-between items-start mb-1">
                                                        <h4 className="font-bold text-lg">{getIdeaTitle(result.ideaId)}</h4>
                                                        <span className="text-xs font-bold text-red-500 px-2 py-1 bg-red-500/10 rounded-full border border-red-500/20">
                                                            Score: {result.score}/10
                                                        </span>
                                                    </div>
                                                    <p className="text-sm text-text-secondary leading-relaxed">{result.reason}</p>
                                                </div>
                                                <button
                                                    onClick={() => onDelete(result.ideaId)}
                                                    className="p-2 text-red-500 hover:bg-red-500/20 rounded-lg transition-colors shrink-0 flex flex-col items-center gap-1"
                                                    title="Delete this idea"
                                                >
                                                    <Trash2 size={20} />
                                                    <span className="text-[10px] uppercase font-bold">Delete</span>
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {realisticIdeas.length > 0 && (
                                <div className="space-y-4 mt-8 pt-6 border-t border-border">
                                    <h3 className="font-bold text-green-500 flex items-center gap-2">
                                        <CheckCircle size={18} />
                                        {currentCriteria ? getGoodLabel(currentCriteria) : 'High Score'} (Score 6+)
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 opacity-60 hover:opacity-100 transition-opacity">
                                        {realisticIdeas.map(result => (
                                            <div key={result.ideaId} className="p-3 rounded-lg border border-green-500/20 bg-green-500/5 flex justify-between items-center">
                                                <span className="font-medium truncate pr-2">{getIdeaTitle(result.ideaId)}</span>
                                                <span className="text-xs font-bold text-green-600 bg-green-500/20 px-2 py-0.5 rounded-full">
                                                    {result.score}/10
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {unrealisticIdeas.length === 0 && realisticIdeas.length > 0 && (
                                <div className="text-center py-8 text-green-500 font-medium">
                                    Great job! All your ideas passed the {currentCriteria} check.
                                </div>
                            )}
                        </>
                    )}
                </div>

                <div className="p-6 border-t border-border flex justify-end bg-surface/50 rounded-b-2xl">
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
