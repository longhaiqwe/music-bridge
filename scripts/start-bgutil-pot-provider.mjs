#!/usr/bin/env node

import process from 'node:process';
import { spawn } from 'node:child_process';

import { getBgutilServerConfig, hasBgutilServerBuild, isBgutilServerReachable } from './bgutil-pot-server-utils.mjs';
const config = getBgutilServerConfig();

if (!hasBgutilServerBuild()) {
  console.error('[YouTube POT] Provider server build not found.');
  console.error('Run `npm run youtube:pot:install` first.');
  process.exit(1);
}

if (await isBgutilServerReachable(config.host, config.port)) {
  console.log(`[YouTube POT] bgutil server is already running at ${config.host}:${config.port}`);
  process.exit(0);
}

try {
  const child = spawn('node', [config.entry, '--port', String(config.port)], {
    stdio: 'inherit',
  });

  child.on('error', (error) => {
    console.error('[YouTube POT] Failed to start server.');
    console.error(error.message);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 1);
  });
} catch {
  process.exit(1);
}
