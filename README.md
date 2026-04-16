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
- Node.js 18+

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
- the Vite frontend on `http://127.0.0.1:5173`
- local API and MCP requests are proxied through the frontend origin

## AI Configuration

Open the Settings page in the app and configure one of:
- Gemini: set your API key
- Ollama: point to your local Ollama endpoint and model
- CLI Proxy: run the companion proxy on `http://localhost:3333`

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
