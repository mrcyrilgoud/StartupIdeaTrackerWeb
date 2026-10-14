# Startup Idea Tracker Codebase Documentation

## Overview
The app is now split into a React frontend and a local TypeScript backend.

- Frontend: React 18 + Vite + TypeScript
- Backend: Express + TypeScript on `127.0.0.1:3334`
- Storage: SQLite via `better-sqlite3`
- MCP: stdio and Streamable HTTP
- AI providers: OpenAI Responses, Anthropic Messages, Gemini, compatible Chat Completions, Ollama, and CLI proxy

## Main Runtime Pieces

### Frontend
- `src/pages`: Home, Detail, Generator, Idea Spark, Settings
- `src/components`: reusable UI and feature components
- `src/services/db.ts`: relative `/api` client for ideas, folders, settings, export, and import
- `src/services/ai.ts`: relative `/api` client for AI and streaming endpoints
- `src/types.ts`: shared domain types and default settings

### Backend
- `server/index.ts`: HTTP server entrypoint
- `server/stdio.ts`: stdio MCP entrypoint
- `server/app.ts`: Express app and REST endpoints
- `server/mcp.ts`: MCP tool registration
- `server/store.ts`: SQLite store, migration, import/export, and query logic
- `server/ai.ts`: provider orchestration and AI workflow prompts
- `server/ai/providers`: request adapters, error mapping, bounded streaming transport
- `server/connections`: profile contracts, credential coordination, model discovery, revision-gated activation
- `server/credentials`: native macOS Keychain bindings and injectable test credential store
- `server/ai/runtime.ts`: shared HTTP/stdio service initialization
- `server/schema.ts`: Drizzle schema definitions

## Persistence Model
SQLite tables:
- `ideas`
- `folders`
- `idea_keywords`
- `idea_related`
- `idea_chat_messages`
- `idea_vetting_results`
- `app_settings`
- `ai_connections`
- `app_metadata`
- `idea_events`

`app_settings` is retained only as a legacy migration source. Active connection selection and database-specific Keychain namespace are stored in metadata. `ai_connections` stores profiles, revisions and credential references; actual API keys are held in macOS Keychain. Exports contain neither credentials nor their references.

The frontend no longer owns persistence directly. It reads and writes through the backend API via same-origin `/api` requests that Vite proxies in local workflows.

## API Surface

### Core Data
- `GET /api/ideas`
- `GET /api/ideas/:id`
- `POST /api/ideas`
- `PATCH /api/ideas/:id`
- `DELETE /api/ideas/:id`
- `GET /api/folders`
- `POST /api/folders`
- `DELETE /api/folders/:id`
- `GET /api/settings`
- `PUT /api/settings`
- `GET /api/export`
- `POST /api/import`

### AI
- `GET/POST /api/ai/connections`
- `PATCH/DELETE /api/ai/connections/:id`
- `PUT/DELETE /api/ai/connections/:id/credential`
- `POST /api/ai/connections/:id/test`
- `GET /api/ai/connections/:id/models`
- `GET /api/ai/status`
- `GET /api/ai/proxy-tools`
- `POST /api/ai/migrate-legacy-settings`
- `POST /api/ai/retry-migration`
- `POST /api/ai/generate-ideas`
- `POST /api/ai/brainstorm`
- `POST /api/ai/summarize-chat`
- `POST /api/ai/idea-chat`
- `POST /api/ai/extract-keywords`
- `POST /api/ai/viability-report`
- `POST /api/ai/competitor-analysis`
- `POST /api/ai/find-mvp`
- `POST /api/ai/vet`
- `POST /api/ai/suggest-folders`
- `POST /api/ai/raw-response`

### MCP
- HTTP: `POST /mcp`
- stdio: `npm run mcp:stdio`

Registered MCP tools:
- `ideas.list`
- `ideas.search`
- `ideas.get`
- `ideas.create`
- `ideas.update`
- `folders.list`
- `folders.create`
- `brainstorm.chat`
- `brainstorm.summarize_to_idea`
- `ideas.chat`
- `ai.generate_ideas`
- `ai.extract_keywords`
- `ai.generate_viability_report`
- `ai.generate_competitor_analysis`
- `ai.find_simplest_mvp`
- `ai.vet_ideas`
- `ai.suggest_folders`
- `search`
- `fetch`

## Migration Notes
- If `data/db.json` exists and SQLite is empty, the backend imports the legacy ideas and folders on first start.
- Existing provider settings are converted into profiles. Nonempty Gemini keys are verified in Keychain before their legacy column is cleared. Denied access leaves the original key available for retry, but never exposes it in API responses or exports.
- Browser `app-settings` migrates through a dedicated backend endpoint only when no backend profile exists; its local copy is removed after success.
- Fresh databases and empty-key Gemini defaults have no active provider. Manual idea management remains available during setup.
- Settings v2 is `{version: 2, activeConnectionId: string | null}`. New or edited connections must pass a test at their current revision before activation. Backups import metadata as new inactive profiles without changing an existing active selection.

## Dev Commands
- `npm run dev`: backend + companion proxy + Vite
- `npm run preview`: built backend + Vite preview
- `npm run build`: frontend typecheck, server build, Vite production build
- `npm run mcp:stdio`: stdio MCP server
- `npm run e2e:thorough`: isolated browser regression suite with mocked AI
- `npm run e2e:lag`: runs the tracked regression harness

## Local Runtime Notes
- Vite proxies `/api` and `/mcp` to `http://127.0.0.1:3334` by default.
- `VITE_BACKEND_TARGET` overrides that proxy target for `dev`, `preview`, and local test scripts.
- Backend `ALLOWED_ORIGINS` defaults to the backend origin itself; direct cross-origin access must opt in explicitly.
- `POST /api/ai/idea-chat` uses `prompt` as the current user turn and `history` as prior context only. The backend temporarily strips a duplicated trailing user turn for backward compatibility.
