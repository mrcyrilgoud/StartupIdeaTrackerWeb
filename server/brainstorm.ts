import { StructuredParseError, type BackendAiService } from './ai.js';
import type { ChatMessage } from '../src/types.js';
import { buildBrainstormFallbackSummary } from '../shared/structuredAiFallback.js';

export async function summarizeBrainstormToIdeaWithFallback(
  aiService: BackendAiService,
  history: ChatMessage[]
): Promise<{
  idea: { title: string; details: string };
  degraded: boolean;
  rawOutput?: string;
}> {
  try {
    const idea = await aiService.summarizeIdeaFromChat(history);
    return { idea, degraded: false };
  } catch (error) {
    if (error instanceof StructuredParseError) {
      return {
        idea: buildBrainstormFallbackSummary(error.rawOutput),
        degraded: true,
        rawOutput: error.rawOutput
      };
    }

    throw error;
  }
}
