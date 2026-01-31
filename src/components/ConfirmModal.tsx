import React from 'react';

interface ConfirmModalProps {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
    isOpen,
    title,
    message,
    onConfirm,
    onCancel
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
                maxWidth: '400px',
                width: '90%',
                padding: '24px',
                animation: 'slideIn 0.2s ease-out'
            }}>
                <h3 style={{ marginTop: 0, marginBottom: '12px', fontSize: '1.25rem' }}>{title}</h3>
                <p style={{ color: 'var(--color-text-secondary)', marginBottom: '24px' }}>{message}</p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                    <button
                        onClick={onCancel}
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
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        className="btn-primary"
                        style={{
                            backgroundColor: '#FF3B30', // Destructive red
                            color: 'white',
                            border: 'none',
                        }}
                    >
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
};
