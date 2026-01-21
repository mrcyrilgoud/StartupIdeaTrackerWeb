import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { dbService } from '../services/db';
import { Idea } from '../types';
import { v4 as uuidv4 } from 'uuid';

export const Home: React.FC = () => {
    const [ideas, setIdeas] = useState<Idea[]>([]);
    const navigate = useNavigate();

    useEffect(() => {
        loadIdeas();
    }, []);

    const loadIdeas = async () => {
        const loaded = await dbService.getAllIdeas();
        setIdeas(loaded.sort((a, b) => b.timestamp - a.timestamp)); // Newest first
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
        await dbService.saveIdea(newIdea);
        navigate(`/idea/${newIdea.id}`);
    };

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>My Ideas</h2>
                <button className="btn-primary" onClick={createNewIdea} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Plus size={18} />
                    New Idea
                </button>
            </div>

            {ideas.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-secondary)' }}>
                    <p>No ideas yet. Start by capturing a new one!</p>
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px', width: '100%' }}>
                    {ideas.map(idea => (
                        <Link key={idea.id} to={`/idea/${idea.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                            <div className="card" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                                <h3 style={{ margin: '0 0 8px 0' }}>{idea.title}</h3>
                                <p style={{
                                    flex: 1,
                                    color: 'var(--color-text-secondary)',
                                    display: '-webkit-box',
                                    WebkitLineClamp: 3,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden'
                                }}>
                                    {idea.details || 'No details provided...'}
                                </p>
                                <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                    {idea.keywords.slice(0, 3).map((kw, idx) => (
                                        <span key={idx} style={{
                                            fontSize: '0.75rem',
                                            backgroundColor: 'rgba(88, 86, 214, 0.1)',
                                            color: 'var(--color-accent)',
                                            padding: '2px 8px',
                                            borderRadius: '12px'
                                        }}>
                                            {kw}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
};
