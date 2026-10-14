import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { ChildProcess } from 'node:child_process';
import { OpenAiAuthService } from '../server/openaiAuth.js';

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { exitCode: number | null; stdout: EventEmitter; kill: () => void };
  child.exitCode = null;
  child.stdout = new EventEmitter();
  child.kill = () => { child.exitCode = 0; child.emit('close', 0); };
  return child as unknown as ChildProcess & { stdout: EventEmitter };
}

test('OpenAI auth reports CLI login status without exposing credentials', async () => {
  const service = new OpenAiAuthService('codex', async () => ({ stdout: 'Logged in using ChatGPT\nsecret-token', stderr: '' }));
  assert.deepEqual(await service.status(), { state: 'authenticated', message: 'Signed in with OpenAI through Codex.' });
});

test('OpenAI auth starts device login and observes completion', async () => {
  let statusCalls = 0;
  const child = fakeChild();
  const service = new OpenAiAuthService(
    'codex',
    async (_file, args) => {
      if (args[0] === 'logout') return { stdout: '', stderr: '' };
      statusCalls += 1;
      return { stdout: statusCalls > 1 ? 'Logged in using ChatGPT' : 'Not logged in', stderr: '' };
    },
    () => child
  );
  assert.equal((await service.start()).state, 'pending');
  assert.equal((await service.status()).state, 'authenticated');
  assert.ok(statusCalls >= 2);
});

test('OpenAI auth logout terminates pending login and delegates to the CLI', async () => {
  const child = fakeChild();
  let logoutCalled = false;
  const service = new OpenAiAuthService(
    'codex',
    async (_file, args) => {
      if (args[0] === 'logout') logoutCalled = true;
      return { stdout: 'Not logged in', stderr: '' };
    },
    () => child
  );
  await service.start();
  const result = await service.logout();
  assert.equal(result.state, 'signed_out');
  assert.equal(logoutCalled, true);
  assert.equal(child.exitCode, 0);
});

test('OpenAI auth degrades cleanly when Codex is unavailable', async () => {
  const service = new OpenAiAuthService('missing-codex', async () => { throw new Error('missing'); });
  assert.deepEqual(await service.status(), { state: 'unavailable', message: 'The Codex CLI is unavailable. Install it and retry.' });
});
