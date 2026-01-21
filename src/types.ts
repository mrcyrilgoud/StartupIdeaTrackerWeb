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
}

export type LLMProviderType = 'gemini' | 'ollama';

export interface AppSettings {
  provider: LLMProviderType;
  geminiKey: string;
  ollamaEndpoint: string;
  ollamaModel: string;
}
