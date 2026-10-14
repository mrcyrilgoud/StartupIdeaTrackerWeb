import assert from 'node:assert/strict';
import test from 'node:test';

import { createStreamBatcher } from '../src/components/features/streamBatching.js';

test('stream batcher coalesces rapid deltas and flushes complete output', async () => {
  const flushed: string[] = [];
  const batcher = createStreamBatcher((content) => flushed.push(content), 5);

  batcher.push('a');
  batcher.push('b');
  batcher.push('c');

  await new Promise((resolve) => setTimeout(resolve, 15));

  assert.deepEqual(flushed, ['abc']);
  batcher.dispose();
});

test('stream batcher flushes synchronously and clear drops pending output', () => {
  const flushed: string[] = [];
  const batcher = createStreamBatcher((content) => flushed.push(content), 50);

  batcher.push('partial');
  batcher.flush();
  batcher.push('discarded');
  batcher.clear();

  assert.deepEqual(flushed, ['partial']);
  batcher.dispose();
});
