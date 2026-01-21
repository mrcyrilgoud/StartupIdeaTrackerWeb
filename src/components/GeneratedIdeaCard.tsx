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
        <div className="card" style={{ marginBottom: '16px', borderLeft: '4px solid var(--color-accent)' }}>
            <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Sparkles size={16} color="var(--color-accent)" />
                {idea.title}
            </h3>
            <p style={{ lineHeight: '1.6', color: 'var(--color-text-secondary)' }}>{idea.details}</p>
            <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                    onClick={handleSave}
                    disabled={saved || loading}
                    className="btn-primary"
                    style={{
                        opacity: saved ? 0.6 : 1,
                        backgroundColor: saved ? '#34C759' : 'var(--color-accent)',
                        display: 'flex', alignItems: 'center', gap: '6px'
                    }}
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
