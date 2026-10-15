// This executable is used only by the isolated browser harness. It never accesses Keychain
// or sends inference/authentication requests to an external provider.
import { createAiRuntime } from '../../server/ai/runtime.js';
import { createHttpApp } from '../../server/app.js';
import { DATABASE_PATH, SERVER_HOST, SERVER_PORT } from '../../server/config.js';
import { AppStore, createSqliteDatabase, initializeSchema } from '../../server/store.js';
import { MemoryCredentialStore } from '../../server/credentials/CredentialStore.js';
import { responseFor } from './mock-proxy.mjs';
const originalFetch = globalThis.fetch;
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.origin === 'https://auth.openai.com') {
        if (url.pathname.endsWith('openid-configuration')) return json({ revocation_endpoint: 'https://auth.openai.com/revoke' });
        if (url.pathname === '/revoke') return new Response('', { status: 200 });
        const params = new URLSearchParams(String(init?.body));
        return json({ access_token: 'E2E-OAUTH-TOKEN', refresh_token: 'E2E-REFRESH-TOKEN', id_token: 'E2E-ID-TOKEN', token_type: 'Bearer', expires_in: 3600,
            scope: params.get('code') === 'identity-only' ? 'openid email profile' : 'openid email profile offline_access resource.invoke chatgpt.tokens.use.direct' });
    }
    if (url.origin === 'https://api.openai.com') {
        if (url.pathname.endsWith('/models')) return json({ models: [{ slug: 'e2e-chatgpt-model', display_name: 'E2E model', visibility: 'list' }] });
        const body = JSON.parse(String(init?.body));
        const text = responseFor(body.input[0].content[0].text, { malformedSummary: false });
        return new Response(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\ndata: ${JSON.stringify({ type: 'response.completed' })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('External requests are prohibited in browser tests');
    return originalFetch(input, init);
};
const sqlite = createSqliteDatabase(DATABASE_PATH); initializeSchema(sqlite);
const store = new AppStore(sqlite);
const { aiService, connections } = await createAiRuntime(store, new MemoryCredentialStore(), {
    openBrowser: async () => {}, verifyIdentity: async () => ({ subject: 'e2e-account', email: 'e2e@example.com' })
});
createHttpApp(store, aiService, connections).listen(SERVER_PORT, SERVER_HOST);
