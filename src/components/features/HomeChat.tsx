import React, { useState, useEffect, useRef } from 'react';
import { Send, Sparkles, Plus, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { ChatMessage, AppSettings, Idea } from '../../types';
import { aiService } from '../../services/ai';
import { dbService } from '../../services/db';

export const HomeChat: React.FC = () => {
    const navigate = useNavigate();
    const [input, setInput] = useState('');
    const [history, setHistory] = useState<ChatMessage[]>([]);
    const [loading, setLoading] = useState(false);
    const [creatingIdea, setCreatingIdea] = useState(false);
    const [settings, setSettings] = useState<AppSettings | null>(null);
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        dbService.getSettings().then(setSettings);
    }, []);

    useEffect(() => {
        if (history.length > 0) {
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [history]);

    const handleSend = async () => {
        if (!input.trim()) return;

        const userMsg: ChatMessage = {
            id: uuidv4(),
            role: 'user',
            content: input,
            timestamp: Date.now()
        };

        const newHistory = [...history, userMsg];
        setHistory(newHistory);
        setInput('');

        if (!settings || (settings.provider === 'gemini' && !settings.geminiKey)) {
            const errorMsg: ChatMessage = {
                id: uuidv4(),
                role: 'system',
                content: "Please configure your API Key in Settings to start brainstorming.",
                timestamp: Date.now()
            };
            setHistory([...newHistory, errorMsg]);
            return;
        }

        setLoading(true);

        try {
            const rawResponse = await aiService.brainstorm(userMsg.content, newHistory, settings);

            let response = rawResponse;
            let shouldCreateIdea = false;

            if (rawResponse.includes('[ACTION: CREATE_IDEA]')) {
                shouldCreateIdea = true;
                response = rawResponse.replace('[ACTION: CREATE_IDEA]', '').trim();
            }

            const aiMsg: ChatMessage = {
                id: uuidv4(),
                role: 'assistant',
                content: response,
                timestamp: Date.now()
            };

            const updatedHistory = [...newHistory, aiMsg];
            setHistory(updatedHistory);

            if (shouldCreateIdea) {
                // Short delay for user to read the confirmation message
                setTimeout(() => {
                    if (bottomRef.current) { // Simple check if still mounted
                        handleCreateIdea(updatedHistory);
                    }
                }, 1000);
            }
        } catch (error) {
            console.error(error);
            const errorMsg: ChatMessage = {
                id: uuidv4(),
                role: 'system',
                content: "Sorry, I encountered an error. Please try again.",
                timestamp: Date.now()
            };
            setHistory([...newHistory, errorMsg]);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateIdea = async (historyOverride?: ChatMessage[] | any) => {
        // historyOverride might be a click event if called from button
        const historyToUse = Array.isArray(historyOverride) ? historyOverride : history;

        if (historyToUse.length === 0 || creatingIdea) return;
        setCreatingIdea(true);

        try {
            if (!settings) throw new Error("Settings not loaded");

            // 1. Summarize conversation into an idea
            const generatedIdea = await aiService.summarizeIdeaFromChat(historyToUse, settings);

            // 2. Create the wrapper Idea object
            const newIdea: Idea = {
                id: uuidv4(),
                title: generatedIdea.title,
                details: generatedIdea.details,
                timestamp: Date.now(),
                keywords: [],
                chatHistory: historyToUse, // Preserve the brainstorming context
                relatedIdeaIds: [],
                status: 'draft'
            };

            // 3. Navigate to the new idea page (passing state so we don't need to save to DB yet if we don't want to, 
            //    or we can save it. The original Home.tsx pattern was navigate with state. 
            //    Let's stick to that for consistency, but maybe we should save keywords too?)

            // Actually, let's generate keywords too for a complete feeling
            try {
                const keywords = await aiService.extractKeywords(newIdea, settings);
                newIdea.keywords = keywords;
            } catch (e) {
                console.warn("Failed to generate keywords", e);
            }

            navigate(`/idea/${newIdea.id}`, { state: { idea: newIdea, isNew: true } });

        } catch (error) {
            console.error("Failed to create idea", error);
            alert("Failed to create idea from chat. Please try again.");
            setCreatingIdea(false);
        }
    };

    const hasStarted = history.length > 0;

    return (
        <div className={`w-full max-w-3xl mx-auto transition-all duration-500 ${hasStarted ? 'mb-10' : 'mb-0'}`}>

            {/* Chat Area */}
            {hasStarted && (
                <div className="bg-surface border border-border rounded-2xl shadow-xl overflow-hidden mb-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="bg-accent/5 p-4 border-b border-border flex justify-between items-center">
                        <div className="flex items-center gap-2 text-accent font-semibold">
                            <Sparkles size={18} />
                            <span>Brainstorming Session</span>
                        </div>
                        <button
                            onClick={handleCreateIdea}
                            disabled={creatingIdea}
                            className="btn-primary text-xs py-1.5 px-3 shadow-none"
                        >
                            {creatingIdea ? 'Creating...' : (
                                <>
                                    <Plus size={16} />
                                    Turn into Idea
                                </>
                            )}
                        </button>
                    </div>

                    <div className="h-[400px] overflow-y-auto p-6 flex flex-col gap-4">
                        {history.map(msg => (
                            <div key={msg.id}
                                className={`max-w-[85%] px-4 py-3 rounded-2xl leading-relaxed ${msg.role === 'user'
                                    ? 'self-end bg-accent text-white rounded-br-sm'
                                    : msg.role === 'system'
                                        ? 'self-center bg-red-50 text-red-600 border border-red-100 text-sm'
                                        : 'self-start bg-background text-text-primary border border-border rounded-bl-sm'
                                    }`}
                            >
                                <div className="whitespace-pre-wrap">{msg.content}</div>
                            </div>
                        ))}
                        {loading && (
                            <div className="self-start bg-background border border-border px-4 py-3 rounded-2xl rounded-bl-sm flex gap-1 items-center">
                                <span className="dot-animate bg-text-secondary"></span>
                                <span className="dot-animate bg-text-secondary" style={{ animationDelay: '0.2s' }}></span>
                                <span className="dot-animate bg-text-secondary" style={{ animationDelay: '0.4s' }}></span>
                            </div>
                        )}
                        <div ref={bottomRef} />
                    </div>
                </div>
            )}

            {/* Input Area */}
            <div className={`relative group transition-all duration-300 ${hasStarted ? '' : 'hover:-translate-y-1'}`}>
                <div className={`absolute -inset-0.5 bg-gradient-to-r from-accent to-purple-600 rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-1000 ${hasStarted ? 'hidden' : ''}`}></div>
                <div className="relative flex items-center bg-surface rounded-2xl shadow-lg border border-border p-2">
                    <div className="pl-4 pr-2 text-accent">
                        <Sparkles size={24} />
                    </div>
                    <input
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !loading) handleSend();
                        }}
                        placeholder={hasStarted ? "Reply..." : "I have an idea for..."}
                        className="flex-1 bg-transparent border-none outline-none text-lg p-3 placeholder:text-text-secondary/50"
                        disabled={loading || creatingIdea}
                        autoFocus
                    />
                    <button
                        onClick={handleSend}
                        disabled={!input.trim() || loading || creatingIdea}
                        className={`p-3 rounded-xl transition-all duration-200 ${input.trim()
                            ? 'bg-accent text-white shadow-md hover:shadow-lg hover:bg-accent-hover'
                            : 'bg-transparent text-text-secondary opacity-50 cursor-not-allowed'
                            }`}
                    >
                        {hasStarted ? <Send size={20} /> : <ArrowRight size={24} />}
                    </button>
                </div>
            </div>

            {/* Helper text when empty */}
            {!hasStarted && (
                <div className="text-center mt-6 flex justify-center gap-2 text-sm text-text-secondary opacity-70">
                    <span>Try: "A specialized dating app for..."</span>
                    <span>•</span>
                    <span>"Uber for..."</span>
                    <span>•</span>
                    <span>"A platform that connects..."</span>
                </div>
            )}
        </div>
    );
};
