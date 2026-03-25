#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const [, , command, ...args] = process.argv;

if (!command) {
  console.error('Usage: node ./scripts/run-with-node-options.mjs <command> [...args]');
  process.exit(1);
}

function resolveCommand(bin) {
  if (bin === 'next') {
    const filename = process.platform === 'win32' ? 'next.cmd' : 'next';
    return path.join(process.cwd(), 'node_modules', '.bin', filename);
  }

  if (bin === 'node') {
    return process.execPath;
  }

  return bin;
}

const shouldSuppressExperimentalWarnings = process.env.MUSIC_BRIDGE_SHOW_EXPERIMENTAL_WARNINGS !== 'true';
const extraNodeOptions = shouldSuppressExperimentalWarnings ? ['--disable-warning=ExperimentalWarning'] : [];
const currentNodeOptions = process.env.NODE_OPTIONS?.trim() ?? '';
const mergedNodeOptions = [...extraNodeOptions, currentNodeOptions].filter(Boolean).join(' ');

const child = spawn(resolveCommand(command), args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_OPTIONS: mergedNodeOptions,
  },
});

child.on('error', (error) => {
  console.error(`[run-with-node-options] Failed to start ${command}:`, error.message);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
