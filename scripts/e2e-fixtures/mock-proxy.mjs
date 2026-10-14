import http from 'node:http';
export const brainstorm = 'E2E brainstorming response: focus on a small customer workflow.';
export const chat = 'E2E streamed advisor response completed.';
export const rawSummary = 'E2E malformed summary preserved for review.';
export const summary = { title: 'E2E Brainstorm Idea', details: 'A concrete workflow extracted from the brainstorming conversation.' };
export function responseFor(prompt, state) {
  if (prompt === 'Reply with only OK.') return 'OK';
  if (prompt.includes('Strictly output a valid JSON object with:')) return state.malformedSummary ? rawSummary : JSON.stringify(summary);
  if (prompt.includes('extract 5 key conceptually relevant keywords')) return 'workflow, customer, startup, validation, productivity';
  // History snapshots contain ideaId keys too; route by operation before examining JSON keys.
  if (prompt.includes('summarizing how a startup idea evolved')) return '# Idea evolution\n\n## What changed\nE2E history records edits and advisor conversations.\n\n## Current state\nReady for customer validation.';
  const ids = [...prompt.matchAll(/^ID: (.+)$/gm)].map(match => match[1].trim());
  if (prompt.includes('"ideaIds"')) {
    if (!ids.length) throw new Error('Folder prompt missing IDs');
    return JSON.stringify([{ name: 'E2E Smart Folder', description: 'Focused workflows', ideaIds: ids }]);
  }
  if (prompt.includes('"ideaId"')) {
    if (!ids.length) throw new Error('Score prompt missing IDs');
    return JSON.stringify(ids.map((ideaId, i) => ({ ideaId, score: Math.max(1, 9 - i), reason: `E2E score for existing idea ${i + 1}.` })));
  }
  if (prompt.includes('"title"') && prompt.includes('"details"') && prompt.includes('JSON array')) {
    const prefix = prompt.includes('hybrid startup ideas') ? 'Hybrid' : 'Generated';
    return JSON.stringify(['Alpha', 'Beta', 'Gamma'].map(name => ({ title: `E2E ${prefix} ${name}`, details: `A viable ${prefix.toLowerCase()} workflow for ${name}.` })));
  }
  if (prompt.includes('business viability report')) return '# Business Viability Report\n\n## Executive Summary\nE2E viability report.\n\n## Business Model Analysis\nSubscription revenue supports the workflow.\n\n## Final Verdict\nMedium potential; validate willingness to pay.';
  if (prompt.includes('Competitor Analysis Report')) return '# Competitor Analysis Report\n\n## Market Landscape Overview\nE2E competitor report.\n\n## SWOT Analysis\nStrength: focus. Weakness: distribution.\n\n## Final Strategic Recommendation\nEnter with focused differentiation.';
  if (prompt.includes('critical, experienced startup advisor')) return chat;
  if (prompt.includes('creative and helpful startup co-founder')) return brainstorm;
  throw new Error(`Unrecognized mock prompt: ${prompt.slice(0, 200)}`);
}
export async function startMockProxy() {
  const state = { malformedSummary: false, failNext: false, requests: [], errors: [], cancelledStreams: 0 };
  const server = http.createServer(async (req, res) => {
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method === 'GET' && req.url === '/api/tools') return json(200, { defaultTool: 'codex', tools: ['codex'], toolDetails: [{ id: 'codex', available: true, capabilities: { streaming: true, model: true, image: false }, authenticationStatus: 'authenticated', authenticationInstructions: 'E2E mock requires no credentials.' }] });
    if (req.method !== 'POST' || !['/api/low-level', '/api/low-level-stream'].includes(req.url)) return json(404, { error: 'Unknown mock route' });
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw); state.requests.push({ route: req.url, ...body });
      if (body.tool !== 'codex') throw new Error('Expected explicit codex tool');
      if (state.failNext) { state.failNext = false; return json(503, { error: 'E2E injected provider failure' }); }
      const text = responseFor(body.prompt, state);
      if (req.url === '/api/low-level') return json(200, { response: text });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      const repeat = /User: Repeat delta fragments exactly\.\s*$/.test(body.prompt);
      const held = /User: Hold stream for cancellation\.\s*$/.test(body.prompt);
      const chunks = repeat ? ['ha', 'ha'] : held ? ['E2E pending cancellation '] : text.match(/.{1,28}/gs);
      let index = 0;
      const send = () => { if (index < chunks.length) res.write(`data: ${JSON.stringify({ response: chunks[index++], streamMode: 'delta' })}\n\n`); else if (!held) { clearInterval(timer); res.end(); } };
      // Provider timing fixture; browser tests wait on observable state instead of sleeping.
      const timer = setInterval(send, 50); send();
      res.on('close', () => { clearInterval(timer); if (held && !res.writableEnded) state.cancelledStreams++; });
    } catch (error) { state.errors.push(error.message); json(500, { error: error.message }); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { state, url: `http://127.0.0.1:${server.address().port}`, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
