import { Idea, AppSettings } from '../types';

const API_URL = 'http://localhost:3001/ideas';

export const dbService = {
    async getAllIdeas(): Promise<Idea[]> {
        try {
            const response = await fetch(API_URL);
            if (!response.ok) throw new Error(response.statusText);
            const ideas: Idea[] = await response.json();
            return ideas;
        } catch (error) {
            console.error('Failed to fetch ideas:', error);
            throw error; // Propagate error so UI knows db is down
        }
    },

    async getIdea(id: string): Promise<Idea | undefined> {
        try {
            const response = await fetch(`${API_URL}/${id}`);
            if (!response.ok) {
                if (response.status === 404) return undefined;
                throw new Error(`Error fetching idea: ${response.statusText}`);
            }
            return await response.json();
        } catch (error) {
            console.error(`Failed to fetch idea ${id}:`, error);
            return undefined;
        }
    },

    async saveIdea(idea: Idea): Promise<string> {
        try {
            // Optimistic Update: Try to PUT first (99% of cases)
            // specific to json-server: PUT /ideas/:id updates the item
            const response = await fetch(`${API_URL}/${idea.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(idea),
            });

            // If successful, we are done
            if (response.ok) {
                return idea.id;
            }

            // If 404, it doesn't exist yet, so we POST (Create)
            if (response.status === 404) {
                const createResponse = await fetch(API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(idea),
                });

                if (!createResponse.ok) {
                    throw new Error(`Failed to create idea: ${createResponse.statusText}`);
                }
                return idea.id;
            }

            throw new Error(`Failed to save idea: ${response.statusText}`);
        } catch (error) {
            console.error('Error saving idea:', error);
            throw error;
        }
    },

    async deleteIdea(id: string): Promise<void> {
        try {
            const response = await fetch(`${API_URL}/${id}`, {
                method: 'DELETE',
            });
            if (!response.ok) {
                throw new Error(`Failed to delete idea: ${response.statusText}`);
            }
        } catch (error) {
            console.error(`Failed to delete idea ${id}:`, error);
            throw error;
        }
    },

    async getSettings(): Promise<AppSettings> {
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
