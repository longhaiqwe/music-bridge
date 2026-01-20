import { MusicInfo, MusicSource } from '../types';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = util.promisify(exec);
const TMP_DIR = path.join(process.cwd(), 'tmp_downloads');

if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
}

export class YoutubeSource implements MusicSource {
    name = 'youtube';

    async search(keyword: string): Promise<MusicInfo[]> {
        try {
            console.log(`[YoutubeSource] Searching for: ${keyword}`);
            // ytsearch5: Limit to 5 results
            const command = `yt-dlp --dump-json --no-playlist "ytsearch5:${keyword}"`;
            const { stdout } = await this.execWithRetry(command);

            const results: MusicInfo[] = [];
            const lines = stdout.trim().split('\n');

            for (const line of lines) {
                if (!line) continue;
                try {
                    const data = JSON.parse(line);
                    results.push({
                        id: data.id,
                        name: data.title,
                        artist: data.uploader || 'Unknown',
                        album: 'YouTube',
                        duration: data.duration,
                        coverUrl: data.thumbnail,
                        source: this.name,
                        originalId: data.id
                    });
                } catch (e) {
                    console.warn('Failed to parse yt-dlp output line', e);
                }
            }
            return results;
        } catch (e) {
            console.error('Youtube search failed:', e);
            return [];
        }
    }

    async getDownloadUrl(info: MusicInfo): Promise<string> {
        const filePath = path.join(TMP_DIR, `${info.id}.mp3`);

        // If file exists, return it
        if (fs.existsSync(filePath)) {
            const stats = fs.statSync(filePath);
            if (stats.size > 0) {
                return filePath;
            }
        }

        let cookieFile = '';
        try {
            // Check for cookies
            const cookieStr = process.env.YOUTUBE_COOKIES;
            if (cookieStr) {
                try {
                    const cookies = JSON.parse(cookieStr);
                    cookieFile = path.join(TMP_DIR, `cookies_${Date.now()}_${Math.random().toString(36).substring(7)}.txt`);
                    const netscapeCookies = this.convertCookiesToNetscape(cookies);
                    fs.writeFileSync(cookieFile, netscapeCookies);
                    console.log(`[YoutubeSource] Created temporary cookie file: ${cookieFile}`);
                } catch (e) {
                    console.warn('[YoutubeSource] Failed to parse/write YOUTUBE_COOKIES:', e);
                }
            }

            console.log(`[YoutubeSource] Downloading with yt-dlp: ${info.name}`);

            // Construct command
            let cmd = `yt-dlp -x --audio-format mp3 -o "${path.join(TMP_DIR, '%(id)s.%(ext)s')}" ${info.originalId}`;
            if (cookieFile) {
                cmd += ` --cookies "${cookieFile}"`;
            }

            // Download best audio and convert to mp3
            await this.execWithRetry(cmd);

            if (fs.existsSync(filePath)) {
                return filePath;
            }

            // Fallback: check other extensions
            const files = fs.readdirSync(TMP_DIR);
            const downloaded = files.find(f => f.startsWith(info.id));
            if (downloaded) {
                return path.join(TMP_DIR, downloaded);
            }

            throw new Error('Download failed: file not found after yt-dlp execution');
        } catch (e) {
            console.error('Youtube download failed:', e);
            throw e;
        } finally {
            // Cleanup cookie file
            if (cookieFile && fs.existsSync(cookieFile)) {
                try {
                    fs.unlinkSync(cookieFile);
                } catch { }
            }
        }
    }

    private convertCookiesToNetscape(cookies: any[]): string {
        let output = '# Netscape HTTP Cookie File\n# http://curl.haxx.se/rfc/cookie_spec.html\n# This is a generated file!  Do not edit.\n\n';

        for (const cookie of cookies) {
            const domain = cookie.domain;
            const flag = domain.startsWith('.') ? 'TRUE' : 'FALSE';
            const path = cookie.path;
            const secure = cookie.secure ? 'TRUE' : 'FALSE';
            const expiration = Math.round(cookie.expirationDate || (Date.now() / 1000) + 31536000); // Default 1 year if missing
            const name = cookie.name;
            const value = cookie.value;

            output += `${domain}\t${flag}\t${path}\t${secure}\t${expiration}\t${name}\t${value}\n`;
        }
        return output;
    }

    private async execWithRetry(command: string, retries = 3, delay = 1000): Promise<{ stdout: string, stderr: string }> {
        for (let i = 0; i < retries; i++) {
            try {
                return await execAsync(command);
            } catch (e) {
                if (i === retries - 1) throw e;
                console.warn(`Command failed, retrying (${i + 1}/${retries}): ${command}`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        throw new Error('Unreachable');
    }
}
