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
        const init = async () => {
            try {
                const [loadedIdeas, loadedSettings] = await Promise.all([
                    dbService.getAllIdeas(),
                    dbService.getSettings()
                ]);
                setIdeas(loadedIdeas);
                setSettings(loadedSettings);
            } catch (e) {
                setError('Failed to connect to database. Make sure the server is running.');
            }
        };
        init();
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
        <div className="max-w-[800px] mx-auto">
            <h2 className="text-2xl font-bold mb-4">Idea Generator</h2>

            <div className="card mb-6">
                <div className="flex gap-4 mb-4">
                    <button
                        onClick={() => setMode('standard')}
                        className={`flex-1 p-3 rounded-lg font-semibold cursor-pointer transition-colors flex items-center justify-center
                            ${mode === 'standard' 
                                ? 'border-2 border-accent bg-[#5856d61a] text-accent' 
                                : 'border border-border bg-transparent text-text-primary hover:bg-background'
                            }`}
                    >
                        <Sparkles size={20} className="mr-2" />
                        New Ideas
                    </button>
                    <button
                        onClick={() => setMode('combination')}
                        className={`flex-1 p-3 rounded-lg font-semibold cursor-pointer transition-colors flex items-center justify-center
                            ${mode === 'combination' 
                                ? 'border-2 border-accent bg-[#5856d61a] text-accent' 
                                : 'border border-border bg-transparent text-text-primary hover:bg-background'
                            }`}
                    >
                        <Layers size={20} className="mr-2" />
                        Combine Existing
                    </button>
                </div>

                {mode === 'standard' && (
                    <div className="mb-4">
                        <label className="block mb-2 font-medium">Topic / Keywords (Optional)</label>
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
                    className="btn-primary w-full flex justify-center items-center gap-2"
                    onClick={handleGenerate}
                    disabled={loading}
                >
                    {loading ? 'Thinking Deeply...' : 'Generate with AI'}
                    {!loading && <Sparkles size={18} />}
                </button>
            </div>

            {error && (
                <div className="p-4 bg-[#FF3B3020] text-[#FF3B30] rounded-lg mb-4">
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
