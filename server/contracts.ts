import { z } from 'zod';
import { connectionInputSchema } from './connections/contracts.js';

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

export const legacyAppSettingsSchema = z.object({
  provider: z.enum(['gemini', 'ollama', 'cli_proxy']),
  geminiKey: z.string(),
  ollamaEndpoint: z.string(),
  ollamaModel: z.string(),
  cliCommandTemplate: z.string()
});

export const appSettingsSchema = z.object({ version: z.literal(2), activeConnectionId: z.string().nullable() });

export const ideaEventTypeSchema = z.enum([
  'idea_created',
  'idea_updated',
  'idea_moved',
  'idea_deleted',
  'ai_keywords_extracted',
  'ai_viability_report_generated',
  'ai_competitor_analysis_generated',
  'ai_brainstorm_summarized'
]);

export const ideaEventContextSchema = z.object({
  type: ideaEventTypeSchema,
  payload: z.record(z.unknown()).optional()
});

export const ideaEventSchema = z.object({
  id: z.number().int(),
  ideaId: z.string(),
  type: ideaEventTypeSchema,
  payload: z.record(z.unknown()),
  snapshot: ideaSchema,
  createdAt: z.number()
});

export const ideaEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  before: z.coerce.number().int().positive().optional()
});

export const ideaEventDiffFieldSchema = z.object({
  name: z.string(),
  before: z.unknown(),
  after: z.unknown()
});

export const ideaEventDiffSchema = z.object({
  fields: z.array(ideaEventDiffFieldSchema),
  chatTurnsAdded: z.number().int().min(0),
  keywordsAdded: z.array(z.string()),
  keywordsRemoved: z.array(z.string())
});

const ideaHistorySummaryFieldsSchema = z.object({
  from: z.number().int().positive(),
  to: z.number().int().positive()
});

export const MAX_HISTORY_SUMMARY_EVENTS = 50;

export const ideaHistorySummaryRequestSchema = ideaHistorySummaryFieldsSchema.refine((value) => value.from <= value.to, {
  message: '`from` must be less than or equal to `to`',
  path: ['from']
});

export const listIdeaEventsInputSchema = ideaEventsQuerySchema.extend({
  ideaId: z.string()
});

export const diffIdeaEventInputSchema = z.object({
  ideaId: z.string(),
  eventId: z.coerce.number().int().positive()
});

export const summarizeIdeaHistoryInputSchema = ideaHistorySummaryFieldsSchema.extend({
  ideaId: z.string()
}).refine((value) => value.from <= value.to, {
  message: '`from` must be less than or equal to `to`',
  path: ['from']
});

export const saveIdeaSchema = ideaSchema;
export const saveIdeaRequestSchema = saveIdeaSchema.extend({
  eventContext: ideaEventContextSchema.optional()
});
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
  ideas: z.array(ideaSchema.extend({
    // Legacy backups may contain draft rows with an empty title.
    title: z.string()
  })).optional(),
  folders: z.array(folderSchema).optional(),
  settings: z.union([appSettingsSchema, legacyAppSettingsSchema.partial()]).optional(),
  connections: z.array(z.preprocess((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const { id: _id, ...metadata } = value as Record<string, unknown>;
    return metadata;
  }, connectionInputSchema)).optional(),
  importCredentials: z.boolean().optional()
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
