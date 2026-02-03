import { AppSettings, Idea, ChatMessage } from '../types';

export interface GeneratedIdea {
    title: string;
    details: string;
}

export interface MVPAnalysisResult {
    ideaId: string;
    reason: string;
}

export const aiService = {
    async generateResponse(prompt: string, settings: AppSettings, thinking: boolean = false, jsonMode: boolean = false): Promise<string> {
        if (settings.provider === 'gemini') {
            return this.generateGemini(prompt, settings.geminiKey, thinking, jsonMode);
        } else {
            return this.generateOllama(prompt, settings, jsonMode);
        }
    },

    async generateGemini(prompt: string, apiKey: string, thinking: boolean = false, jsonMode: boolean = false): Promise<string> {
        // Use thinking model if requested, otherwise standard verified model
        const model = thinking ? 'gemini-2.5-pro' : 'gemini-2.0-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const body: any = {
            contents: [{ parts: [{ text: prompt }] }]
        };

        if (jsonMode) {
            body.generationConfig = { responseMimeType: "application/json" };
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error?.message || `Gemini API Error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    },

    async generateOllama(prompt: string, settings: AppSettings, jsonMode: boolean = false): Promise<string> {
        const url = `${settings.ollamaEndpoint}/api/generate`;
        const body: any = {
            model: settings.ollamaModel,
            prompt: prompt,
            stream: false
        };

        if (jsonMode) {
            body.format = "json";
        }

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

        const responseText = await this.generateResponse(jsonPrompt, settings, true, true); // Use thinking/smart model + jsonMode

        try {
            // Find the first '[' and last ']' to extract valid JSON array
            // Even with jsonMode, robustness in parsing is good
            const firstBracket = responseText.indexOf('[');
            const lastBracket = responseText.lastIndexOf(']');

            if (firstBracket === -1 || lastBracket === -1 || firstBracket > lastBracket) {
                // Fallback if strict JSON mode returned just the object without array wrapper (unlikely but possible)
                throw new Error("No JSON array found in response");
            }

            const jsonCandidate = responseText.substring(firstBracket, lastBracket + 1);
            return JSON.parse(jsonCandidate);
        } catch (e) {
            console.error("Failed to parse AI response as JSON", responseText);
            throw new Error("AI response was not valid JSON");
        }
    },

    async findSimplestMVP(ideas: Idea[], settings: AppSettings): Promise<MVPAnalysisResult> {
        const ideasContext = ideas.map(idea => `ID: ${idea.id}\nTitle: ${idea.title}\nDetails: ${idea.details}`).join('\n\n');

        const prompt = `
        Analyze the following startup ideas and identify which one would be the SIMPLEST to build a Minimum Viable Product (MVP) for.
        Consider technical complexity, resource requirements, and time-to-market.

        Ideas:
        ${ideasContext}

        Strictly output the result as a valid JSON object with the following keys:
        - "ideaId": The ID of the simplest idea.
        - "reason": A concise explanation of why this is the simplest MVP.

        Do NOT include any markdown formatting or code fences (like \`\`\`json). Return ONLY the raw JSON object.
        `;

        const responseText = await this.generateResponse(prompt, settings, true, true); // Use thinking + jsonMode

        try {
            const firstBrace = responseText.indexOf('{');
            const lastBrace = responseText.lastIndexOf('}');

            if (firstBrace === -1 || lastBrace === -1 || firstBrace > lastBrace) {
                throw new Error("No JSON object found in response");
            }

            const jsonCandidate = responseText.substring(firstBrace, lastBrace + 1);
            return JSON.parse(jsonCandidate);
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

        const response = await this.generateResponse(prompt, settings, true); // Use thinking model
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

        return this.generateResponse(fullContext, settings, true); // Use thinking model for better advice
    },

    async generateViabilityReport(idea: Idea, settings: AppSettings): Promise<string> {
        const prompt = `
You are a seasoned business analyst and market strategist. Your task is to critically examine the business viability of the following startup idea. Be thorough, objective, and brutally honest.

**Idea Title:** ${idea.title}
**Idea Details:** ${idea.details}

Generate a comprehensive business viability report with the following structure. Use Markdown formatting with headers.

# Business Viability Report: ${idea.title}

## Executive Summary
Provide a brief 2-3 sentence overview of your assessment.

## Business Model Analysis
Critically examine:
- The proposed value proposition and its uniqueness
- Revenue model feasibility
- Cost structure assumptions
- Key risks in the business model

## Current Competitive Landscape
Analyze:
- Direct competitors currently operating in this space
- Indirect competitors and alternative solutions
- Competitive advantages and disadvantages
- Market positioning challenges

## Future Competition Threats
Examine:
- Potential future entrants (startups, big tech, incumbents)
- Technology shifts that could disrupt this space
- Barriers to entry for new competitors

## Market Analysis
Examine major market features:
- Total Addressable Market (TAM) estimate
- Market growth trends
- Customer segments and their needs
- Regulatory and legal considerations
- Geographic considerations

## Improvement Recommendations
Provide specific, actionable suggestions:
- How to strengthen the competitive position
- Features or pivots that could improve market fit
- Partnership or acquisition opportunities

## Niche Opportunities
Explore underserved market segments:
- Niches where major players don't or won't operate
- Regional opportunities
- Specialized customer segments
- Blue ocean strategies

## Final Verdict
Provide an honest assessment with a viability rating (Low/Medium/High) and your top 3 recommendations for next steps.

Be specific, cite examples of real competitors when possible, and provide actionable insights.
`;

        // Use thinking model for deeper analysis
        return this.generateResponse(prompt, settings, true, false);
    },

    async analyzeCompetitors(idea: Idea, settings: AppSettings): Promise<string> {
        const prompt = `
You are a strategic business consultant specializing in competitive intelligence. Your task is to perform a deep-dive competitor analysis for the following startup idea.

**Idea Title:** ${idea.title}
**Idea Details:** ${idea.details}

Generate a comprehensive Competitor Analysis Report in Markdown format. Be specific, naming real companies where possible, or describing exact categories of existing solutions.

# Competitor Analysis: ${idea.title}

## Market Landscape Overview
Briefly describe the current state of the market this idea is entering (e.g., "Fragmented," "Winner-take-all," "Emerging," "Saturated").

## Direct Competitors
Identify 3-5 existing companies or products that solve the exact same problem for the same customer. For each:
- **Name:** (Real company name if known, or "Generic [Solution Type]")
- **Strengths:** What they do well.
- **Weaknesses:** Where they fall short.
- **Threat Level:** (High/Medium/Low)

## Indirect Competitors
Identify alternative ways users currently solve this problem (e.g., spreadsheets, manual processes, hiring a human, hacking together other tools).

## SWOT Analysis (Relative to Competitors)
- **Strengths:** What unique advantages does this idea have?
- **Weaknesses:** Where is it vulnerable?
- **Opportunities:** What market gaps are competitors missing?
- **Threats:** What external factors or competitor moves could kill this idea?

## Differentiation Strategy
Propose specific "Blue Ocean" moves or features that would make the competition irrelevant. How can this idea distinguish itself immediately?

## Final Strategic Recommendation
A concluding paragraph on the best path to enter the market.
`;

        // Use thinking model for deeper analysis
        return this.generateResponse(prompt, settings, true, false);
    },

    async brainstorm(prompt: string, history: ChatMessage[], settings: AppSettings): Promise<string> {
        const historyTranscript = history.map(msg =>
            `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`
        ).join('\n');

        const fullContext = `
      You are a creative and helpful startup co-founder. You are having a casual brainstorming session with the user to come up with new startup ideas or refine loose thoughts.

      Goals:
      1. Encourage creativity.
      2. Ask probing questions to help define the problem and solution.
      3. Suggest interesting angles or pivots.
      4. Be concise and conversational.
      
      Previous conversation:
      ${historyTranscript}
      
      User: ${prompt}
      
      Reply directly to the user's last message.
      `;

        return this.generateResponse(fullContext, settings, true);
    },

    async summarizeIdeaFromChat(history: ChatMessage[], settings: AppSettings): Promise<GeneratedIdea> {
        const historyTranscript = history.map(msg =>
            `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`
        ).join('\n');

        const prompt = `
        Analyze the following brainstorming conversation and extract a concrete startup idea.
        
        Conversation:
        ${historyTranscript}
        
        Strictly output the result as a valid JSON object with the following keys:
        - "title": A catchy, concise title for the idea.
        - "details": A comprehensive description of the idea, capturing the problem, solution, and key features discussed.
        
        Do NOT include any markdown formatting or code fences (like \`\`\`json). Return ONLY the raw JSON object.
        `;

        const responseText = await this.generateResponse(prompt, settings, true, true);

        try {
            const firstBrace = responseText.indexOf('{');
            const lastBrace = responseText.lastIndexOf('}');

            if (firstBrace === -1 || lastBrace === -1 || firstBrace > lastBrace) {
                throw new Error("No JSON object found in response");
            }

            const jsonCandidate = responseText.substring(firstBrace, lastBrace + 1);
            return JSON.parse(jsonCandidate);
        } catch (e) {
            console.error("Failed to parse AI response as JSON", responseText);
            // Fallback
            return {
                title: "New Idea from Chat",
                details: "Details could not be automatically generated. Please review the chat history."
            };
        }
    }
};
