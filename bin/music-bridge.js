#!/usr/bin/env node

const DEFAULT_BASE_URL = process.env.MUSIC_BRIDGE_BASE_URL || 'http://127.0.0.1:3000';

function printHelp() {
  console.log(`Usage:
  music-bridge search-song <query> [--base-url URL]
  music-bridge search-artist <query> [--cookie COOKIE] [--base-url URL]
  music-bridge sync-song (--file PATH | --json JSON) [--cookie COOKIE] [--wait] [--base-url URL]
  music-bridge sync-artist --artist-name NAME [--artist-id ID] [--count N] [--playlist true|false] [--cookie COOKIE] [--wait] [--base-url URL]
  music-bridge job-status <jobId> [--cookie COOKIE] [--base-url URL]
  music-bridge job-events <jobId> [--since N] [--cookie COOKIE] [--base-url URL]
  music-bridge jobs [--limit N] [--cookie COOKIE] [--base-url URL]

Environment:
  MUSIC_BRIDGE_BASE_URL   Override API base URL
  NETEASE_COOKIE          Default x-netease-cookie value
`);
}

function parseArgs(argv) {
  const positionals = [];
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return { positionals, options };
}

async function request(path, { method = 'GET', body, baseUrl = DEFAULT_BASE_URL, cookie } = {}) {
  const headers = {
    'content-type': 'application/json',
  };
  const authCookie = cookie || process.env.NETEASE_COOKIE;
  if (authCookie) {
    headers['x-netease-cookie'] = authCookie;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error || `${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  return payload;
}

async function waitForJob(jobId, options) {
  while (true) {
    const payload = await request(`/api/jobs/${jobId}`, options);
    if (payload.status === 'succeeded' || payload.status === 'failed' || payload.status === 'cancelled') {
      return payload;
    }

    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
}

function parseBoolean(value, defaultValue) {
  if (value === undefined) return defaultValue;
  if (value === true) return true;
  return value === 'true';
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .trim();
}

async function resolveArtist({ artistId, artistName, baseOptions }) {
  if (artistId && artistName) {
    return { artistId, artistName, resolvedBy: 'explicit' };
  }

  if (!artistName) {
    throw new Error('sync-artist requires --artist-name');
  }

  const results = await request(`/api/artist/search?q=${encodeURIComponent(artistName)}`, baseOptions);
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error(`No artist found for "${artistName}"`);
  }

  const normalizedTarget = normalizeName(artistName);
  const exactMatch =
    results.find((artist) => normalizeName(artist.name) === normalizedTarget) ||
    results.find((artist) => normalizeName(artist.name).includes(normalizedTarget));
  const resolved = exactMatch || results[0];

  if (!resolved?.id || !resolved?.name) {
    throw new Error(`Failed to resolve artist "${artistName}"`);
  }

  if (normalizedTarget !== normalizeName(resolved.name)) {
    console.error(`Resolved artist "${artistName}" to "${resolved.name}" (id: ${resolved.id})`);
  }

  return {
    artistId: resolved.id,
    artistName: resolved.name,
    resolvedBy: 'search',
  };
}

async function main() {
  const { positionals, options } = parseArgs(process.argv.slice(2));
  const command = positionals[0];

  if (!command || command === '--help' || command === 'help') {
    printHelp();
    return;
  }

  const baseOptions = {
    baseUrl: options['base-url'],
    cookie: options.cookie,
  };

  if (command === 'search-song') {
    const query = positionals.slice(1).join(' ').trim();
    if (!query) throw new Error('Missing query');
    const payload = await request(`/api/search?q=${encodeURIComponent(query)}`, baseOptions);
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (command === 'search-artist') {
    const query = positionals.slice(1).join(' ').trim();
    if (!query) throw new Error('Missing query');
    const payload = await request(`/api/artist/search?q=${encodeURIComponent(query)}`, baseOptions);
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (command === 'sync-song') {
    let info;
    if (options.file) {
      const fs = await import('fs/promises');
      info = JSON.parse(await fs.readFile(options.file, 'utf8'));
    } else if (options.json) {
      info = JSON.parse(options.json);
    } else {
      throw new Error('sync-song requires --file or --json');
    }

    const payload = await request('/api/jobs', {
      ...baseOptions,
      method: 'POST',
      body: {
        type: 'sync_song',
        input: {
          info,
        },
      },
    });

    if (options.wait) {
      const result = await waitForJob(payload.jobId, baseOptions);
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.status === 'succeeded' ? 0 : 1;
      return;
    }

    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (command === 'sync-artist') {
    const artistId = options['artist-id'];
    const artistName = options['artist-name'];
    const resolvedArtist = await resolveArtist({ artistId, artistName, baseOptions });

    const payload = await request('/api/jobs', {
      ...baseOptions,
      method: 'POST',
      body: {
        type: 'sync_artist',
        input: {
          artistId: resolvedArtist.artistId,
          artistName: resolvedArtist.artistName,
          count: Number(options.count || 10),
          createPlaylist: parseBoolean(options.playlist, true),
        },
      },
    });

    if (options.wait) {
      const result = await waitForJob(payload.jobId, baseOptions);
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.status === 'succeeded' ? 0 : 1;
      return;
    }

    console.log(
      JSON.stringify(
        {
          ...payload,
          artistId: resolvedArtist.artistId,
          artistName: resolvedArtist.artistName,
        },
        null,
        2
      )
    );
    return;
  }

  if (command === 'job-status') {
    const jobId = positionals[1];
    if (!jobId) throw new Error('Missing jobId');
    const payload = await request(`/api/jobs/${jobId}`, baseOptions);
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (command === 'job-events') {
    const jobId = positionals[1];
    if (!jobId) throw new Error('Missing jobId');
    const since = Number(options.since || 0);
    const payload = await request(`/api/jobs/${jobId}/events?since=${since}`, baseOptions);
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (command === 'jobs') {
    const limit = Number(options.limit || 20);
    const payload = await request(`/api/jobs?limit=${limit}`, baseOptions);
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
