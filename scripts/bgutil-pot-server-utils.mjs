import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

const DEFAULT_HOST = process.env.YOUTUBE_POT_SERVER_HOST?.trim() || '127.0.0.1';
const DEFAULT_PORT = Number.parseInt(process.env.YOUTUBE_POT_SERVER_PORT?.trim() || '4416', 10);
const DEFAULT_ENTRY = path.join(os.homedir(), 'bgutil-ytdlp-pot-provider', 'server', 'build', 'main.js');

let ensurePromise = null;

function isPortValid(port) {
  return Number.isInteger(port) && port > 0 && port < 65536;
}

export function getBgutilServerConfig() {
  return {
    autoStart: process.env.YOUTUBE_POT_AUTO_START !== 'false',
    host: DEFAULT_HOST,
    port: isPortValid(DEFAULT_PORT) ? DEFAULT_PORT : 4416,
    entry: DEFAULT_ENTRY,
  };
}

export function hasBgutilServerBuild() {
  return fs.existsSync(getBgutilServerConfig().entry);
}

export async function isBgutilServerReachable(host = DEFAULT_HOST, port = DEFAULT_PORT) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });

    socket.setTimeout(400);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      resolve(false);
    });
  });
}

async function waitForServer(host, port, timeoutMs = 5000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isBgutilServerReachable(host, port)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return false;
}

export async function ensureBgutilPotServer() {
  const config = getBgutilServerConfig();

  if (!config.autoStart) {
    return { status: 'disabled', ...config };
  }

  if (await isBgutilServerReachable(config.host, config.port)) {
    return { status: 'already-running', ...config };
  }

  if (!fs.existsSync(config.entry)) {
    return { status: 'missing-build', ...config };
  }

  if (!ensurePromise) {
    ensurePromise = (async () => {
      const child = spawn('node', [config.entry, '--port', String(config.port)], {
        detached: true,
        stdio: 'ignore',
        env: process.env,
      });
      child.unref();

      const ready = await waitForServer(config.host, config.port);
      if (!ready) {
        throw new Error(`Timed out waiting for bgutil POT server on ${config.host}:${config.port}`);
      }

      return { status: 'started', ...config };
    })().finally(() => {
      ensurePromise = null;
    });
  }

  return ensurePromise;
}
