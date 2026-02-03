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
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-[1000] backdrop-blur-[4px]">
            <div className="card max-w-[400px] w-[90%] p-6 animate-slideIn">
                <h3 className="mt-0 mb-3 text-xl font-bold">{title}</h3>
                <p className="text-text-secondary mb-6">{message}</p>
                <div className="flex justify-end gap-3">
                    <button
                        onClick={onCancel}
                        className="py-2 px-4 rounded-lg border border-border bg-transparent text-text-primary cursor-pointer font-medium hover:bg-background transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        className="btn-primary bg-[#FF3B30] hover:bg-[#D70015] border-none text-white"
                    >
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
};
