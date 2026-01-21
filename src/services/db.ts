import { openDB, DBSchema } from 'idb';
import { Idea, AppSettings } from '../types';

interface MyDB extends DBSchema {
    ideas: {
        key: string;
        value: Idea;
        indexes: { 'by-timestamp': number };
    };
    settings: {
        key: string;
        value: AppSettings;
    };
}

const dbPromise = openDB<MyDB>('startup-idea-tracker-db', 1, {
    upgrade(db) {
        const ideaStore = db.createObjectStore('ideas', { keyPath: 'id' });
        ideaStore.createIndex('by-timestamp', 'timestamp');

        db.createObjectStore('settings', { keyPath: 'key' as any }); // 'key' is not a property of AppSettings but we store it as singular object? logic adjustment below
    },
});

export const dbService = {
    async getAllIdeas(): Promise<Idea[]> {
        return (await dbPromise).getAllFromIndex('ideas', 'by-timestamp');
    },

    async getIdea(id: string): Promise<Idea | undefined> {
        return (await dbPromise).get('ideas', id);
    },

    async saveIdea(idea: Idea): Promise<string> {
        return (await dbPromise).put('ideas', idea);
    },

    async deleteIdea(id: string): Promise<void> {
        return (await dbPromise).delete('ideas', id);
    },

    async getSettings(): Promise<AppSettings> {
        await dbPromise;
        // We store settings as a single object with a fixed key 'app-settings' or similar, 
        // or we could use localStorage for settings. Ideally, IDB is fine.
        // Let's use localStorage for settings for sync simplicity, IDB for heavy data.
        // BUT since we are already here, let's just stick to IDB or localStorage.
        // Actually, localStorage is sync, easier for initialization.
        const stored = localStorage.getItem('app-settings');
        if (stored) return JSON.parse(stored);

        return {
            provider: 'gemini',
            geminiKey: '',
            ollamaEndpoint: 'http://localhost:11434',
            ollamaModel: 'llama3'
        };
    },

    async saveSettings(settings: AppSettings): Promise<void> {
        localStorage.setItem('app-settings', JSON.stringify(settings));
    },

    async exportAllData(): Promise<string> {
        const ideas = await this.getAllIdeas();
        const settings = await this.getSettings();
        const exportData = {
            version: 1,
            timestamp: Date.now(),
            ideas,
            settings
        };
        return JSON.stringify(exportData, null, 2);
    },

    async importData(jsonString: string): Promise<void> {
        try {
            const data = JSON.parse(jsonString);
            if (data.ideas && Array.isArray(data.ideas)) {
                for (const idea of data.ideas) {
                    await this.saveIdea(idea);
                }
            }
            if (data.settings) {
                await this.saveSettings(data.settings);
            }
        } catch (e) {
            console.error("Failed to import data", e);
            throw new Error("Invalid backup file");
        }
    }
};
