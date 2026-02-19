import React, { useState } from 'react';
import { Sparkles, FolderPlus, Check, X } from 'lucide-react';
import { FolderSuggestion } from '../services/ai';
import { Idea } from '../types';

interface SmartOrganizeModalProps {
    isOpen: boolean;
    suggestions: FolderSuggestion[];
    loading: boolean;
    onClose: () => void;
    onApply: (selectedFolders: FolderSuggestion[]) => void;
    ideas: Idea[];
}

export const SmartOrganizeModal: React.FC<SmartOrganizeModalProps> = ({
    isOpen,
    suggestions,
    loading,
    onClose,
    onApply,
    ideas
}) => {
    // Determine which folders are selected to be created/populated
    const [selectedIndices, setSelectedIndices] = useState<number[]>([]);

    // Reset selection when suggestions change
    React.useEffect(() => {
        if (suggestions.length > 0) {
            setSelectedIndices(suggestions.map((_, i) => i)); // Default select all
        }
    }, [suggestions]);

    if (!isOpen) return null;

    const toggleSelection = (index: number) => {
        setSelectedIndices(prev =>
            prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
        );
    };

    const handleApply = () => {
        const selected = suggestions.filter((_, i) => selectedIndices.includes(i));
        onApply(selected);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-surface border border-border rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[80vh] animate-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="p-6 border-b border-border bg-background">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-purple-500/10 rounded-lg text-purple-500">
                                <Sparkles size={24} />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold">Smart Organize</h2>
                                <p className="text-sm text-text-secondary">AI-suggested folder structure for your ideas</p>
                            </div>
                        </div>
                        <button onClick={onClose} className="p-2 hover:bg-accent/10 rounded-full transition-colors">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 bg-surface/50">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                            <div className="w-12 h-12 border-4 border-accent/30 border-t-accent rounded-full animate-spin mb-4" />
                            <h3 className="font-bold text-lg mb-2">Analyzing your ideas...</h3>
                            <p className="text-text-secondary text-sm max-w-xs">
                                Finding common themes and logical groupings for your startup concepts.
                            </p>
                        </div>
                    ) : suggestions.length === 0 ? (
                        <div className="text-center py-12">
                            <p className="text-text-secondary">No suggestions generated. Try adding more details to your ideas.</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {suggestions.map((folder, idx) => {
                                const isSelected = selectedIndices.includes(idx);
                                const folderIdeas = ideas.filter(idea => folder.ideaIds.includes(idea.id));

                                return (
                                    <div
                                        key={idx}
                                        onClick={() => toggleSelection(idx)}
                                        className={`border rounded-xl p-4 cursor-pointer transition-all duration-200 ${isSelected
                                            ? 'border-purple-500/50 bg-purple-500/5 shadow-md'
                                            : 'border-border bg-background opacity-70 hover:opacity-100'
                                            }`}
                                    >
                                        <div className="flex items-start gap-4">
                                            <div className={`mt-1 w-5 h-5 rounded border flex items-center justify-center transition-colors ${isSelected ? 'bg-purple-500 border-purple-500 text-white' : 'border-border'
                                                }`}>
                                                {isSelected && <Check size={12} />}
                                            </div>

                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <FolderPlus size={18} className={isSelected ? "text-purple-500" : "text-text-secondary"} />
                                                    <h3 className="font-bold text-lg">{folder.name}</h3>
                                                    <span className="text-xs px-2 py-0.5 bg-background border border-border rounded-full text-text-secondary">
                                                        {folderIdeas.length} ideas
                                                    </span>
                                                </div>
                                                <p className="text-sm text-text-secondary mb-3">{folder.description}</p>

                                                <div className="pl-4 border-l-2 border-border/50 space-y-1">
                                                    {folderIdeas.slice(0, 3).map(idea => (
                                                        <div key={idea.id} className="text-xs text-text-secondary truncate flex items-center gap-2">
                                                            <div className="w-1 h-1 rounded-full bg-text-secondary/50" />
                                                            {idea.title}
                                                        </div>
                                                    ))}
                                                    {folderIdeas.length > 3 && (
                                                        <div className="text-xs text-text-secondary/70 pl-3 italic">
                                                            + {folderIdeas.length - 3} more...
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-border bg-background flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg hover:bg-accent/10 text-sm font-medium transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleApply}
                        disabled={loading || selectedIndices.length === 0}
                        className={`px-6 py-2 rounded-lg flex items-center gap-2 text-sm font-bold text-white shadow-lg shadow-purple-500/20 transition-all ${loading || selectedIndices.length === 0
                            ? 'bg-text-secondary/50 cursor-not-allowed'
                            : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:scale-105 active:scale-95'
                            }`}
                    >
                        {loading ? 'Processing...' : (
                            <>
                                <Sparkles size={16} />
                                Apply Organization
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};
