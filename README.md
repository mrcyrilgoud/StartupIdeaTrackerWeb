# Startup Idea Tracker - PWA

A Progressive Web App (PWA) designed to help entrepreneurs and creators capture, refine, and analyze startup ideas using local AI processing and offline-first storage.

## Features

### 1. Idea Management
- **Capture & Store**: Quickly save startup concepts with a title and detailed description.
- **Offline First**: Built on **IndexedDB**, ensuring all your data is stored locally on your device. It works perfectly without an internet connection.
- **Auto-Keywords**: Automatically extracts relevant keywords from your idea descriptions to help with organization.

### 2. AI-Powered Generator (`/generate`)
- **Standard Mode**: Generate completely new, unique startup ideas based on optional topics or keywords.
- **Combination Mode**: Takes your *existing* saved ideas and creatively combines them to propose new hybrid concepts.
- **Verify & Save**: Review generated ideas and save the ones you like directly to your library.

### 3. Critical AI Analysis (Chat)
- **Objective Feedback**: Unlike typical chat assistants, the "Advisor" persona is prompted to be critical and non-sycophantic. It challenges assumptions, points out market risks, and helps refine the viability of your idea.
- **Context Aware**: The chat retains history specific to each idea, allowing for deep, continuous discussions about a single concept.

### 4. Cross-Platform Support
- **PWA**: Installable on iOS, Android, and Desktop as a native-like application.

---

## Technical Architecture: How It Works

### Core Tech Stack
- **Frontend**: React + Vite + TypeScript
- **State/Storage**: IndexedDB (via `idb`) for robust local data persistence.
- **Routing**: React Router DOM
- **Styling**: Vanilla CSS with a responsive, dark-mode focused design system.

### Service Layer (`src/services`)

#### 1. Database Service (`db.ts`)
This service wraps IndexedDB to provide a simple asynchronous API for the app.
- **Stores**:
    - `ideas`: Stores idea objects, indexed by timestamp for easy sorting.
    - `settings`: Stores application configuration (like API choices).
- **Data Privacy**: No data is ever sent to a central server. Your ideas live only on your device (and the AI provider you choose).

#### 2. AI Service (`ai.ts`)
A flexible abstraction layer that supports multiple LLM providers:
- **Google Gemini**: Uses the Gemini API (Flash models) for high-speed, high-quality reasoning. Supports "Thinking" models for complex tasks like idea generation.
- **Ollama**: Connects to a locally running Ollama instance (default port 11434). This allows for **100% private, offline AI** if you have the hardware to run models like Llama 3 locally.

### Key Workflows

#### Idea Generation
1. User selects a mode (Standard or Combination).
2. The app constructs a specialized prompt (e.g., forcing JSON output for structured data).
3. The `aiService` calls the selected provider.
4. If the provider is Gemini, it may use a "Thinking" model variant for better creativity.
5. The raw text response is parsed into JSON and displayed as cards.

#### Analysis Chat
1. User opens an idea detail page.
2. The chat component loads the specific conversation history for that idea.
3. When the user sends a message, it is bundled with a system prompt that enforces the "Critical Advisor" persona.
4. The response is saved back to the idea's `chatHistory` in IndexedDB.

---

## Setup & Configuration

### Prerequisites
- Node.js (v18+)

### Installation
1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```

### Configuring AI
Navigate to the **Settings** page in the app:
1. **Gemini**: Enter your Google Gemini API Key.
2. **Ollama**: Ensure Ollama is running (`ollama serve`). The default endpoint `http://localhost:11434` is pre-configured but can be changed if needed. Use a model name you have pulled (e.g., `llama3`).

## Project Structure
- `src/components`: UI building blocks (Cards, Layouts, Chat interface).
- `src/pages`: Top-level route components (Home, Detail, Generator, Settings).
- `src/services`: Core logic for Data and AI.
- `src/types.ts`: TypeScript definitions for Ideas, ChatMessages, and Settings.
