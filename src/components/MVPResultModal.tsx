import React from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, ArrowRight, X } from 'lucide-react';

interface MVPResultModalProps {
    isOpen: boolean;
    title: string;
    reason: string;
    ideaId: string;
    onClose: () => void;
}

export const MVPResultModal: React.FC<MVPResultModalProps> = ({
    isOpen,
    title,
    reason,
    ideaId,
    onClose
}) => {
    if (!isOpen) return null;

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000,
            backdropFilter: 'blur(4px)'
        }}>
            <div className="card" style={{
                maxWidth: '500px',
                width: '90%',
                maxHeight: '85vh',
                overflowY: 'auto',
                padding: '24px',
                animation: 'slideIn 0.2s ease-out',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column'
            }}>
                <button 
                    onClick={onClose}
                    style={{
                        position: 'absolute',
                        top: '16px',
                        right: '16px',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--color-text-secondary)',
                        zIndex: 1
                    }}
                >
                    <X size={20} />
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                    <div style={{
                        backgroundColor: 'rgba(88, 86, 214, 0.1)',
                        padding: '8px',
                        borderRadius: '50%',
                        color: 'var(--color-accent)'
                    }}>
                        <Sparkles size={24} />
                    </div>
                    <h3 style={{ margin: 0, fontSize: '1.25rem' }}>Simplest MVP Found</h3>
                </div>
                
                <h4 style={{ margin: '0 0 8px 0', fontSize: '1.1rem' }}>{title}</h4>
                
                <p style={{ 
                    color: 'var(--color-text-secondary)', 
                    marginBottom: '24px',
                    lineHeight: '1.6',
                    backgroundColor: 'var(--color-background)',
                    padding: '12px',
                    borderRadius: '8px',
                    flex: '1'
                }}>
                    {reason}
                </p>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: 'auto' }}>
                    <button
                        onClick={onClose}
                        style={{
                            padding: '8px 16px',
                            borderRadius: '8px',
                            border: '1px solid var(--color-border)',
                            backgroundColor: 'transparent',
                            color: 'var(--color-text-primary)',
                            cursor: 'pointer',
                            fontWeight: '500'
                        }}
                    >
                        Close
                    </button>
                    <Link to={`/idea/${ideaId}`} onClick={onClose} style={{ textDecoration: 'none' }}>
                        <button
                            className="btn-primary"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px'
                            }}
                        >
                            View Idea <ArrowRight size={16} />
                        </button>
                    </Link>
                </div>
            </div>
        </div>
    );
};
