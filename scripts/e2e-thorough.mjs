import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as fixtures from './e2e-fixtures/mock-proxy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const lag = process.argv.includes('--lag');
const output = path.join(root, 'output/playwright', `e2e-${lag ? 'lag' : 'thorough'}-${Date.now()}-${process.pid}`);
const children = [], results = [], unexpected = [], expectedErrors = [], credentialRequests = [];
let temp, proxy, browser, context, page, backend, origin, backendEnv, client, transport, current = 'startup', expectedFailure = false;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function poll(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout; let last;
  while (Date.now() < deadline) {
    try { const value = await check(); if (value) return value; } catch (error) { last = error; }
    const exited = children.find(child => child.exitCode !== null);
    if (exited) throw new Error(`${label}: child exited (${exited.exitCode})`);
    await delay(50);
  }
  throw new Error(`Timed out: ${label}${last ? `: ${last.message}` : ''}`);
}
async function freePort() {
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
function start(name, executable, args, env) {
  const child = spawn(executable, args, { cwd: root, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.logName = name; child.log = ''; child.on('error', error => { child.log += error.stack; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { child.log += data; });
  children.push(child); return child;
}
async function api(route, method = 'GET', body) {
  const response = await fetch(`${backend}${route}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.ok(response.ok, `${method} ${route}: ${response.status} ${await response.clone().text()}`);
  return response.status === 204 ? null : response.json();
}
const button = name => page.getByRole('button', { name, exact: true });
async function visible(locator) { await locator.waitFor({ state: 'visible', timeout: 15000 }); }
async function gone(locator) { await locator.waitFor({ state: 'hidden', timeout: 15000 }); }
async function enabled(locator) { await poll(() => locator.isEnabled(), 'control enabled'); }
async function goto(route) { await page.goto(`${origin}${route}`); }
async function scenario(name, run) {
  current = name; const started = Date.now();
  try { await run(); await page.screenshot({ path: path.join(output, `${results.length + 1}-${name}.png`), fullPage: true }); results.push({ name, passed: true, ms: Date.now() - started }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, passed: false, error: error.stack }); throw error; }
}
async function sendChat(text) { const input = page.getByPlaceholder('Ask about your idea...'); await enabled(input); await input.fill(text); await input.press('Enter'); }
async function connectionRow(name = 'E2E Codex') { const row = page.locator('section[aria-label="AI connections"] .border.rounded-lg').filter({ has: page.getByText(new RegExp(`^${name}( · Active)?$`)) }); await visible(row); return row; }
async function testAndActivate(row) {
  const test = row.getByRole('button', { name: 'Test', exact: true }); await enabled(test); await test.click();
  await visible(page.getByText('Connection test passed. You can now make it active.', { exact: true }));
  const active = row.getByRole('button', { name: 'Make active', exact: true }); if (await active.isEnabled()) await active.click();
  await visible(page.getByText('AI status: configured', { exact: true }));
}
try {
  await mkdir(output, { recursive: true }); temp = await mkdtemp(path.join(tmpdir(), 'startup-e2e-')); proxy = await fixtures.startMockProxy();
  const backendPort = await freePort(), vitePort = await freePort(); backend = `http://127.0.0.1:${backendPort}`; origin = `http://127.0.0.1:${vitePort}`;
  backendEnv = { APP_DB_PATH: path.join(temp, 'app.sqlite'), LEGACY_DB_JSON_PATH: path.join(temp, 'absent-legacy.json'), SERVER_PORT: String(backendPort), CLI_PROXY_BASE_URL: proxy.url, ALLOWED_ORIGINS: origin };
  start('backend', process.execPath, ['--import', 'tsx', 'server/index.ts'], backendEnv);
  await poll(async () => (await fetch(`${backend}/api/health`)).ok, 'backend readiness');
  start('vite', process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { VITE_BACKEND_TARGET: backend });
  await poll(async () => (await fetch(origin)).ok, 'Vite readiness');
  browser = await chromium.launch({ headless: true }); context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true }); page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('console', message => { if (message.type() !== 'error') return; const entry = { scenario: current, text: message.text() }; if (expectedFailure && /Failed to load resource.*502/.test(entry.text)) expectedErrors.push(entry); else unexpected.push(entry); });
  page.on('pageerror', error => unexpected.push({ scenario: current, text: error.stack }));
  page.on('request', request => { if (/\/credential$/.test(request.url())) credentialRequests.push(request.url()); });
  await scenario('fresh-setup-and-api-draft', async () => {
    assert.deepEqual(await api('/api/ai/connections'), []); assert.equal((await api('/api/settings')).activeConnectionId, null);
    await goto('/'); await visible(page.getByRole('complementary', { name: 'AI setup' }).first()); await button('Continue without AI').first().click();
    await button('New Idea').click(); await page.waitForURL(/\/idea\/.+/); assert.equal(await page.getByPlaceholder('Ask about your idea...').isEnabled(), false);
    await goto('/settings'); await enabled(button('Save connection')); await page.getByLabel('Name', { exact: true }).fill('E2E API Draft'); await page.getByLabel('Model', { exact: true }).fill('explicit-e2e-model');
    const key = page.getByLabel(/API key/); assert.equal(await key.getAttribute('type'), 'password'); await key.fill('NOT-A-SECRET-FORM-ONLY'); await key.fill(''); await button('Save connection').click(); await visible(page.getByText(/Connection saved\. Test it/));
    const draft = (await api('/api/ai/connections')).find(connection => connection.name === 'E2E API Draft'); assert.equal(draft.model, 'explicit-e2e-model'); assert.equal(draft.hasKey, false); assert.equal((await api('/api/settings')).activeConnectionId, null);
  });
  let connectionId, manualId;
  await scenario('http-connection-contract-and-ui-activation', async () => {
    const connection = await api('/api/ai/connections', 'POST', { kind: 'cli_proxy', tool: 'codex', name: 'E2E Codex' }); connectionId = connection.id;
    assert.deepEqual(await api(`/api/ai/connections/${connectionId}/test`, 'POST', {}), { ok: true }); await api('/api/settings', 'PUT', { activeConnectionId: connectionId }); await api('/api/settings', 'PUT', { activeConnectionId: null });
    await page.reload(); const row = await connectionRow(); await row.getByRole('button', { name: 'Edit', exact: true }).click(); await page.getByLabel('Model (optional)').fill('e2e-cli-model'); await button('Save connection').click(); await visible(page.getByText(/Connection saved\. Test it/)); await testAndActivate(row);
  });
  await scenario('manual-idea-persistence', async () => {
    await goto('/'); await button('New Idea').click(); await page.waitForURL(/\/idea\/.+/); manualId = page.url().split('/').at(-1); await page.getByPlaceholder('Idea Title').fill('E2E Manual Idea'); await page.getByPlaceholder('Describe your idea in detail...').fill('E2E isolated SQLite workflow details.');
    await poll(async () => { const idea = await api(`/api/ideas/${manualId}`); return idea.title === 'E2E Manual Idea' && idea.details.includes('SQLite'); }, 'manual persisted'); await page.reload(); await poll(async () => (await page.getByPlaceholder('Idea Title').inputValue()) === 'E2E Manual Idea', 'reload title');
  });
  await scenario('brainstorm-conversion-lag', async () => {
    await goto('/'); await page.getByPlaceholder('I have an idea for...').fill('A focused E2E customer workflow'); await page.getByPlaceholder('I have an idea for...').press('Enter'); await visible(page.getByText(fixtures.brainstorm, { exact: true }));
    const before = proxy.state.requests.filter(request => request.prompt.includes('Strictly output a valid JSON object with:')).length; const started = Date.now(); await button('Turn into Idea').click(); await page.waitForURL(/\/idea\/.+/);
    assert.ok(Date.now() - started < 6000, 'conversion navigation under six seconds'); assert.equal(proxy.state.requests.filter(request => request.prompt.includes('Strictly output a valid JSON object with:')).length, before + 1); assert.equal((await api(`/api/ideas/${page.url().split('/').at(-1)}`)).title, fixtures.summary.title);
    await sendChat('Immediate persisted access'); await visible(page.getByText(fixtures.chat, { exact: true }));
  });
  await scenario('repeat-deltas-and-cancel', async () => {
    await goto(`/idea/${manualId}`); await sendChat('Repeat delta fragments exactly.'); await visible(page.getByText('haha', { exact: true })); await poll(async () => (await api(`/api/ideas/${manualId}`)).chatHistory.some(message => message.role === 'assistant' && message.content === 'haha'), 'repeat persisted');
    await sendChat('Hold stream for cancellation.'); await visible(page.getByText('E2E pending cancellation', { exact: true })); await button('Stop').click(); await gone(button('Stop')); await enabled(page.getByPlaceholder('Ask about your idea...')); await poll(() => proxy.state.cancelledStreams > 0, 'upstream cancellation');
  });
  await scenario('title-validation-and-recovery', async () => {
    await page.getByPlaceholder('Idea Title').fill(''); await visible(page.getByText('Title is required. Changes stay local and AI tools are disabled until you enter one.', { exact: true }));
    for (const control of [page.getByPlaceholder('Ask about your idea...'), button('Examine Business Viability'), button('Competitor Analysis'), button('Extract')]) assert.equal(await control.isEnabled(), false);
    assert.equal((await api(`/api/ideas/${manualId}`)).title, 'E2E Manual Idea'); await page.getByPlaceholder('Idea Title').fill('E2E Manual Restored'); await poll(async () => (await api(`/api/ideas/${manualId}`)).title === 'E2E Manual Restored', 'restored title saved'); await sendChat('Recovered title'); await visible(page.getByText(fixtures.chat, { exact: true }));
  });
  for (const [name, action, dialogName, finalHeading, close] of [['viability', 'Examine Business Viability', 'Business Viability Report', 'Final Verdict', 'Close business viability report'], ['competitors', 'Competitor Analysis', 'Competitor Analysis', 'Final Strategic Recommendation', 'Close competitor analysis']]) await scenario(`${name}-full-report`, async () => {
    await button(action).click(); const dialog = page.getByRole('dialog', { name: dialogName, exact: true }); await visible(dialog.locator('pre')); await visible(dialog.getByRole('heading', { name: finalHeading, exact: true })); await gone(dialog.getByRole('button', { name: 'Cancel', exact: true })); await dialog.getByRole('button', { name: close, exact: true }).click();
  });
  if (!lag) {
    await scenario('generator-standard-and-combine', async () => {
      await goto('/generate'); await enabled(button('Generate with AI')); await button('Generate with AI').click(); await visible(page.getByRole('heading', { name: 'E2E Generated Alpha', exact: true })); await button('Save to Library').first().click(); await visible(button('Saved')); assert.ok((await api('/api/ideas')).some(idea => idea.title === 'E2E Generated Alpha'));
      await button('Combine Existing').click(); await button('Generate with AI').click(); await visible(page.getByRole('heading', { name: 'E2E Hybrid Alpha', exact: true })); await button('Save to Library').first().click(); await visible(button('Saved')); assert.ok((await api('/api/ideas')).some(idea => idea.title === 'E2E Hybrid Alpha'));
    });
    await scenario('search-mvp-vetting-smart-folder', async () => {
      await goto('/'); await page.getByPlaceholder('Search ideas...').fill('E2E Manual Restored'); await visible(page.getByRole('heading', { name: 'E2E Manual Restored', exact: true })); await gone(page.getByRole('heading', { name: fixtures.summary.title, exact: true })); await page.getByPlaceholder('Search ideas...').fill('');
      await enabled(button('Find Simplest MVP')); await button('Find Simplest MVP').click(); await visible(page.getByRole('heading', { name: 'Simplest MVP Ranking', exact: true })); await visible(page.getByText('E2E score for existing idea 1.', { exact: true })); await button('Done').click();
      await button('Vet Ideas').click(); await page.getByRole('button', { name: /Realism/ }).click(); await visible(page.getByText('E2E score for existing idea 1.', { exact: true })); await goto('/'); await poll(async () => (await api('/api/ideas')).some(idea => idea.vetting?.realism?.criteria === 'realism'), 'vetting persisted');
      await page.getByTitle('Auto-Organize with AI').click(); await visible(page.getByText('E2E Smart Folder', { exact: true })); await button('Apply Organization').click(); await poll(async () => { const folder = (await api('/api/folders')).find(item => item.name === 'E2E Smart Folder'); return folder && (await api('/api/ideas')).some(idea => idea.folder_id === folder.id); }, 'folder assignments persisted');
    });
    await scenario('history-summary', async () => {
      await goto(`/idea/${manualId}`); await enabled(button('Summarize selected range')); await button('Summarize selected range').click(); await visible(page.getByRole('heading', { name: 'Current state', exact: true })); await enabled(button('Summarize selected range')); assert.ok(proxy.state.requests.some(request => request.prompt.includes('Events are ordered oldest to newest.')));
    });
    await scenario('connection-edit-invalidates-and-retest', async () => {
      await goto('/settings'); const row = await connectionRow(); await row.getByRole('button', { name: 'Edit', exact: true }).click(); await page.getByLabel('Model (optional)').fill('e2e-changed-model'); await button('Save connection').click(); await visible(page.getByText(/Connection saved\. Test it/)); assert.equal((await api('/api/ai/status')).state, 'needs_setup');
      await goto(`/idea/${manualId}`); await visible(page.getByRole('complementary', { name: 'AI setup' }).first()); assert.equal(await page.getByPlaceholder('Ask about your idea...').isEnabled(), false);
      await goto('/settings'); const restored = await connectionRow(); await restored.getByRole('button', { name: 'Edit', exact: true }).click(); await page.getByLabel('Model (optional)').fill('e2e-cli-model'); await button('Save connection').click(); await visible(page.getByText(/Connection saved\. Test it/)); await testAndActivate(restored);
    });
    await scenario('credential-free-backup', async () => {
      const downloaded = page.waitForEvent('download'); await button('Export Backup').click(); const download = await downloaded; const backupPath = path.join(output, 'backup.json'); await download.saveAs(backupPath); const raw = await readFile(backupPath, 'utf8'); const backup = JSON.parse(raw); assert.ok(backup.ideas.length > 0); assert.equal(backup.settings.version, 2); assert.ok(!/apiKey|geminiKey|credentialRef|NOT-A-SECRET/.test(raw)); assert.deepEqual(credentialRequests, []);
    });
    await scenario('web-stdio-shared-store', async () => {
      client = new Client({ name: 'e2e-shared-store', version: '1.0.0' }); transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'node_modules/tsx/dist/cli.mjs'), path.join(root, 'server/stdio.ts')], cwd: root, env: { ...process.env, ...backendEnv }, stderr: 'pipe' });
      await client.connect(transport);
      const fetched = await client.callTool({ name: 'ideas.get', arguments: { ideaId: manualId } });
      assert.equal(fetched.structuredContent.idea.title, (await api(`/api/ideas/${manualId}`)).title);
      const updated = await client.callTool({ name: 'ideas.update', arguments: { ideaId: manualId, patch: { details: 'E2E shared SQLite proof from stdio.' } } });
      assert.ok(!updated.isError); assert.equal((await api(`/api/ideas/${manualId}`)).details, 'E2E shared SQLite proof from stdio.');
      await goto(`/idea/${manualId}`); await poll(async () => (await page.getByPlaceholder('Describe your idea in detail...').inputValue()) === 'E2E shared SQLite proof from stdio.', 'stdio edit visible in browser');
      const result = await client.callTool({ name: 'brainstorm.chat', arguments: { prompt: 'shared MCP proof', history: [] } }); assert.ok(!result.isError); assert.equal(result.structuredContent.response, fixtures.brainstorm);
      await client.close(); client = null; await transport.close(); transport = null;
    });
    await scenario('malformed-summary-fallback', async () => {
      proxy.state.malformedSummary = true; await goto('/'); const before = (await api('/api/ideas')).length; await page.getByPlaceholder('I have an idea for...').fill('Malformed summary scenario'); await page.getByPlaceholder('I have an idea for...').press('Enter'); await visible(page.getByText(fixtures.brainstorm, { exact: true })); expectedFailure = true; await button('Turn into Idea').click(); await visible(page.getByText('Chat Summary Fallback', { exact: true })); await visible(page.getByText(fixtures.rawSummary, { exact: true })); assert.equal((await api('/api/ideas')).length, before); await button('Create Draft from Raw Output').click(); await page.waitForURL(/\/idea\/.+/); assert.ok((await api(`/api/ideas/${page.url().split('/').at(-1)}`)).details.includes(fixtures.rawSummary)); proxy.state.malformedSummary = false; expectedFailure = false;
    });
    await scenario('provider-failure-and-recovery', async () => {
      await goto('/generate'); await enabled(button('Generate with AI')); expectedFailure = true; proxy.state.failNext = true; const failed = page.waitForResponse(response => response.url().endsWith('/api/ai/generate-ideas') && response.status() === 502); await button('Generate with AI').click(); await failed; await visible(page.getByText(/Error:.*provider/i)); await enabled(button('Generate with AI')); await button('Generate with AI').click(); await visible(page.getByRole('heading', { name: 'E2E Generated Alpha', exact: true })); expectedFailure = false;
    });
  }
  assert.deepEqual(proxy.state.errors, [], 'mock contract errors'); assert.deepEqual(unexpected, [], 'unexpected browser errors'); assert.deepEqual(credentialRequests, [], 'no native Keychain credential requests'); console.log(`${results.length}/${results.length} scenarios passed; artifacts: ${output}`);
} catch (error) { process.exitCode = 1; console.error(error.stack); if (page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {}); }
finally {
  await client?.close().catch(() => {}); await transport?.close().catch(() => {}); await context?.close().catch(() => {}); await browser?.close().catch(() => {});
  for (const child of children) if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  for (const child of children) { if (child.pid && child.exitCode === null) await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(2000)]); if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } await writeFile(path.join(output, `${child.logName}.log`), child.log); }
  await proxy?.close(); await writeFile(path.join(output, 'results.json'), JSON.stringify({ mode: lag ? 'lag' : 'thorough', results, unexpected, expectedErrors, mockErrors: proxy?.state.errors, credentialRequests, limitations: ['API key forms only: native credential writes and real providers excluded.', 'Dynamic Vite/backend ports use reserve-release followed by strict bind.'] }, null, 2)); if (temp) await rm(temp, { recursive: true, force: true });
}
