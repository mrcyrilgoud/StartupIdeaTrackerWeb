#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required but was not found on PATH."
  exit 1
fi

APP_PORT="${APP_PORT:-5174}"
BACKEND_PORT="${BACKEND_PORT:-3334}"
PROXY_PORT="${PROXY_PORT:-3333}"

export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"
export PLAYWRIGHT_CLI_SESSION="lag$(date +%s)"

BACKEND_PID=""
MOCK_PROXY_PID=""
VITE_PID=""
BACKEND_LOG=".context/e2e-backend.log"
MOCK_PROXY_LOG=".context/e2e-mock-proxy.log"
VITE_LOG=".context/e2e-vite.log"

cleanup() {
  set +e

  if [[ -n "$BACKEND_PID" ]]; then
    kill "$BACKEND_PID" >/dev/null 2>&1
    wait "$BACKEND_PID" >/dev/null 2>&1 || true
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

print_process_log() {
  local label="$1"
  local logfile="$2"

  echo "${label} failed. Recent log output:"
  if [[ -f "$logfile" ]]; then
    tail -n 80 "$logfile"
  else
    echo "Log file not found: $logfile"
  fi
}

wait_for_http() {
  local url="$1"
  local pid="${2:-}"
  local logfile="${3:-}"
  local retries="${4:-60}"

  for _ in $(seq 1 "$retries"); do
    if [[ -n "$pid" ]] && ! kill -0 "$pid" >/dev/null 2>&1; then
      print_process_log "Process ${pid}" "$logfile"
      return 1
    fi
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

const PORT = Number(process.env.PROXY_PORT || '3333');
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

const streamEvents = (res, chunks, delayMs = 140, streamMode = 'delta') => {
  let idx = 0;
  const timer = setInterval(() => {
    if (idx >= chunks.length) {
      clearInterval(timer);
      res.end();
      return;
    }

    const payload = JSON.stringify({ response: chunks[idx], streamMode });
    res.write(`data: ${payload}\n\n`);
    idx += 1;
  }, delayMs);
};

const streamChunks = (res, text, chunkSize = 12, delayMs = 140, streamMode = 'delta') => {
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }

  streamEvents(res, chunks, delayMs, streamMode);
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

      if (prompt.includes('Repeat delta fragments exactly.')) {
        streamEvents(res, ['ha', 'ha'], 140, 'delta');
        return;
      }

      const responseText = prompt.includes('Business Viability Report')
        ? '# Business Viability Report\n\n## Executive Summary\nMock viability streaming report for E2E validation.\n\n## Business Model Analysis\n- Value proposition has potential\n- Costs should be constrained early\n\n## Final Verdict\nMedium\n'
        : prompt.includes('Competitor Analysis')
          ? '# Competitor Analysis\n\n## Market Landscape Overview\nMock competitor streaming report for E2E validation.\n\n## SWOT Analysis\n- Strength: speed\n- Weakness: narrow scope\n\n## Final Strategic Recommendation\nEnter with focused differentiation.\n'
          : 'This is a streamed mock assistant response to validate throttled rendering.';

      streamChunks(res, responseText, 12, 140, 'delta');
      return;
    }

    return sendJson(res, 404, { error: 'Unknown route' });
  });
});

server.listen(PORT, () => {
  console.log(`Mock AI proxy running on http://localhost:${PORT}`);
});
MOCKEOF

rm -f .context/e2e.sqlite

APP_DB_PATH=".context/e2e.sqlite" \
LEGACY_DB_JSON_PATH=".context/e2e-db.json" \
SERVER_PORT="$BACKEND_PORT" \
CLI_PROXY_BASE_URL="http://127.0.0.1:${PROXY_PORT}" \
npx tsx server/index.ts > "$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

PROXY_PORT="$PROXY_PORT" node .context/mock-ai-proxy.cjs > "$MOCK_PROXY_LOG" 2>&1 &
MOCK_PROXY_PID=$!

VITE_BACKEND_TARGET="http://127.0.0.1:${BACKEND_PORT}" \
npx vite --host 127.0.0.1 --port "$APP_PORT" --strictPort > "$VITE_LOG" 2>&1 &
VITE_PID=$!

wait_for_http "http://127.0.0.1:${BACKEND_PORT}/api/health" "$BACKEND_PID" "$BACKEND_LOG" 60
wait_for_http "http://127.0.0.1:${APP_PORT}/" "$VITE_PID" "$VITE_LOG" 60

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

  let summarizeCalls = 0;
  let immediateIdeaChatResponses = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/ai/summarize-chat')) {
      summarizeCalls += 1;
    }
  });
  page.on('response', (response) => {
    if (
      response.request().method() === 'POST'
      && response.url().includes('/api/ai/idea-chat')
      && response.status() === 200
    ) {
      immediateIdeaChatResponses += 1;
    }
  });

  const startedAt = Date.now();
  await page.getByRole('button', { name: 'Turn into Idea' }).click();
  await page.waitForURL(/\\/idea\\/.+/, { timeout: 10000 });
  const elapsedMs = Date.now() - startedAt;

  if (summarizeCalls !== 1) {
    throw new Error('Expected exactly 1 /api/ai/summarize-chat request during HomeChat idea creation, received ' + summarizeCalls);
  }

  if (elapsedMs > 6000) {
    throw new Error('HomeChat navigation after create was too slow: ' + elapsedMs + 'ms');
  }

  await page.getByRole('textbox', { name: 'Ask about your idea...' }).waitFor({ timeout: 10000 });
  await page.getByRole('textbox', { name: 'Ask about your idea...' }).fill('Validate immediate persisted idea access.');
  await page.getByRole('textbox', { name: 'Ask about your idea...' }).press('Enter');
  await page.getByText('This is a streamed mock assistant response to validate throttled rendering.').waitFor({ timeout: 10000 });

  if (immediateIdeaChatResponses < 1) {
    throw new Error('Expected a successful /api/ai/idea-chat response immediately after HomeChat idea creation.');
  }

  await page.goto('http://127.0.0.1:${APP_PORT}/');
  return { step: 'home_chat_non_blocking_create_pass' };
}" >/dev/null

run_pw run-code "async (page) => {
  await page.goto('http://127.0.0.1:${APP_PORT}/');
  await page.getByRole('button', { name: 'New Idea' }).click();
  let successfulIdeaChatResponses = 0;
  page.on('response', (response) => {
    if (
      response.request().method() === 'POST'
      && response.url().includes('/api/ai/idea-chat')
      && response.status() === 200
    ) {
      successfulIdeaChatResponses += 1;
    }
  });
  await page.getByRole('textbox', { name: 'Ask about your idea...' }).waitFor({ timeout: 10000 });
  await page.getByRole('textbox', { name: 'Ask about your idea...' }).fill('Confirm new drafts persist before first edit.');
  await page.getByRole('textbox', { name: 'Ask about your idea...' }).press('Enter');
  await page.getByText('This is a streamed mock assistant response to validate throttled rendering.').waitFor({ timeout: 10000 });

  await page.getByRole('textbox', { name: 'Idea Title' }).fill('Lag Script Idea');
  await page.getByRole('textbox', { name: 'Describe your idea in detail...' }).fill('Scripted E2E validation for lag fixes.');
  await page.waitForTimeout(1200);
  await page.getByRole('textbox', { name: 'Ask about your idea...' }).fill('Provide a streamed checklist response.');
  await page.getByRole('button').filter({ hasText: /^$/ }).nth(4).click();
  await page.getByText('This is a streamed mock assistant response to validate throttled rendering.').waitFor({ timeout: 10000 });

  await page.getByRole('textbox', { name: 'Ask about your idea...' }).fill('Repeat delta fragments exactly.');
  await page.getByRole('button').filter({ hasText: /^$/ }).nth(4).click();
  await page.getByText('haha').waitFor({ timeout: 10000 });

  if (successfulIdeaChatResponses < 3) {
    throw new Error('Expected at least 3 successful /api/ai/idea-chat responses, received ' + successfulIdeaChatResponses);
  }

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
  await page.waitForTimeout(600);

  let ideaSaveRequests = 0;
  let restoredTitleChatResponses = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/ideas')) {
      ideaSaveRequests += 1;
    }
  });
  page.on('response', (response) => {
    if (
      response.request().method() === 'POST'
      && response.url().includes('/api/ai/idea-chat')
      && response.status() === 200
    ) {
      restoredTitleChatResponses += 1;
    }
  });

  const titleInput = page.getByRole('textbox', { name: 'Idea Title' });
  const validationMessage = page.getByText('Title is required. Changes stay local and AI tools are disabled until you enter one.');

  await titleInput.fill('');
  await validationMessage.waitFor({ timeout: 5000 });
  await page.waitForTimeout(1300);

  if (ideaSaveRequests !== 0) {
    throw new Error('Expected no /api/ideas save requests while the idea title is invalid, received ' + ideaSaveRequests);
  }

  if (await page.getByRole('textbox', { name: 'Ask about your idea...' }).isEnabled()) {
    throw new Error('Chat input remained enabled while the title was invalid.');
  }

  if (await page.getByRole('button', { name: 'Examine Business Viability' }).isEnabled()) {
    throw new Error('Viability action remained enabled while the title was invalid.');
  }

  if (await page.getByRole('button', { name: 'Competitor Analysis' }).isEnabled()) {
    throw new Error('Competitor analysis action remained enabled while the title was invalid.');
  }

  if (await page.getByRole('button', { name: 'Extract' }).isEnabled()) {
    throw new Error('Keyword extraction remained enabled while the title was invalid.');
  }

  await titleInput.fill('Lag Script Idea');
  await page.waitForTimeout(1300);

  if (ideaSaveRequests < 1) {
    throw new Error('Expected a /api/ideas save request after restoring a valid title.');
  }

  const validationStillVisible = await validationMessage.isVisible().catch(() => false);
  if (validationStillVisible) {
    throw new Error('Title validation message remained visible after restoring a valid title.');
  }

  const chatInput = page.getByRole('textbox', { name: 'Ask about your idea...' });
  if (!(await chatInput.isEnabled())) {
    throw new Error('Chat input did not re-enable after restoring a valid title.');
  }

  await chatInput.fill('Validation recovered after restoring title.');
  await chatInput.press('Enter');
  await page.getByText('This is a streamed mock assistant response to validate throttled rendering.').waitFor({ timeout: 10000 });

  if (restoredTitleChatResponses < 1) {
    throw new Error('Expected a successful /api/ai/idea-chat response after restoring a valid title.');
  }

  return { step: 'title_validation_pass' };
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
      || true
  )"

  if [[ -n "$UNEXPECTED_ERRORS" ]]; then
    echo "Unexpected console errors during E2E run:"
    echo "$UNEXPECTED_ERRORS"
    exit 1
  fi
fi

echo "E2E lag check passed."
