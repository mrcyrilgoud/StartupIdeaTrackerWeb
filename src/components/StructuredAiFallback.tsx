import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface StructuredAiFallbackProps {
    rawOutput: string;
    title?: string;
    message?: string;
    className?: string;
}

export const StructuredAiFallback: React.FC<StructuredAiFallbackProps> = ({
    rawOutput,
    title = 'Raw AI Output',
    message = 'The AI returned a response, but it was not in the expected JSON format. Showing the raw output instead.',
    className = ''
}) => {
    return (
        <div className={`rounded-xl border border-amber-500/30 bg-amber-500/10 ${className}`}>
            <div className="border-b border-amber-500/20 p-4">
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                    <AlertTriangle size={18} />
                    <h3 className="text-sm font-bold uppercase tracking-wide">{title}</h3>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                    {message}
                </p>
            </div>
            <div className="p-4">
                <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background p-4 text-sm leading-relaxed text-text-primary border border-border">
                    {rawOutput}
                </pre>
            </div>
        </div>
    );
};
