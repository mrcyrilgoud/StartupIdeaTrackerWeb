import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Send, FileText, Download, PlusCircle, Undo, Sparkles, Target, Puzzle, Scale, Users, Square } from 'lucide-react';
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
    const STREAM_UPDATE_INTERVAL_MS = 75;
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [settings, setSettings] = useState<AppSettings | null>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamingContent, setStreamingContent] = useState('');
    const streamBufferRef = useRef('');
    const streamUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const activeStreamAbortRef = useRef<AbortController | null>(null);
    const isMountedRef = useRef(true);

    const safeHistory = idea.chatHistory || [];

    useEffect(() => {
        dbService.getSettings().then(setSettings);
    }, []);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [safeHistory]);

    const isAbortError = (error: unknown): boolean => {
        if (!error || typeof error !== 'object') return false;
        const maybeError = error as { name?: string; message?: string };
        return maybeError.name === 'AbortError' || maybeError.message?.toLowerCase().includes('aborted') === true;
    };

    const flushStreamBuffer = useCallback(() => {
        if (streamUpdateTimerRef.current) {
            clearTimeout(streamUpdateTimerRef.current);
            streamUpdateTimerRef.current = null;
        }

        if (!streamBufferRef.current) return;

        const buffered = streamBufferRef.current;
        streamBufferRef.current = '';
        setStreamingContent(prev => prev + buffered);
    }, []);

    const queueStreamChunk = useCallback((delta: string) => {
        if (!delta) return;

        streamBufferRef.current += delta;
        if (streamUpdateTimerRef.current) return;

        streamUpdateTimerRef.current = setTimeout(() => {
            streamUpdateTimerRef.current = null;
            if (!streamBufferRef.current) return;
            const buffered = streamBufferRef.current;
            streamBufferRef.current = '';
            setStreamingContent(prev => prev + buffered);
        }, STREAM_UPDATE_INTERVAL_MS);
    }, [STREAM_UPDATE_INTERVAL_MS]);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            activeStreamAbortRef.current?.abort();
            if (streamUpdateTimerRef.current) {
                clearTimeout(streamUpdateTimerRef.current);
            }
            streamBufferRef.current = '';
        };
    }, []);

    const cancelActiveStream = useCallback(() => {
        activeStreamAbortRef.current?.abort();
    }, []);

    const sendMessage = async () => {
        if (!input.trim()) return;

        const userMsg: ChatMessage = {
            id: uuidv4(),
            role: 'user',
            content: input,
            timestamp: Date.now()
        };

        // Optimistic update
        const historyWithUser = [...safeHistory, userMsg];
        onChatUpdate(historyWithUser);
        setInput('');

        if (!settings || (settings.provider === 'gemini' && !settings.geminiKey)) {
            const errorMsg: ChatMessage = {
                id: uuidv4(),
                role: 'system',
                content: "Please configure your API Key in Settings to use the AI Assistant.",
                timestamp: Date.now()
            };
            onChatUpdate([...historyWithUser, errorMsg]);
            return;
        }
        setLoading(true);
        setIsStreaming(true);
        setStreamingContent('');
        streamBufferRef.current = '';
        if (streamUpdateTimerRef.current) {
            clearTimeout(streamUpdateTimerRef.current);
            streamUpdateTimerRef.current = null;
        }
        let controller: AbortController | null = new AbortController();
        activeStreamAbortRef.current = controller;

        try {
            const finalOutput = await aiService.chatStream(
                userMsg.content,
                historyWithUser,
                idea,
                settings,
                queueStreamChunk,
                { emitDelta: true, signal: controller.signal }
            );
            flushStreamBuffer();

            const aiMsg: ChatMessage = {
                id: uuidv4(),
                role: 'assistant',
                content: finalOutput,
                timestamp: Date.now()
            };

            onChatUpdate([...historyWithUser, aiMsg]);
        } catch (error) {
            if (!isMountedRef.current || controller?.signal.aborted || isAbortError(error)) return;
            const errorMsg: ChatMessage = {
                id: uuidv4(),
                role: 'system',
                content: `Error: ${(error as Error).message}`,
                timestamp: Date.now()
            };
            onChatUpdate([...historyWithUser, errorMsg]);
        } finally {
            if (activeStreamAbortRef.current === controller) {
                activeStreamAbortRef.current = null;
            }
            controller = null;
            if (isMountedRef.current) {
                setLoading(false);
                setIsStreaming(false);
                setStreamingContent('');
            }
            streamBufferRef.current = '';
            if (streamUpdateTimerRef.current) {
                clearTimeout(streamUpdateTimerRef.current);
                streamUpdateTimerRef.current = null;
            }
        }
    };

    const handleUndo = () => {
        if (safeHistory.length === 0) return;

        const lastMsg = safeHistory[safeHistory.length - 1];
        let newHistory = [...safeHistory];
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
        if (loading) return;

        const userMsg: ChatMessage = {
            id: uuidv4(),
            role: 'user',
            content: promptText,
            timestamp: Date.now()
        };

        const historyWithUser = [...safeHistory, userMsg];
        onChatUpdate(historyWithUser);

        if (!settings || (settings.provider === 'gemini' && !settings.geminiKey)) {
            const errorMsg: ChatMessage = {
                id: uuidv4(),
                role: 'system',
                content: "Please configure your API Key in Settings to use the AI Assistant.",
                timestamp: Date.now()
            };
            onChatUpdate([...historyWithUser, errorMsg]);
            return;
        }

        setLoading(true);
        setIsStreaming(true);
        setStreamingContent('');
        streamBufferRef.current = '';
        if (streamUpdateTimerRef.current) {
            clearTimeout(streamUpdateTimerRef.current);
            streamUpdateTimerRef.current = null;
        }
        let controller: AbortController | null = new AbortController();
        activeStreamAbortRef.current = controller;

        try {
            const finalOutput = await aiService.chatStream(
                promptText,
                historyWithUser,
                idea,
                settings,
                queueStreamChunk,
                { emitDelta: true, signal: controller.signal }
            );
            flushStreamBuffer();
            const aiMsg: ChatMessage = {
                id: uuidv4(),
                role: 'assistant',
                content: finalOutput,
                timestamp: Date.now()
            };
            onChatUpdate([...historyWithUser, aiMsg]);
        } catch (error) {
            if (!isMountedRef.current || controller?.signal.aborted || isAbortError(error)) return;
            const errorMsg: ChatMessage = {
                id: uuidv4(),
                role: 'system',
                content: `Error: ${(error as Error).message}`,
                timestamp: Date.now()
            };
            onChatUpdate([...historyWithUser, errorMsg]);
        } finally {
            if (activeStreamAbortRef.current === controller) {
                activeStreamAbortRef.current = null;
            }
            controller = null;
            if (isMountedRef.current) {
                setLoading(false);
                setIsStreaming(false);
                setStreamingContent('');
            }
            streamBufferRef.current = '';
            if (streamUpdateTimerRef.current) {
                clearTimeout(streamUpdateTimerRef.current);
                streamUpdateTimerRef.current = null;
            }
        }
    };

    const generatePlan = async () => {
        if (!settings || (settings.provider === 'gemini' && !settings.geminiKey)) {
            const errorMsg: ChatMessage = {
                id: uuidv4(),
                role: 'system',
                content: "Please configure your API Key in Settings to use the AI Assistant.",
                timestamp: Date.now()
            };
            onChatUpdate([...safeHistory, errorMsg]);
            return;
        }
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
            onChatUpdate([...safeHistory, aiMsg]);
        } catch (error) {
            const errorMsg: ChatMessage = {
                id: uuidv4(),
                role: 'system',
                content: `Failed to generate plan: ${(error as Error).message}`,
                timestamp: Date.now()
            };
            onChatUpdate([...safeHistory, errorMsg]);
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
                ${safeHistory.map(msg => `
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
        <div className="flex flex-col h-full border border-border rounded-xl bg-surface">
            <div className="p-3 border-b border-border flex justify-between items-center">
                <span className="font-semibold text-sm">AI Assistant</span>
                <div className="flex gap-2">
                    <button
                        onClick={downloadChatPDF}
                        className="btn-text text-xs px-2 py-1"
                        title="Download Chat as PDF"
                    >
                        <Download size={14} /> PDF
                    </button>
                    <button
                        onClick={handleUndo}
                        className="btn-text text-xs px-2 py-1"
                        title="Revert last turn"
                        disabled={safeHistory.length === 0 || loading}
                    >
                        <Undo size={14} /> Undo
                    </button>
                    <button
                        onClick={generatePlan}
                        disabled={loading}
                        className="btn-text text-xs px-2 py-1"
                        title="Generate Implementation Plan"
                    >
                        <FileText size={14} /> Plan
                    </button>
                    {loading && (
                        <button
                            onClick={cancelActiveStream}
                            className="btn-text text-xs px-2 py-1"
                            title="Cancel in-progress AI request"
                        >
                            <Square size={14} /> Stop
                        </button>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
                {safeHistory.map(msg => (
                    <div key={msg.id}
                        className={`max-w-[80%] px-3 py-2 rounded-xl ${msg.role === 'user'
                            ? 'self-end bg-accent text-white'
                            : 'self-start bg-background text-text-primary'
                            }`}
                    >
                        {msg.role !== 'user' && (
                            <div className="flex justify-between items-center mb-1">
                                <div className="text-[0.7rem] opacity-70">{msg.role === 'system' ? 'System' : 'AI'}</div>
                                {msg.role === 'assistant' && (
                                    <button
                                        onClick={() => onAppendToNote(msg.content)}
                                        className="bg-transparent border-none p-0 cursor-pointer text-inherit opacity-60 hover:opacity-100"
                                        title="Save to Note"
                                    >
                                        <PlusCircle size={14} />
                                    </button>
                                )}
                            </div>
                        )}
                        <div className="whitespace-pre-wrap">{msg.content}</div>
                    </div>
                ))}
                {isStreaming && (
                    <div className="max-w-[80%] px-3 py-2 rounded-xl self-start bg-background text-text-primary">
                        <div className="flex justify-between items-center mb-1">
                            <div className="text-[0.7rem] opacity-70">AI</div>
                        </div>
                        <div className="whitespace-pre-wrap">{streamingContent}</div>
                    </div>
                )}
                {loading && !isStreaming && (
                    <div className="self-start bg-background text-text-secondary px-3 py-2 rounded-xl text-sm opacity-80 flex gap-1 items-center">
                        <span>Thinking</span>
                        <span className="dot-animate">.</span>
                        <span className="dot-animate" style={{ animationDelay: '0.2s' }}>.</span>
                        <span className="dot-animate" style={{ animationDelay: '0.4s' }}>.</span>
                    </div>
                )}
                <div ref={bottomRef} />
            </div>

            <div className="p-2 px-3 border-t border-border flex gap-1.5 flex-wrap">
                {QUICK_PROMPTS.map(qp => (
                    <button
                        key={qp.label}
                        onClick={() => sendQuickPrompt(qp.prompt)}
                        disabled={loading}
                        className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-2xl border border-border bg-background text-text-secondary transition-all duration-150
                            ${loading
                                ? 'cursor-not-allowed opacity-50'
                                : 'cursor-pointer hover:bg-accent hover:text-white hover:border-accent'
                            }
                        `}
                    >
                        <qp.icon size={12} />
                        {qp.label}
                    </button>
                ))}
            </div>

            <div className="p-3 border-t border-border flex gap-2">
                <input
                    className="input"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !loading && sendMessage()}
                    placeholder="Ask about your idea..."
                    disabled={loading}
                />
                <button
                    className="btn-primary flex items-center justify-center px-3"
                    onClick={sendMessage}
                    disabled={loading || !input.trim()}
                >
                    {loading ? '...' : <Send size={18} />}
                </button>
            </div>
        </div>
    );
};
