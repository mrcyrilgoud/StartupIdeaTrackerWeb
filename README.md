# Startup Idea Tracker - PWA

A Progressive Web App for capturing, refining, and analyzing startup ideas with a local TypeScript backend, SQLite storage, and an MCP server for agent access.

## Features

### Idea Management
- Capture and store startup concepts with a title, details, status, folder, keywords, chat history, and vetting results.
- Persist ideas and settings through a local backend on `127.0.0.1:3334`.
- Browser requests use relative `/api` paths and are proxied to the backend by Vite in `dev` and `preview`.
- Export and import backups through the backend API.

### AI Workflows
- Generate new ideas or combine existing ones.
- Brainstorm from the home screen and turn a conversation into a saved idea.
- Run critical idea chat, keyword extraction, business viability reports, competitor analysis, MVP ranking, vetting, and smart folder suggestions.
- Use Gemini, Ollama, or the local CLI proxy provider.

### Agent Access
- MCP over stdio: `npm run mcp:stdio`
- MCP over HTTP: `http://127.0.0.1:3334/mcp`
- Shared source of truth: the web app and MCP tools use the same SQLite database and stored AI settings.

## Architecture

### Frontend
- React + Vite + TypeScript
- Frontend services in `src/services` use relative `/api` paths and rely on Vite proxying in local workflows.

### Backend
- Express + TypeScript
- SQLite via `better-sqlite3`
- Drizzle schema definitions for ideas, folders, chat messages, keywords, related ideas, vetting results, and settings

### AI
- Backend-owned orchestration for Gemini, Ollama, and CLI proxy
- Streaming endpoints for idea chat, viability reports, and competitor analysis

### MCP
- Tools for listing, searching, reading, creating, and updating ideas and folders
- Tools for the app’s existing AI workflows
- Compatibility `search` and `fetch` tools for research-style clients

## Setup

### Prerequisites
- Node.js 18.17+

### Install
```bash
npm install
```

### Run The App
```bash
npm run dev
```

This starts:
- the backend on `http://127.0.0.1:3334`
- the companion AI CLI proxy on `http://localhost:3333`
- the Vite frontend on `http://127.0.0.1:5173`
- local API and MCP requests are proxied through the frontend origin

If your AI CLI proxy checkout lives somewhere other than `../AI-CLI-Proxy-Server`, point startup at it explicitly:

```bash
AI_CLI_PROXY_PATH=/path/to/AI-CLI-Proxy-Server npm run dev
```

## AI Configuration

On first run, choose **Set up AI** or continue capturing ideas without AI. There is no automatically selected provider. In Settings, choose **Add connection** to open the setup dialog. Save a named connection, run **Test connection**, then **Make active**. Editing opens the same dialog; **Done** closes it while keeping the connection saved. Tests send a small inference request and can consume usage. Editing a model, endpoint, tool, or key requires another test.

- Direct APIs: OpenAI Responses, Anthropic/Claude Messages, Google Gemini, and OpenAI-compatible services. Enter the exact model ID, or load the provider's model list after saving a credential. Compatible APIs use a base URL such as `https://api.example.com/v1`.
- Ollama: configure its endpoint and model. HTTP is permitted for loopback services; remote endpoints require HTTPS.
- Cursor and Kiro: select either provider in the dialog. Enter an API key or use an existing official CLI account. Keys entered here belong to the individual connection and are stored in the app’s Keychain service; the companion proxy receives them only for that request. Kiro uses its signed-in CLI account before a key. Use **Check status** to see the effective method. Run `kiro-cli login` to connect its account. Both integrations require their official CLI on the proxy host and an updated companion proxy.
- Other local CLIs: select Codex CLI, Claude Code CLI, Gemini CLI, or OpenCode. Existing profiles retain proxy-managed authentication. `npm run dev` starts the companion proxy. Its isolated inference adapters disable local tools and do not support image input.
- OpenAI: choose **ChatGPT account** or **API key**. **Continue with ChatGPT** opens the official browser flow and requests permission to use an eligible plan. After sign-in, choose a model from your account’s catalog, save, test, and activate. **Manage usage** opens ChatGPT usage settings. Add a separate named connection for another account or workspace. **Disconnect account** revokes only this app registration’s renewable session and clears its local tokens; remote revocation failures are reported. This integration does not require Codex CLI or import its existing session.
- Legacy Codex sign-in: Codex CLI connections retain **Sign in with OpenAI** using the official `codex login --device-auth` flow. Codex owns those credentials; this app only checks login status.

ChatGPT authentication uses OpenAI’s [registration flow](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [session management](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), and [Responses inference contract](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference). Plan access depends on eligibility and granted permission. Identity-only sign-in cannot activate AI. Usage and eligibility failures never switch automatically to API-key billing.

API keys and ChatGPT OAuth tokens are stored in **macOS Keychain**, using native bindings. SQLite stores connection metadata and credential references; the browser receives only credential-presence flags and safe account/status information. OAuth registration metadata and the persistent host ID stay out of backups; imported ChatGPT profiles require fresh sign-in. HTTP and stdio runtimes share a SQLite lease to coordinate rotating-token refreshes. The backend and stdio MCP share the database's active connection. Keychain access must be allowed for the Node process; other operating systems do not currently support storing API credentials in this app.

Existing configured settings migrate once. Gemini keys are verified in Keychain before the legacy database field is cleared. If access is denied, allow access and use **Refresh connections** in Settings to retry. Empty Gemini defaults enter setup instead of failing the first AI request.

Version-2 backups include ideas, folders, and credential-free connection metadata. Imported profiles are inactive and require credentials and testing. Legacy backups with embedded keys ask whether to import those keys into Keychain. Existing backup files and old database copies may still contain credentials and are not rewritten.

### Verification

```bash
npm test
npm run build
npm run e2e:thorough
```

The browser suite uses temporary SQLite storage, a test-only in-memory credential store, mocked OAuth and AI responses, and isolated ports. It never opens a real sign-in browser, writes Keychain entries, or sends external inference calls. Install Chromium once with `npx playwright install chromium` if it is not present. `npm run e2e:lag` runs the same tracked regression harness. Automated provider tests make no paid API calls.

On macOS, `NATIVE_KEYCHAIN_TEST=1 npm test` also verifies a disposable Keychain-backed connection against a loopback mock. It cleans up its test entries and makes no external provider calls.

## MCP Usage

### stdio
```bash
npm run mcp:stdio
```

### HTTP
Use `http://127.0.0.1:3334/mcp` from a local MCP client.

## Preview

```bash
npm run build
npm run preview
```

This starts the built backend and the Vite preview server together on `http://127.0.0.1:4173`.

## Runtime Configuration
- `VITE_BACKEND_TARGET`: overrides the Vite proxy target for `dev`, `preview`, and local tests
- `ALLOWED_ORIGINS`: only needed for direct cross-origin access to the backend; the normal app path uses Vite proxying

## Project Structure
- `server`: backend, SQLite store, HTTP API, and MCP registration
- `src/components`: reusable UI components
- `src/pages`: route-level screens
- `src/services`: frontend HTTP clients
- `src/types.ts`: shared app types and defaults
