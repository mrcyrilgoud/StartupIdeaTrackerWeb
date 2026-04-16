import type { AppSettings, ChatMessage, Idea, VettingCriteria, VettingResult } from '../types';

export interface GeneratedIdea {
  title: string;
  details: string;
}

export interface MVPAnalysisResult {
  ideaId: string;
  reason: string;
  score: number;
}

export interface Analysis {
  analysis: string;
  market?: string;
  product?: string;
  acquisition?: string;
  monetization?: string;
}

export interface FolderSuggestion {
  name: string;
  description: string;
  ideaIds: string[];
}

export interface StreamOptions {
  signal?: AbortSignal;
  emitDelta?: boolean;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

const API_BASE_URL = '/api';

async function request<T>(path: string, body: unknown, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    ...options
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    throw new Error(String(errorPayload.error || response.statusText));
  }

  return response.json() as Promise<T>;
}

async function streamText(
  path: string,
  body: unknown,
  onChunk: (text: string) => void,
  options: StreamOptions = {}
): Promise<string> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    signal: options.signal,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    throw new Error(String(errorPayload.error || response.statusText));
  }

  if (!response.body) {
    throw new Error('No response body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n');
    buffer = chunks.pop() || '';

    for (const chunk of chunks) {
      if (!chunk.startsWith('data: ')) continue;
      const payloadText = chunk.slice(6).trim();
      if (!payloadText) continue;
      const payload = JSON.parse(payloadText) as { delta?: string; fullText?: string; done?: boolean; error?: string };
      if (payload.error) {
        throw new Error(payload.error);
      }
      if (payload.delta) {
        fullText = payload.fullText ?? `${fullText}${payload.delta}`;
        onChunk(options.emitDelta ? payload.delta : fullText);
      }
      if (payload.done) {
        return payload.fullText ?? fullText;
      }
    }
  }

  return fullText;
}

export const aiService = {
  async generateResponse(
    prompt: string,
    _settings: AppSettings,
    thinking = false,
    jsonMode = false,
    _image?: string,
    options: RequestOptions = {}
  ): Promise<string> {
    const response = await request<{ response: string }>('/ai/raw-response', {
      prompt,
      thinking,
      jsonMode
    }, { signal: options.signal });
    return response.response;
  },

  async generateResponseStream(
    prompt: string,
    settings: AppSettings,
    onChunk: (text: string) => void,
    thinking = false,
    image?: string,
    options: StreamOptions = {}
  ): Promise<string> {
    const response = await this.generateResponse(prompt, settings, thinking, false, image, options);
    onChunk(response);
    return response;
  },

  async generateIdeas(prompt: string, _settings: AppSettings, image?: string): Promise<GeneratedIdea[]> {
    const response = await request<{ ideas: GeneratedIdea[] }>('/ai/generate-ideas', {
      prompt,
      image
    });
    return response.ideas;
  },

  async findSimplestMVP(ideas: Idea[], _settings: AppSettings): Promise<MVPAnalysisResult[]> {
    const response = await request<{ results: MVPAnalysisResult[] }>('/ai/find-mvp', {
      ideaIds: ideas.map((idea) => idea.id)
    });
    return response.results;
  },

  async suggestFolders(ideas: Idea[], _currentFolders: Array<{ name: string }>, _settings: AppSettings): Promise<FolderSuggestion[]> {
    const response = await request<{ suggestions: FolderSuggestion[] }>('/ai/suggest-folders', {
      ideaIds: ideas.map((idea) => idea.id)
    });
    return response.suggestions;
  },

  async vetIdeas(ideas: Idea[], criteria: VettingCriteria, _settings: AppSettings): Promise<VettingResult[]> {
    const response = await request<{ results: VettingResult[] }>('/ai/vet', {
      criteria,
      ideaIds: ideas.map((idea) => idea.id)
    });
    return response.results;
  },

  async extractKeywords(idea: Idea, _settings: AppSettings, options: RequestOptions = {}): Promise<string[]> {
    const response = await request<{ keywords: string[] }>('/ai/extract-keywords', {
      ideaId: idea.id
    }, { signal: options.signal });
    return response.keywords;
  },

  async chatStream(
    prompt: string,
    history: ChatMessage[],
    contextIdea: Idea,
    _settings: AppSettings,
    onChunk: (text: string) => void,
    options: StreamOptions = {}
  ): Promise<string> {
    return streamText('/ai/idea-chat', {
      ideaId: contextIdea.id,
      prompt,
      history,
      stream: true,
      persist: false
    }, onChunk, options);
  },

  async chat(prompt: string, history: ChatMessage[], contextIdea: Idea, _settings: AppSettings): Promise<string> {
    const response = await request<{ response: string }>('/ai/idea-chat', {
      ideaId: contextIdea.id,
      prompt,
      history,
      persist: false
    });
    return response.response;
  },

  async generateViabilityReportStream(
    idea: Idea,
    _settings: AppSettings,
    onChunk: (text: string) => void,
    options: StreamOptions = {}
  ): Promise<string> {
    return streamText('/ai/viability-report', {
      ideaId: idea.id,
      stream: true
    }, onChunk, options);
  },

  async generateViabilityReport(idea: Idea, _settings: AppSettings): Promise<string> {
    const response = await request<{ report: string }>('/ai/viability-report', {
      ideaId: idea.id
    });
    return response.report;
  },

  async analyzeCompetitorsStream(
    idea: Idea,
    _settings: AppSettings,
    onChunk: (text: string) => void,
    options: StreamOptions = {}
  ): Promise<string> {
    return streamText('/ai/competitor-analysis', {
      ideaId: idea.id,
      stream: true
    }, onChunk, options);
  },

  async analyzeCompetitors(idea: Idea, _settings: AppSettings): Promise<string> {
    const response = await request<{ report: string }>('/ai/competitor-analysis', {
      ideaId: idea.id
    });
    return response.report;
  },

  async brainstorm(
    prompt: string,
    history: ChatMessage[],
    _settings: AppSettings,
    options: RequestOptions = {}
  ): Promise<string> {
    const response = await request<{ response: string }>('/ai/brainstorm', {
      prompt,
      history
    }, { signal: options.signal });
    return response.response;
  },

  async summarizeIdeaFromChat(
    history: ChatMessage[],
    _settings: AppSettings,
    options: RequestOptions = {}
  ): Promise<GeneratedIdea> {
    const response = await request<{ idea: GeneratedIdea }>('/ai/summarize-chat', {
      history
    }, { signal: options.signal });
    return response.idea;
  }
};
