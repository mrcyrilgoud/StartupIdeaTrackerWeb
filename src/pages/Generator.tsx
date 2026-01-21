import React, { useState, useEffect } from 'react';
import { Sparkles, Layers } from 'lucide-react';
import { dbService } from '../services/db';
import { aiService } from '../services/ai';
import { Idea, AppSettings } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { GeneratedIdeaCard } from '../components/GeneratedIdeaCard';

export const Generator: React.FC = () => {
    const [mode, setMode] = useState<'standard' | 'combination'>('standard');
    const [loading, setLoading] = useState(false);
    const [userPrompt, setUserPrompt] = useState('');
    const [generatedIdeas, setGeneratedIdeas] = useState<{ title: string, details: string }[]>([]);
    const [error, setError] = useState<string>('');
    const [ideas, setIdeas] = useState<Idea[]>([]);
    const [settings, setSettings] = useState<AppSettings | null>(null);

    useEffect(() => {
        dbService.getAllIdeas().then(setIdeas);
        dbService.getSettings().then(setSettings);
    }, []);

    const handleGenerate = async () => {
        if (!settings) return;
        setLoading(true);
        setError('');
        setGeneratedIdeas([]);

        try {
            let prompt = "";
            let newIdeas: { title: string, details: string }[] = [];

            if (mode === 'standard') {
                const basePrompt = "Generate 3 unique and innovative startup ideas";
                const criteria = "Ensure these are viable and creative projects which lack a current existing alternative in the marketplace.";

                if (userPrompt.trim()) {
                    prompt = `${basePrompt} based on this topic: "${userPrompt}". ${criteria}`;
                } else {
                    prompt = `${basePrompt}. ${criteria}`;
                }
                newIdeas = await aiService.generateIdeas(prompt, settings);
            } else {
                const titles = ideas.map(i => i.title).join(", ");
                prompt = `
                I have the following startup ideas: ${titles}.
                Please combine concepts from these ideas to create 3 NEW, hybrid startup ideas. 
                Ensure these are viable and creative projects which lack a current existing alternative in the marketplace.
                Explain the inspiration for each.
                `;
                newIdeas = await aiService.generateIdeas(prompt, settings);
            }

            setGeneratedIdeas(newIdeas);
        } catch (error) {
            setError(`Error: ${(error as Error).message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleSaveIdea = async (idea: { title: string, details: string }) => {
        const newIdea: Idea = {
            id: uuidv4(),
            title: idea.title,
            details: idea.details,
            timestamp: Date.now(),
            keywords: [],
            chatHistory: [],
            relatedIdeaIds: []
        };
        await dbService.saveIdea(newIdea);
        // We stay on the page to allow saving others
    };

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '16px' }}>Idea Generator</h2>

            <div className="card" style={{ marginBottom: '24px' }}>
                <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
                    <button
                        onClick={() => setMode('standard')}
                        style={{
                            flex: 1,
                            padding: '12px',
                            borderRadius: '8px',
                            border: mode === 'standard' ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                            backgroundColor: mode === 'standard' ? 'rgba(88, 86, 214, 0.1)' : 'transparent',
                            color: mode === 'standard' ? 'var(--color-accent)' : 'var(--color-text-primary)',
                            cursor: 'pointer',
                            fontWeight: '600'
                        }}
                    >
                        <Sparkles size={20} style={{ verticalAlign: 'middle', marginRight: '8px' }} />
                        New Ideas
                    </button>
                    <button
                        onClick={() => setMode('combination')}
                        style={{
                            flex: 1,
                            padding: '12px',
                            borderRadius: '8px',
                            border: mode === 'combination' ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                            backgroundColor: mode === 'combination' ? 'rgba(88, 86, 214, 0.1)' : 'transparent',
                            color: mode === 'combination' ? 'var(--color-accent)' : 'var(--color-text-primary)',
                            cursor: 'pointer',
                            fontWeight: '600'
                        }}
                    >
                        <Layers size={20} style={{ verticalAlign: 'middle', marginRight: '8px' }} />
                        Combine Existing
                    </button>
                </div>

                {mode === 'standard' && (
                    <div style={{ marginBottom: '16px' }}>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>Topic / Keywords (Optional)</label>
                        <textarea
                            className="input"
                            rows={3}
                            value={userPrompt}
                            onChange={(e) => setUserPrompt(e.target.value)}
                            placeholder="e.g. AI for healthcare, sustainable fashion, productivity tools..."
                        />
                    </div>
                )}

                <button
                    className="btn-primary"
                    onClick={handleGenerate}
                    disabled={loading}
                    style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}
                >
                    {loading ? 'Thinking Deeply...' : 'Generate with AI'}
                    {!loading && <Sparkles size={18} />}
                </button>
            </div>

            {error && (
                <div style={{ padding: '16px', backgroundColor: '#FF3B3020', color: '#FF3B30', borderRadius: '8px', marginBottom: '16px' }}>
                    {error}
                </div>
            )}

            <div className="responsive-grid">
                {generatedIdeas.map((idea, index) => (
                    <GeneratedIdeaCard key={index} idea={idea} onSave={handleSaveIdea} />
                ))}
            </div>
        </div>
    );
};
