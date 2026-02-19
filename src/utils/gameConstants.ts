export const CANVAS_WIDTH = 800; // Wider for better perspective
export const CANVAS_HEIGHT = 600;
export const PLAYER_SIZE = 50;
export const OBSTACLE_SIZE = 60; // Increased size for visibility
export const ITEM_SIZE = 50;
export const LANE_COUNT = 5;
export const LANE_WIDTH = (CANVAS_WIDTH * 0.8) / LANE_COUNT; // Playable area is 80%

// Themes (Mario Kart Style Levels)
export const THEMES = [
    { name: 'Seed Valley', skyColor: '#38bdf8', roadColor: '#475569', grassColor: '#22c55e', stripeColor: '#ffffff', accentColor: '#facc15' }, // Brighter road
    { name: 'Series A City', skyColor: '#a855f7', roadColor: '#1e293b', grassColor: '#f472b6', stripeColor: '#fde047', accentColor: '#c084fc' }, // Vaporwave
    { name: 'Unicorn Sky', skyColor: '#fbcfe8', roadColor: '#e0f2fe', grassColor: '#bae6fd', stripeColor: '#ec4899', accentColor: '#818cf8' }, // Pastel
    { name: 'IPO Circuit', skyColor: '#fbbf24', roadColor: '#171717', grassColor: '#dc2626', stripeColor: '#fbbf24', accentColor: '#ffffff' }  // Intense
];

// Assets
export const OBSTACLES = [
    { type: 'bug', char: '🐛', label: 'Bug' },
    { type: 'debt', char: '🧱', label: 'Blocker' },
    { type: 'lawsuit', char: '⚖️', label: 'Lawsuit' },
    { type: 'competitor', char: '🏎️', label: 'Competitor' }
];

export const COLLECTIBLES = [
    { type: 'idea', char: '💡', value: 2, label: 'Insight' }, // Small boost
    { type: 'coffee', char: '☕', value: 1, label: 'Energy' },
    { type: 'money', char: '💰', value: 5, label: 'Funding' }, // BIG VALUATION BOOST
    { type: 'user', char: '❤️', value: 0, label: 'Traction' }, // HEALS RUNWAY
    { type: 'shield', char: '🛡️', value: 0, label: ' pivot' } // SHIELD (New)
];
