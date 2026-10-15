import type { AiConnection } from '../../../src/types.js';
export type { AiConnection } from '../../../src/types.js';

export interface ProviderRequest {
  prompt: string;
  model: string;
  image?: string;
  jsonMode?: boolean;
  /** Advisory intent only. Never replaces the explicitly configured model. */
  thinking?: boolean;
  maxOutputTokens?: number;
}

export interface ProviderOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  emitDelta?: boolean;
}

export interface AiProvider {
  generate(request: ProviderRequest, options?: ProviderOptions): Promise<string>;
  stream(request: ProviderRequest, onChunk: (text: string) => void, options?: ProviderOptions): Promise<string>;
}

export type ResolveConnection = () => Promise<{ connection: AiConnection; apiKey?: string; accessToken?: string }>;
