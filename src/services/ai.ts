import { AppSettings, Idea, ChatMessage } from '../types';

export interface GeneratedIdea {
    title: string;
    details: string;
}


export const aiService = {
    async generateResponse(prompt: String, settings: AppSettings, thinking: boolean = false): Promise<string> {
        if (settings.provider === 'gemini') {
            return this.generateGemini(prompt, settings.geminiKey, thinking);
        } else {
            return this.generateOllama(prompt, settings);
        }
    },

    async generateGemini(prompt: String, apiKey: string, thinking: boolean = false): Promise<string> {
        // Use thinking model if requested, otherwise standard verified model
        const model = thinking ? 'gemini-2.0-flash-exp' : 'gemini-flash-latest';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const body = {
            contents: [{ parts: [{ text: prompt }] }]
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error?.message || 'Gemini API Error');
        }

        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    },

    async generateOllama(prompt: String, settings: AppSettings): Promise<string> {
        const url = `${settings.ollamaEndpoint}/api/generate`;
        const body = {
            model: settings.ollamaModel,
            prompt: prompt,
            stream: false
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) throw new Error('Ollama API Error');

        const data = await response.json();
        return data.response;
    },

    async generateIdeas(prompt: string, settings: AppSettings): Promise<GeneratedIdea[]> {
        const jsonPrompt = `
        ${prompt}
        
        Strictly output the result as a valid JSON array of objects, where each object has the following keys:
        - "title": The title of the idea.
        - "details": A short description of the idea.
        
        Do NOT include any markdown formatting or code fences (like \`\`\`json). Return ONLY the raw JSON array.
        `;

        const responseText = await this.generateResponse(jsonPrompt, settings, true); // Use thinking/smart model

        try {
            // Cleanup in case the model adds markdown despite instructions
            const cleaned = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(cleaned);
        } catch (e) {
            console.error("Failed to parse AI response as JSON", responseText);
            throw new Error("AI response was not valid JSON");
        }
    },

    // High-level methods
    async extractKeywords(idea: Idea, settings: AppSettings): Promise<string[]> {
        const prompt = `
      Analyze the following startup idea and extract 5 key conceptually relevant keywords.
      Return ONLY the keywords separated by commas.
      
      Title: ${idea.title}
      Details: ${idea.details}
      `;

        const response = await this.generateResponse(prompt, settings);
        return response.split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
    },

    async chat(prompt: string, history: ChatMessage[], contextIdea: Idea, settings: AppSettings): Promise<string> {
        const historyTranscript = history.map(msg =>
            `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`
        ).join('\n');

        const fullContext = `
      You are a critical, experienced startup advisor analyzing the idea: "${contextIdea.title}".
      Details: ${contextIdea.details}

      Your goal is to help the user refine their idea by identifying risks, challenging assumptions, and offering objective feedback. 
      Do NOT be sycophantic or blindly agreeable. Be honest about feasibility and potential market challenges.
      
      Previous conversation:
      ${historyTranscript}
      
      User: ${prompt}
      
      Reply directly to the user's last message, maintaining the context of the startup idea.
      `;

        return this.generateResponse(fullContext, settings);
    }
};
