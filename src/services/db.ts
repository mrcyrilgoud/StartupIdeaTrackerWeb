import { Idea, AppSettings, Folder } from '../types';

const API_BASE_URL = 'http://localhost:3001';
const IDEAS_URL = `${API_BASE_URL}/ideas`;
const FOLDERS_URL = `${API_BASE_URL}/folders`;

export const dbService = {
    async getAllIdeas(): Promise<Idea[]> {
        try {
            const response = await fetch(IDEAS_URL);
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
            const response = await fetch(`${IDEAS_URL}/${id}`);
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

    async saveIdea(idea: Idea, options?: RequestInit): Promise<string> {
        try {
            // Optimistic Update: Try to PUT first (99% of cases)
            // specific to json-server: PUT /ideas/:id updates the item
            const response = await fetch(`${IDEAS_URL}/${idea.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(idea),
                ...options
            });

            // If successful, we are done
            if (response.ok) {
                return idea.id;
            }

            // If 404, it doesn't exist yet, so we POST (Create)
            if (response.status === 404) {
                const createResponse = await fetch(IDEAS_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(idea),
                    ...options
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
            const response = await fetch(`${IDEAS_URL}/${id}`, {
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

    // --- Folders ---

    async getAllFolders(): Promise<Folder[]> {
        try {
            const response = await fetch(FOLDERS_URL);
            if (!response.ok) throw new Error(response.statusText);
            return await response.json();
        } catch (error) {
            console.error('Failed to fetch folders:', error);
            return [];
        }
    },

    async saveFolder(folder: Folder): Promise<string> {
        try {
            const response = await fetch(`${FOLDERS_URL}/${folder.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(folder),
            });

            if (response.ok) return folder.id;

            if (response.status === 404) {
                const createResponse = await fetch(FOLDERS_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(folder),
                });
                if (!createResponse.ok) throw new Error(`Failed to create folder: ${createResponse.statusText}`);
                return folder.id;
            }
            throw new Error(`Failed to save folder: ${response.statusText}`);
        } catch (error) {
            console.error('Error saving folder:', error);
            throw error;
        }
    },

    async deleteFolder(id: string): Promise<void> {
        try {
            const response = await fetch(`${FOLDERS_URL}/${id}`, {
                method: 'DELETE',
            });
            if (!response.ok) throw new Error(`Failed to delete folder: ${response.statusText}`);
        } catch (error) {
            console.error(`Failed to delete folder ${id}:`, error);
            throw error;
        }
    },

    async getSettings(): Promise<AppSettings> {
        const stored = localStorage.getItem('app-settings');
        if (stored) {
            const settings = JSON.parse(stored);
            // Auto-migration to ensure we use the correct 'opencode run' command for autonomous execution
            if (settings.agentCommand && (
                settings.agentCommand.includes('opencode loop') ||
                settings.agentCommand.includes('--goal') ||
                settings.agentCommand.includes('opencode .')
            )) {
                // Reset to the valid autonomous command
                settings.agentCommand = 'opencode run "Build MVP from PROMPT.md"';
                localStorage.setItem('app-settings', JSON.stringify(settings));
            }
            return settings;
        }

        return {
            provider: 'gemini',
            geminiKey: '',
            ollamaEndpoint: 'http://localhost:11434',
            ollamaModel: 'llama3',
            editorCommand: 'cursor',
            agentProvider: 'custom',
            agentCommand: '',
            projectsBaseDir: '../'
        };
    },

    async saveSettings(settings: AppSettings): Promise<void> {
        localStorage.setItem('app-settings', JSON.stringify(settings));
    },

    async createProject(data: { path: string; projectName: string; prompt: string; editorCommand?: string; agentCommand?: string }): Promise<void> {
        const response = await fetch(`${API_BASE_URL}/api/create-project`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `Failed to create project: ${response.statusText}`);
        }
    },

    async selectBaseDirectory(): Promise<string | null> {
        try {
            const response = await fetch(`${API_BASE_URL}/api/select-folder`);
            if (!response.ok) throw new Error('Failed to open folder picker');
            const data = await response.json();
            if (data.cancelled) return null;
            return data.path;
        } catch (error) {
            console.error('Error selecting folder:', error);
            return null;
        }
    },

    async exportAllData(): Promise<string> {
        const ideas = await this.getAllIdeas();
        const folders = await this.getAllFolders();
        const settings = await this.getSettings();
        const exportData = {
            version: 1,
            timestamp: Date.now(),
            ideas,
            folders,
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
            if (data.folders && Array.isArray(data.folders)) {
                for (const folder of data.folders) {
                    await this.saveFolder(folder);
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
