import assert from 'node:assert/strict';
import test from 'node:test';

const VERBOSE_LOG_ENV = 'MUSIC_BRIDGE_VERBOSE_LOGS';

async function loadLoggingModule(verbose) {
  const previous = process.env[VERBOSE_LOG_ENV];

  if (verbose === undefined) {
    delete process.env[VERBOSE_LOG_ENV];
  } else {
    process.env[VERBOSE_LOG_ENV] = verbose ? 'true' : 'false';
  }

  try {
    const moduleUrl = new URL(
      `./logging.ts?scenario=${verbose === undefined ? 'unset' : String(verbose)}-${Date.now()}-${Math.random()}`,
      import.meta.url
    );

    return await import(moduleUrl.href);
  } finally {
    if (previous === undefined) {
      delete process.env[VERBOSE_LOG_ENV];
    } else {
      process.env[VERBOSE_LOG_ENV] = previous;
    }
  }
}

async function captureConsole(method, fn) {
  const original = console[method];
  const calls = [];

  console[method] = (...args) => {
    calls.push(args);
  };

  try {
    await fn();
  } finally {
    console[method] = original;
  }

  return calls;
}

test('workflow logs remain visible when verbose logging is disabled', async () => {
  const logging = await loadLoggingModule(false);

  assert.equal(typeof logging.workflowLog, 'function');

  const calls = await captureConsole('log', async () => {
    logging.workflowLog('[Song Search] Query: 稻香');
    logging.debugLog('[YoutubeSource] Searching for: 稻香');
  });

  assert.deepEqual(calls, [['[Song Search] Query: 稻香']]);
});

test('debug logs are added only when verbose logging is enabled', async () => {
  const logging = await loadLoggingModule(true);

  assert.equal(typeof logging.workflowLog, 'function');

  const calls = await captureConsole('log', async () => {
    logging.workflowLog('[Upload] Success! Public Match ID: 123');
    logging.debugLog('[YoutubeSource] Top 3 results: ...');
  });

  assert.deepEqual(calls, [
    ['[Upload] Success! Public Match ID: 123'],
    ['[YoutubeSource] Top 3 results: ...'],
  ]);
});
