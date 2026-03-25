#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const version = (process.env.BGUTIL_POT_PROVIDER_VERSION || '1.3.1').trim();
const repoDir = path.join(os.homedir(), 'bgutil-ytdlp-pot-provider');
const serverDir = path.join(repoDir, 'server');
const pluginDir = path.join(os.homedir(), '.config', 'yt-dlp', 'plugins');
const pluginZipPath = path.join(pluginDir, 'bgutil-ytdlp-pot-provider.zip');
const pluginZipUrl = `https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/download/${version}/bgutil-ytdlp-pot-provider.zip`;

function run(command, args, options = {}) {
  execFileSync(command, args, {
    stdio: 'inherit',
    ...options,
  });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function repoExists(dir) {
  return fs.existsSync(path.join(dir, '.git'));
}

try {
  console.log(`[YouTube POT] Installing bgutil provider ${version}`);

  ensureDir(pluginDir);
  run('curl', ['-L', '--fail', pluginZipUrl, '-o', pluginZipPath]);

  if (!repoExists(repoDir)) {
    run('git', ['clone', '--single-branch', '--branch', version, 'https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git', repoDir]);
  } else {
    run('git', ['-C', repoDir, 'fetch', '--tags', 'origin']);
    run('git', ['-C', repoDir, 'checkout', version]);
  }

  run('npm', ['ci'], { cwd: serverDir });
  run('npx', ['tsc'], { cwd: serverDir });

  console.log('[YouTube POT] Installed successfully.');
  console.log(`Plugin ZIP: ${pluginZipPath}`);
  console.log(`Provider repo: ${repoDir}`);
  console.log('Next steps:');
  console.log('1. Restart the app if it is already running.');
  console.log('2. Run npm run youtube:pot:doctor');
  console.log('3. Use npm run youtube:pot:server only if you want to inspect provider logs manually.');
} catch (error) {
  console.error('[YouTube POT] Install failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
