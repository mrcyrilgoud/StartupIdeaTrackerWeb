import jsonServer from 'json-server';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const server = jsonServer.create();
const router = jsonServer.router(path.join(__dirname, 'data/db.json'));
const middlewares = jsonServer.defaults();

server.use(middlewares);
server.use(jsonServer.bodyParser);

// Custom endpoint to create project and launch agent
server.post('/api/create-project', (req, res) => {
    const { path: parentPath, projectName, prompt, editorCommand, agentCommand } = req.body;

    if (!parentPath || !projectName || !prompt) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const fullPath = path.join(parentPath, projectName);

    try {
        // 1. Create Directory
        if (!fs.existsSync(fullPath)) {
            fs.mkdirSync(fullPath, { recursive: true });
        } else {
            // Optional: Check if empty or error? For now, we allow appending to existing folders
            console.log(`Directory ${fullPath} already exists.`);
        }

        // 2. Write PROMPT.md
        fs.writeFileSync(path.join(fullPath, 'PROMPT.md'), prompt);

        // 3. Initialize package.json if it doesn't exist (for Loop verification)
        if (!fs.existsSync(path.join(fullPath, 'package.json'))) {
            try {
                execSync('npm init -y', { cwd: fullPath });
            } catch (e) {
                console.error(`Error initializing npm: ${e}`);
            }
        }

        // 4. Launch Editor
        const effectiveEditorCommand = editorCommand || 'cursor';
        exec(`${effectiveEditorCommand} "${fullPath}"`, (error) => {
            if (error) {
                console.error(`Error launching editor: ${error}`);
            }
        });

        // 5. Spawn Agent (if requested)
        if (agentCommand) {
            // We use osascript to open a new Terminal window on macOS so the agent is visible/interactive
            // Escape double quotes for AppleScript
            const escapedCommand = `${agentCommand}`.replace(/"/g, '\\"');
            const safePath = fullPath.replace(/"/g, '\\"');

            const appleScript = `
                tell application "Terminal"
                    do script "cd \\"${safePath}\\" && ${escapedCommand}"
                    activate
                end tell
            `;

            exec(`osascript -e '${appleScript}'`, (error) => {
                if (error) {
                    console.error(`Error spawning agent terminal: ${error}`);
                }
            });
        }

        res.json({ success: true, path: fullPath });

    } catch (err) {
        console.error('Error creating project:', err);
        res.status(500).json({ error: err.message });
    }
});

server.get('/api/select-folder', (req, res) => {
    const appleScript = `
        set folderPath to POSIX path of (choose folder with prompt "Select the base directory for your projects")
        return folderPath
    `;

    exec(`osascript -e '${appleScript}'`, (error, stdout, stderr) => {
        if (error) {
            // User likely cancelled
            console.error('Folder selection cancelled or failed:', stderr);
            return res.json({ cancelled: true });
        }
        res.json({ path: stdout.trim() });
    });
});

// Mount json-server router
server.use(router);

const PORT = 3001;
server.listen(PORT, () => {
    console.log(`JSON Server is running on port ${PORT}`);
    console.log(`Custom API available at http://localhost:${PORT}/api/create-project`);
});
