import React, { useState } from 'react';
import { Sparkles, Check, Save } from 'lucide-react';
import { GeneratedIdea } from '../services/ai';

interface GeneratedIdeaCardProps {
    idea: GeneratedIdea;
    onSave: (idea: GeneratedIdea) => Promise<void>;
}

export const GeneratedIdeaCard: React.FC<GeneratedIdeaCardProps> = ({ idea, onSave }) => {
    const [saved, setSaved] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleSave = async () => {
        setLoading(true);
        await onSave(idea);
        setSaved(true);
        setLoading(false);
    };

    return (
        <div className="card mb-4 border-l-4 border-accent">
            <h3 className="mt-0 flex items-center gap-2">
                <Sparkles size={16} className="text-accent" />
                {idea.title}
            </h3>
            <p className="leading-relaxed text-text-secondary">{idea.details}</p>
            <div className="mt-4 flex justify-end">
                <button
                    onClick={handleSave}
                    disabled={saved || loading}
                    className={`btn-primary flex items-center gap-1.5 ${saved ? 'opacity-60 bg-green-500 hover:bg-green-600 border-green-500' : ''}`}
                >
                    {loading ? 'Saving...' : saved ? (
                        <>
                            <Check size={18} /> Saved
                        </>
                    ) : (
                        <>
                            <Save size={18} /> Save to Library
                        </>
                    )}
                </button>
            </div>
        </div>
    );
};
