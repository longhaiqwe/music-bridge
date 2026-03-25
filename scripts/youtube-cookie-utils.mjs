import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

export const DEFAULT_BROWSER = process.env.YOUTUBE_COOKIES_BROWSER?.trim() || 'chrome';
export const DEFAULT_OUTPUT = path.resolve(process.env.YOUTUBE_COOKIE_FILE?.trim() || path.join(process.cwd(), 'cookies.txt'));
export const TEST_QUERY = 'ytsearch1:周杰伦 稻香';

export function parseCookieScriptArgs(argv) {
  const parsed = {
    browser: DEFAULT_BROWSER,
    output: DEFAULT_OUTPUT,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }

    if (arg === '--browser') {
      parsed.browser = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith('--browser=')) {
      parsed.browser = arg.slice('--browser='.length);
      continue;
    }

    if (arg === '--output') {
      parsed.output = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith('--output=')) {
      parsed.output = path.resolve(arg.slice('--output='.length));
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!parsed.browser) {
    throw new Error('Browser name is required.');
  }

  if (!parsed.output) {
    throw new Error('Output path is required.');
  }

  return parsed;
}

export function ensureParentDir(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

export function hasCookieFile(filePath) {
  try {
    return existsSync(filePath) && statSync(filePath).size > 0;
  } catch {
    return false;
  }
}

export function runYtDlp(args) {
  return spawnSync('yt-dlp', args, {
    encoding: 'utf8',
  });
}

export function formatShellValue(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function summarizeYtDlpOutput(output, maxLines = 8) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= maxLines) {
    return lines.join('\n');
  }

  return lines.slice(-maxLines).join('\n');
}

export function isLikelyYoutubeAuthIssue(output) {
  const haystack = output.toLowerCase();
  return [
    'provided youtube account cookies are no longer valid',
    'sign in to confirm you’re not a bot',
    "sign in to confirm you're not a bot",
    'the page needs to be reloaded',
    'po token',
  ].some((pattern) => haystack.includes(pattern));
}
