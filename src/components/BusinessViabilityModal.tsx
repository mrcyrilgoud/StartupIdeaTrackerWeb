import React from 'react';
import { X, FileText, Download, Code } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface BusinessViabilityModalProps {
    isOpen: boolean;
    loading: boolean;
    ideaTitle: string;
    report: string;
    onClose: () => void;
}

const escapeHtml = (unsafe: string) => {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};

// Simple markdown to HTML converter for display
const markdownToHtml = (md: string): string => {
    return md
        // Headers
        .replace(/^### (.*$)/gm, '<h3>$1</h3>')
        .replace(/^## (.*$)/gm, '<h2>$1</h2>')
        .replace(/^# (.*$)/gm, '<h1>$1</h1>')
        // Bold
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        // Italic
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        // Lists
        .replace(/^- (.*$)/gm, '<li>$1</li>')
        // Paragraphs (double newlines)
        .replace(/\n\n/g, '</p><p>')
        // Single newlines in lists
        .replace(/<\/li>\n<li>/g, '</li><li>')
        // Wrap in paragraph
        .replace(/^(.+)$/gm, (match) => {
            if (match.startsWith('<h') || match.startsWith('<li') || match.startsWith('</')) {
                return match;
            }
            return match;
        });
};

export const BusinessViabilityModal: React.FC<BusinessViabilityModalProps> = ({
    isOpen,
    loading,
    ideaTitle,
    report,
    onClose
}) => {
    if (!isOpen) return null;

    const downloadAsPDF = () => {
        const printWindow = window.open('', '_blank');
        if (!printWindow) return;

        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Business Viability Report - ${escapeHtml(ideaTitle)}</title>
                <style>
                    body { 
                        font-family: system-ui, -apple-system, sans-serif; 
                        line-height: 1.6; 
                        padding: 40px; 
                        max-width: 800px; 
                        margin: 0 auto; 
                        color: #333;
                    }
                    h1 { color: #1a1a2e; border-bottom: 2px solid #5856d6; padding-bottom: 10px; }
                    h2 { color: #2d2d44; margin-top: 24px; }
                    h3 { color: #4a4a6a; }
                    li { margin-bottom: 8px; }
                    strong { color: #1a1a2e; }
                    .date { color: #666; font-size: 0.9rem; margin-bottom: 20px; }
                </style>
            </head>
            <body>
                <div class="date">Generated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}</div>
                ${markdownToHtml(escapeHtml(report))}
                <script>
                    window.onload = () => { window.print(); }
                </script>
            </body>
            </html>
        `;

        printWindow.document.write(htmlContent);
        printWindow.document.close();
    };

    const downloadAsMarkdown = () => {
        const blob = new Blob([report], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `viability-report-${ideaTitle.replace(/\s+/g, '-').toLowerCase()}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const downloadAsHTML = () => {
        const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>Business Viability Report - ${escapeHtml(ideaTitle)}</title>
    <style>
        body { 
            font-family: system-ui, -apple-system, sans-serif; 
            line-height: 1.6; 
            padding: 40px; 
            max-width: 800px; 
            margin: 0 auto; 
            color: #e0e0e0;
            background: #1a1a2e;
        }
        h1 { color: #fff; border-bottom: 2px solid #5856d6; padding-bottom: 10px; }
        h2 { color: #d0d0ff; margin-top: 24px; }
        h3 { color: #a0a0d0; }
        li { margin-bottom: 8px; }
        strong { color: #fff; }
        .date { color: #888; font-size: 0.9rem; margin-bottom: 20px; }
    </style>
</head>
<body>
    <div class="date">Generated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}</div>
    ${markdownToHtml(escapeHtml(report))}
</body>
</html>`;

        const blob = new Blob([htmlContent], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `viability-report-${ideaTitle.replace(/\s+/g, '-').toLowerCase()}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <div className="fixed inset-0 bg-black/70 flex justify-center items-center z-[1000] p-5">
            <div className="bg-surface rounded-2xl w-full max-w-[800px] max-h-[90vh] flex flex-col shadow-[0_20px_60px_rgba(0,0,0,0.4)] animate-slideIn">
                {/* Header */}
                <div className="p-6 border-b border-border flex justify-between items-center">
                    <div>
                        <h2 className="m-0 text-xl font-bold">Business Viability Report</h2>
                        <p className="mt-1 text-text-secondary text-sm">
                            {ideaTitle}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="btn-icon p-2"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-16 px-5 text-text-secondary">
                            <div className="w-12 h-12 border-[3px] border-border border-t-accent rounded-full animate-spin mb-4" />
                            <p className="m-0 text-base">Analyzing business viability...</p>
                            <p className="mt-2 text-sm opacity-70">
                                This may take a moment for comprehensive analysis
                            </p>
                            <p className="mt-4 text-xs text-accent bg-[#5856d61a] px-4 py-2 rounded-lg">
                                💡 You can close this and continue browsing. The report will be ready when you return!
                            </p>
                        </div>
                    ) : (
                        <div className="markdown-body leading-relaxed text-[0.95rem] text-text-primary">
                            <ReactMarkdown
                                components={{
                                    h1: ({ node, ...props }) => <h1 className="text-text-primary border-b border-border pb-2.5 mt-6 text-2xl" {...props} />,
                                    h2: ({ node, ...props }) => <h2 className="text-text-primary mt-5 mb-2.5 text-xl" {...props} />,
                                    h3: ({ node, ...props }) => <h3 className="text-text-secondary mt-4 mb-2 text-lg" {...props} />,
                                    ul: ({ node, ...props }) => <ul className="pl-5" {...props} />,
                                    li: ({ node, ...props }) => <li className="mb-1.5" {...props} />,
                                    strong: ({ node, ...props }) => <strong className="text-text-primary font-semibold" {...props} />,
                                    p: ({ node, ...props }) => <p className="mb-4" {...props} />
                                }}
                            >
                                {report}
                            </ReactMarkdown>
                        </div>
                    )}
                </div>

                {/* Footer with download buttons */}
                {!loading && report && (
                    <div className="p-6 border-t border-border flex gap-3 justify-end flex-wrap">
                        <button
                            onClick={downloadAsPDF}
                            className="btn-text flex items-center gap-1.5 px-4 py-2"
                        >
                            <FileText size={16} /> Download PDF
                        </button>
                        <button
                            onClick={downloadAsMarkdown}
                            className="btn-text flex items-center gap-1.5 px-4 py-2"
                        >
                            <Download size={16} /> Download Markdown
                        </button>
                        <button
                            onClick={downloadAsHTML}
                            className="btn-text flex items-center gap-1.5 px-4 py-2"
                        >
                            <Code size={16} /> Download HTML
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
