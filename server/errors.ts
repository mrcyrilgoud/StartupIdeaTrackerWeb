export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class AiConnectionError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) { super(message); }
}
