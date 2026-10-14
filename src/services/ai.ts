import type { ChatMessage, Idea, StructuredAiFallbackPayload, VettingCriteria, VettingResult } from '../types';
import {
  StructuredParseError,
  isStructuredParseError,
  isStructuredParseErrorPayload
} from '../../shared/structuredAiError';

export {
  StructuredParseError,
  isStructuredParseError,
  isStructuredParseErrorPayload
};
export type { StructuredParseErrorPayload } from '../../shared/structuredAiError';

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

export interface StreamResult {
  fullText: string;
  fallback?: StructuredAiFallbackPayload;
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
    if (isStructuredParseErrorPayload(errorPayload)) {
      throw new StructuredParseError(
        errorPayload.operation,
        errorPayload.rawOutput,
        errorPayload.error || 'AI response was not valid JSON'
      );
    }
    throw new Error(String(errorPayload.error || response.statusText));
  }

  return response.json() as Promise<T>;
}

async function streamText(
  path: string,
  body: unknown,
  onChunk: (text: string) => void,
  options: StreamOptions = {}
): Promise<StreamResult> {
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
      const payload = JSON.parse(payloadText) as {
        delta?: string;
        fullText?: string;
        done?: boolean;
        error?: string;
        fallback?: StructuredAiFallbackPayload;
      };
      if (payload.error) {
        throw new Error(payload.error);
      }
      if (payload.delta) {
        fullText = payload.fullText ?? `${fullText}${payload.delta}`;
        onChunk(options.emitDelta ? payload.delta : fullText);
      }
      if (payload.fallback) {
        return {
          fullText: payload.fullText ?? fullText,
          fallback: payload.fallback
        };
      }
      if (payload.done) {
        return {
          fullText: payload.fullText ?? fullText
        };
      }
    }
  }

  return { fullText };
}

export const aiService = {
  async generateResponse(
    prompt: string,
    thinking = false,
    jsonMode = false,
    image?: string,
    options: RequestOptions = {}
  ): Promise<string> {
    const response = await request<{ response: string }>('/ai/raw-response', {
      prompt,
      thinking,
      jsonMode,
      image
    }, { signal: options.signal });
    return response.response;
  },

  async generateResponseStream(
    prompt: string,
    onChunk: (text: string) => void,
    thinking = false,
    image?: string,
    options: StreamOptions = {},
    jsonMode = false
  ): Promise<string> {
    const result = await streamText('/ai/raw-response', {
      prompt, thinking, jsonMode, image, stream: true
    }, onChunk, options);
    return result.fullText;
  },

  async generateIdeas(prompt: string, image?: string): Promise<GeneratedIdea[]> {
    const response = await request<{ ideas: GeneratedIdea[] }>('/ai/generate-ideas', {
      prompt,
      image
    });
    return response.ideas;
  },

  async findSimplestMVP(ideas: Array<Pick<Idea, 'id'>>): Promise<MVPAnalysisResult[]> {
    const response = await request<{ results: MVPAnalysisResult[] }>('/ai/find-mvp', {
      ideaIds: ideas.map((idea) => idea.id)
    });
    return response.results;
  },

  async suggestFolders(ideas: Array<Pick<Idea, 'id'>>, _currentFolders: Array<{ name: string }>): Promise<FolderSuggestion[]> {
    const response = await request<{ suggestions: FolderSuggestion[] }>('/ai/suggest-folders', {
      ideaIds: ideas.map((idea) => idea.id)
    });
    return response.suggestions;
  },

  async vetIdeas(ideas: Array<Pick<Idea, 'id'>>, criteria: VettingCriteria): Promise<VettingResult[]> {
    const response = await request<{ results: VettingResult[] }>('/ai/vet', {
      criteria,
      ideaIds: ideas.map((idea) => idea.id)
    });
    return response.results;
  },

  async extractKeywords(idea: Idea, options: RequestOptions = {}): Promise<string[]> {
    const response = await request<{ keywords: string[] }>('/ai/extract-keywords', {
      ideaId: idea.id
    }, { signal: options.signal });
    return response.keywords;
  },

  async chatStream(
    prompt: string,
    history: ChatMessage[],
    contextIdea: Idea,
    onChunk: (text: string) => void,
    options: StreamOptions = {}
  ): Promise<string> {
    const result = await streamText('/ai/idea-chat', {
      ideaId: contextIdea.id,
      prompt,
      history,
      stream: true,
      persist: false
    }, onChunk, options);
    return result.fullText;
  },

  async chat(prompt: string, history: ChatMessage[], contextIdea: Idea): Promise<string> {
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
    onChunk: (text: string) => void,
    options: StreamOptions = {}
  ): Promise<string> {
    const result = await streamText('/ai/viability-report', {
      ideaId: idea.id,
      stream: true
    }, onChunk, options);
    return result.fullText;
  },

  async generateViabilityReport(idea: Pick<Idea, 'id'>): Promise<string> {
    const response = await request<{ report: string }>('/ai/viability-report', {
      ideaId: idea.id
    });
    return response.report;
  },

  async analyzeCompetitorsStream(
    idea: Idea,
    onChunk: (text: string) => void,
    options: StreamOptions = {}
  ): Promise<string> {
    const result = await streamText('/ai/competitor-analysis', {
      ideaId: idea.id,
      stream: true
    }, onChunk, options);
    return result.fullText;
  },

  async analyzeCompetitors(idea: Pick<Idea, 'id'>): Promise<string> {
    const response = await request<{ report: string }>('/ai/competitor-analysis', {
      ideaId: idea.id
    });
    return response.report;
  },

  async brainstorm(
    prompt: string,
    history: ChatMessage[],
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
    options: RequestOptions = {}
  ): Promise<GeneratedIdea> {
    const response = await request<{ idea: GeneratedIdea }>('/ai/summarize-chat', {
      history
    }, { signal: options.signal });
    return response.idea;
  },

  async summarizeIdeaHistoryStream(
    ideaId: string,
    range: { from: number; to: number },
    onChunk: (text: string) => void,
    options: StreamOptions = {}
  ): Promise<StreamResult> {
    return streamText(`/ideas/${ideaId}/history/summary`, range, onChunk, options);
  }
};
