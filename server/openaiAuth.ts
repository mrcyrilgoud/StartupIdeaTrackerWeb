import { execFile as nodeExecFile, spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(nodeExecFile);
export type OpenAiAuthState = 'authenticated' | 'signed_out' | 'pending' | 'unavailable';
export interface OpenAiAuthStatus { state: OpenAiAuthState; message: string; authorizationUrl?: string; }
type Exec = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
type Spawn = (file: string, args: string[]) => ChildProcess;

function defaultExec(file: string, args: string[]) { return execFile(file, args, { timeout: 8_000, windowsHide: true }); }
function defaultSpawn(file: string, args: string[]) { return nodeSpawn(file, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }); }
function findAuthorizationUrl(value: string): string | undefined { return value.match(/https:\/\/[^\s]+/i)?.[0]?.replace(/[),.]+$/, ''); }

/** The official Codex CLI owns its refresh/session credentials. */
export class OpenAiAuthService {
  private loginProcess: ChildProcess | null = null;
  private loginOutput = '';
  constructor(private readonly command = process.env.OPENAI_CLI_PATH?.trim() || 'codex', private readonly run: Exec = defaultExec, private readonly startProcess: Spawn = defaultSpawn) {}

  private async cliStatus(): Promise<'authenticated' | 'signed_out'> {
    const result = await this.run(this.command, ['login', 'status']);
    const output = `${result.stdout}\n${result.stderr}`;
    return !/not logged in|not authenticated|signed out/i.test(output) && /logged in|authenticated/i.test(output) ? 'authenticated' : 'signed_out';
  }

  async status(): Promise<OpenAiAuthStatus> {
    if (this.loginProcess && this.loginProcess.exitCode === null) {
      try {
        if (await this.cliStatus() === 'authenticated') {
          this.loginProcess = null;
          return { state: 'authenticated', message: 'Signed in with OpenAI through Codex.' };
        }
      } catch { /* The login process is still responsible for completing the flow. */ }
      const authorizationUrl = findAuthorizationUrl(this.loginOutput);
      return { state: 'pending', message: 'Complete OpenAI sign-in in the browser opened by Codex.', ...(authorizationUrl ? { authorizationUrl } : {}) };
    }
    try {
      const state = await this.cliStatus();
      return state === 'authenticated'
        ? { state, message: 'Signed in with OpenAI through Codex.' }
        : { state, message: 'OpenAI is not signed in. Start sign-in to use the authenticated Codex connection.' };
    } catch { return { state: 'unavailable', message: 'The Codex CLI is unavailable. Install it and retry.' }; }
  }

  async start(): Promise<OpenAiAuthStatus> {
    const current = await this.status();
    if (current.state === 'authenticated' || current.state === 'pending' || current.state === 'unavailable') return current;
    this.loginOutput = '';
    try {
      const child = this.startProcess(this.command, ['login', '--device-auth']);
      this.loginProcess = child;
      child.stdout?.on('data', chunk => { this.loginOutput += String(chunk).slice(0, 4096); });
      child.on('close', () => { if (this.loginProcess === child) this.loginProcess = null; });
      child.on('error', () => { if (this.loginProcess === child) this.loginProcess = null; });
      return { state: 'pending', message: 'Complete OpenAI sign-in in the browser opened by Codex.' };
    } catch { return { state: 'unavailable', message: 'Unable to start the Codex sign-in flow.' }; }
  }

  async logout(): Promise<OpenAiAuthStatus> {
    if (this.loginProcess && this.loginProcess.exitCode === null) { this.loginProcess.kill(); this.loginProcess = null; }
    try { await this.run(this.command, ['logout']); return { state: 'signed_out', message: 'Signed out of OpenAI in Codex.' }; }
    catch { return { state: 'unavailable', message: 'Unable to sign out of OpenAI through Codex.' }; }
  }
}
