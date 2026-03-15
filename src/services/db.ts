import { Idea, AppSettings, Folder } from '../types';

const API_BASE_URL = 'http://localhost:3001';
const IDEAS_URL = `${API_BASE_URL}/ideas`;
const FOLDERS_URL = `${API_BASE_URL}/folders`;
const pendingSaveChains = new Map<string, Promise<string>>();

async function serializeResourceSave(resourceKey: string, saveOperation: () => Promise<string>): Promise<string> {
    const previousOperation = pendingSaveChains.get(resourceKey) ?? Promise.resolve(resourceKey);
    const nextOperation = previousOperation
        .catch(() => resourceKey)
        .then(saveOperation);

    pendingSaveChains.set(resourceKey, nextOperation);

    try {
        return await nextOperation;
    } finally {
        if (pendingSaveChains.get(resourceKey) === nextOperation) {
            pendingSaveChains.delete(resourceKey);
        }
    }
}

async function upsertJsonServerResource<T extends { id: string }>(
    baseUrl: string,
    resource: T,
    options?: RequestInit
): Promise<string> {
    return serializeResourceSave(`${baseUrl}:${resource.id}`, async () => {
        const requestInit: RequestInit = {
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(resource),
            ...options
        };

        const updateResponse = await fetch(`${baseUrl}/${resource.id}`, {
            method: 'PUT',
            ...requestInit
        });

        if (updateResponse.ok) {
            return resource.id;
        }

        if (updateResponse.status !== 404) {
            throw new Error(`Failed to save resource: ${updateResponse.statusText}`);
        }

        const createResponse = await fetch(baseUrl, {
            method: 'POST',
            ...requestInit
        });

        if (createResponse.ok) {
            return resource.id;
        }

        // Concurrent first-save calls can race: another caller may create the same id
        // between our 404 PUT and this POST. Retry PUT once to converge on the existing row.
        const retryUpdateResponse = await fetch(`${baseUrl}/${resource.id}`, {
            method: 'PUT',
            ...requestInit
        });

        if (retryUpdateResponse.ok) {
            return resource.id;
        }

        throw new Error(`Failed to create resource: ${createResponse.statusText}`);
    });
}

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
            return await upsertJsonServerResource(IDEAS_URL, idea, options);
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
            return await upsertJsonServerResource(FOLDERS_URL, folder);
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
        if (stored) return JSON.parse(stored);

        return {
            provider: 'gemini',
            geminiKey: '',
            ollamaEndpoint: 'http://localhost:11434',
            ollamaModel: 'llama3',
            cliCommandTemplate: 'gemini "{{prompt}}"'
        };
    },

    async saveSettings(settings: AppSettings): Promise<void> {
        localStorage.setItem('app-settings', JSON.stringify(settings));
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
