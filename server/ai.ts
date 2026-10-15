import { z } from 'zod';
import type { ChatMessage, Idea, IdeaEvent, VettingCriteria, VettingResult } from '../src/types.js';
import { buildIdeaHistorySummaryPrompt } from './ideaHistory.js';
import { StructuredParseError } from '../shared/structuredAiError.js';
import { createProvider, type ResolveConnection, type ProviderOptions } from './ai/providers/index.js';

export { StructuredParseError };
export { getCapabilities, AiProviderError } from './ai/providers/index.js';
export type { AiConnection, ResolveConnection } from './ai/providers/index.js';

export interface GeneratedIdea { title: string; details: string }
export interface MVPAnalysisResult { ideaId: string; reason: string; score: number }
export interface FolderSuggestion { name: string; description: string; ideaIds: string[] }
export interface RequestOptions extends ProviderOptions { maxOutputTokens?: number }
export interface StreamOptions extends RequestOptions {}

const nonempty = z.string().refine(value => value.trim().length > 0);
const generatedIdeaSchema = z.object({ title: nonempty, details: nonempty }).strict();
function uniqueScoresSchema(ideas: Idea[]) {
  return z.array(scoreSchema(ideas)).refine(values => new Set(values.map(value => value.ideaId)).size === values.length);
}
function uniqueFoldersSchema(ideas: Idea[]) {
  return z.array(folderSuggestionSchema(ideas)).refine(values => {
    const ids = values.flatMap(value => value.ideaIds);
    return new Set(ids).size === ids.length;
  });
}
function scoreSchema(ideas: Idea[]) {
  const ids = new Set(ideas.map(idea => idea.id));
  return z.object({
    ideaId: nonempty.refine(id => ids.has(id)),
    score: z.number().finite().min(1).max(10), reason: nonempty
  }).strict();
}
function folderSuggestionSchema(ideas: Idea[]) {
  const ids = new Set(ideas.map(idea => idea.id));
  return z.object({
    name: nonempty, description: z.string(),
    ideaIds: z.array(nonempty.refine(id => ids.has(id))).refine(values => new Set(values).size === values.length)
  }).strict();
}
function parseStructuredJson<T>(rawOutput: string, operation: string, schema: z.ZodType<T>): T {
  let raw = rawOutput.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(raw);
  if (fenced) raw = fenced[1];
  try {
    return schema.parse(JSON.parse(raw));
  } catch {
    throw new StructuredParseError(operation, rawOutput);
  }
}

function formatChatHistory(history: ChatMessage[]): string {
  return history.map((message) => {
    switch (message.role) {
      case 'user':
        return `User: ${message.content}`;
      case 'assistant':
        return `Assistant: ${message.content}`;
      case 'system':
        return `System: ${message.content}`;
      default:
        return `${message.role}: ${message.content}`;
    }
  }).join('\n');
}

export class BackendAiService {
  constructor(public readonly resolveConnection: ResolveConnection, private readonly fetchImpl: typeof fetch = fetch) {}

  async generateResponse(prompt: string, thinking = false, jsonMode = false, image?: string, options: RequestOptions = {}): Promise<string> {
    const { connection, apiKey, accessToken } = await this.resolveConnection();
    return createProvider(connection, apiKey, this.fetchImpl, accessToken).generate({
      prompt, model: connection.model ?? '', thinking, jsonMode, image, maxOutputTokens: options.maxOutputTokens
    }, options);
  }

  async generateResponseStream(prompt: string, onChunk: (text: string) => void, thinking = false, image?: string, options: StreamOptions = {}): Promise<string> {
    const { connection, apiKey, accessToken } = await this.resolveConnection();
    return createProvider(connection, apiKey, this.fetchImpl, accessToken).stream({
      prompt, model: connection.model ?? '', thinking, image, maxOutputTokens: options.maxOutputTokens
    }, onChunk, options);
  }

  async generateIdeas(prompt: string, image?: string, options: RequestOptions = {}): Promise<GeneratedIdea[]> {
    const responseText = await this.generateResponse(`
${prompt}

Strictly output the result as a valid JSON array of objects, where each object has the following keys:
- "title": The title of the idea.
- "details": A short description of the idea.

Do NOT include any markdown formatting or code fences. Return ONLY the raw JSON array.
`, false, true, image, options);
    return parseStructuredJson(responseText, 'generate_ideas', z.array(generatedIdeaSchema).min(1));
  }

  async findSimplestMVP(ideas: Idea[], options: RequestOptions = {}): Promise<MVPAnalysisResult[]> {
    const ideasContext = ideas.map((idea) => `ID: ${idea.id}\nTitle: ${idea.title}\nDetails: ${idea.details}`).join('\n\n');
    const responseText = await this.generateResponse(`
Analyze the following startup ideas and score them based on how SIMPLE they would be to build as a Minimum Viable Product (MVP).
Consider technical complexity, resource requirements, and time-to-market.

Ideas:
${ideasContext}

Strictly output the result as a valid JSON array of objects, with each object having the following keys:
- "ideaId": The ID of the idea.
- "score": A score from 1 to 10.
- "reason": A concise explanation.

Return ONLY the raw JSON array.
`, false, true, undefined, options);
    return parseStructuredJson(responseText, 'find_simplest_mvp', uniqueScoresSchema(ideas));
  }

  async suggestFolders(ideas: Idea[], currentFolders: Array<{ name: string }>, options: RequestOptions = {}): Promise<FolderSuggestion[]> {
    const ideasContext = ideas.map((idea) => `ID: ${idea.id}\nTitle: ${idea.title}\nDetails: ${idea.details}`).join('\n\n');
    const foldersContext = currentFolders.map((folder) => folder.name).join(', ');
    const responseText = await this.generateResponse(`
You are a smart organizational assistant. Analyze the following startup ideas and group them into logical folders.

Current Folders: ${foldersContext}

Ideas:
${ideasContext}

Strictly output a valid JSON array with keys:
- "name"
- "description"
- "ideaIds"

Return ONLY the raw JSON array.
`, false, true, undefined, options);
    return parseStructuredJson(responseText, 'suggest_folders', uniqueFoldersSchema(ideas));
  }

  async vetIdeas(ideas: Idea[], criteria: VettingCriteria, options: RequestOptions = {}): Promise<VettingResult[]> {
    const ideasContext = ideas.map((idea) => `ID: ${idea.id}\nTitle: ${idea.title}\nDetails: ${idea.details}`).join('\n\n');

    const criteriaPrompts: Record<VettingCriteria, string> = {
      realism: 'Analyze for REALISM and FEASIBILITY.',
      creativity: 'Analyze for CREATIVITY and NOVELTY.',
      uniqueness: 'Analyze for UNIQUENESS and MARKET SATURATION.',
      legality: 'Analyze for LEGALITY and ETHICS.'
    };

    const responseText = await this.generateResponse(`
${criteriaPrompts[criteria]}

Ideas:
${ideasContext}

Strictly output a valid JSON array of objects with keys:
- "ideaId"
- "score"
- "reason"

Return ONLY the raw JSON array.
`, false, true, undefined, options);
    const parsed = parseStructuredJson(responseText, 'vet_ideas', uniqueScoresSchema(ideas));

    return parsed.map((result) => ({
      ideaId: result.ideaId,
      criteria,
      score: result.score,
      reason: result.reason,
      timestamp: Date.now()
    }));
  }

  async extractKeywords(idea: Idea, options: RequestOptions = {}): Promise<string[]> {
    const response = await this.generateResponse(`
Analyze the following startup idea and extract 5 key conceptually relevant keywords.
Return ONLY the keywords separated by commas.

Title: ${idea.title}
Details: ${idea.details}
`, false, false, undefined, options);

    return response.split(',').map((value) => value.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }

  async chatStream(prompt: string, history: ChatMessage[], contextIdea: Idea, onChunk: (text: string) => void, options: StreamOptions = {}): Promise<string> {
    const historyTranscript = formatChatHistory(history);
    return this.generateResponseStream(`
You are a critical, experienced startup advisor analyzing the idea: "${contextIdea.title}".
Details: ${contextIdea.details}

Your goal is to help the user refine their idea by identifying risks, challenging assumptions, and offering objective feedback.

Previous conversation:
${historyTranscript}

User: ${prompt}
`, onChunk, false, undefined, options);
  }

  async chat(prompt: string, history: ChatMessage[], contextIdea: Idea, options: RequestOptions = {}): Promise<string> {
    const historyTranscript = formatChatHistory(history);
    return this.generateResponse(`
You are a critical, experienced startup advisor analyzing the idea: "${contextIdea.title}".
Details: ${contextIdea.details}

Previous conversation:
${historyTranscript}

User: ${prompt}
`, false, false, undefined, options);
  }

  async generateViabilityReportStream(idea: Idea, onChunk: (text: string) => void, options: StreamOptions = {}): Promise<string> {
    return this.generateResponseStream(this.buildViabilityPrompt(idea), onChunk, true, undefined, options);
  }

  async generateViabilityReport(idea: Idea, options: RequestOptions = {}): Promise<string> {
    return this.generateResponse(this.buildViabilityPrompt(idea), true, false, undefined, options);
  }

  async analyzeCompetitorsStream(idea: Idea, onChunk: (text: string) => void, options: StreamOptions = {}): Promise<string> {
    return this.generateResponseStream(this.buildCompetitorPrompt(idea), onChunk, true, undefined, options);
  }

  async analyzeCompetitors(idea: Idea, options: RequestOptions = {}): Promise<string> {
    return this.generateResponse(this.buildCompetitorPrompt(idea), true, false, undefined, options);
  }

  async summarizeIdeaHistoryStream(events: IdeaEvent[], onChunk: (text: string) => void, options: StreamOptions = {}): Promise<string> {
    return this.generateResponseStream(buildIdeaHistorySummaryPrompt(events), onChunk, true, undefined, options);
  }

  async brainstorm(prompt: string, history: ChatMessage[], options: RequestOptions = {}): Promise<string> {
    const historyTranscript = formatChatHistory(history);
    return this.generateResponse(`
You are a creative and helpful startup co-founder. You are having a casual brainstorming session with the user.

IMPORTANT: If the user explicitly asks to save or create an idea, append [ACTION: CREATE_IDEA] at the end of your response.

Previous conversation:
${historyTranscript}

User: ${prompt}
`, false, false, undefined, options);
  }

  async summarizeIdeaFromChat(history: ChatMessage[], options: RequestOptions = {}): Promise<GeneratedIdea> {
    const historyTranscript = formatChatHistory(history);
    const responseText = await this.generateResponse(`
Analyze the following brainstorming conversation and extract a concrete startup idea.

Conversation:
${historyTranscript}

Strictly output a valid JSON object with:
- "title"
- "details"

Return ONLY the raw JSON object.
`, false, true, undefined, options);
    return parseStructuredJson(responseText, 'summarize_chat', generatedIdeaSchema);
  }

  private buildViabilityPrompt(idea: Idea): string {
    return `
You are a seasoned business analyst and market strategist. Your task is to critically examine the business viability of the following startup idea.

**Idea Title:** ${idea.title}
**Idea Details:** ${idea.details}

Generate a comprehensive business viability report with Markdown headers.
`;
  }

  private buildCompetitorPrompt(idea: Idea): string {
    return `
You are a strategic business consultant specializing in competitive intelligence.

**Idea Title:** ${idea.title}
**Idea Details:** ${idea.details}

Generate a comprehensive Competitor Analysis Report in Markdown format.
`;
  }
}
