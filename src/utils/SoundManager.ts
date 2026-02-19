export class SoundManager {
    private ctx: AudioContext | null = null;
    private enabled: boolean = true;

    constructor() {
        try {
            // @ts-ignore
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContext();
        } catch (e) {
            console.error('AudioContext not supported');
            this.enabled = false;
        }
    }

    private playTone(freq: number, type: OscillatorType, duration: number, vol: number = 0.1) {
        if (!this.enabled || !this.ctx) return;

        // Resume context if suspended (browser policy)
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }

    playJump() {
        this.playTone(400, 'sine', 0.1, 0.1);
        setTimeout(() => this.playTone(600, 'sine', 0.2, 0.1), 50);
    }

    playShoot() {
        this.playTone(800, 'square', 0.1, 0.05);
        setTimeout(() => this.playTone(400, 'square', 0.1, 0.05), 50);
    }

    playCollect(isGood: boolean = true) {
        if (isGood) {
            this.playTone(880, 'sine', 0.1, 0.1); // A5
            setTimeout(() => this.playTone(1108, 'sine', 0.2, 0.1), 100); // C#6
        } else {
            this.playTone(200, 'sawtooth', 0.3, 0.1);
        }
    }

    playCrash() {
        this.playTone(100, 'sawtooth', 0.5, 0.2);
        setTimeout(() => this.playTone(80, 'sawtooth', 0.4, 0.2), 100);
        setTimeout(() => this.playTone(60, 'sawtooth', 0.3, 0.2), 200);
    }

    playLevelUp() {
        [440, 554, 659, 880].forEach((freq, i) => {
            setTimeout(() => this.playTone(freq, 'square', 0.3, 0.1), i * 150);
        });
    }

    toggle(on: boolean) {
        this.enabled = on;
    }
}

export const soundManager = new SoundManager();
