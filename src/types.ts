export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface Folder {
  id: string;
  name: string;
  timestamp: number;
}

export type VettingCriteria = 'realism' | 'creativity' | 'uniqueness' | 'legality';

export interface VettingResult {
  ideaId: string;
  criteria: VettingCriteria;
  score: number;
  reason: string;
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
  relatedIdeas: string[];
  status: 'draft' | 'validation' | 'mvp' | 'completed' | 'archived';
  folder_id?: string;
  vetting?: Partial<Record<VettingCriteria, VettingResult>>;
}

export type IdeaEventType =
  | 'idea_created'
  | 'idea_updated'
  | 'idea_moved'
  | 'idea_deleted'
  | 'ai_keywords_extracted'
  | 'ai_viability_report_generated'
  | 'ai_competitor_analysis_generated'
  | 'ai_brainstorm_summarized';

export interface IdeaEvent<TPayload = Record<string, unknown>> {
  id: number;
  ideaId: string;
  type: IdeaEventType;
  payload: TPayload;
  snapshot: Idea;
  createdAt: number;
}

export interface IdeaEventDiffField {
  name: string;
  before: unknown;
  after: unknown;
}

export interface IdeaEventDiff {
  fields: IdeaEventDiffField[];
  chatTurnsAdded: number;
  keywordsAdded: string[];
  keywordsRemoved: string[];
}

export interface StructuredAiFallbackPayload {
  rawOutput: string;
  title?: string;
  message?: string;
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

export type LLMProviderType = 'gemini' | 'ollama' | 'cli_proxy';

export interface LegacyAppSettings {
  provider: LLMProviderType;
  geminiKey: string;
  ollamaEndpoint: string;
  ollamaModel: string;
  cliCommandTemplate: string;
}

export const APP_SETTINGS_STORAGE_KEY = 'app-settings';

export const LEGACY_DEFAULT_APP_SETTINGS: LegacyAppSettings = {
  provider: 'gemini',
  geminiKey: '',
  ollamaEndpoint: 'http://localhost:11434',
  ollamaModel: 'llama3',
  cliCommandTemplate: 'gemini "{{prompt}}"'
};

export type ApiProvider = 'openai' | 'anthropic' | 'gemini' | 'openai_compatible' | 'ollama';
export type AiConnection = {
  id: string;
  name: string;
  revision: number;
} & ({ kind: 'api'; provider: ApiProvider; model: string; baseUrl?: string; hasKey: boolean }
  | { kind: 'cli_proxy'; tool: string; model?: string });

export interface AppSettings {
  version: 2;
  activeConnectionId: string | null;
}
export const DEFAULT_APP_SETTINGS: AppSettings = { version: 2, activeConnectionId: null };
export interface AiConnectionStatus {
  state: 'needs_setup' | 'configured' | 'missing_credential' | 'proxy_unavailable' | 'tool_unavailable' | 'authentication_required' | 'credential_store_unavailable';
  connection: AiConnection | null;
  capabilities: { image: boolean; streaming: boolean };
  message?: string;
}
