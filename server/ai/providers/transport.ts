import { AiProviderError, providerHttpError } from './errors.js';
import type { ProviderOptions } from './types.js';

export async function withResponse<T>(
  fetchImpl: typeof fetch, url: string, headers: Record<string, string>, body: unknown,
  options: ProviderOptions, consume: (response: Response) => Promise<T>, chatGptPlan = false
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 120_000);
  try {
    controller.signal.throwIfAborted();
    const response = await fetchImpl(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body), signal: controller.signal, redirect: 'manual'
    });
    if (!response.ok || response.redirected) {
      if (chatGptPlan && !response.redirected) {
        try {
          const payload = await response.json();
          if (payload?.error) checkPayload(payload);
        } catch (error) { if (error instanceof AiProviderError) throw error; }
        if (response.status === 401 || response.status === 403) throw new AiProviderError('AI_AUTH_FAILED', response.status, 'ChatGPT authorization or plan eligibility failed. Reconnect an eligible account in Settings.');
        if (response.status === 429) throw new AiProviderError('AI_RATE_LIMITED', 429, 'ChatGPT plan usage limit reached. Manage usage in ChatGPT Settings → Usage.');
      }
      await response.body?.cancel();
      throw providerHttpError(response.redirected ? 302 : response.status);
    }
    return await consume(response);
  } catch (error) {
    if (timedOut) throw new AiProviderError('AI_TIMEOUT', 504, 'AI provider request timed out.');
    if (options.signal?.aborted) throw new AiProviderError('AI_CANCELLED', 499, 'AI request was cancelled.');
    if (error instanceof AiProviderError) throw error;
    throw new AiProviderError('AI_NETWORK_ERROR', 502, 'Unable to communicate with AI provider.');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

export function parsePayload(raw: string): Record<string, any> {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, any>;
  } catch {
    throw new AiProviderError('AI_INVALID_RESPONSE', 502, 'AI provider returned an invalid response.');
  }
}

export function checkPayload(payload: Record<string, any>, event = ''): void {
  if (payload.error || payload.response?.error || event === 'error' || payload.type === 'error' ||
      payload.type === 'response.failed' || payload.type === 'response.incomplete' ||
      payload.status === 'failed' || payload.status === 'incomplete') {
    const error = payload.error ?? payload.response?.error;
    const status = Number(error?.code ?? payload.statusCode);
    if (status >= 400 && status <= 599) throw providerHttpError(status);
    const type = String(error?.type ?? error?.code ?? error?.status ?? payload.code ?? '');
    if (/subscription_sharing_usage_limit_exceeded|subscription_sharing_usage_unavailable/.test(type)) throw new AiProviderError('AI_RATE_LIMITED', 429, 'ChatGPT plan usage is unavailable or its limit was reached. Manage usage in ChatGPT Settings → Usage.');
    if (/subscription_sharing_user_not_eligible/.test(type)) throw new AiProviderError('AI_AUTH_FAILED', 403, 'This ChatGPT account or workspace is not eligible for plan usage. Choose another connection in Settings.');
    if (/auth|permission|invalid_api_key/.test(type)) throw providerHttpError(401);
    if (/rate_limit|overloaded|RESOURCE_EXHAUSTED/.test(type)) throw providerHttpError(429);
    if (/model_not_found|not_found|NOT_FOUND/.test(type)) throw providerHttpError(404);
    throw new AiProviderError('AI_PROVIDER_ERROR', 502, 'AI provider reported a generation error.');
  }
}

/** Incremental UTF-8, SSE framing, multiline data, CRLF, and an unterminated final event. */
export async function readEvents(response: Response, ndjson: boolean, onEvent: (payload: Record<string, any>, event: string) => void): Promise<void> {
  if (!response.body) throw new AiProviderError('AI_INVALID_RESPONSE', 502, 'AI provider returned no response body.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', event = '';
  let data: string[] = [];
  const dispatch = () => {
    const raw = data.join('\n');
    data = [];
    if (raw.trim() && raw.trim() !== '[DONE]') {
      const payload = parsePayload(raw);
      checkPayload(payload, event);
      onEvent(payload, event);
    } else if (event === 'error') {
      throw new AiProviderError('AI_PROVIDER_ERROR', 502, 'AI provider reported a generation error.');
    }
    event = '';
  };
  const line = (value: string) => {
    if (ndjson) {
      if (value.trim()) { const payload = parsePayload(value); checkPayload(payload); onEvent(payload, ''); }
    } else if (!value) dispatch();
    else if (value.startsWith('event:')) event = value.slice(6).trim();
    else if (value.startsWith('data:')) {
      // Legacy CLI proxy emits consecutive data lines without blank separators.
      if (data.length && isCompleteJson(data.join('\n'))) dispatch();
      data.push(value.slice(5).replace(/^ /, ''));
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        line(buffer.slice(0, index).replace(/\r$/, ''));
        buffer = buffer.slice(index + 1);
      }
      if (done) break;
    }
    if (buffer) line(buffer.replace(/\r$/, ''));
    if (!ndjson) dispatch();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function isCompleteJson(raw: string): boolean {
  try { JSON.parse(raw); return true; } catch { return false; }
}
