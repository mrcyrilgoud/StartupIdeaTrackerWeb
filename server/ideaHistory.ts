import { z } from 'zod';

import type { Idea, IdeaEvent } from '../src/types.js';
import { ideaEventDiffSchema } from './contracts.js';

type IdeaEventDiff = z.infer<typeof ideaEventDiffSchema>;
const SUMMARY_TEXT_CLIP_LENGTH = 600;

const FIELD_NAMES: Array<keyof Idea> = [
  'title',
  'details',
  'analysis',
  'status',
  'folder_id',
  'relatedIdeas',
  'vetting'
];

function stableStringify(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function clipText(value: string | undefined, maxLength = SUMMARY_TEXT_CLIP_LENGTH): string | null {
  if (!value) {
    return value ?? null;
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}

export function computeIdeaEventDiff(current: Idea, previous?: Idea): IdeaEventDiff {
  const fields: IdeaEventDiff['fields'] = [];

  for (const fieldName of FIELD_NAMES) {
    const before = previous?.[fieldName] ?? null;
    const after = current[fieldName] ?? null;
    if (stableStringify(before) !== stableStringify(after)) {
      fields.push({
        name: fieldName,
        before,
        after
      });
    }
  }

  const previousKeywords = new Set(previous?.keywords ?? []);
  const currentKeywords = uniqueStrings(current.keywords);
  const keywordsAdded = currentKeywords.filter((keyword) => !previousKeywords.has(keyword));
  const currentKeywordSet = new Set(currentKeywords);
  const keywordsRemoved = uniqueStrings(previous?.keywords ?? []).filter((keyword) => !currentKeywordSet.has(keyword));

  const previousChatLength = previous?.chatHistory.length ?? 0;

  return {
    fields,
    chatTurnsAdded: Math.max(0, current.chatHistory.length - previousChatLength),
    keywordsAdded,
    keywordsRemoved
  };
}

export function buildIdeaHistorySummaryPrompt(events: IdeaEvent[]): string {
  if (events.length === 0) {
    return 'No idea history events were found for this range.';
  }

  const ideaTitle = events[events.length - 1]?.snapshot.title ?? events[0].snapshot.title;
  const evolution = events.map((event, index) => {
    const previous = index > 0 ? events[index - 1] : undefined;
    const diff = computeIdeaEventDiff(event.snapshot, previous?.snapshot);

    return JSON.stringify({
      eventId: event.id,
      type: event.type,
      createdAt: event.createdAt,
      payload: event.payload,
      snapshot: {
        title: event.snapshot.title,
        details: clipText(event.snapshot.details),
        analysis: clipText(event.snapshot.analysis),
        status: event.snapshot.status,
        folder_id: event.snapshot.folder_id ?? null,
        keywords: event.snapshot.keywords,
        relatedIdeas: event.snapshot.relatedIdeas,
        chatHistoryCount: event.snapshot.chatHistory.length
      },
      diff
    });
  }).join('\n');

  return `
You are summarizing how a startup idea evolved over time.

Return concise Markdown with:
- A short overview paragraph
- A "What changed" section
- A "Current state" section

Idea title: ${ideaTitle}
Events are ordered oldest to newest.

${evolution}
`.trim();
}
