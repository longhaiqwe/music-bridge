import assert from 'node:assert/strict';
import test from 'node:test';

async function loadAuthModule(label) {
  const moduleUrl = new URL(`./youtube-auth.ts?scenario=${label}-${Date.now()}-${Math.random()}`, import.meta.url);
  return import(moduleUrl.href);
}

test('browser auth ignores legacy file and JSON cookie settings', async () => {
  const { resolveYoutubeCookieAuth } = await loadAuthModule('browser');

  const auth = resolveYoutubeCookieAuth({
    YOUTUBE_COOKIE_FILE: '/tmp/cookies.txt',
    YOUTUBE_COOKIES: '[{\"name\":\"SID\"}]',
    YOUTUBE_COOKIES_BROWSER: 'chrome:Profile 2',
    YOUTUBE_COOKIES_FROM_BROWSER: 'true',
  });

  assert.deepEqual(auth, {
    args: ['--cookies-from-browser', 'chrome:Profile 2'],
    source: 'browser',
    description: 'browser cookies (chrome:Profile 2)',
  });
});

test('auth falls back to anonymous mode only when browser cookies are disabled', async () => {
  const { resolveYoutubeCookieAuth } = await loadAuthModule('anonymous');

  const auth = resolveYoutubeCookieAuth({
    YOUTUBE_COOKIES_FROM_BROWSER: 'false',
    YOUTUBE_COOKIES_BROWSER: 'chrome:Profile 2',
  });

  assert.deepEqual(auth, {
    args: [],
    source: 'none',
    description: 'anonymous session',
  });
});
