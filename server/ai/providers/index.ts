import { CLI_PROXY_BASE_URL } from '../../config.js';
import { isSafeEndpoint } from '../../connections/contracts.js';
import { AiProviderError } from './errors.js';
import { checkPayload, parsePayload, readEvents, withResponse } from './transport.js';
import type { AiConnection, AiProvider, ProviderOptions, ProviderRequest } from './types.js';

export { AiProviderError } from './errors.js';
export type { AiConnection, AiProvider, ProviderOptions, ProviderRequest, ResolveConnection } from './types.js';

export function getCapabilities(connection: AiConnection): { image: boolean; streaming: boolean } {
  return { image: connection.kind === 'api' && ['openai', 'anthropic', 'gemini'].includes(connection.provider), streaming: true };
}

type Payload = Record<string, any>;
type WireRequest = { url: string; headers: Record<string, string>; body: Payload };

function imageData(image: string): { mimeType: string; data: string; url: string } {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/.exec(image);
  if (image.startsWith('data:') && !match) throw new AiProviderError('AI_INVALID_CONFIGURATION', 400, 'Invalid image data.');
  const mimeType = match?.[1] ?? 'image/png';
  const data = match?.[2] ?? image;
  return { mimeType, data, url: `data:${mimeType};base64,${data}` };
}

function endpoint(base: string | undefined, path: string): string {
  if (!base) throw new AiProviderError('AI_INVALID_CONFIGURATION', 400, 'AI provider base URL is required.');
  try {
    const url = new URL(base);
    if (!isSafeEndpoint(base)) throw new Error();
    return `${url.toString().replace(/\/$/, '')}${path}`;
  } catch {
    throw new AiProviderError('AI_INVALID_CONFIGURATION', 400, 'Invalid AI provider base URL.');
  }
}

/** Adapters have one transport call per request; no retry or model fallback. */
export function createProvider(connection: AiConnection, apiKey?: string, fetchImpl: typeof fetch = fetch): AiProvider {
  const provider = connection.kind === 'cli_proxy' ? 'cli_proxy' : connection.provider;
  const wire = (request: ProviderRequest, stream: boolean): WireRequest => {
    if (connection.kind === 'api' && !request.model.trim()) throw new AiProviderError('AI_INVALID_CONFIGURATION', 400, 'An explicit AI model is required.');
    if (request.image && !getCapabilities(connection).image) throw new AiProviderError('AI_UNSUPPORTED_CAPABILITY', 400, 'This AI connection does not support images.');
    if (request.maxOutputTokens !== undefined && (!Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens <= 0)) {
      throw new AiProviderError('AI_INVALID_CONFIGURATION', 400, 'Output token limit must be a positive integer.');
    }
    if (['openai', 'anthropic', 'gemini'].includes(provider) && !apiKey?.trim()) throw new AiProviderError('AI_AUTH_FAILED', 502, 'AI provider API key is missing.');
    const prompt = request.jsonMode ? `${request.prompt}\n\nStrictly output valid JSON format only.` : request.prompt;
    const image = request.image ? imageData(request.image) : undefined;
    switch (provider) {
      case 'openai':
        return {
          url: 'https://api.openai.com/v1/responses', headers: { Authorization: `Bearer ${apiKey}` },
          body: {
            model: request.model, stream, store: false,
            input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, ...(image ? [{ type: 'input_image', image_url: image.url }] : [])] }],
            ...(request.maxOutputTokens ? { max_output_tokens: request.maxOutputTokens } : {})
            // JSON is prompted: json_object mode cannot represent the workflow's top-level arrays.
          }
        };
      case 'anthropic':
        return {
          url: 'https://api.anthropic.com/v1/messages', headers: { 'x-api-key': apiKey!, 'anthropic-version': '2023-06-01' },
          body: {
            model: request.model, stream, max_tokens: request.maxOutputTokens ?? 4096,
            messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...(image ? [{ type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.data } }] : [])] }]
          }
        };
      case 'gemini':
        return {
          url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`,
          headers: { 'x-goog-api-key': apiKey! },
          body: {
            contents: [{ parts: [{ text: prompt }, ...(image ? [{ inlineData: { mimeType: image.mimeType, data: image.data } }] : [])] }],
            generationConfig: {
              ...(request.jsonMode ? { responseMimeType: 'application/json' } : {}),
              ...(request.maxOutputTokens ? { maxOutputTokens: request.maxOutputTokens } : {})
            }
          }
        };
      case 'openai_compatible':
        return {
          url: endpoint(connection.kind === 'api' ? connection.baseUrl : undefined, '/chat/completions'),
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
          body: { model: request.model, stream, messages: [{ role: 'user', content: prompt }], ...(request.maxOutputTokens ? { max_tokens: request.maxOutputTokens } : {}) }
        };
      case 'ollama':
        return {
          url: endpoint(connection.kind === 'api' ? connection.baseUrl ?? 'http://localhost:11434' : undefined, '/api/generate'),
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
          body: { model: request.model, prompt, stream, ...(request.jsonMode ? { format: 'json' } : {}), ...(request.maxOutputTokens ? { options: { num_predict: request.maxOutputTokens } } : {}) }
        };
      case 'cli_proxy':
        return {
          url: endpoint(CLI_PROXY_BASE_URL, stream ? '/api/low-level-stream' : '/api/low-level'), headers: {},
          body: { tool: connection.kind === 'cli_proxy' ? connection.tool : '', prompt, ...(request.model ? { model: request.model } : {}), ...(request.maxOutputTokens ? { maxOutputTokens: request.maxOutputTokens } : {}) }
        };
    }
  };
  const text = (payload: Payload, streaming: boolean): string => {
    try {
      checkPayload(payload);
      let value: unknown;
      switch (provider) {
        case 'openai':
          value = streaming ? (payload.type === 'response.output_text.delta' ? payload.delta : '') :
            payload.output_text ?? payload.output?.flatMap((item: Payload) => item.content ?? []).filter((part: Payload) => part.type === 'output_text').map((part: Payload) => part.text).join('');
          break;
        case 'anthropic':
          value = streaming ? (payload.type === 'content_block_delta' && payload.delta?.type === 'text_delta' ? payload.delta.text :
            payload.type === 'content_block_start' && payload.content_block?.type === 'text' ? payload.content_block.text : '') :
            payload.content?.filter((part: Payload) => part.type === 'text').map((part: Payload) => part.text).join('');
          break;
        case 'gemini':
          if (payload.promptFeedback?.blockReason || ['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT'].includes(payload.candidates?.[0]?.finishReason)) {
            throw new AiProviderError('AI_PROVIDER_ERROR', 502, 'AI provider declined to generate a response.');
          }
          value = payload.candidates?.[0]?.content?.parts?.filter((part: Payload) => !part.thought && typeof part.text === 'string').map((part: Payload) => part.text).join('');
          break;
        case 'openai_compatible': value = streaming ? payload.choices?.[0]?.delta?.content ?? '' : payload.choices?.[0]?.message?.content; break;
        default: value = payload.response ?? (streaming ? '' : undefined);
      }
      if (value === undefined && streaming) return '';
      if (typeof value !== 'string') throw new AiProviderError('AI_INVALID_RESPONSE', 502, 'AI provider returned no text response.');
      return value;
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      throw new AiProviderError('AI_INVALID_RESPONSE', 502, 'AI provider returned an invalid text response.');
    }
  };
  return {
    async generate(request, options = {}) {
      const { url, headers, body } = wire(request, false);
      return withResponse(fetchImpl, url, headers, body, options, async response => text(parsePayload(await response.text()), false));
    },
    async stream(request, onChunk, options: ProviderOptions = {}) {
      const { url, headers, body } = wire(request, true);
      return withResponse(fetchImpl, url, headers, body, options, async response => {
        let full = '';
        await readEvents(response, provider === 'ollama', payload => {
          const next = text(payload, true);
          if (!next) return;
          let delta = next;
          if (provider === 'cli_proxy' && !(payload.streamMode === 'delta' || payload.mode === 'delta' || payload.delta === true)) {
            if (full.startsWith(next)) return;
            delta = next.startsWith(full) ? next.slice(full.length) : next;
            full = next;
          } else full += next;
          if (delta) onChunk(options.emitDelta ? delta : full);
        });
        return full;
      });
    }
  };
}
