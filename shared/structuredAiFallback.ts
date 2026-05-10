import type { ChatMessage, Idea } from '../src/types.js';

export const BRAINSTORM_FALLBACK_TITLE = 'Brainstormed Idea';

export function buildBrainstormFallbackSummary(rawOutput: string): { title: string; details: string } {
  return {
    title: BRAINSTORM_FALLBACK_TITLE,
    details: rawOutput
  };
}

export function buildBrainstormFallbackIdea(
  rawOutput: string,
  history: ChatMessage[],
  id: string,
  timestamp: number
): Idea {
  return {
    id,
    ...buildBrainstormFallbackSummary(rawOutput),
    timestamp,
    keywords: [],
    chatHistory: history,
    relatedIdeas: [],
    status: 'draft'
  };
}
