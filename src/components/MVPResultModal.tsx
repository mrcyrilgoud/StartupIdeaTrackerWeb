import React from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, ArrowRight, X } from 'lucide-react';
import { Idea } from '../types';
import { MVPAnalysisResult } from '../services/ai';
import { StructuredAiFallback } from './StructuredAiFallback';

interface MVPResultModalProps {
    isOpen: boolean;
    results: MVPAnalysisResult[] | null;
    rawOutput?: string | null;
    ideas: Idea[];
    onClose: () => void;
}

export const MVPResultModal: React.FC<MVPResultModalProps> = ({
    isOpen,
    results,
    rawOutput,
    ideas,
    onClose
}) => {
    if (!isOpen || (!results && !rawOutput)) return null;

    const getIdeaTitle = (id: string) => ideas.find(i => i.id === id)?.title || "Unknown Idea";

    // Sort results by score (highest = simplest)
    const sortedResults = results ? [...results].sort((a, b) => b.score - a.score) : [];

    return (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-[1000] backdrop-blur-[4px]">
            <div className="card w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6 animate-slideIn relative flex flex-col">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 bg-transparent border-none cursor-pointer text-text-secondary hover:bg-surface rounded-full p-2 z-10 transition-colors"
                >
                    <X size={20} />
                </button>

                <div className="flex items-center gap-3 mb-6 border-b border-border pb-4">
                    <div className="bg-[#5856d61a] p-2 rounded-full text-accent">
                        <Sparkles size={24} />
                    </div>
                    <div>
                        <h3 className="m-0 text-xl font-bold">Simplest MVP Ranking</h3>
                        <p className="text-sm text-text-secondary m-0 mt-1">Ordered from easiest to hardest to build.</p>
                    </div>
                </div>

                <div className="space-y-4 mb-6">
                    {rawOutput ? (
                        <StructuredAiFallback
                            title="MVP Ranking Fallback"
                            rawOutput={rawOutput}
                        />
                    ) : sortedResults.map((result) => {
                        // Score 8-10: Green (Easiest), 5-7: Yellow, 1-4: Red (Hardest)
                        let colorClass = "bg-green-500";
                        let textClass = "text-green-500";
                        let borderClass = "border-green-500/20";
                        let bgHoverClass = "hover:bg-green-500/10";
                        let bgSubtleClass = "bg-green-500/5";

                        if (result.score <= 4) {
                            colorClass = "bg-red-500";
                            textClass = "text-red-500";
                            borderClass = "border-red-500/20";
                            bgHoverClass = "hover:bg-red-500/10";
                            bgSubtleClass = "bg-red-500/5";
                        } else if (result.score <= 7) {
                            colorClass = "bg-amber-500";
                            textClass = "text-amber-500";
                            borderClass = "border-amber-500/20";
                            bgHoverClass = "hover:bg-amber-500/10";
                            bgSubtleClass = "bg-amber-500/5";
                        }

                        return (
                            <div key={result.ideaId} className={`p-4 rounded-xl border ${borderClass} ${bgSubtleClass} ${bgHoverClass} transition-all group`}>
                                <div className="flex justify-between items-start mb-2">
                                    <h4 className="font-bold text-lg m-0">{getIdeaTitle(result.ideaId)}</h4>
                                    <Link to={`/idea/${result.ideaId}`} onClick={onClose} className="no-underline shrink-0 ml-4">
                                        <button className="flex items-center gap-1 text-xs font-bold text-accent bg-accent/10 hover:bg-accent/20 px-3 py-1.5 rounded-full transition-colors border border-accent/20">
                                            View <ArrowRight size={14} />
                                        </button>
                                    </Link>
                                </div>

                                <div className="flex items-center gap-3 w-full mb-3">
                                    <span className={`text-sm font-bold ${textClass} w-16`}>
                                        Score: {result.score}
                                    </span>
                                    <div className="flex-1 h-2 bg-background rounded-full overflow-hidden border border-border/50">
                                        <div
                                            className={`h-full ${colorClass} rounded-full transition-all duration-1000 ease-out`}
                                            style={{ width: `${(result.score / 10) * 100}%` }}
                                        />
                                    </div>
                                </div>
                                <p className="text-sm text-text-secondary leading-relaxed m-0">{result.reason}</p>
                            </div>
                        );
                    })}
                </div>

                <div className="flex justify-end mt-auto pt-4 border-t border-border">
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
