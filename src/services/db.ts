import { APP_SETTINGS_STORAGE_KEY, DEFAULT_APP_SETTINGS, type AppSettings, type Folder, type Idea } from '../types';

const API_BASE_URL = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json'
    },
    ...init
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Not found');
    }
    const errorPayload = await response.json().catch(() => ({}));
    throw new Error(String(errorPayload.error || response.statusText));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function hasMeaningfulSettings(settings: AppSettings): boolean {
  return Boolean(
    settings.geminiKey.trim()
    || settings.ollamaEndpoint.trim() !== DEFAULT_APP_SETTINGS.ollamaEndpoint
    || settings.ollamaModel.trim() !== DEFAULT_APP_SETTINGS.ollamaModel
    || settings.cliCommandTemplate.trim() !== DEFAULT_APP_SETTINGS.cliCommandTemplate
    || settings.provider !== DEFAULT_APP_SETTINGS.provider
  );
}

async function syncLegacySettingsIfNeeded(currentSettings: AppSettings): Promise<AppSettings> {
  const stored = localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
  if (!stored || hasMeaningfulSettings(currentSettings)) {
    return currentSettings;
  }

  try {
    const legacySettings = JSON.parse(stored) as AppSettings;
    const saved = await request<AppSettings>('/settings', {
      method: 'PUT',
      body: JSON.stringify(legacySettings)
    });
    localStorage.removeItem(APP_SETTINGS_STORAGE_KEY);
    return saved;
  } catch {
    return currentSettings;
  }
}

export const dbService = {
  async getAllIdeas(): Promise<Idea[]> {
    return request<Idea[]>('/ideas');
  },

  async getIdea(id: string): Promise<Idea | undefined> {
    try {
      return await request<Idea>(`/ideas/${id}`);
    } catch (error) {
      if (error instanceof Error && error.message === 'Not found') {
        return undefined;
      }
      throw error;
    }
  },

  async saveIdea(idea: Idea, options?: RequestInit): Promise<string> {
    const payload: Record<string, unknown> = {
      id: idea.id,
      title: idea.title,
      details: idea.details,
      analysis: idea.analysis,
      timestamp: idea.timestamp,
      keywords: idea.keywords,
      chatHistory: idea.chatHistory,
      relatedIdeas: idea.relatedIdeas,
      status: idea.status,
      vetting: idea.vetting
    };

    if (idea.folder_id) {
      payload.folder_id = idea.folder_id;
    }

    const saved = await request<Idea>('/ideas', {
      ...options,
      method: 'POST',
      body: JSON.stringify(payload)
    });

    return saved.id;
  },

  async deleteIdea(id: string): Promise<void> {
    await request<void>(`/ideas/${id}`, {
      method: 'DELETE'
    });
  },

  async getAllFolders(): Promise<Folder[]> {
    return request<Folder[]>('/folders');
  },

  async saveFolder(folder: Folder): Promise<string> {
    const saved = await request<Folder>('/folders', {
      method: 'POST',
      body: JSON.stringify(folder)
    });
    return saved.id;
  },

  async deleteFolder(id: string): Promise<void> {
    await request<void>(`/folders/${id}`, {
      method: 'DELETE'
    });
  },

  async getSettings(): Promise<AppSettings> {
    const settings = await request<AppSettings>('/settings');
    return syncLegacySettingsIfNeeded(settings);
  },

  async saveSettings(settings: AppSettings): Promise<void> {
    await request<AppSettings>('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings)
    });
    localStorage.removeItem(APP_SETTINGS_STORAGE_KEY);
  },

  async exportAllData(): Promise<string> {
    const payload = await request<unknown>('/export');
    return JSON.stringify(payload, null, 2);
  },

  async importData(jsonString: string): Promise<void> {
    const payload = JSON.parse(jsonString);
    await request('/import', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }
};
