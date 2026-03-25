#!/usr/bin/env node

import process from 'node:process';

import { ensureBgutilPotServer, hasBgutilServerBuild } from './bgutil-pot-server-utils.mjs';
import {
  TEST_QUERY,
  ensureParentDir,
  formatShellValue,
  hasCookieFile,
  isLikelyYoutubeAuthIssue,
  parseCookieScriptArgs,
  runYtDlp,
  summarizeYtDlpOutput,
} from './youtube-cookie-utils.mjs';

const usage = `Usage: npm run youtube:cookies:export -- [--browser chrome] [--output ./cookies.txt]`;

try {
  const { browser, output, help } = parseCookieScriptArgs(process.argv.slice(2));

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

  ensureParentDir(output);

  console.log(`[YouTube Cookies] Exporting cookies from ${browser} to ${output}`);

  const result = runYtDlp([
    '--cookies-from-browser',
    browser,
    '--cookies',
    output,
    '--ignore-errors',
    '--skip-download',
    TEST_QUERY,
  ]);

  if (result.error) {
    throw result.error;
  }

  if (!hasCookieFile(output)) {
    const summary = summarizeYtDlpOutput(`${result.stdout ?? ''}\n${result.stderr ?? ''}`) || 'yt-dlp did not produce a cookies file.';
    console.error('[YouTube Cookies] Export failed.');
    console.error(summary);
    process.exit(result.status ?? 1);
  }

  const summary = summarizeYtDlpOutput(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  if (summary) {
    console.log(summary);
  }

  if (isLikelyYoutubeAuthIssue(summary)) {
    console.warn('[YouTube Cookies] Cookies file was exported, but the current YouTube session still looks unstable. Run the check command below to confirm.');
  }

  console.log('[YouTube Cookies] Exported successfully.');
  console.log(`export YOUTUBE_COOKIE_FILE=${formatShellValue(output)}`);
  console.log('export YOUTUBE_COOKIES_FROM_BROWSER=false');
  console.log(`npm run youtube:cookies:check -- --output ${formatShellValue(output)}`);
} catch (error) {
  console.error('[YouTube Cookies] Export script failed.');
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage);
  process.exit(1);
}
