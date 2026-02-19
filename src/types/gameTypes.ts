export type GameState = 'intro' | 'playing' | 'crashed' | 'generating' | 'results';

export interface GameObject {
    id: string;
    lane: number; // Use lanes for logic, X for render
    y: number; // 0 to 1000 (virtual depth)
    type: string;
    char: string;
    speed: number;
    label?: string;
}

export interface TrackTheme {
    name: string;
    skyColor: string;
    roadColor: string;
    roadBorderColor?: string;
    grassColor: string;
    stripeColor: string;
    accentColor: string;
}
