import React, { useState, useEffect, useRef } from 'react';
import { Send, FileText, Download, PlusCircle, Undo, Sparkles, Target, Puzzle, Scale, Users } from 'lucide-react';
import { Idea, ChatMessage, AppSettings } from '../../types';
import { aiService } from '../../services/ai';
import { dbService } from '../../services/db';
import { v4 as uuidv4 } from 'uuid';

const QUICK_PROMPTS = [
    {
        label: 'Refine',
        icon: Sparkles,
        prompt: 'Help me refine this idea to be more focused, specific, and well-defined. Identify any vague aspects and suggest concrete improvements.'
    },
    {
        label: 'Niches',
        icon: Target,
        prompt: 'Analyze this idea and identify 3-5 potential niches or sub-sections that might have better market fit, less competition, or be easier to execute.'
    },
    {
        label: 'Components',
        icon: Puzzle,
        prompt: 'Break down this idea into its core components and examine each one. Identify strengths, weaknesses, dependencies, and potential risks for each component.'
    },
    {
        label: 'Challenge',
        icon: Scale,
        prompt: 'Play devil\'s advocate. What are the hidden assumptions in this idea? Challenge each one and explain why it might be wrong.'
    },
    {
        label: 'Audience',
        icon: Users,
        prompt: 'Help me define the target audience for this idea. Who are the ideal customers? What are their pain points and how does this idea address them?'
    }
];

const escapeHtml = (unsafe: string) => {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};

interface ChatProps {
    idea: Idea;
    onChatUpdate: (newHistory: ChatMessage[]) => void;
    onAppendToNote: (text: string) => void;
}

export const Chat: React.FC<ChatProps> = ({ idea, onChatUpdate, onAppendToNote }) => {
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [settings, setSettings] = useState<AppSettings | null>(null);
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        dbService.getSettings().then(setSettings);
    }, []);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [idea.chatHistory]);

    const sendMessage = async () => {
        if (!input.trim() || !settings) return;

        const userMsg: ChatMessage = {
            id: uuidv4(),
            role: 'user',
            content: input,
            timestamp: Date.now()
        };

        // Optimistic update
        const historyWithUser = [...idea.chatHistory, userMsg];
        onChatUpdate(historyWithUser);

        setInput('');
        setLoading(true);

        try {
            // We pass historyWithUser to context, but we rely on the FRESH idea from props 
            // for the context if we needed it, but here we just need the history.
            // Note: aiService.chat uses idea.details. If idea.details changes while this runs,
            // that's fine for THIS request. The important thing is we don't clobber that change 
            // when we write back the response.
            const response = await aiService.chat(userMsg.content, historyWithUser, idea, settings);

            const aiMsg: ChatMessage = {
                id: uuidv4(),
                role: 'assistant',
                content: response,
                timestamp: Date.now()
            };

            onChatUpdate([...historyWithUser, aiMsg]);
        } catch (error) {
            const errorMsg: ChatMessage = {
                id: uuidv4(),
                role: 'system',
                content: `Error: ${(error as Error).message}`,
                timestamp: Date.now()
            };
            onChatUpdate([...historyWithUser, errorMsg]);
        } finally {
            setLoading(false);
        }
    };

    const handleUndo = () => {
        if (idea.chatHistory.length === 0) return;

        const lastMsg = idea.chatHistory[idea.chatHistory.length - 1];
        let newHistory = [...idea.chatHistory];
        let restoredInput = '';

        if (lastMsg.role !== 'user') {
            // Remove assistant/system message
            newHistory.pop();
            // Check if previous was user, if so, remove it too to "undo" the turn
            const prevMsg = newHistory[newHistory.length - 1];
            if (prevMsg && prevMsg.role === 'user') {
                restoredInput = prevMsg.content;
                newHistory.pop();
            }
        } else {
            // Just remove the user message
            restoredInput = lastMsg.content;
            newHistory.pop();
        }

        setInput(restoredInput);
        onChatUpdate(newHistory);
    };

    const sendQuickPrompt = async (promptText: string) => {
        if (!settings || loading) return;

        const userMsg: ChatMessage = {
            id: uuidv4(),
            role: 'user',
            content: promptText,
            timestamp: Date.now()
        };

        const historyWithUser = [...idea.chatHistory, userMsg];
        onChatUpdate(historyWithUser);
        setLoading(true);

        try {
            const response = await aiService.chat(promptText, historyWithUser, idea, settings);
            const aiMsg: ChatMessage = {
                id: uuidv4(),
                role: 'assistant',
                content: response,
                timestamp: Date.now()
            };
            onChatUpdate([...historyWithUser, aiMsg]);
        } catch (error) {
            const errorMsg: ChatMessage = {
                id: uuidv4(),
                role: 'system',
                content: `Error: ${(error as Error).message}`,
                timestamp: Date.now()
            };
            onChatUpdate([...historyWithUser, errorMsg]);
        } finally {
            setLoading(false);
        }
    };

    const generatePlan = async () => {
        if (!settings) return;
        setLoading(true);
        try {
            const plan = await aiService.generateResponse(`
        I have a startup idea: "${idea.title}".
        Details: ${idea.details}
        
        The user wants to proceed with this idea. Create a DETAILED, step-by-step implementation plan.
        
        First, provide a "Critical Feasibility Analysis" section where you ruthlessly evaluate the idea's viability and potential pitfalls.
        Then, if the idea has merit, proceed with the plan:

        1. MVP Definition (Minimal Viable Product)
        2. Technology Stack Recommendations
        3. Go-to-Market Strategy
        4. Monetization Path
        
        Format it nicely with Markdown headers.
        `, settings);

            const aiMsg: ChatMessage = {
                id: uuidv4(),
                role: 'assistant',
                content: "Here is a detailed plan for your idea:\n\n" + plan,
                timestamp: Date.now()
            };
            onChatUpdate([...idea.chatHistory, aiMsg]);
        } catch (error) {
            alert('Failed to generate plan');
        } finally {
            setLoading(false);
        }
    };

    const downloadChatPDF = () => {
        const printWindow = window.open('', '_blank');
        if (!printWindow) return;

        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Chat History - ${escapeHtml(idea.title)}</title>
                <style>
                    body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; padding: 20px; max-width: 800px; margin: 0 auto; }
                    .header { margin-bottom: 20px; border-bottom: 2px solid #eee; padding-bottom: 10px; }
                    .message { margin-bottom: 16px; padding: 10px; border-radius: 8px; page-break-inside: avoid; }
                    .role { font-weight: bold; font-size: 0.8rem; margin-bottom: 4px; text-transform: uppercase; color: #666; }
                    .content { white-space: pre-wrap; }
                    .user { background-color: #f0f7ff; }
                    .assistant { background-color: #f5f5f5; }
                    .system { background-color: #fff0f0; border: 1px solid #ffcccc; }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>${escapeHtml(idea.title)} - Chat History</h1>
                    <p>Date: ${new Date().toLocaleDateString()}</p>
                </div>
                ${idea.chatHistory.map(msg => `
                    <div class="message ${msg.role}">
                        <div class="role">${msg.role} - ${new Date(msg.timestamp).toLocaleTimeString()}</div>
                        <div class="content">${escapeHtml(msg.content)}</div>
                    </div>
                `).join('')}
                <script>
                    window.onload = () => {
                        window.print();
                        // Optional: window.close();
                    }
                </script>
            </body>
            </html>
        `;

        printWindow.document.write(htmlContent);
        printWindow.document.close();
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', border: '1px solid var(--color-border)', borderRadius: '12px', backgroundColor: 'var(--color-surface)' }}>
            <div style={{ padding: '12px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: '600', fontSize: '0.9rem' }}>AI Assistant</span>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        onClick={downloadChatPDF}
                        className="btn-text"
                        style={{ fontSize: '0.8rem', padding: '4px 8px' }}
                        title="Download Chat as PDF"
                    >
                        <Download size={14} /> PDF
                    </button>
                    <button
                        onClick={handleUndo}
                        className="btn-text"
                        style={{ fontSize: '0.8rem', padding: '4px 8px' }}
                        title="Revert last turn"
                        disabled={idea.chatHistory.length === 0 || loading}
                    >
                        <Undo size={14} /> Undo
                    </button>
                    <button
                        onClick={generatePlan}
                        disabled={loading}
                        className="btn-text"
                        style={{ fontSize: '0.8rem', padding: '4px 8px' }}
                        title="Generate Implementation Plan"
                    >
                        <FileText size={14} /> Plan
                    </button>
                </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {idea.chatHistory.map(msg => (
                    <div key={msg.id} style={{
                        alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                        maxWidth: '80%',
                        backgroundColor: msg.role === 'user' ? 'var(--color-accent)' : 'var(--color-background)',
                        color: msg.role === 'user' ? 'white' : 'var(--color-text-primary)',
                        padding: '8px 12px',
                        borderRadius: '12px',
                    }}>
                        {msg.role !== 'user' && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                <div style={{ fontSize: '0.7rem', opacity: 0.7 }}>{msg.role === 'system' ? 'System' : 'AI'}</div>
                                {msg.role === 'assistant' && (
                                    <button
                                        onClick={() => onAppendToNote(msg.content)}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            padding: 0,
                                            cursor: 'pointer',
                                            color: 'inherit',
                                            opacity: 0.6
                                        }}
                                        title="Save to Note"
                                    >
                                        <PlusCircle size={14} />
                                    </button>
                                )}
                            </div>
                        )}
                        <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                    </div>
                ))}
                {loading && (
                    <div style={{
                        alignSelf: 'flex-start',
                        backgroundColor: 'var(--color-background)',
                        color: 'var(--color-text-secondary)',
                        padding: '8px 12px',
                        borderRadius: '12px',
                        fontSize: '0.9rem',
                        opacity: 0.8,
                        display: 'flex',
                        gap: '4px',
                        alignItems: 'center'
                    }}>
                        <span>Thinking</span>
                        <span className="dot-animate">.</span>
                        <span className="dot-animate" style={{ animationDelay: '0.2s' }}>.</span>
                        <span className="dot-animate" style={{ animationDelay: '0.4s' }}>.</span>
                    </div>
                )}
                <div ref={bottomRef} />
            </div>

            <div style={{ padding: '8px 12px', borderTop: '1px solid var(--color-border)', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {QUICK_PROMPTS.map(qp => (
                    <button
                        key={qp.label}
                        onClick={() => sendQuickPrompt(qp.prompt)}
                        disabled={loading}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '4px 10px',
                            fontSize: '0.75rem',
                            borderRadius: '16px',
                            border: '1px solid var(--color-border)',
                            background: 'var(--color-background)',
                            color: 'var(--color-text-secondary)',
                            cursor: loading ? 'not-allowed' : 'pointer',
                            opacity: loading ? 0.5 : 1,
                            transition: 'all 0.15s ease'
                        }}
                        onMouseEnter={e => {
                            if (!loading) {
                                e.currentTarget.style.background = 'var(--color-accent)';
                                e.currentTarget.style.color = 'white';
                                e.currentTarget.style.borderColor = 'var(--color-accent)';
                            }
                        }}
                        onMouseLeave={e => {
                            e.currentTarget.style.background = 'var(--color-background)';
                            e.currentTarget.style.color = 'var(--color-text-secondary)';
                            e.currentTarget.style.borderColor = 'var(--color-border)';
                        }}
                    >
                        <qp.icon size={12} />
                        {qp.label}
                    </button>
                ))}
            </div>

            <div style={{ padding: '12px', borderTop: '1px solid var(--color-border)', display: 'flex', gap: '8px' }}>
                <input
                    className="input"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !loading && sendMessage()}
                    placeholder="Ask about your idea..."
                    disabled={loading}
                />
                <button
                    className="btn-primary"
                    onClick={sendMessage}
                    disabled={loading || !input.trim()}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 12px' }}
                >
                    {loading ? '...' : <Send size={18} />}
                </button>
            </div>
        </div>
    );
};
