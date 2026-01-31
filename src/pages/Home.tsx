import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Sparkles, Search, Trash2 } from 'lucide-react';
import { dbService } from '../services/db';
import { aiService, MVPAnalysisResult } from '../services/ai';
import { Idea } from '../types';
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
    const [viabilityIdeaTitle, setViabilityIdeaTitle] = useState('');
    const [showViabilityModal, setShowViabilityModal] = useState(false);

    // Delete confirmation state
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [ideaToDelete, setIdeaToDelete] = useState<Idea | null>(null);

    const navigate = useNavigate();

    useEffect(() => {
        loadIdeas();
    }, []);

    const loadIdeas = async () => {
        try {
            setError(null);
            const loaded = await dbService.getAllIdeas();
            setIdeas(loaded.sort((a, b) => b.timestamp - a.timestamp)); // Newest first
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
            relatedIdeaIds: []
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
            setShowViabilityModal(true);
            setViabilityLoading(true);

            const settings = await dbService.getSettings();

            if (settings.provider === 'gemini' && !settings.geminiKey) {
                setViabilityLoading(false);
                setShowViabilityModal(false);
                alert("Please configure your Gemini API Key in Settings first.");
                return;
            }

            const report = await aiService.generateViabilityReport(idea, settings);
            setViabilityReport(report);
        } catch (e) {
            console.error(e);
            setViabilityReport(`Error generating report: ${(e as Error).message}`);
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

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>My Ideas</h2>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <button
                        className="btn-primary"
                        onClick={handleAnalyzeMVP}
                        disabled={analyzingMVP || ideas.length === 0}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            backgroundColor: 'var(--color-surface)',
                            color: 'var(--color-accent)',
                            border: '1px solid var(--color-border)',
                            cursor: (analyzingMVP || ideas.length === 0) ? 'not-allowed' : 'pointer',
                            opacity: (analyzingMVP || ideas.length === 0) ? 0.6 : 1
                        }}
                    >
                        <Sparkles size={18} className={analyzingMVP ? "dot-animate" : ""} />
                        {analyzingMVP ? 'Analyzing...' : 'Analyze Simplest MVP'}
                    </button>
                    <button className="btn-primary" onClick={createNewIdea} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Plus size={18} />
                        New Idea
                    </button>
                </div>
            </div>

            {error && (
                <div style={{
                    padding: '16px',
                    marginBottom: '24px',
                    backgroundColor: '#fee2e2',
                    color: '#dc2626',
                    borderRadius: '8px',
                    border: '1px solid #fecaca'
                }}>
                    {error}
                </div>
            )}

            {ideas.length === 0 && !error ? (
                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-secondary)' }}>
                    <p>No ideas yet. Start by capturing a new one!</p>
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px', width: '100%' }}>
                    {ideas.map(idea => (
                        <div
                            key={idea.id}
                            className="card"
                            onClick={(e) => {
                                // Don't navigate if a button was clicked
                                if ((e.target as HTMLElement).closest('button')) return;
                                navigate(`/idea/${idea.id}`);
                            }}
                            style={{
                                height: '100%',
                                display: 'flex',
                                flexDirection: 'column',
                                border: '1px solid var(--color-border)',
                                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
                                transition: 'box-shadow 0.2s ease, transform 0.2s ease',
                                cursor: 'pointer'
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.12)';
                                e.currentTarget.style.transform = 'translateY(-2px)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.08)';
                                e.currentTarget.style.transform = 'translateY(0)';
                            }}
                        >
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
                            <div onClick={(e) => e.stopPropagation()}>
                                <button
                                    onClick={(e) => handleAnalyzeViability(e, idea)}
                                    className="btn-text"
                                    style={{
                                        marginTop: '12px',
                                        fontSize: '0.8rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        padding: '6px 12px',
                                        width: '100%',
                                        justifyContent: 'center',
                                        border: '1px solid var(--color-border)',
                                        borderRadius: '8px',
                                        transition: 'all 0.2s ease'
                                    }}
                                >
                                    <Search size={14} /> Examine Viability
                                </button>
                                <button
                                    onClick={(e) => handleDeleteIdea(e, idea)}
                                    className="btn-text"
                                    title="Delete this idea"
                                    style={{
                                        marginTop: '8px',
                                        fontSize: '0.8rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        padding: '6px 12px',
                                        width: '100%',
                                        justifyContent: 'center',
                                        border: '1px solid var(--color-border)',
                                        borderRadius: '8px',
                                        transition: 'all 0.2s ease',
                                        color: '#dc2626'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = '#fef2f2';
                                        e.currentTarget.style.borderColor = '#dc2626';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = '';
                                        e.currentTarget.style.borderColor = 'var(--color-border)';
                                    }}
                                >
                                    <Trash2 size={14} /> Delete Idea
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
                    style={{
                        position: 'fixed',
                        bottom: '24px',
                        right: '24px',
                        backgroundColor: viabilityLoading ? 'var(--color-accent)' : 'var(--color-success)',
                        color: 'white',
                        padding: '12px 20px',
                        borderRadius: '12px',
                        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        fontSize: '0.9rem',
                        fontWeight: '500',
                        zIndex: 999,
                        transition: 'transform 0.2s ease',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                >
                    {viabilityLoading ? (
                        <>
                            <div style={{
                                width: '16px',
                                height: '16px',
                                border: '2px solid rgba(255,255,255,0.3)',
                                borderTopColor: 'white',
                                borderRadius: '50%',
                                animation: 'spin 1s linear infinite'
                            }} />
                            Generating report...
                            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                        </>
                    ) : (
                        <>
                            ✓ Report ready! Click to view
                        </>
                    )}
                </div>
            )}
        </div>
    );
};
