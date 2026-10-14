export type AiProviderErrorCode =
  | 'AI_MODEL_UNAVAILABLE'
  | 'AI_AUTH_FAILED' | 'AI_RATE_LIMITED' | 'AI_TIMEOUT' | 'AI_CANCELLED'
  | 'AI_NETWORK_ERROR' | 'AI_PROVIDER_ERROR' | 'AI_INVALID_RESPONSE'
  | 'AI_UNSUPPORTED_CAPABILITY' | 'AI_INVALID_CONFIGURATION' | 'AI_REDIRECT_NOT_ALLOWED';

/** Safe to expose to clients: never contains upstream bodies or credentials. */
export class AiProviderError extends Error {
  constructor(public readonly code: AiProviderErrorCode, public readonly status: number, message: string) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export function providerHttpError(status: number): AiProviderError {
  if (status === 404) return new AiProviderError('AI_MODEL_UNAVAILABLE', 502, 'AI provider model or endpoint is unavailable.');
  if (status >= 300 && status < 400) return new AiProviderError('AI_REDIRECT_NOT_ALLOWED', 502, 'AI provider redirects are not allowed.');
  if (status === 401 || status === 403) return new AiProviderError('AI_AUTH_FAILED', 502, 'AI provider authentication failed.');
  if (status === 429) return new AiProviderError('AI_RATE_LIMITED', 429, 'AI provider rate limit exceeded.');
  if (status === 408 || status === 504) return new AiProviderError('AI_TIMEOUT', 504, 'AI provider request timed out.');
  return new AiProviderError('AI_PROVIDER_ERROR', 502, 'AI provider request failed.');
}
