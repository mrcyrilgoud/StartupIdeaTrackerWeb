import React, { useState, useRef, useEffect } from 'react';
import { Gamepad2, Brain, ArrowRight, RefreshCw, Sparkles, Timer, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { aiService } from '../services/ai';
import { dbService } from '../services/db';
import { AppSettings, Idea } from '../types';
import { GeneratedIdeaCard } from '../components/GeneratedIdeaCard';
import { v4 as uuidv4 } from 'uuid';

type GameStage = 'intro' | 'personality' | 'drawing' | 'generating' | 'results';

// Personality Questions
const QUESTIONS = [
    {
        id: 'vibe',
        question: 'What is your current founder vibe?',
        options: [
            { id: 'chaotic', label: 'Chaotic Good', icon: '🌪️' },
            { id: 'calculated', label: 'Calculated Risk', icon: '♟️' },
            { id: 'zen', label: 'Zen Master', icon: '🧘' },
            { id: 'hustle', label: 'Pure Hustle', icon: '🏃' }
        ]
    },
    {
        id: 'field',
        question: 'Pick a playground:',
        options: [
            { id: 'tech', label: 'Deep Tech', icon: '🤖' },
            { id: 'consumer', label: 'Consumer Social', icon: '📱' },
            { id: 'sustainability', label: 'Green Earth', icon: '🌱' },
            { id: 'weird', label: 'Something Weird', icon: '👾' }
        ]
    }
];

const PROMPTS = [
    "A machine that turns clouds into cotton candy",
    "A house designed for a fish",
    "The worst possible way to wake up",
    "An umbrella for a thunderstorm of emotions",
    "A vehicle that runs on laughter",
    "A vegetable with a secret identity",
    "Architecture for a colony of ants",
    "A clock that measures moments, not time"
];

const DRAWING_TIME = 45; // seconds

export const IdeaSpark: React.FC = () => {
    const [stage, setStage] = useState<GameStage>('intro');
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [drawingDescription, setDrawingDescription] = useState('');
    const [generatedIdeas, setGeneratedIdeas] = useState<{ title: string, details: string }[]>([]);
    const [settings, setSettings] = useState<AppSettings | null>(null);
    const [error, setError] = useState('');

    // Timer State
    const [timeLeft, setTimeLeft] = useState(DRAWING_TIME);
    const [activePrompt, setActivePrompt] = useState('');

    // Canvas Refs
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);

    useEffect(() => {
        const init = async () => {
            const s = await dbService.getSettings();
            setSettings(s);
        };
        init();
    }, []);

    // Timer Logic
    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (stage === 'drawing' && timeLeft > 0) {
            interval = setInterval(() => {
                setTimeLeft((prev) => {
                    if (prev <= 1) {
                        setIsDrawing(false); // Force stop drawing
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        }
        return () => clearInterval(interval);
    }, [stage, timeLeft]);

    const startGame = () => {
        setStage('personality');
        setAnswers({});
        setDrawingDescription('');
        setGeneratedIdeas([]);
    };

    const startDrawingPhase = () => {
        // Pick random prompt
        const randomPrompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
        setActivePrompt(randomPrompt);
        setTimeLeft(DRAWING_TIME);
        setStage('drawing');

        // Clear canvas if it exists (state persistence handling)
        setTimeout(() => clearCanvas(), 100);
    };

    // Drawing Logic
    const startDrawing = (e: React.MouseEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        if (timeLeft === 0) return; // Time's up!

        ctx.strokeStyle = '#8B5CF6';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';

        ctx.beginPath();
        ctx.moveTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
        setIsDrawing(true);
    };

    const draw = (e: React.MouseEvent) => {
        if (!isDrawing) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.lineTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
        ctx.stroke();
    };

    const stopDrawing = () => {
        setIsDrawing(false);
    };

    const clearCanvas = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    };

    // Game Flow Logic
    const handleAnswer = (qId: string, optionId: string) => {
        setAnswers(prev => ({ ...prev, [qId]: optionId }));
    };

    const handleGenerate = async () => {
        if (!settings) {
            setError('Settings not loaded yet.');
            return;
        }

        setStage('generating');

        try {
            const vibe = answers['vibe'] || 'Unknown';
            const field = answers['field'] || 'General';

            const prompt = `
                I am a founder with a "${vibe}" vibe looking to build in "${field}".
                I was given the creative prompt: "${activePrompt}".
                I drew a picture that signifies: "${drawingDescription}".
                
                Based on this eclectic mix of personality and abstract creative input, 
                generate 3 wildly creative, out-of-the-box startup ideas.
                Make them unique and slightly unconventional.
            `;

            const ideas = await aiService.generateIdeas(prompt, settings);
            setGeneratedIdeas(ideas);
            setStage('results');
        } catch (e) {
            console.error(e);
            setError('Failed to generate ideas. Check your API key.');
            setStage('drawing'); // Go back
        }
    };

    const handleSaveIdea = async (idea: { title: string, details: string }) => {
        const newIdea: Idea = {
            id: uuidv4(),
            title: idea.title,
            details: idea.details,
            timestamp: Date.now(),
            keywords: [],
            chatHistory: [],
            relatedIdeaIds: [],
            status: 'draft'
        };
        await dbService.saveIdea(newIdea);
    };

    // -- RENDERERS --

    const renderIntro = () => (
        <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            className="text-center py-12"
        >
            <div className="inline-block p-6 rounded-full bg-gradient-to-br from-accent/20 to-purple-500/20 mb-6 relative">
                <Gamepad2 size={64} className="text-accent" />
                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
                    className="absolute -top-2 -right-2 bg-yellow-400 text-black text-xs font-bold p-2 rounded-full shadow-lg"
                >
                    NEW!
                </motion.div>
            </div>
            <h1 className="text-4xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-accent to-purple-600">
                Idea Spark
            </h1>
            <p className="text-text-secondary text-lg max-w-md mx-auto mb-8">
                Stuck? Let's play a game. Answer some weird questions, race against the clock to draw a doodle, and let the AI hallucinate your next unicorn.
            </p>
            <button
                onClick={startGame}
                className="btn-primary text-lg px-8 py-3 rounded-full shadow-lg shadow-accent/25 hover:shadow-accent/40 transition-all"
            >
                Start The Game
            </button>
        </motion.div>
    );

    const renderPersonality = () => (
        <motion.div
            initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
            className="max-w-2xl mx-auto"
        >
            <h2 className="text-2xl font-bold mb-8 text-center flex items-center justify-center gap-2">
                <Brain className="text-accent" /> Phase 1: Vibe Check
            </h2>

            {QUESTIONS.map((q) => (
                <div key={q.id} className="mb-8">
                    <p className="text-lg font-medium mb-4">{q.question}</p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {q.options.map((opt) => (
                            <button
                                key={opt.id}
                                onClick={() => handleAnswer(q.id, opt.label)}
                                className={`p-4 rounded-xl border-2 transition-all text-left group
                                    ${answers[q.id] === opt.label
                                        ? 'border-accent bg-accent/5'
                                        : 'border-border hover:border-accent/50 bg-card'}`
                                }
                            >
                                <span className="text-2xl mb-2 block group-hover:scale-110 transition-transform">{opt.icon}</span>
                                <span className="font-semibold text-sm">{opt.label}</span>
                            </button>
                        ))}
                    </div>
                </div>
            ))}

            <div className="flex justify-end mt-8">
                <button
                    disabled={Object.keys(answers).length < QUESTIONS.length}
                    onClick={startDrawingPhase}
                    className="btn-primary flex items-center gap-2"
                >
                    Next Phase <ArrowRight size={18} />
                </button>
            </div>
        </motion.div>
    );

    const renderDrawing = () => {
        const isTimeLow = timeLeft <= 10;
        const isTimeUp = timeLeft === 0;

        return (
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                className="max-w-3xl mx-auto text-center"
            >
                <div className="mb-6 flex flex-col items-center">
                    <div className="bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 px-6 py-3 rounded-full text-lg font-medium mb-4 flex items-center gap-2 border border-purple-200 dark:border-purple-800">
                        <Zap size={20} className="fill-current" />
                        Prompt: "{activePrompt}"
                    </div>

                    <div className={`text-4xl font-mono font-bold flex items-center gap-3 transition-colors ${isTimeUp ? 'text-red-500' : isTimeLow ? 'text-orange-500 animate-pulse' : 'text-text-primary'
                        }`}>
                        <Timer size={32} />
                        00:{timeLeft.toString().padStart(2, '0')}
                    </div>
                    {isTimeUp && <span className="text-red-500 text-sm font-bold mt-1">TIME'S UP! DROP YOUR PEN!</span>}
                </div>

                <div className="relative inline-block border-2 border-dashed border-border rounded-xl bg-white dark:bg-slate-900 overflow-hidden shadow-inner cursor-crosshair touch-none">
                    <canvas
                        ref={canvasRef}
                        width={600}
                        height={400}
                        onMouseDown={startDrawing}
                        onMouseMove={draw}
                        onMouseUp={stopDrawing}
                        onMouseLeave={stopDrawing}
                        className="w-full h-auto max-w-full"
                    />
                    <button
                        onClick={clearCanvas}
                        className="absolute top-2 right-2 p-2 bg-red-500/10 text-red-500 rounded-lg hover:bg-red-500/20"
                        title="Clear"
                    >
                        <RefreshCw size={16} />
                    </button>
                </div>

                <div className="mt-6 max-w-md mx-auto">
                    <label className="block text-left font-medium mb-2">What did you draw? (Or what were you TRYING to draw?)</label>
                    <input
                        type="text"
                        value={drawingDescription}
                        onChange={(e) => setDrawingDescription(e.target.value)}
                        placeholder={isTimeUp ? "Quick! What is it?" : "e.g. A happy cloud eating a pizza"}
                        className="input w-full"
                    />
                </div>

                <div className="flex justify-between mt-8">
                    <button onClick={() => setStage('personality')} className="text-text-secondary hover:text-text-primary">
                        Back
                    </button>
                    <button
                        onClick={handleGenerate}
                        disabled={!drawingDescription}
                        className="btn-primary flex items-center gap-2"
                    >
                        Spark Ideas <Sparkles size={18} />
                    </button>
                </div>
            </motion.div>
        );
    };

    const renderGenerating = () => (
        <div className="flex flex-col items-center justify-center py-20">
            <div className="relative">
                <div className="w-16 h-16 border-4 border-accent/30 border-t-accent rounded-full animate-spin"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                    <Brain className="text-accent animate-pulse" size={24} />
                </div>
            </div>
            <h3 className="text-xl font-bold mt-8">Synthesizing Chaos...</h3>
            <p className="text-text-secondary animate-pulse mt-2">Mixing your vibe with your art...</p>
        </div>
    );

    const renderResults = () => (
        <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="max-w-4xl mx-auto"
        >
            <div className="text-center mb-10">
                <h2 className="text-3xl font-bold mb-2">The Spark Results</h2>
                <p className="text-text-secondary">
                    Based on your <strong>{answers['vibe']}</strong> vibe and your drawing of <strong>"{drawingDescription}"</strong>.
                </p>
                <button
                    onClick={() => {
                        setStage('intro');
                        setAnswers({});
                        setDrawingDescription('');
                        setGeneratedIdeas([]);
                    }}
                    className="mt-4 text-accent hover:underline flex items-center justify-center gap-2 mx-auto"
                >
                    <RefreshCw size={16} /> Play Again
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {generatedIdeas.map((idea, idx) => (
                    <GeneratedIdeaCard key={idx} idea={idea} onSave={handleSaveIdea} />
                ))}
            </div>
        </motion.div>
    );

    return (
        <div className="min-h-full p-4 md:p-8">
            <AnimatePresence mode="wait">
                {stage === 'intro' && <motion.div key="intro" exit={{ opacity: 0, y: -20 }}>{renderIntro()}</motion.div>}
                {stage === 'personality' && <motion.div key="pers" exit={{ opacity: 0, x: -20 }}>{renderPersonality()}</motion.div>}
                {stage === 'drawing' && <motion.div key="draw" exit={{ opacity: 0, scale: 0.9 }}>{renderDrawing()}</motion.div>}
                {stage === 'generating' && <motion.div key="gen" exit={{ opacity: 0 }}>{renderGenerating()}</motion.div>}
                {stage === 'results' && <motion.div key="res">{renderResults()}</motion.div>}
            </AnimatePresence>

            {error && (
                <div className="fixed bottom-4 right-4 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg">
                    {error}
                </div>
            )}
        </div>
    );
};
