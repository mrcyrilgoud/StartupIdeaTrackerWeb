# Isolated browser E2E

Run `node scripts/e2e-thorough.mjs` for the 16-scenario suite, or
`bash scripts/e2e-lag-check.sh` for its eight-scenario streaming/lag subset.
Install dependencies and the matching Chromium runtime first:
`npx playwright install chromium`. This suite uses the Playwright library,
not shared Playwright CLI sessions.

Each run starts the actual SQLite backend, Vite, an in-process mock CLI proxy,
and its own Chromium context. Ports are allocated dynamically; the backend and
Vite use strict binding after allocation. SQLite and the absent legacy-import
path are inside a unique OS temporary directory. The runner never starts the
real companion proxy or uses production app data. Stdio MCP uses the same
database and proxy environment as the HTTP backend.

Thorough coverage: fresh setup/API draft and password form; HTTP connection
contracts plus UI metadata save/test/activation; manual persistence; brainstorm
conversion and immediate persisted access; repeated streaming deltas and
cancellation; title validation/recovery; full viability and competitor reports;
standard/combine generation and save; search/MVP/vetting/folder assignments;
history summary; edited connection invalidation/retest; credential-free backup;
web/stdio shared reads and writes plus MCP brainstorming; malformed-summary
review/manual draft; provider failure and retry recovery.

API key fields are filled then cleared before saving. No credential endpoint
is called, so the native Keychain runtime is never asked to store a key.
Real provider authentication, real CLI behavior, and native credential storage
are intentionally outside this suite. Generated responses validate against the
app's strict schemas, including actual idea IDs parsed from scoring prompts.
Unknown mock prompts fail instead of silently returning a generic response.

Screenshots, backend/Vite logs, downloaded backup, and `results.json` are saved
in a unique ignored `output/playwright/e2e-*` directory. Exactly the two deliberate
502 browser network errors are accepted in their respective failure scenarios;
other error-level console messages and all page errors fail the run.
Normal cleanup closes the owned browser and MCP client/transport, kills only
owned child process groups, closes the mock server, and removes only the
temporary SQLite directory. Artifacts remain for inspection.
