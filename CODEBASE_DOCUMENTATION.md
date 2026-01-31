# Startup Idea Tracker Codebase Documentation

## 1. Overview
The **Startup Idea Tracker** is a Progressive Web App (PWA) designed to help users capture, refine, and generate startup ideas. It leverages local-first storage for privacy and offline capability, and integrates with AI models (Google Gemini and Ollama) to provide creative generation and critical analysis of ideas.

## 2. Technology Stack
- **Frontend Framework**: React 18 with TypeScript.
- **Build Tool**: Vite 5.
- **Routing**: `react-router-dom` (v6).
- **State/Storage**: IndexedDB via the `idb` library (Offline-first architecture).
- **Styling**: Vanilla CSS with a responsive design system, utilizing `clsx` for class management and `lucide-react` for icons. `framer-motion` is used for animations.
- **AI Integration**:
    - **Cloud**: Google Gemini API (`gemini-2.0-flash`, `gemini-2.5-pro`).
    - **Local**: Ollama (e.g., Llama 3).

## 3. Project Structure
The project follows a standard React/Vite structure:

```
src/
├── components/         # Reusable UI components
│   ├── features/       # Feature-specific components (e.g., Chat)
│   ├── Layout.tsx      # Main application wrapper
│   └── ...
├── pages/              # Top-level route components
│   ├── Home.tsx        # Dashboard/Idea list
│   ├── Detail.tsx      # Idea specific view & chat
│   ├── Generator.tsx   # AI Idea generation interface
│   └── Settings.tsx    # App configuration
├── services/           # Business logic and external services
│   ├── db.ts           # IndexedDB wrapper
│   └── ai.ts           # AI provider abstraction
├── types.ts            # TypeScript definitions
├── App.tsx             # Main router configuration
└── main.tsx            # Application entry point
```

## 4. Core Data Models (`src/types.ts`)

### Idea
The central entity of the application.
```typescript
interface Idea {
  id: string;             // UUID
  title: string;
  details: string;        // Main description
  analysis?: string;      // AI analysis summary (optional)
  timestamp: number;      // Creation time
  keywords: string[];     // AI-extracted tags
  chatHistory: ChatMessage[]; // Persisted chat context
  relatedIdeaIds: string[];
}
```

### ChatMessage
Represents a message in the analysis chat.
```typescript
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}
```

### AppSettings
Stores configuration for AI providers.
```typescript
interface AppSettings {
  provider: 'gemini' | 'ollama';
  geminiKey: string;
  ollamaEndpoint: string;
  ollamaModel: string;
}
```

## 5. Key Services

### Database Service (`src/services/db.ts`)
- Wraps `IndexedDB` using the `idb` library.
- Manages the `ideas` object store.
- Provides async methods for `getAllIdeas`, `saveIdea`, `deleteIdea`.
- **Privacy**: Data is stored locally on the user's device.
- **Export/Import**: Supports exporting all data to JSON and importing it back (useful for backups).

### AI Service (`src/services/ai.ts`)
- **Abstraction Layer**: Switches between `gemini` and `ollama` providers based on user settings.
- **Generative AI Methods**:
    - `generateIdeas(prompt)`: Forces JSON output to create structured idea cards.
    - `extractKeywords(idea)`: Analyzes an idea to generate relevant tags.
    - `chat(prompt, history, idea)`: Maintains a "Critical Advisor" persona.
- **Models**:
    - Uses `gemini-2.5-pro` for "thinking" tasks (complex generation) and `gemini-2.0-flash` for faster responses.

## 6. Workflows

### Idea Capture & Storage
1.  User clicks "New Idea" on the Home page.
2.  A new `Idea` object is initialized with a UUID.
3.  User edits details; data is persisted to IndexedDB via `dbService.saveIdea`.
4.  Optionally, the user can trigger "Extract Keywords," which calls `aiService` to populate the `keywords` array.

### AI Idea Generation
1.  Located at `/generate`.
2.  **Standard Mode**: Generates new ideas from scratch based on a topic.
3.  **Combination Mode**: Feeds existing user ideas into the prompt to generate hybrid concepts.
4.  The AI response is parsed from JSON into `GeneratedIdea` objects, which the user can choose to save to their library.

### Analysis Chat
1.  Located at `/idea/:id`.
2.  Loads the specific idea's context and history.
3.  The system prompt instructs the AI to be a "critical startup advisor," challenging assumptions rather than just validating them.
4.  Chat history is updated in the `Idea` object and saved to IndexedDB after every turn.

## 7. Setup & Run
1.  **Install**: `npm install`
2.  **Dev Server**: `npm run dev`
3.  **Build**: `npm run build`
4.  **Configuration**: Go to `/settings` in the app to enter a Gemini API key or configure the local Ollama endpoint.
