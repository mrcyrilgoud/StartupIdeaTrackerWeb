import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Rocket, Skull, Zap, Play, RotateCcw, Trophy, Timer, Car, Heart, DollarSign } from 'lucide-react';
import { aiService } from '../services/ai';
import { dbService } from '../services/db';
import { AppSettings, Idea } from '../types';
import { GeneratedIdeaCard } from '../components/GeneratedIdeaCard';
import { v4 as uuidv4 } from 'uuid';

// -- Constants --
const CANVAS_WIDTH = 800; // Wider for better perspective
const CANVAS_HEIGHT = 600;
const PLAYER_SIZE = 50;
const OBSTACLE_SIZE = 60; // Increased size for visibility
const ITEM_SIZE = 50;
const LANE_COUNT = 5;
const LANE_WIDTH = (CANVAS_WIDTH * 0.8) / LANE_COUNT; // Playable area is 80%

// Themes (Mario Kart Style Levels)
interface TrackTheme {
    name: string;
    skyColor: string;
    roadColor: string;
    grassColor: string;
    stripeColor: string;
    accentColor: string;
}

const THEMES: TrackTheme[] = [
    { name: 'Seed Valley', skyColor: '#38bdf8', roadColor: '#475569', grassColor: '#22c55e', stripeColor: '#ffffff', accentColor: '#facc15' }, // Brighter road
    { name: 'Series A City', skyColor: '#a855f7', roadColor: '#1e293b', grassColor: '#f472b6', stripeColor: '#fde047', accentColor: '#c084fc' }, // Vaporwave
    { name: 'Unicorn Sky', skyColor: '#fbcfe8', roadColor: '#e0f2fe', grassColor: '#bae6fd', stripeColor: '#ec4899', accentColor: '#818cf8' }, // Pastel
    { name: 'IPO Circuit', skyColor: '#fbbf24', roadColor: '#171717', grassColor: '#dc2626', stripeColor: '#fbbf24', accentColor: '#ffffff' }  // Intense
];

// Assets
const OBSTACLES = [
    { type: 'bug', char: '🐛', label: 'Bug' },
    { type: 'debt', char: '🧱', label: 'Blocker' },
    { type: 'lawsuit', char: '⚖️', label: 'Lawsuit' },
    { type: 'competitor', char: '🏎️', label: 'Competitor' }
];

const COLLECTIBLES = [
    { type: 'idea', char: '💡', value: 2, label: 'Insight' }, // Small boost
    { type: 'coffee', char: '☕', value: 1, label: 'Energy' },
    { type: 'money', char: '💰', value: 5, label: 'Funding' }, // BIG VALUATION BOOST
    { type: 'user', char: '❤️', value: 0, label: 'Traction' } // HEALS RUNWAY
];

type GameState = 'intro' | 'playing' | 'crashed' | 'generating' | 'results';

interface GameObject {
    id: string;
    lane: number; // Use lanes for logic, X for render
    y: number; // 0 to 1000 (virtual depth)
    type: string;
    char: string;
    speed: number;
    label?: string;
}

export const StartupRace: React.FC = () => {
    // -- State --
    const [gameState, setGameState] = useState<GameState>('intro');
    const [score, setScore] = useState(0);
    const [highScore, setHighScore] = useState(0);
    const [timeSurvived, setTimeSurvived] = useState(0);
    const [currentLevel, setCurrentLevel] = useState(0);
    const [runway, setRunway] = useState(100); // 0-100%

    const collectedItemsRef = useRef<string[]>([]);
    const themesVisitedRef = useRef<Set<string>>(new Set());

    const [generatedIdeas, setGeneratedIdeas] = useState<{ title: string, details: string }[]>([]);
    const [settings, setSettings] = useState<AppSettings | null>(null);
    const [error, setError] = useState('');

    // Game Loop Refs
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const requestRef = useRef<number>();

    // Game Logic Refs
    const playingRef = useRef(false);
    const scoreRef = useRef(0);
    const runwayRef = useRef(100);

    // Movement Physics
    const playerLane = useRef(2); // 0-4
    const playerX = useRef(0); // visual X offset for smooth lane changing
    const targetPlayerX = useRef(0);

    // Entities - Y coordinate is now 0 (horizon) to CANVAS_HEIGHT (bottom)
    const obstacles = useRef<GameObject[]>([]);
    const collectibles = useRef<GameObject[]>([]);
    const projectiles = useRef<{ id: string; x: number; y: number; speed: number; color: string }[]>([]);
    const particles = useRef<{ id: string; x: number; y: number; vx: number; vy: number; life: number; color: string; size: number }[]>([]);

    const speedMultiplier = useRef(1);
    const startTime = useRef(0);
    const levelRef = useRef(0);

    // -- Initialization --
    useEffect(() => {
        const init = async () => {
            const s = await dbService.getSettings();
            setSettings(s);
        };
        init();
        return () => cancelAnimationFrame(requestRef.current!);
    }, []);

    // -- Game Logic --
    const startGame = () => {
        setGameState('playing');
        playingRef.current = true;

        scoreRef.current = 0;
        setScore(0);
        runwayRef.current = 100;
        setRunway(100);
        setTimeSurvived(0);
        setCurrentLevel(0);
        collectedItemsRef.current = [];
        themesVisitedRef.current = new Set([THEMES[0].name]);
        setGeneratedIdeas([]);

        obstacles.current = [];
        collectibles.current = [];
        projectiles.current = [];
        particles.current = [];

        speedMultiplier.current = 1;
        playerLane.current = 2; // Center
        playerX.current = getLaneCenter(2);
        targetPlayerX.current = getLaneCenter(2);

        startTime.current = Date.now();
        levelRef.current = 0;

        requestRef.current = requestAnimationFrame(gameLoop);
    };

    const stopGame = () => {
        playingRef.current = false;
        cancelAnimationFrame(requestRef.current!);
    };

    const handleCrash = (cause: string) => {
        stopGame();
        setGameState('crashed');
        setHighScore(prev => Math.max(prev, scoreRef.current));
        setScore(scoreRef.current);
    };

    // Helper to get lane X at the bottom (player position)
    const getLaneCenter = (laneIndex: number) => {
        const totalRoadWidth = CANVAS_WIDTH * 0.8;
        const laneWidth = totalRoadWidth / LANE_COUNT;
        const startX = (CANVAS_WIDTH - totalRoadWidth) / 2;
        return startX + laneWidth * laneIndex + laneWidth / 2;
    };

    const spawnObject = () => {
        const lane = Math.floor(Math.random() * LANE_COUNT);
        const id = uuidv4();

        // 50% Collectible (Higher chance now)
        if (Math.random() > 0.5) {
            const type = COLLECTIBLES[Math.floor(Math.random() * COLLECTIBLES.length)];
            collectibles.current.push({
                id, lane, y: 0,
                type: 'collectible',
                char: type.char,
                speed: 2 * speedMultiplier.current, // Start speed
                label: type.label
            });
        } else {
            const type = OBSTACLES[Math.floor(Math.random() * OBSTACLES.length)];
            obstacles.current.push({
                id, lane, y: 0,
                type: 'obstacle',
                char: type.char,
                speed: 2.5 * speedMultiplier.current,
                label: type.label
            });
        }
    };

    const shoot = () => {
        if (!playingRef.current) return;
        projectiles.current.push({
            id: uuidv4(),
            x: playerX.current,
            y: 1000,
            speed: 30,
            color: '#ffffff'
        });
    };

    const spawnExplosion = (x: number, yScreen: number, color: string) => {
        for (let i = 0; i < 12; i++) {
            particles.current.push({
                id: uuidv4(),
                x, y: yScreen,
                vx: (Math.random() - 0.5) * 15,
                vy: (Math.random() - 0.5) * 15,
                life: 1.0,
                color,
                size: Math.random() * 6 + 3
            });
        }
    };

    const spawnFloatingText = (x: number, y: number, text: string, color: string) => {
        // Simple visual feedback could be particles or specific text list
        // For now, we reuse particles but maybe just sparklies
    };

    const gameLoop = useCallback(() => {
        if (!playingRef.current) return;

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const now = Date.now();
        const currentSurvived = (now - startTime.current) / 1000;

        // Level Up every 15 seconds
        const newLevel = Math.floor(currentSurvived / 15) % THEMES.length;
        if (newLevel !== levelRef.current) {
            levelRef.current = newLevel;
            setCurrentLevel(newLevel);
            themesVisitedRef.current.add(THEMES[newLevel].name);
        }

        const theme = THEMES[levelRef.current];
        speedMultiplier.current = 1 + (currentSurvived / 40);
        setTimeSurvived(currentSurvived);

        // -- Runway Decay (Burn Rate) --
        // Deplete logic: -0.15% per frame approx? (60fps * 0.15 = 9% per sec? Too fast)
        // Let's do time based.
        const burnRate = 6 * speedMultiplier.current; // % per second
        runwayRef.current -= (burnRate / 60);
        if (runwayRef.current <= 0) {
            runwayRef.current = 0;
            handleCrash('Burnout');
            return;
        }
        setRunway(runwayRef.current);

        // Smooth Player Movement
        playerX.current = playerX.current + (targetPlayerX.current - playerX.current) * 0.15;

        // Draw Background
        ctx.fillStyle = theme.skyColor;
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT / 2);

        // Sun
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        const sunY = (Math.sin(now / 2000) * 10) + 100;
        ctx.arc(CANVAS_WIDTH / 2, sunY, 40, 0, Math.PI * 2);
        ctx.fill();

        // Grass
        ctx.fillStyle = theme.grassColor;
        ctx.fillRect(0, CANVAS_HEIGHT / 2, CANVAS_WIDTH, CANVAS_HEIGHT / 2);

        // Road
        const horizonY = CANVAS_HEIGHT / 2;
        const roadTopWidth = 20;
        const roadBottomWidth = CANVAS_WIDTH * 0.8;
        const roadCenterX = CANVAS_WIDTH / 2;

        ctx.fillStyle = theme.roadColor;
        ctx.beginPath();
        ctx.moveTo(roadCenterX - roadTopWidth / 2, horizonY);
        ctx.lineTo(roadCenterX + roadTopWidth / 2, horizonY);
        ctx.lineTo(roadCenterX + roadBottomWidth / 2, CANVAS_HEIGHT);
        ctx.lineTo(roadCenterX - roadBottomWidth / 2, CANVAS_HEIGHT);
        ctx.fill();

        // Road Stripes
        ctx.strokeStyle = theme.stripeColor;
        ctx.lineWidth = 2;

        ctx.beginPath();
        for (let i = 1; i < LANE_COUNT; i++) {
            const topX = (roadCenterX - roadTopWidth / 2) + (roadTopWidth / LANE_COUNT) * i;
            const bottomX = (roadCenterX - roadBottomWidth / 2) + (roadBottomWidth / LANE_COUNT) * i;
            ctx.moveTo(topX, horizonY);
            ctx.lineTo(bottomX, CANVAS_HEIGHT);
        }
        ctx.globalAlpha = 0.3;
        ctx.stroke();
        ctx.globalAlpha = 1.0;


        // Spawn Logic
        if (Math.random() < 0.025 * speedMultiplier.current) {
            spawnObject();
        }

        const project = (lane: number, yVirtual: number) => {
            const perspective = Math.pow(yVirtual / 1000, 3);
            const screenY = horizonY + (yVirtual / 1000) * (CANVAS_HEIGHT - horizonY);
            const currentWidth = roadTopWidth + (roadBottomWidth - roadTopWidth) * (yVirtual / 1000);
            const laneW = currentWidth / LANE_COUNT;
            const leftEdge = roadCenterX - currentWidth / 2;
            const screenX = leftEdge + laneW * lane + laneW / 2;
            const scale = 0.2 + 0.8 * perspective;
            return { x: screenX, y: screenY, scale };
        };

        // Render Objects
        const allObjects = [...obstacles.current, ...collectibles.current].sort((a, b) => a.y - b.y);

        for (const obj of allObjects) {
            const speedCurve = 1 + (obj.y / 1000) * 5;
            obj.y += obj.speed * speedCurve;

            const proj = project(obj.lane, obj.y);

            // Glow / Visibility Background
            const glowSize = 30 * proj.scale;
            const glow = ctx.createRadialGradient(proj.x, proj.y, glowSize * 0.2, proj.x, proj.y, glowSize);
            glow.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
            glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(proj.x, proj.y, glowSize, 0, Math.PI * 2);
            ctx.fill();

            // Bobbing Animation for Collectibles
            let yOffset = 0;
            if (obj.type === 'collectible') {
                yOffset = Math.sin(now / 150) * 10 * proj.scale;
            }

            // Draw Object
            // Using slightly larger font for better visibility
            ctx.font = `${50 * proj.scale}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#000'; // fallback
            ctx.fillText(obj.char, proj.x, proj.y + yOffset - 10 * proj.scale);

            if (obj.y > 1000) {
                if (obj.type === 'obstacle') {
                    // Passed safely
                    obstacles.current = obstacles.current.filter(o => o.id !== obj.id);
                } else {
                    collectibles.current = collectibles.current.filter(c => c.id !== obj.id);
                }
            }
        }

        // Collision Check
        const checks = [...obstacles.current, ...collectibles.current];
        for (const obj of checks) {
            if (obj.y > 900 && obj.y < 1000) {
                const proj = project(obj.lane, obj.y);
                const dx = Math.abs(playerX.current - proj.x);
                if (dx < 40) { // Hitbox
                    if (obj.type === 'obstacle') {
                        handleCrash(obj.label || 'Crash');
                        return;
                    } else {
                        // Collect
                        const colItem = COLLECTIBLES.find(c => c.char === obj.char);
                        if (colItem) {
                            if (colItem.label === 'Traction') { // Heart
                                runwayRef.current = Math.min(100, runwayRef.current + 20); // Heal
                                spawnExplosion(proj.x, proj.y, '#ec4899');
                            } else if (colItem.label === 'Funding') { // Money
                                scoreRef.current += 5; // Big boost
                                spawnExplosion(proj.x, proj.y, '#22c55e');
                            } else {
                                scoreRef.current += colItem.value;
                                spawnExplosion(proj.x, proj.y, '#fbbf24');
                            }

                            collectedItemsRef.current.push(colItem.label);
                            collectibles.current = collectibles.current.filter(c => c.id !== obj.id);
                            setScore(scoreRef.current);
                        }
                    }
                }
            }
        }

        // Projectiles
        for (let i = projectiles.current.length - 1; i >= 0; i--) {
            const p = projectiles.current[i];
            p.y -= p.speed;

            const scale = p.y / 1000;
            const size = 5 + 10 * scale;
            const screenY = horizonY + (p.y / 1000) * (CANVAS_HEIGHT - horizonY);
            const factor = p.y / 1000;
            const screenX = roadCenterX + (p.x - roadCenterX) * factor;

            ctx.beginPath();
            ctx.arc(screenX, screenY, size, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.fill();

            // Hit Check
            for (let j = obstacles.current.length - 1; j >= 0; j--) {
                const obs = obstacles.current[j];
                if (Math.abs(obs.y - p.y) < 50) {
                    const projObs = project(obs.lane, obs.y);
                    if (Math.abs(projObs.x - screenX) < 40 * projObs.scale) {
                        spawnExplosion(projObs.x, projObs.y, '#ef4444');
                        obstacles.current.splice(j, 1);
                        projectiles.current.splice(i, 1);
                        scoreRef.current += 1;
                        setScore(scoreRef.current);
                        break;
                    }
                }
            }
            if (p.y < 0) projectiles.current.splice(i, 1);
        }

        // Player
        const pY = 520;
        const pSize = 60;

        ctx.save();
        ctx.translate(playerX.current, pY);
        const tilt = (targetPlayerX.current - playerX.current) * 0.1;
        ctx.rotate(tilt * Math.PI / 180);

        ctx.fillStyle = theme.accentColor;
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.moveTo(0, -pSize / 2);
        ctx.lineTo(pSize / 2, pSize / 2);
        ctx.lineTo(-pSize / 2, pSize / 2);
        ctx.fill();

        ctx.font = '30px sans-serif';
        ctx.fillText('🏎️', -15, 10);

        if (Math.random() > 0.3) {
            ctx.fillStyle = '#f97316';
            ctx.beginPath();
            ctx.arc(0, pSize / 2 + 10, 10, 0, Math.PI);
            ctx.fill();
        }
        ctx.restore();

        // Particles
        for (let i = particles.current.length - 1; i >= 0; i--) {
            const p = particles.current[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life -= 0.05;
            if (p.life <= 0) {
                particles.current.splice(i, 1);
                continue;
            }
            ctx.globalAlpha = p.life;
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x, p.y, p.size, p.size);
            ctx.globalAlpha = 1.0;
        }

        requestRef.current = requestAnimationFrame(gameLoop);
    }, []);

    // Input Handling
    const moveLane = (dir: -1 | 1) => {
        const newLane = Math.max(0, Math.min(LANE_COUNT - 1, playerLane.current + dir));
        playerLane.current = newLane;
        targetPlayerX.current = getLaneCenter(newLane);
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!canvasRef.current || !playingRef.current) return;
        const rect = canvasRef.current.getBoundingClientRect();
        const scaleX = canvasRef.current.width / rect.width;
        const x = (e.clientX - rect.left) * scaleX;

        let closestLane = 0;
        let minDist = 9999;
        for (let i = 0; i < LANE_COUNT; i++) {
            const center = getLaneCenter(i);
            const dist = Math.abs(x - center);
            if (dist < minDist) {
                minDist = dist;
                closestLane = i;
            }
        }
        if (closestLane !== playerLane.current) {
            playerLane.current = closestLane;
            targetPlayerX.current = getLaneCenter(closestLane);
        }
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!playingRef.current) return;
            if (e.key === 'ArrowLeft') moveLane(-1);
            if (e.key === 'ArrowRight') moveLane(1);
            if (e.key === ' ' || e.key === 'ArrowUp') shoot();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // AI
    const handleGenerate = async () => {
        if (!settings) return;
        setGameState('generating');
        try {
            const itemCounts = collectedItemsRef.current.reduce((acc: Record<string, number>, curr: string) => {
                acc[curr] = (acc[curr] || 0) + 1;
                return acc;
            }, {} as Record<string, number>);

            const themes = Array.from(themesVisitedRef.current).join(' -> ');
            const items = Object.entries(itemCounts).map(([k, v]) => `${v} ${k}`).join(', ');

            const prompt = `
                I just played a wild kart racing game for a startup ideation session.
                My Journey: I started in ${themesVisitedRef.current.has('Seed Valley') ? 'the early stage Seed Valley' : 'a garage'} and raced through themes like: ${themes}.
                I survived ${timeSurvived.toFixed(0)} seconds.
                I collected: ${items || "Pure adrenaline"} while shooting down blockers.

                Generate 3 creative, widely divergent startup ideas inspired by this specific journey.
                Format: Title + One sentence colorful pitch.
            `;

            const ideas = await aiService.generateIdeas(prompt, settings);
            setGeneratedIdeas(ideas);
            setGameState('results');
        } catch (e) {
            console.error(e);
            setGameState('results');
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

    const currentTheme = THEMES[currentLevel];

    return (
        <div className="min-h-full p-4 flex flex-col items-center">
            <div className="text-center mb-4">
                <h1 className="text-5xl font-black italic tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-yellow-400 to-pink-500 drop-shadow-sm flex items-center justify-center gap-3" style={{ textShadow: '4px 4px 0px rgba(0,0,0,0.2)' }}>
                    <Car size={48} className="text-yellow-400" strokeWidth={3} />
                    STARTUP KART
                </h1>
                <p className="font-bold text-slate-500 tracking-widest text-sm uppercase">
                    Level {currentLevel + 1}: {currentTheme.name}
                </p>
            </div>

            <div className="relative rounded-3xl overflow-hidden border-8 border-white shadow-2xl bg-black max-w-4xl w-full aspect-[4/3]">
                <canvas
                    ref={canvasRef}
                    width={CANVAS_WIDTH}
                    height={CANVAS_HEIGHT}
                    className="w-full h-full object-cover cursor-none"
                    onMouseMove={handleMouseMove}
                    onClick={shoot}
                />

                {/* HUD */}
                {gameState === 'playing' && (
                    <div className="absolute top-4 left-4 right-4 flex justify-between items-start font-black text-2xl text-white drop-shadow-md z-10 w-full px-8 pointer-events-none">

                        {/* Left: Runway (Life) */}
                        <div className="flex flex-col items-start gap-1 w-1/3">
                            <div className="flex items-center gap-2 text-pink-400">
                                <Heart fill="currentColor" size={24} />
                                <span className="text-lg">RUNWAY</span>
                            </div>
                            <div className="w-full h-4 bg-black/50 rounded-full border border-white/30 overflow-hidden">
                                <motion.div
                                    className="h-full bg-gradient-to-r from-pink-500 to-red-500"
                                    initial={{ width: '100%' }}
                                    animate={{ width: `${runway}%` }}
                                    transition={{ type: 'tween', ease: 'linear', duration: 0.1 }}
                                />
                            </div>
                        </div>

                        {/* Center: Time */}
                        <div className="bg-white/20 backdrop-blur px-4 py-2 rounded-full border-2 border-white/50">
                            ⏱️ {timeSurvived.toFixed(1)}s
                        </div>

                        {/* Right: Valuation (Score) */}
                        <div className="flex flex-col items-end w-1/3">
                            <div className="text-yellow-300 text-4xl flex items-center gap-1">
                                <DollarSign size={32} strokeWidth={4} />
                                {score}M
                            </div>
                            <span className="text-sm opacity-80 uppercase tracking-widest">Valuation</span>
                        </div>
                    </div>
                )}

                {/* Introduction */}
                {gameState === 'intro' && (
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center text-white text-center p-8">
                        <h2 className="text-6xl font-black mb-6 text-yellow-300 drop-shadow-[0_4px_0_rgba(0,0,0,0.5)]">READY?</h2>
                        <div className="bg-white/10 p-6 rounded-3xl backdrop-blur-md border-4 border-white/20 max-w-md">
                            <p className="text-xl font-bold mb-4">🏁 Race through the Startup Lifecycle!</p>
                            <ul className="text-left space-y-4 mb-8 font-medium">
                                <li className="flex items-center gap-3">
                                    <div className="bg-pink-500 p-2 rounded-lg"><Heart size={20} fill="white" /></div>
                                    <span>Collect collects to extend <strong>Runway</strong></span>
                                </li>
                                <li className="flex items-center gap-3">
                                    <div className="bg-green-500 p-2 rounded-lg"><DollarSign size={20} /></div>
                                    <span>Grab Funding to boost <strong>Valuation</strong></span>
                                </li>
                                <li className="flex items-center gap-3">
                                    <div className="bg-red-500 p-2 rounded-lg"><Skull size={20} /></div>
                                    <span>Avoid Burnout & Bugs!</span>
                                </li>
                            </ul>
                            <button onClick={startGame} className="w-full bg-pink-500 hover:bg-pink-400 text-white font-black py-4 rounded-xl text-2xl shadow-[0_6px_0_rgb(190,24,93)] active:translate-y-1 active:shadow-none transition-all">
                                START ENGINE
                            </button>
                        </div>
                    </div>
                )}

                {/* Crash / Game Over */}
                {gameState === 'crashed' && (
                    <div className="absolute inset-0 bg-black/80 backdrop-blur flex flex-col items-center justify-center text-white text-center p-8 animate-in zoom-in duration-300">
                        <div className="text-8xl mb-4">💥</div>
                        <h2 className="text-5xl font-black mb-2 text-white">WIPEOUT!</h2>
                        <p className="text-2xl text-yellow-300 font-bold mb-8">Final Valuation: ${score}M</p>

                        <div className="flex gap-4">
                            <button onClick={handleGenerate} className="bg-purple-600 hover:bg-purple-500 text-white font-bold py-4 px-8 rounded-xl shadow-[0_6px_0_rgb(107,33,168)] active:translate-y-1 active:shadow-none transition-all flex items-center gap-2">
                                <Zap size={24} fill="currentColor" />
                                PIVOT (Generate Ideas)
                            </button>
                            <button onClick={startGame} className="bg-slate-600 hover:bg-slate-500 text-white font-bold py-4 px-8 rounded-xl shadow-[0_6px_0_rgb(51,65,85)] active:translate-y-1 active:shadow-none transition-all flex items-center gap-2">
                                <RotateCcw size={24} />
                                RETRY
                            </button>
                        </div>
                    </div>
                )}

                {/* Generating */}
                {gameState === 'generating' && (
                    <div className="absolute inset-0 bg-purple-900/90 backdrop-blur flex flex-col items-center justify-center text-white p-8">
                        <div className="text-6xl animate-bounce mb-4">🧠</div>
                        <h2 className="text-3xl font-bold animate-pulse">Brainstorming...</h2>
                    </div>
                )}
            </div>

            {/* Results */}
            {gameState === 'results' && (
                <div className="mt-8 w-full max-w-4xl animate-in slide-in-from-bottom duration-500">
                    <div className="bg-white p-6 rounded-3xl shadow-xl border-4 border-slate-100">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-3xl font-black text-slate-800">New Ventures Unlocked</h2>
                            <button
                                onClick={startGame}
                                className="text-slate-500 hover:text-slate-800 font-bold flex items-center gap-2"
                            >
                                <RotateCcw size={20} /> Race Again
                            </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {generatedIdeas.map((idea, idx) => (
                                <GeneratedIdeaCard key={idx} idea={idea} onSave={handleSaveIdea} />
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
