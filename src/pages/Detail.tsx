import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { dbService } from '../services/db';
import { aiService } from '../services/ai';
import { Idea, AppSettings } from '../types';
import { Chat } from '../components/features/Chat';
import { ArrowLeft, Sparkles, Trash2 } from 'lucide-react';

export const Detail: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [idea, setIdea] = useState<Idea | null>(null);
    const [loading, setLoading] = useState(true);
    const [settings, setSettings] = useState<AppSettings | null>(null);

    useEffect(() => {
        const init = async () => {
            if (id) {
                const loaded = await dbService.getIdea(id);
                if (loaded) setIdea(loaded);
            }
            const s = await dbService.getSettings();
            setSettings(s);
            setLoading(false);
        };
        init();
    }, [id]);

    const saveIdea = async (updated: Idea) => {
        setIdea(updated);
        await dbService.saveIdea(updated);
    };

    const deleteIdea = async () => {
        if (id && confirm('Are you sure you want to delete this idea?')) {
            await dbService.deleteIdea(id);
            navigate('/');
        }
    };

    const extractKeywords = async () => {
        if (!idea || !settings) return;
        try {
            const keywords = await aiService.extractKeywords(idea, settings);
            await saveIdea({ ...idea, keywords });
        } catch (e) {
            alert('Failed to extract keywords');
        }
    };

    if (loading) return <div style={{ padding: '20px' }}>Loading...</div>;
    if (!idea) return <div style={{ padding: '20px' }}>Idea not found</div>;

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <button
                    onClick={() => navigate('/')}
                    className="btn-icon"
                >
                    <ArrowLeft size={20} /> Back
                </button>
                <button
                    onClick={deleteIdea}
                    className="btn-icon danger"
                >
                    <Trash2 size={20} />
                </button>
            </div>

            <div className="responsive-grid">
                {/* Left Column: Editor */}
                <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <input
                        value={idea.title}
                        onChange={e => saveIdea({ ...idea, title: e.target.value })}
                        placeholder="Idea Title"
                        style={{
                            fontSize: '1.5rem',
                            fontWeight: 'bold',
                            border: 'none',
                            background: 'transparent',
                            marginBottom: '16px',
                            color: 'var(--color-text-primary)',
                            outline: 'none'
                        }}
                    />
                    <textarea
                        value={idea.details}
                        onChange={e => saveIdea({ ...idea, details: e.target.value })}
                        placeholder="Describe your idea in detail..."
                        style={{
                            flex: 1,
                            border: 'none',
                            background: 'transparent',
                            resize: 'none',
                            color: 'var(--color-text-primary)',
                            fontSize: '1rem',
                            outline: 'none',
                            lineHeight: '1.6'
                        }}
                    />

                    <div style={{ marginTop: '16px', borderTop: '1px solid var(--color-border)', paddingTop: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--color-text-secondary)' }}>KEYWORDS</span>
                            <button
                                onClick={extractKeywords}
                                className="btn-text"
                            >
                                <Sparkles size={12} /> Extract
                            </button>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {idea.keywords.map((kw, idx) => (
                                <span key={idx} style={{ fontSize: '0.8rem', backgroundColor: 'var(--color-background)', padding: '4px 12px', borderRadius: '16px' }}>
                                    {kw}
                                </span>
                            ))}
                            {idea.keywords.length === 0 && <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.8rem' }}>No keywords extracted yet.</span>}
                        </div>
                    </div>
                </div>

                {/* Right Column: Chat */}
                <div style={{ height: '100%' }}>
                    <Chat idea={idea} onUpdate={saveIdea} />
                </div>
            </div>
        </div>
    );
};
