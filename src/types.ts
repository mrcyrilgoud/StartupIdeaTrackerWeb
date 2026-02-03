export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface Idea {
  id: string;
  title: string;
  details: string;
  analysis?: string;
  timestamp: number;
  keywords: string[];
  chatHistory: ChatMessage[];
  relatedIdeaIds: string[];
  status: 'draft' | 'validation' | 'mvp' | 'completed' | 'archived';
}

export type IdeaStatus = Idea['status'];

export const STATUS_LABELS: Record<IdeaStatus, string> = {
  draft: 'Draft',
  validation: 'Validation',
  mvp: 'MVP',
  completed: 'Completed',
  archived: 'Archived'
};

export const STATUS_COLORS: Record<IdeaStatus, string> = {
  draft: '#9CA3AF',       // gray
  validation: '#F59E0B',  // amber
  mvp: '#8B5CF6',         // violet
  completed: '#10B981',   // emerald
  archived: '#6B7280'     // dark gray
};

export type LLMProviderType = 'gemini' | 'ollama';

export interface AppSettings {
  provider: LLMProviderType;
  geminiKey: string;
  ollamaEndpoint: string;
  ollamaModel: string;
}
