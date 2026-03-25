#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { ensureBgutilPotServer } from './bgutil-pot-server-utils.mjs';

const cookieFile = path.resolve(process.env.YOUTUBE_COOKIE_FILE?.trim() || path.join(process.cwd(), 'cookies.txt'));
const providerRepo = path.join(os.homedir(), 'bgutil-ytdlp-pot-provider');
const providerBuild = path.join(providerRepo, 'server', 'build', 'main.js');
const providerZip = path.join(os.homedir(), '.config', 'yt-dlp', 'plugins', 'bgutil-ytdlp-pot-provider.zip');
const recommendedExtractorArgs = 'youtube:player_client=mweb';

function runCapture(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function captureAll(command, args) {
  try {
    return runCapture(command, args);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'stdout' in error && 'stderr' in error) {
      const stdout = typeof error.stdout === 'string' ? error.stdout : '';
      const stderr = typeof error.stderr === 'string' ? error.stderr : '';
      return `${stdout}\n${stderr}`;
    }
    throw error;
  }
}

function getProxySummary(verboseOutput) {
    const proxyVars = [
        ['HTTPS_PROXY', process.env.HTTPS_PROXY || process.env.https_proxy],
        ['HTTP_PROXY', process.env.HTTP_PROXY || process.env.http_proxy],
        ['ALL_PROXY', process.env.ALL_PROXY || process.env.all_proxy],
    ].filter(([, value]) => value);

    if (proxyVars.length > 0) {
        return proxyVars.map(([name, value]) => `${name}=${value}`).join(', ');
    }

    const proxyMapMatch = verboseOutput.match(/\[debug\] Proxy map: (.+)/);
    if (proxyMapMatch) {
        return proxyMapMatch[1];
    }

    return null;
}

function hasAuthFailure(text) {
  return [
    'the page needs to be reloaded',
    'sign in to confirm you’re not a bot',
    "sign in to confirm you're not a bot",
    'provided youtube account cookies are no longer valid',
  ].some((pattern) => text.toLowerCase().includes(pattern));
}

function hasProvider(text) {
  return text.includes('PO Token Providers: bgutil:http') || text.includes('PO Token Providers: bgutil:script-node');
}

try {
  console.log('[YouTube POT] Doctor starting...');
  const server = await ensureBgutilPotServer();
  if (server.status === 'started') {
    console.log(`[YouTube POT] Auto-started bgutil server at ${server.host}:${server.port}`);
  }
  console.log(`Plugin ZIP: ${fs.existsSync(providerZip) ? 'present' : 'missing'} (${providerZip})`);
  console.log(`Provider build: ${fs.existsSync(providerBuild) ? 'present' : 'missing'} (${providerBuild})`);
  console.log(`Cookies file: ${fs.existsSync(cookieFile) ? 'present' : 'missing'} (${cookieFile})`);

  const verboseOutput = captureAll('yt-dlp', ['-v', '--ignore-config', '--simulate', '--skip-download', 'https://www.youtube.com/watch?v=BaW_jenozKcj']);
  if (hasProvider(verboseOutput)) {
    console.log('[YouTube POT] bgutil provider is loaded by yt-dlp.');
  } else {
    console.error('[YouTube POT] bgutil provider is not visible in yt-dlp verbose output.');
    process.exit(1);
  }

  const proxySummary = getProxySummary(verboseOutput);
  if (proxySummary) {
    console.log(`[YouTube POT] Proxy env detected: ${proxySummary}`);
  } else {
    console.log('[YouTube POT] No proxy env detected.');
  }

  if (!fs.existsSync(cookieFile)) {
    console.warn('[YouTube POT] Cookies file is missing, skipping auth check.');
    process.exit(0);
  }

  const searchOutput = captureAll('yt-dlp', [
    '--cookies',
    cookieFile,
    '--extractor-args',
    recommendedExtractorArgs,
    '--dump-json',
    '--no-playlist',
    'ytsearch1:周杰伦 稻香',
  ]);

  if (hasAuthFailure(searchOutput)) {
    console.error('[YouTube POT] Provider is installed, but YouTube auth still fails on the current network/session.');
    console.error('[YouTube POT] If you are not already running the bgutil HTTP server, start it with `npm run youtube:pot:server` and try again.');
    if (proxySummary) {
      console.error('[YouTube POT] Most likely the current proxy exit IP is being challenged by YouTube. Try another node first.');
    } else {
      console.error('[YouTube POT] Refresh cookies or try a different network egress.');
    }
    console.error(searchOutput.split(/\r?\n/).filter(Boolean).slice(-6).join('\n'));
    process.exit(1);
  }

  console.log('[YouTube POT] Search check passed.');
  process.exit(0);
} catch (error) {
  console.error('[YouTube POT] Doctor failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
