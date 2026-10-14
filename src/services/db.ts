import { type AppSettings, type Folder, type Idea, type IdeaEvent, type IdeaEventDiff, type IdeaEventType } from '../types';

const API_BASE_URL = '/api';
const pendingIdeaSaveChains = new Map<string, Promise<unknown>>();

type SaveIdeaOptions = RequestInit & {
  eventContext?: {
    type: IdeaEventType;
    payload?: Record<string, unknown>;
  };
};

async function serializeIdeaSave<T>(ideaId: string, saveOperation: () => Promise<T>): Promise<T> {
  const previousOperation = pendingIdeaSaveChains.get(ideaId) ?? Promise.resolve();
  const nextOperation = previousOperation
    .catch(() => undefined)
    .then(saveOperation);

  pendingIdeaSaveChains.set(ideaId, nextOperation);

  try {
    return await nextOperation;
  } finally {
    if (pendingIdeaSaveChains.get(ideaId) === nextOperation) {
      pendingIdeaSaveChains.delete(ideaId);
    }
  }
}

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

  async saveIdea(idea: Idea, options?: SaveIdeaOptions): Promise<string> {
    return serializeIdeaSave(idea.id, async () => {
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
      if (options?.eventContext) {
        payload.eventContext = options.eventContext;
      }

      const saved = await request<Idea>('/ideas', {
        ...options,
        method: 'POST',
        body: JSON.stringify(payload)
      });

      return saved.id;
    });
  },

  async deleteIdea(id: string): Promise<void> {
    await request<void>(`/ideas/${id}`, {
      method: 'DELETE'
    });
  },

  async listIdeaEvents(id: string, options: { limit?: number; before?: number } = {}): Promise<IdeaEvent[]> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options.before !== undefined) {
      params.set('before', String(options.before));
    }

    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    const response = await request<{ events: IdeaEvent[] }>(`/ideas/${id}/events${suffix}`);
    return response.events;
  },

  async diffIdeaEvent(ideaId: string, eventId: number): Promise<IdeaEventDiff> {
    return request<IdeaEventDiff>(`/ideas/${ideaId}/events/${eventId}/diff`, {
      method: 'POST'
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
    return request<AppSettings>('/settings');
  },

  async saveSettings(settings: AppSettings): Promise<void> {
    await request<AppSettings>('/settings', {
      method: 'PUT',
      body: JSON.stringify({ version: 2, activeConnectionId: settings.activeConnectionId })
    });
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
