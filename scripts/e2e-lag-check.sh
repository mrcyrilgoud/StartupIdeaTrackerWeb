#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required but was not found on PATH."
  exit 1
fi

APP_PORT="${APP_PORT:-5174}"
DB_PORT="3001"
PROXY_PORT="3333"

export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"
export PLAYWRIGHT_CLI_SESSION="e2e-lag-$(date +%s)"

JSON_SERVER_PID=""
MOCK_PROXY_PID=""
VITE_PID=""

cleanup() {
  set +e

  if [[ -n "$JSON_SERVER_PID" ]]; then
    kill "$JSON_SERVER_PID" >/dev/null 2>&1
    wait "$JSON_SERVER_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$MOCK_PROXY_PID" ]]; then
    kill "$MOCK_PROXY_PID" >/dev/null 2>&1
    wait "$MOCK_PROXY_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$VITE_PID" ]]; then
    kill "$VITE_PID" >/dev/null 2>&1
    wait "$VITE_PID" >/dev/null 2>&1 || true
  fi

  if [[ -x "$PWCLI" ]]; then
    "$PWCLI" close-all >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

wait_for_http() {
  local url="$1"
  local retries="${2:-60}"

  for _ in $(seq 1 "$retries"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done

  echo "Timed out waiting for $url"
  return 1
}

run_pw() {
  "$PWCLI" "$@"
}

mkdir -p .context

cat > .context/e2e-db.json <<'DBEOF'
{
  "ideas": [],
  "folders": []
}
DBEOF

cat > .context/mock-ai-proxy.cjs <<'MOCKEOF'
const http = require('http');

const PORT = 3333;
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const sendJson = (res, code, payload) => {
  res.writeHead(code, { 'Content-Type': 'application/json', ...CORS_HEADERS });
  res.end(JSON.stringify(payload));
};

const makeJsonResponse = (prompt = '') => {
  if (prompt.includes('Strictly output the result as a valid JSON object') && prompt.includes('title')) {
    return JSON.stringify({
      title: 'Mock Generated Idea',
      details: 'Generated from mocked brainstorm history.'
    });
  }

  if (prompt.includes('extract 5 key conceptually relevant keywords')) {
    return 'mock, startup, mvp, analysis, testing';
  }

  if (prompt.includes('Strictly output the result as a valid JSON array of objects') && prompt.includes('"title"') && prompt.includes('"details"')) {
    return JSON.stringify([
      { title: 'Mock Idea Alpha', details: 'A test startup concept for E2E.' },
      { title: 'Mock Idea Beta', details: 'Another generated concept for verification.' },
      { title: 'Mock Idea Gamma', details: 'A third concept produced by mock AI.' }
    ]);
  }

  if (prompt.includes('Strictly output the result as a valid JSON array of objects') && prompt.includes('"ideaId"') && prompt.includes('"score"')) {
    return JSON.stringify([]);
  }

  return 'Mock AI response generated successfully.';
};

const streamChunks = (res, text, chunkSize = 12, delayMs = 140) => {
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }

  let idx = 0;
  const timer = setInterval(() => {
    if (idx >= chunks.length) {
      clearInterval(timer);
      res.end();
      return;
    }

    const payload = JSON.stringify({ response: chunks[idx] });
    res.write(`data: ${payload}\n\n`);
    idx += 1;
  }, delayMs);
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    return sendJson(res, 404, { error: 'Not found' });
  }

  let rawBody = '';
  req.on('data', (chunk) => {
    rawBody += chunk;
  });

  req.on('end', () => {
    let body = {};
    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch (e) {
      return sendJson(res, 400, { error: 'Invalid JSON' });
    }

    const prompt = body.prompt || '';

    if (req.url === '/api/low-level') {
      return sendJson(res, 200, { response: makeJsonResponse(prompt) });
    }

    if (req.url === '/api/low-level-stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        ...CORS_HEADERS,
      });

      const responseText = prompt.includes('Business Viability Report')
        ? '# Business Viability Report\n\n## Executive Summary\nMock viability streaming report for E2E validation.\n\n## Business Model Analysis\n- Value proposition has potential\n- Costs should be constrained early\n\n## Final Verdict\nMedium\n'
        : prompt.includes('Competitor Analysis')
          ? '# Competitor Analysis\n\n## Market Landscape Overview\nMock competitor streaming report for E2E validation.\n\n## SWOT Analysis\n- Strength: speed\n- Weakness: narrow scope\n\n## Final Strategic Recommendation\nEnter with focused differentiation.\n'
          : 'This is a streamed mock assistant response to validate throttled rendering.';

      streamChunks(res, responseText);
      return;
    }

    return sendJson(res, 404, { error: 'Unknown route' });
  });
});

server.listen(PORT, () => {
  console.log(`Mock AI proxy running on http://localhost:${PORT}`);
});
MOCKEOF

npx json-server --watch .context/e2e-db.json --port "$DB_PORT" > .context/e2e-json-server.log 2>&1 &
JSON_SERVER_PID=$!

node .context/mock-ai-proxy.cjs > .context/e2e-mock-proxy.log 2>&1 &
MOCK_PROXY_PID=$!

npx vite --host 127.0.0.1 --port "$APP_PORT" --strictPort > .context/e2e-vite.log 2>&1 &
VITE_PID=$!

wait_for_http "http://localhost:${DB_PORT}/ideas"
wait_for_http "http://127.0.0.1:${APP_PORT}/"

run_pw open "http://127.0.0.1:${APP_PORT}/" >/dev/null
run_pw run-code "async (page) => {
  await page.evaluate(() => {
    localStorage.setItem('app-settings', JSON.stringify({
      provider: 'cli_proxy',
      geminiKey: '',
      ollamaEndpoint: 'http://localhost:11434',
      ollamaModel: 'llama3',
      cliCommandTemplate: 'gemini \"{{prompt}}\"',
    }));
  });
  return { settings: 'ok' };
}" >/dev/null

run_pw run-code "async (page) => {
  await page.goto('http://127.0.0.1:${APP_PORT}/');
  await page.getByPlaceholder('I have an idea for...').fill('A tool that summarizes technical RFCs');
  await page.getByPlaceholder('I have an idea for...').press('Enter');
  await page.getByText('Mock AI response generated successfully.').waitFor({ timeout: 10000 });

  let lowLevelCalls = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/low-level')) {
      lowLevelCalls += 1;
    }
  });

  const startedAt = Date.now();
  await page.getByRole('button', { name: 'Turn into Idea' }).click();
  await page.waitForURL(/\\/idea\\/.+/, { timeout: 10000 });
  const elapsedMs = Date.now() - startedAt;

  if (lowLevelCalls !== 1) {
    throw new Error('Expected exactly 1 /api/low-level request during HomeChat idea creation, received ' + lowLevelCalls);
  }

  if (elapsedMs > 6000) {
    throw new Error('HomeChat navigation after create was too slow: ' + elapsedMs + 'ms');
  }

  await page.goto('http://127.0.0.1:${APP_PORT}/');
  return { step: 'home_chat_non_blocking_create_pass' };
}" >/dev/null

run_pw run-code "async (page) => {
  await page.goto('http://127.0.0.1:${APP_PORT}/');
  await page.getByRole('button', { name: 'New Idea' }).click();
  await page.getByRole('textbox', { name: 'Idea Title' }).fill('Lag Script Idea');
  await page.getByRole('textbox', { name: 'Describe your idea in detail...' }).fill('Scripted E2E validation for lag fixes.');
  await page.waitForTimeout(1200);
  await page.getByRole('textbox', { name: 'Ask about your idea...' }).fill('Provide a streamed checklist response.');
  await page.getByRole('button').filter({ hasText: /^$/ }).nth(4).click();
  await page.getByText('This is a streamed mock assistant response to validate throttled rendering.').waitFor({ timeout: 10000 });
  return { step: 'chat_stream_pass' };
}" >/dev/null

run_pw run-code "async (page) => {
  await page.getByRole('textbox', { name: 'Ask about your idea...' }).fill('Generate a long response that I will cancel.');
  await page.getByRole('textbox', { name: 'Ask about your idea...' }).press('Enter');

  const stopBtn = page.getByRole('button', { name: 'Stop' }).first();
  await stopBtn.waitFor({ timeout: 5000 });
  await stopBtn.click();
  await page.waitForTimeout(400);

  if (await stopBtn.isVisible().catch(() => false)) {
    throw new Error('Chat stop button stayed visible after cancel.');
  }

  return { step: 'chat_cancel_pass' };
}" >/dev/null

run_pw run-code "async (page) => {
  await page.getByRole('button', { name: 'Examine Business Viability' }).click();
  const viabilityDialog = page.getByRole('dialog', { name: 'Business Viability Report' });
  await viabilityDialog.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(400);
  const cancelStillVisible = await viabilityDialog.getByRole('button', { name: 'Cancel' }).isVisible().catch(() => false);
  if (cancelStillVisible) {
    throw new Error('Viability cancel control remained visible after cancel.');
  }
  await viabilityDialog.getByRole('button', { name: /Close business viability report/i }).click();
  return { step: 'viability_cancel_pass' };
}" >/dev/null

run_pw run-code "async (page) => {
  await page.getByRole('button', { name: 'Competitor Analysis' }).click();
  const competitorDialog = page.getByRole('dialog', { name: 'Competitor Analysis' });
  await competitorDialog.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(400);
  const cancelStillVisible = await competitorDialog.getByRole('button', { name: 'Cancel' }).isVisible().catch(() => false);
  if (cancelStillVisible) {
    throw new Error('Competitor cancel control remained visible after cancel.');
  }
  await competitorDialog.getByRole('button', { name: /Close competitor analysis/i }).click();
  return { step: 'competitor_cancel_pass' };
}" >/dev/null

run_pw run-code "async (page) => {
  await page.getByRole('button', { name: 'Examine Business Viability' }).click();
  await page.waitForTimeout(700);
  const viabilityDialog = page.getByRole('dialog', { name: 'Business Viability Report' });
  const viabilityPre = await viabilityDialog.locator('pre').count();
  const viabilityMarkdown = await viabilityDialog.locator('.markdown-body').count();
  if (viabilityPre < 1 || viabilityMarkdown !== 0) {
    throw new Error('Viability streaming view did not render in plain-text mode while loading.');
  }
  await page.waitForTimeout(3200);
  const viabilityFinalPre = await viabilityDialog.locator('pre').count();
  const viabilityFinalMarkdown = await viabilityDialog.locator('.markdown-body').count();
  if (viabilityFinalPre !== 0 || viabilityFinalMarkdown < 1) {
    throw new Error('Viability report did not switch to markdown mode after streaming.');
  }
  await page.getByRole('button', { name: /Close business viability report/i }).click();
  return { step: 'viability_modal_pass' };
}" >/dev/null

run_pw run-code "async (page) => {
  await page.getByRole('button', { name: 'Competitor Analysis' }).click();
  await page.waitForTimeout(700);
  const competitorDialog = page.getByRole('dialog', { name: 'Competitor Analysis' });
  const competitorPre = await competitorDialog.locator('pre').count();
  const competitorMarkdown = await competitorDialog.locator('.markdown-body').count();
  if (competitorPre < 1 || competitorMarkdown !== 0) {
    throw new Error('Competitor streaming view did not render in plain-text mode while loading.');
  }
  await page.waitForTimeout(3400);
  const competitorFinalPre = await competitorDialog.locator('pre').count();
  const competitorFinalMarkdown = await competitorDialog.locator('.markdown-body').count();
  if (competitorFinalPre !== 0 || competitorFinalMarkdown < 1) {
    throw new Error('Competitor report did not switch to markdown mode after streaming.');
  }
  await page.getByRole('button', { name: /Close competitor analysis/i }).click();
  return { step: 'competitor_modal_pass' };
}" >/dev/null

run_pw run-code "async (page) => {
  await page.getByRole('button', { name: 'Examine Business Viability' }).click();
  await page.waitForTimeout(120);
  await page.goto('http://127.0.0.1:${APP_PORT}/');
  await page.waitForTimeout(900);
  await page.getByRole('heading', { name: 'Lag Script Idea' }).first().click();
  await page.getByRole('textbox', { name: 'Ask about your idea...' }).waitFor({ timeout: 8000 });
  await page.getByRole('textbox', { name: 'Ask about your idea...' }).fill('Stream then abort by navigation.');
  await page.getByRole('button').filter({ hasText: /^$/ }).nth(4).click();
  await page.waitForTimeout(120);
  await page.goto('http://127.0.0.1:${APP_PORT}/');
  await page.waitForTimeout(900);
  return { step: 'abort_paths_pass' };
}" >/dev/null

CONSOLE_OUTPUT="$(run_pw console error)"
echo "$CONSOLE_OUTPUT"
if ! grep -q 'Returning 0 messages for level "error"' <<< "$CONSOLE_OUTPUT"; then
  CONSOLE_FILE="$(sed -n 's/.*\[Console\](\(.*\)).*/\1/p' <<< "$CONSOLE_OUTPUT")"
  if [[ -z "$CONSOLE_FILE" || ! -f "$CONSOLE_FILE" ]]; then
    echo "Could not locate console log artifact from Playwright CLI."
    exit 1
  fi

  UNEXPECTED_ERRORS="$(
    grep '^\[ERROR\]' "$CONSOLE_FILE" \
      | grep -v 'status of 404 (Not Found) @ http://localhost:3001/ideas/' \
      || true
  )"

  if [[ -n "$UNEXPECTED_ERRORS" ]]; then
    echo "Unexpected console errors during E2E run:"
    echo "$UNEXPECTED_ERRORS"
    exit 1
  fi
fi

NETWORK_OUTPUT="$(run_pw network)"
NETWORK_FILE="$(sed -n 's/.*\[Network\](\(.*\)).*/\1/p' <<< "$NETWORK_OUTPUT")"
if [[ -z "$NETWORK_FILE" || ! -f "$NETWORK_FILE" ]]; then
  echo "Could not locate network log artifact from Playwright CLI."
  exit 1
fi

if ! grep -q '\[POST\] http://localhost:3333/api/low-level-stream => \[200\] OK' "$NETWORK_FILE"; then
  echo "Did not find successful streamed AI requests in network log."
  exit 1
fi

echo "E2E lag check passed."
