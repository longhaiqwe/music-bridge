import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

import { debugLog, debugWarn } from '@/lib/logging';

const DEFAULT_HOST = process.env.YOUTUBE_POT_SERVER_HOST?.trim() || '127.0.0.1';
const parsedPort = Number.parseInt(process.env.YOUTUBE_POT_SERVER_PORT?.trim() || '4416', 10);
const DEFAULT_PORT = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort < 65536 ? parsedPort : 4416;
const DEFAULT_ENTRY = path.join(os.homedir(), 'bgutil-ytdlp-pot-provider', 'server', 'build', 'main.js');

let ensurePromise: Promise<void> | null = null;

function shouldAutoStart() {
    return process.env.YOUTUBE_POT_AUTO_START !== 'false';
}

function isServerBuildPresent() {
    return fs.existsSync(DEFAULT_ENTRY);
}

function isReachable(host = DEFAULT_HOST, port = DEFAULT_PORT): Promise<boolean> {
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

async function waitForServer(host: string, port: number, timeoutMs = 5000): Promise<boolean> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        if (await isReachable(host, port)) {
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
    }

    return false;
}

export async function ensureBgutilPotServer(): Promise<void> {
    if (!shouldAutoStart()) {
        return;
    }

    if (await isReachable()) {
        return;
    }

    if (!isServerBuildPresent()) {
        debugWarn(`[YoutubeSource] bgutil server build not found at ${DEFAULT_ENTRY}`);
        return;
    }

    if (!ensurePromise) {
        ensurePromise = (async () => {
            debugLog(`[YoutubeSource] Auto-starting bgutil POT server at ${DEFAULT_HOST}:${DEFAULT_PORT}`);
            const child = spawn('node', [DEFAULT_ENTRY, '--port', String(DEFAULT_PORT)], {
                detached: true,
                stdio: 'ignore',
                env: process.env,
            });
            child.unref();

            const ready = await waitForServer(DEFAULT_HOST, DEFAULT_PORT);
            if (!ready) {
                throw new Error(`Timed out waiting for bgutil POT server on ${DEFAULT_HOST}:${DEFAULT_PORT}`);
            }
        })().catch((error) => {
            debugWarn('[YoutubeSource] Failed to auto-start bgutil POT server:', error);
        }).finally(() => {
            ensurePromise = null;
        });
    }

    await ensurePromise;
}
