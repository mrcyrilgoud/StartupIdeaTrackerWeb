import { z } from 'zod';
import type { AiConnection } from '../../src/types.js';

export function isSafeEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.hash && !url.search
      && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
  } catch { return false; }
}
const endpoint = z.string().trim().url().refine(isSafeEndpoint, 'Use HTTPS, or HTTP on a loopback host; credentials, query strings and fragments are not allowed.');
const api = z.object({
  kind: z.literal('api'), name: z.string().trim().min(1).max(100),
  provider: z.enum(['openai', 'anthropic', 'gemini', 'openai_compatible', 'ollama']),
  model: z.string().trim().min(1).max(200), baseUrl: endpoint.optional()
}).strict();
const cli = z.object({
  kind: z.literal('cli_proxy'), name: z.string().trim().min(1).max(100),
  tool: z.enum(['codex', 'claude', 'cursor', 'kiro', 'gemini', 'opencode']),
  model: z.string().trim().min(1).max(200).optional()
}).strict();
export const connectionInputSchema = z.discriminatedUnion('kind', [api, cli]).superRefine((value, ctx) => {
  if (value.kind === 'api') {
    if (value.provider === 'openai_compatible' && !value.baseUrl) ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: 'A compatible API base URL is required.' });
    if (!['ollama', 'openai_compatible'].includes(value.provider) && value.baseUrl) ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: 'This provider uses its official endpoint.' });
  }
});
export type ConnectionInput = z.infer<typeof connectionInputSchema>;
export type StoredConnection = ConnectionInput & { id: string; revision: number; credentialRef: string | null; testedRevision: number | null };
// Stored metadata is parsed independently of public responses and credential writes.
export const storedConnectionSchema = z.object({ id: z.string(), metadata: connectionInputSchema, credentialRef: z.string().nullable(), revision: z.number().int().positive(), testedRevision: z.number().int().nullable() });
export const publicConnectionSchema = z.union([
  api.extend({ id: z.string(), revision: z.number().int(), hasKey: z.boolean() }),
  cli.extend({ id: z.string(), revision: z.number().int() })
]);
export const credentialWriteSchema = z.object({ apiKey: z.string().trim().min(1).max(8192)
  .refine(value => !/[\r\n\0]/.test(value), 'API keys cannot contain control characters.')
  .refine(value => !value.startsWith('sk-ant-oat'), 'Use an API key here; subscription login belongs in the official CLI.') }).strict();
export const activeConnectionSchema = z.object({ activeConnectionId: z.string().nullable(), version: z.literal(2).optional() }).strict();
