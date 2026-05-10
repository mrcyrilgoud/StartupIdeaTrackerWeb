#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const configuredProxyPath = process.env.AI_CLI_PROXY_PATH?.trim();
const proxyPath = path.resolve(projectRoot, configuredProxyPath || '../AI-CLI-Proxy-Server');
const serverEntry = path.join(proxyPath, 'server.js');

function exitWithError(message) {
  console.error(`[dev:proxy] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(proxyPath)) {
  exitWithError(
    `Proxy directory not found at ${proxyPath}. Set AI_CLI_PROXY_PATH to the AI CLI Proxy Server checkout before running npm run dev.`
  );
}

if (!fs.existsSync(serverEntry)) {
  exitWithError(
    `Expected server entry at ${serverEntry}, but it was not found. Confirm AI_CLI_PROXY_PATH points to the AI CLI Proxy Server repo root.`
  );
}

console.log(`[dev:proxy] Starting AI CLI Proxy Server from ${proxyPath}`);

const child = spawn(process.execPath, ['server.js'], {
  cwd: proxyPath,
  env: process.env,
  stdio: 'inherit',
});

let forwardedSignal = null;

function forwardSignal(signal) {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  forwardedSignal = signal;
  child.kill(signal);
}

process.on('SIGINT', () => forwardSignal('SIGINT'));
process.on('SIGTERM', () => forwardSignal('SIGTERM'));
process.on('SIGHUP', () => forwardSignal('SIGHUP'));

child.on('error', (error) => {
  exitWithError(`Failed to start AI CLI Proxy Server: ${error.message}`);
});

child.on('exit', (code, signal) => {
  if (signal) {
    if (signal === forwardedSignal) {
      process.exit(0);
    }

    exitWithError(`AI CLI Proxy Server exited after receiving ${signal}.`);
  }

  if (code && code !== 0) {
    exitWithError(
      `AI CLI Proxy Server exited with code ${code}. Make sure dependencies are installed in ${proxyPath}.`
    );
  }

  process.exit(code ?? 0);
});
