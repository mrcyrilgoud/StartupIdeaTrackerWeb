import React, { useState, useEffect, useRef } from 'react';
import { Send, FileText } from 'lucide-react';
import { Idea, ChatMessage, AppSettings } from '../../types';
import { aiService } from '../../services/ai';
import { dbService } from '../../services/db';
import { v4 as uuidv4 } from 'uuid';

interface ChatProps {
    idea: Idea;
    onUpdate: (updatedIdea: Idea) => void;
}

export const Chat: React.FC<ChatProps> = ({ idea, onUpdate }) => {
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

        const newHistory = [...idea.chatHistory, userMsg];
        const updatedIdea = { ...idea, chatHistory: newHistory };
        onUpdate(updatedIdea);
        setInput('');
        setLoading(true);

        try {
            const response = await aiService.chat(userMsg.content, newHistory, idea, settings);
            const aiMsg: ChatMessage = {
                id: uuidv4(),
                role: 'assistant',
                content: response,
                timestamp: Date.now()
            };
            onUpdate({ ...updatedIdea, chatHistory: [...newHistory, aiMsg] });
        } catch (error) {
            const errorMsg: ChatMessage = {
                id: uuidv4(),
                role: 'system',
                content: `Error: ${(error as Error).message}`,
                timestamp: Date.now()
            };
            onUpdate({ ...updatedIdea, chatHistory: [...newHistory, errorMsg] });
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
            const updatedIdea = { ...idea, chatHistory: [...idea.chatHistory, aiMsg] };
            onUpdate(updatedIdea);
        } catch (error) {
            alert('Failed to generate plan');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', border: '1px solid var(--color-border)', borderRadius: '12px', backgroundColor: 'var(--color-surface)' }}>
            <div style={{ padding: '12px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: '600', fontSize: '0.9rem' }}>AI Assistant</span>
                <button
                    onClick={generatePlan}
                    disabled={loading}
                    className="btn-text"
                    style={{ fontSize: '0.8rem' }}
                >
                    <FileText size={14} /> Generate Plan
                </button>
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
                        whiteSpace: 'pre-wrap'
                    }}>
                        {msg.role !== 'user' && <div style={{ fontSize: '0.7rem', opacity: 0.7, marginBottom: '4px' }}>{msg.role === 'system' ? 'System' : 'AI'}</div>}
                        {msg.content}
                    </div>
                ))}
                <div ref={bottomRef} />
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
