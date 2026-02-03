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
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-[1000] backdrop-blur-[4px]">
            <div className="card max-w-[500px] w-[90%] max-h-[85vh] overflow-y-auto p-6 animate-slideIn relative flex flex-col">
                <button 
                    onClick={onClose}
                    className="absolute top-4 right-4 bg-transparent border-none cursor-pointer text-text-secondary z-10"
                >
                    <X size={20} />
                </button>

                <div className="flex items-center gap-3 mb-4">
                    <div className="bg-[#5856d61a] p-2 rounded-full text-accent">
                        <Sparkles size={24} />
                    </div>
                    <h3 className="m-0 text-xl font-bold">Simplest MVP Found</h3>
                </div>
                
                <h4 className="m-0 mb-2 text-lg font-semibold">{title}</h4>
                
                <p className="text-text-secondary mb-6 leading-relaxed bg-background p-3 rounded-lg flex-1">
                    {reason}
                </p>

                <div className="flex justify-end gap-3 mt-auto">
                    <button
                        onClick={onClose}
                        className="py-2 px-4 rounded-lg border border-border bg-transparent text-text-primary cursor-pointer font-medium hover:bg-background transition-colors"
                    >
                        Close
                    </button>
                    <Link to={`/idea/${ideaId}`} onClick={onClose} className="no-underline">
                        <button className="btn-primary flex items-center gap-2">
                            View Idea <ArrowRight size={16} />
                        </button>
                    </Link>
                </div>
            </div>
        </div>
    );
};
