# Startup Idea Tracker - PWA

This is the Progressive Web App version of the Startup Idea Tracker.

## Features
- **Offline First**: Uses IndexedDB to store ideas locally.
- **AI Integration**: Supports Google Gemini and Ollama (Local LLM).
- **Installable**: Works as a standalone app on iOS/Android/Desktop.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run development server:
   ```bash
   npm run dev
   ```

3. Build for production:
   ```bash
   npm run build
   ```

## Configuration
- Open the app and navigate to **Settings**.
- Choose **Gemini** (requires API Key) or **Ollama** (requires local server running on port 11434).

## Project Structure
- `src/services/db.ts`: IndexedDB wrapper.
- `src/services/ai.ts`: AI Provider abstraction.
- `src/pages`: Home, Detail, Settings.
- `src/components`: Reusable UI components.
