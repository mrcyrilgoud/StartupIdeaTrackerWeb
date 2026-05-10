export const STRUCTURED_PARSE_ERROR_KIND = 'structured_parse_failed' as const;

export interface StructuredParseErrorPayload {
  error?: string;
  kind: typeof STRUCTURED_PARSE_ERROR_KIND;
  operation: string;
  rawOutput: string;
}

export class StructuredParseError extends Error {
  readonly kind = STRUCTURED_PARSE_ERROR_KIND;

  constructor(
    public readonly operation: string,
    public readonly rawOutput: string,
    message = 'AI response was not valid JSON'
  ) {
    super(message);
    this.name = 'StructuredParseError';
  }
}

export function isStructuredParseError(error: unknown): error is StructuredParseError {
  return error instanceof StructuredParseError
    || (typeof error === 'object'
      && error !== null
      && 'kind' in error
      && (error as { kind?: string }).kind === STRUCTURED_PARSE_ERROR_KIND
      && 'rawOutput' in error
      && 'operation' in error);
}

export function isStructuredParseErrorPayload(payload: unknown): payload is StructuredParseErrorPayload {
  return typeof payload === 'object'
    && payload !== null
    && (payload as { kind?: unknown }).kind === STRUCTURED_PARSE_ERROR_KIND
    && typeof (payload as { rawOutput?: unknown }).rawOutput === 'string'
    && typeof (payload as { operation?: unknown }).operation === 'string';
}
