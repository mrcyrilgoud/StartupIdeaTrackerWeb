import React from 'react';
import { X, FileText, Download, Code, Swords } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface CompetitorAnalysisModalProps {
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

export const CompetitorAnalysisModal: React.FC<CompetitorAnalysisModalProps> = ({
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
                <title>Competitor Analysis - ${escapeHtml(ideaTitle)}</title>
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
        a.download = `competitor-analysis-${ideaTitle.replace(/\s+/g, '-').toLowerCase()}.md`;
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
    <title>Competitor Analysis - ${escapeHtml(ideaTitle)}</title>
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
        a.download = `competitor-analysis-${ideaTitle.replace(/\s+/g, '-').toLowerCase()}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000,
            padding: '20px'
        }}>
            <div style={{
                backgroundColor: 'var(--color-surface)',
                borderRadius: '16px',
                width: '100%',
                maxWidth: '800px',
                maxHeight: '90vh',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 20px 60px rgba(0, 0, 0, 0.4)'
            }}>
                {/* Header */}
                <div style={{
                    padding: '20px 24px',
                    borderBottom: '1px solid var(--color-border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ 
                            backgroundColor: 'rgba(255, 59, 48, 0.1)', 
                            padding: '8px', 
                            borderRadius: '8px',
                            color: '#ff3b30'
                        }}>
                            <Swords size={24} />
                        </div>
                        <div>
                            <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Competitor Analysis</h2>
                            <p style={{ margin: '4px 0 0 0', color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>
                                {ideaTitle}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="btn-icon"
                        style={{ padding: '8px' }}
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '24px'
                }}>
                    {loading ? (
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '60px 20px',
                            color: 'var(--color-text-secondary)'
                        }}>
                            <div style={{
                                width: '48px',
                                height: '48px',
                                border: '3px solid var(--color-border)',
                                borderTopColor: '#ff3b30',
                                borderRadius: '50%',
                                animation: 'spin 1s linear infinite',
                                marginBottom: '16px'
                            }} />
                            <p style={{ margin: 0, fontSize: '1rem' }}>Identifying competitors...</p>
                            <p style={{ margin: '8px 0 0 0', fontSize: '0.85rem', opacity: 0.7 }}>
                                Scouring the market landscape for threats and opportunities
                            </p>
                            <p style={{
                                margin: '16px 0 0 0',
                                fontSize: '0.8rem',
                                color: '#ff3b30',
                                backgroundColor: 'rgba(255, 59, 48, 0.1)',
                                padding: '8px 16px',
                                borderRadius: '8px'
                            }}>
                                💡 You can close this and continue browsing. The report will be ready when you return!
                            </p>
                            <style>{`
                                @keyframes spin {
                                    to { transform: rotate(360deg); }
                                }
                            `}</style>
                        </div>
                    ) : (
                        <div className="markdown-body" style={{
                            lineHeight: '1.7',
                            fontSize: '0.95rem',
                            color: 'var(--color-text-primary)'
                        }}>
                            <ReactMarkdown
                                components={{
                                    h1: ({node, ...props}) => <h1 style={{ color: 'var(--color-text-primary)', borderBottom: '1px solid var(--color-border)', paddingBottom: '10px', marginTop: '24px', fontSize: '1.5em' }} {...props} />,
                                    h2: ({node, ...props}) => <h2 style={{ color: 'var(--color-text-primary)', marginTop: '20px', marginBottom: '10px', fontSize: '1.3em' }} {...props} />,
                                    h3: ({node, ...props}) => <h3 style={{ color: 'var(--color-text-secondary)', marginTop: '16px', marginBottom: '8px', fontSize: '1.1em' }} {...props} />,
                                    ul: ({node, ...props}) => <ul style={{ paddingLeft: '20px' }} {...props} />,
                                    li: ({node, ...props}) => <li style={{ marginBottom: '6px' }} {...props} />,
                                    strong: ({node, ...props}) => <strong style={{ color: 'var(--color-text-primary)', fontWeight: '600' }} {...props} />,
                                    p: ({node, ...props}) => <p style={{ marginBottom: '16px' }} {...props} />
                                }}
                            >
                                {report}
                            </ReactMarkdown>
                        </div>
                    )}
                </div>

                {/* Footer with download buttons */}
                {!loading && report && (
                    <div style={{
                        padding: '16px 24px',
                        borderTop: '1px solid var(--color-border)',
                        display: 'flex',
                        gap: '12px',
                        justifyContent: 'flex-end',
                        flexWrap: 'wrap'
                    }}>
                        <button
                            onClick={downloadAsPDF}
                            className="btn-text"
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px' }}
                        >
                            <FileText size={16} /> Download PDF
                        </button>
                        <button
                            onClick={downloadAsMarkdown}
                            className="btn-text"
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px' }}
                        >
                            <Download size={16} /> Download Markdown
                        </button>
                        <button
                            onClick={downloadAsHTML}
                            className="btn-text"
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px' }}
                        >
                            <Code size={16} /> Download HTML
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
