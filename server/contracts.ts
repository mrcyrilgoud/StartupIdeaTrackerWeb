import { z } from 'zod';

const statusSchema = z.enum(['draft', 'validation', 'mvp', 'completed', 'archived']);
const criteriaSchema = z.enum(['realism', 'creativity', 'uniqueness', 'legality']);

export const chatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  timestamp: z.number()
});

export const folderSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  timestamp: z.number()
});

export const vettingResultSchema = z.object({
  ideaId: z.string(),
  criteria: criteriaSchema,
  score: z.number(),
  reason: z.string(),
  timestamp: z.number()
});

export const ideaSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  details: z.string(),
  analysis: z.string().optional(),
  timestamp: z.number(),
  keywords: z.array(z.string()),
  chatHistory: z.array(chatMessageSchema),
  relatedIdeas: z.array(z.string()),
  status: statusSchema,
  folder_id: z.string().optional().nullable(),
  vetting: z.object({
    realism: vettingResultSchema.optional(),
    creativity: vettingResultSchema.optional(),
    uniqueness: vettingResultSchema.optional(),
    legality: vettingResultSchema.optional()
  }).partial().optional()
});

export const appSettingsSchema = z.object({
  provider: z.enum(['gemini', 'ollama', 'cli_proxy']),
  geminiKey: z.string(),
  ollamaEndpoint: z.string(),
  ollamaModel: z.string(),
  cliCommandTemplate: z.string()
});

export const saveIdeaSchema = ideaSchema;
export const updateIdeaSchema = z.object({
  title: z.string().min(1).optional(),
  details: z.string().optional(),
  analysis: z.string().optional(),
  timestamp: z.number().optional(),
  keywords: z.array(z.string()).optional(),
  chatHistory: z.array(chatMessageSchema).optional(),
  chatAppend: z.array(chatMessageSchema).optional(),
  relatedIdeas: z.array(z.string()).optional(),
  status: statusSchema.optional(),
  folder_id: z.string().optional().nullable(),
  vetting: ideaSchema.shape.vetting.optional(),
  vettingMerge: z.array(vettingResultSchema).optional()
});

export const ideaListQuerySchema = z.object({
  query: z.string().optional(),
  status: statusSchema.optional(),
  folderId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});

export const importDataSchema = z.object({
  version: z.number().optional(),
  timestamp: z.number().optional(),
  ideas: z.array(ideaSchema).optional(),
  folders: z.array(folderSchema).optional(),
  settings: appSettingsSchema.partial().optional()
});

export const brainstormSchema = z.object({
  prompt: z.string().min(1),
  history: z.array(chatMessageSchema).default([])
});

export const summarizeChatSchema = z.object({
  history: z.array(chatMessageSchema).min(1)
});

export const ideaChatSchema = z.object({
  ideaId: z.string(),
  prompt: z.string().min(1),
  history: z.array(chatMessageSchema).default([]),
  stream: z.boolean().optional(),
  persist: z.boolean().default(true)
});

export const ideaReferenceSchema = z.object({
  ideaId: z.string()
});

export const ideaListReferenceSchema = z.object({
  ideaIds: z.array(z.string()).optional()
});

export const generateIdeasSchema = z.object({
  prompt: z.string().min(1),
  image: z.string().optional()
});

export const suggestFoldersSchema = z.object({
  ideaIds: z.array(z.string()).optional()
});

export const vetIdeasSchema = z.object({
  criteria: criteriaSchema,
  ideaIds: z.array(z.string()).optional()
});

export const searchToolSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional()
});

export const fetchToolSchema = z.object({
  entity: z.enum(['idea', 'folder']),
  id: z.string()
});

export type IdeaListQuery = z.infer<typeof ideaListQuerySchema>;
export type UpdateIdeaInput = z.infer<typeof updateIdeaSchema>;
