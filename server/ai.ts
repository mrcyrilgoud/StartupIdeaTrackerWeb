import { CLI_PROXY_BASE_URL } from './config.js';
import type { AppSettings, ChatMessage, Idea, VettingCriteria, VettingResult } from '../src/types.js';

export interface GeneratedIdea {
  title: string;
  details: string;
}

export interface MVPAnalysisResult {
  ideaId: string;
  reason: string;
  score: number;
}

export interface FolderSuggestion {
  name: string;
  description: string;
  ideaIds: string[];
}

export interface StreamOptions {
  signal?: AbortSignal;
  emitDelta?: boolean;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

type CliProxyStreamMode = 'snapshot' | 'delta';

function getCliProxyStreamMode(payload: Record<string, unknown>): CliProxyStreamMode {
  if (payload.streamMode === 'delta' || payload.mode === 'delta' || payload.delta === true) {
    return 'delta';
  }

  return 'snapshot';
}

function mergeCliProxyStreamText(previousText: string, nextText: string, streamMode: CliProxyStreamMode): { fullText: string; delta: string } {
  if (!nextText) {
    return { fullText: previousText, delta: '' };
  }

  if (streamMode === 'delta') {
    return {
      fullText: previousText + nextText,
      delta: nextText
    };
  }

  if (!previousText) {
    return { fullText: nextText, delta: nextText };
  }

  if (nextText === previousText) {
    return { fullText: previousText, delta: '' };
  }

  if (nextText.startsWith(previousText)) {
    return {
      fullText: nextText,
      delta: nextText.slice(previousText.length)
    };
  }

  if (previousText.startsWith(nextText)) {
    return { fullText: previousText, delta: '' };
  }

  return {
    fullText: nextText,
    delta: nextText
  };
}

function extractCliTool(settings: AppSettings): string {
  const firstWord = settings.cliCommandTemplate.split(' ')[0]?.toLowerCase();
  if (firstWord && ['gemini', 'opencode', 'codex', 'cursor'].includes(firstWord)) {
    return firstWord;
  }
  return 'gemini';
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
  constructor(private readonly getSettings: () => Promise<AppSettings>) {}

  private async loadSettings(): Promise<AppSettings> {
    const settings = await this.getSettings();

    if (settings.provider === 'gemini' && !settings.geminiKey.trim()) {
      throw new Error('Please configure your Gemini API Key in Settings first.');
    }

    return settings;
  }

  async generateResponse(
    prompt: string,
    thinking = false,
    jsonMode = false,
    image?: string,
    options: RequestOptions = {}
  ): Promise<string> {
    const settings = await this.loadSettings();
    if (settings.provider === 'gemini') {
      return this.generateGemini(prompt, settings.geminiKey, thinking, jsonMode, image, options);
    }
    if (settings.provider === 'cli_proxy') {
      return this.generateCliProxy(prompt, settings, jsonMode, options);
    }
    return this.generateOllama(prompt, settings, jsonMode, options);
  }

  async generateResponseStream(
    prompt: string,
    onChunk: (text: string) => void,
    thinking = false,
    image?: string,
    options: StreamOptions = {}
  ): Promise<string> {
    const settings = await this.loadSettings();
    if (settings.provider === 'gemini') {
      return this.generateGeminiStream(prompt, settings.geminiKey, onChunk, thinking, image, options);
    }
    if (settings.provider === 'cli_proxy') {
      return this.generateCliProxyStream(prompt, settings, onChunk, options);
    }
    return this.generateOllamaStream(prompt, settings, onChunk, false, options);
  }

  private async generateCliProxyStream(
    prompt: string,
    settings: AppSettings,
    onChunk: (text: string) => void,
    options: StreamOptions = {}
  ): Promise<string> {
    const response = await fetch(`${CLI_PROXY_BASE_URL}/api/low-level-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: options.signal,
      body: JSON.stringify({
        tool: extractCliTool(settings),
        prompt
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(String(err.error || err.details || 'CLI Proxy Stream Error'));
    }
    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonText = line.slice(6).trim();
        if (!jsonText) continue;
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(jsonText) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (payload.error) {
          throw new Error(String(payload.error));
        }
        const nextChunk = String(payload.response ?? '');
        const streamMode = getCliProxyStreamMode(payload);
        const merged = mergeCliProxyStreamText(fullText, nextChunk, streamMode);
        fullText = merged.fullText;
        onChunk(options.emitDelta ? merged.delta : fullText);
      }
    }

    return fullText;
  }

  private async generateCliProxy(
    prompt: string,
    settings: AppSettings,
    jsonMode = false,
    options: RequestOptions = {}
  ): Promise<string> {
    const finalPrompt = jsonMode ? `${prompt}\n\nStrictly output valid JSON format only.` : prompt;
    const response = await fetch(`${CLI_PROXY_BASE_URL}/api/low-level`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: options.signal,
      body: JSON.stringify({
        tool: extractCliTool(settings),
        prompt: finalPrompt
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(String(err.error || err.details || 'CLI Proxy Error'));
    }

    const payload = await response.json();
    return String(payload.response ?? '');
  }

  private async generateGeminiStream(
    prompt: string,
    apiKey: string,
    onChunk: (text: string) => void,
    thinking = false,
    image?: string,
    options: StreamOptions = {}
  ): Promise<string> {
    const model = thinking ? 'gemini-2.5-pro' : 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
    const parts: Array<Record<string, unknown>> = [{ text: prompt }];
    if (image) {
      parts.push({ inlineData: { mimeType: 'image/png', data: image } });
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: options.signal,
      body: JSON.stringify({
        contents: [{ parts }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(String(err.error?.message || `Gemini API Error: ${response.status} ${response.statusText}`));
    }
    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonText = line.slice(6).trim();
        if (!jsonText) continue;
        try {
          const payload = JSON.parse(jsonText) as Record<string, any>;
          const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!text) continue;
          fullText += text;
          onChunk(options.emitDelta ? text : fullText);
        } catch {
          continue;
        }
      }
    }

    return fullText;
  }

  private async generateGemini(
    prompt: string,
    apiKey: string,
    thinking = false,
    jsonMode = false,
    image?: string,
    options: RequestOptions = {}
  ): Promise<string> {
    const model = thinking ? 'gemini-2.5-pro' : 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const parts: Array<Record<string, unknown>> = [{ text: prompt }];
    if (image) {
      parts.push({ inlineData: { mimeType: 'image/png', data: image } });
    }

    const body: Record<string, unknown> = {
      contents: [{ parts }]
    };

    if (jsonMode) {
      body.generationConfig = { responseMimeType: 'application/json' };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: options.signal,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(String(err.error?.message || `Gemini API Error: ${response.status} ${response.statusText}`));
    }

    const payload = await response.json();
    return String(payload.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
  }

  private async generateOllamaStream(
    prompt: string,
    settings: AppSettings,
    onChunk: (text: string) => void,
    jsonMode = false,
    options: StreamOptions = {}
  ): Promise<string> {
    const response = await fetch(`${settings.ollamaEndpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: options.signal,
      body: JSON.stringify({
        model: settings.ollamaModel,
        prompt,
        stream: true,
        ...(jsonMode ? { format: 'json' } : {})
      })
    });

    if (!response.ok) {
      throw new Error('Ollama API Error');
    }
    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const payload = JSON.parse(line) as Record<string, unknown>;
          const text = String(payload.response ?? '');
          if (!text) continue;
          fullText += text;
          onChunk(options.emitDelta ? text : fullText);
        } catch {
          continue;
        }
      }
    }

    return fullText;
  }

  private async generateOllama(
    prompt: string,
    settings: AppSettings,
    jsonMode = false,
    options: RequestOptions = {}
  ): Promise<string> {
    const response = await fetch(`${settings.ollamaEndpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: options.signal,
      body: JSON.stringify({
        model: settings.ollamaModel,
        prompt,
        stream: false,
        ...(jsonMode ? { format: 'json' } : {})
      })
    });

    if (!response.ok) {
      throw new Error('Ollama API Error');
    }

    const payload = await response.json();
    return String(payload.response ?? '');
  }

  async generateIdeas(prompt: string, image?: string): Promise<GeneratedIdea[]> {
    const responseText = await this.generateResponse(`
${prompt}

Strictly output the result as a valid JSON array of objects, where each object has the following keys:
- "title": The title of the idea.
- "details": A short description of the idea.

Do NOT include any markdown formatting or code fences. Return ONLY the raw JSON array.
`, false, true, image);

    const firstBracket = responseText.indexOf('[');
    const lastBracket = responseText.lastIndexOf(']');
    if (firstBracket === -1 || lastBracket === -1 || firstBracket > lastBracket) {
      throw new Error('AI response was not valid JSON');
    }
    return JSON.parse(responseText.slice(firstBracket, lastBracket + 1)) as GeneratedIdea[];
  }

  async findSimplestMVP(ideas: Idea[]): Promise<MVPAnalysisResult[]> {
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
`, false, true);

    const firstBracket = responseText.indexOf('[');
    const lastBracket = responseText.lastIndexOf(']');
    if (firstBracket === -1 || lastBracket === -1 || firstBracket > lastBracket) {
      throw new Error('AI response was not valid JSON');
    }
    return JSON.parse(responseText.slice(firstBracket, lastBracket + 1)) as MVPAnalysisResult[];
  }

  async suggestFolders(ideas: Idea[], currentFolders: Array<{ name: string }>): Promise<FolderSuggestion[]> {
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
`, false, true);

    const firstBracket = responseText.indexOf('[');
    const lastBracket = responseText.lastIndexOf(']');
    if (firstBracket === -1 || lastBracket === -1 || firstBracket > lastBracket) {
      throw new Error('AI response was not valid JSON');
    }
    return JSON.parse(responseText.slice(firstBracket, lastBracket + 1)) as FolderSuggestion[];
  }

  async vetIdeas(ideas: Idea[], criteria: VettingCriteria): Promise<VettingResult[]> {
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
`, false, true);

    const firstBracket = responseText.indexOf('[');
    const lastBracket = responseText.lastIndexOf(']');
    if (firstBracket === -1 || lastBracket === -1 || firstBracket > lastBracket) {
      throw new Error('AI response was not valid JSON');
    }

    const parsed = JSON.parse(responseText.slice(firstBracket, lastBracket + 1)) as Array<{
      ideaId: string;
      score: number;
      reason: string;
    }>;

    return parsed.map((result) => ({
      ideaId: result.ideaId,
      criteria,
      score: Number(result.score) || 5,
      reason: result.reason || 'No reason provided',
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

  async generateViabilityReport(idea: Idea): Promise<string> {
    return this.generateResponse(this.buildViabilityPrompt(idea), true);
  }

  async analyzeCompetitorsStream(idea: Idea, onChunk: (text: string) => void, options: StreamOptions = {}): Promise<string> {
    return this.generateResponseStream(this.buildCompetitorPrompt(idea), onChunk, true, undefined, options);
  }

  async analyzeCompetitors(idea: Idea): Promise<string> {
    return this.generateResponse(this.buildCompetitorPrompt(idea), true);
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

    const firstBrace = responseText.indexOf('{');
    const lastBrace = responseText.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || firstBrace > lastBrace) {
      return {
        title: 'New Idea from Chat',
        details: 'Details could not be automatically generated. Please review the chat history.'
      };
    }
    return JSON.parse(responseText.slice(firstBrace, lastBrace + 1)) as GeneratedIdea;
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
