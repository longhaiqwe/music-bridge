#!/usr/bin/env node

import process from 'node:process';

import { ensureBgutilPotServer, hasBgutilServerBuild } from './bgutil-pot-server-utils.mjs';
import {
  TEST_QUERY,
  hasCookieFile,
  isLikelyYoutubeAuthIssue,
  parseCookieScriptArgs,
  runYtDlp,
  summarizeYtDlpOutput,
} from './youtube-cookie-utils.mjs';

const usage = `Usage: npm run youtube:cookies:check -- [--output ./cookies.txt]`;

try {
  const { output, help } = parseCookieScriptArgs(process.argv.slice(2));

  if (help) {
    console.log(usage);
    process.exit(0);
  }

  if (hasBgutilServerBuild()) {
    const server = await ensureBgutilPotServer();
    if (server.status === 'started') {
      console.log(`[YouTube POT] Auto-started bgutil server at ${server.host}:${server.port}`);
    }
  }

  if (!hasCookieFile(output)) {
    console.error(`[YouTube Cookies] Cookies file not found: ${output}`);
    process.exit(1);
  }

  console.log(`[YouTube Cookies] Checking ${output}`);

  const result = runYtDlp([
    '--cookies',
    output,
    '--dump-json',
    '--no-playlist',
    '--ignore-errors',
    TEST_QUERY,
  ]);

  if (result.error) {
    throw result.error;
  }

  const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const summary = summarizeYtDlpOutput(combined);

  if (isLikelyYoutubeAuthIssue(combined)) {
    console.error('[YouTube Cookies] Cookies look invalid or have been rotated by YouTube.');
    if (summary) {
      console.error(summary);
    }
    process.exit(1);
  }

  if ((result.stdout ?? '').trim()) {
    console.log('[YouTube Cookies] Cookies look usable.');
    try {
      const firstLine = (result.stdout ?? '').split(/\r?\n/).find((line) => line.trim());
      if (firstLine) {
        const data = JSON.parse(firstLine);
        const title = typeof data.title === 'string' ? data.title : 'Unknown title';
        const id = typeof data.id === 'string' ? data.id : 'unknown';
        console.log(`[YouTube Cookies] Sample result: ${title} (${id})`);
      }
    } catch {
      if (summary) {
        console.log(summary);
      }
    }
    process.exit(0);
  }

  console.error('[YouTube Cookies] Could not confirm the cookies status.');
  if (summary) {
    console.error(summary);
  }
  process.exit(result.status ?? 1);
} catch (error) {
  console.error('[YouTube Cookies] Check script failed.');
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage);
  process.exit(1);
}
