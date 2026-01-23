import { MusicInfo, MusicSource } from '../types';
import { getSafeFileName } from '../../metadata';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = util.promisify(exec);
const TMP_DIR = path.join(process.cwd(), 'tmp_downloads');

if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
}


import * as OpenCC from 'opencc-js';

const converter = OpenCC.Converter({ from: 'cn', to: 'hk' });

export class YoutubeSource implements MusicSource {
    name = 'youtube';

    // Helper to normalize strings for comparison
    private normalize(str: string): string {
        return str.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    }

    private cleanTitle(str: string): string {
        return str.replace(/\s*[\(（][^)\）]*[\)）]\s*/g, ' ').trim();
    }

    private calculateScore(video: MusicInfo, keyword: string, options?: { artist?: string; duration?: number }): number {
        let score = 0;
        const videoNameRaw = video.name;
        const videoNameNorm = this.normalize(videoNameRaw);

        // We might not have the original song name easily if keyword is a mix, 
        // but we can try to infer or just rely on keywords.
        // If options.artist is present, we can use it.

        const artist = options?.artist || '';
        const duration = options?.duration || 0;

        // 1. Keywords (Title)
        if (/Official|官方|MV|Music Video/i.test(videoNameRaw)) score += 50;

        // Lyric/Audio: favorable if duration is close (checked later), otherwise just small bonus
        if (/Lyric|歌词|Audio|音频/i.test(videoNameRaw)) score += 10;

        // Penalties (Context-aware)
        const isLiveSearch = /Live|Concert|现场|演唱会/i.test(keyword);
        if (!isLiveSearch && /Live|Concert|现场|演唱会/i.test(videoNameRaw)) score -= 20;

        const isCoverSearch = /Cover|翻唱/i.test(keyword);
        if (!isCoverSearch && /Cover|翻唱/i.test(videoNameRaw)) score -= 50;

        // Remix penalty
        const isRemixSearch = /Remix|Mix|串烧/i.test(keyword);
        if (!isRemixSearch && /Remix|Mix|串烧/i.test(videoNameRaw)) score -= 50;

        if (/伴奏|Instrumental|Karaoke/i.test(videoNameRaw)) score -= 50;
        if (/Reaction|Tutorial|Guitar|Piano/i.test(videoNameRaw)) score -= 50;
        if (/试听|Preview|Teaser|Trailer/i.test(videoNameRaw)) score -= 50;

        // 2. Channel Match
        // 2. Artist Match (Channel & Title)
        if (artist) {
            const artistNorm = this.normalize(artist);
            const artistTradNorm = this.normalize(converter(artist));

            // Channel/Uploader Match
            const channelNorm = this.normalize(video.artist); // video.artist is uploader
            if (channelNorm.includes(artistNorm) || channelNorm.includes(artistTradNorm)) {
                score += 40;
            }

            // Title Match
            // If the title contains the artist name, it's a strong signal.
            // This helps when the artist is not the uploader (e.g. lyric videos, generated channels)
            if (videoNameNorm.includes(artistNorm) || videoNameNorm.includes(artistTradNorm)) {
                score += 40;
            }
        }
        // Known official channels (could be expanded)
        if (/JVR Music|周杰倫/i.test(video.artist)) score += 20;

        // 3. Duration Match
        if (duration > 0 && video.duration > 0) {
            const diff = Math.abs(video.duration - duration);
            if (diff < 5) score += 30;
            else if (diff < 20) score += 10;
            else if (diff > 60) {
                // If it claims to be certain things, we might forgive it?
                // But generally > 1 min diff is bad.
                score -= 50;
            }
        }

        // 4. View Count (Logarithmic)
        // 1M = 6 * 2 = 12. 100M = 8 * 2 = 16.
        if (video.viewCount && video.viewCount > 0) {
            score += Math.log10(video.viewCount) * 2;
        }

        return score;
    }

    private async withCookies<T>(callback: (cookiePath: string | null) => Promise<T>): Promise<T> {
        let cookieFile: string | null = null;
        try {
            const cookieStr = process.env.YOUTUBE_COOKIES;
            if (cookieStr) {
                try {
                    const cookies = JSON.parse(cookieStr);
                    cookieFile = path.join(TMP_DIR, `cookies_${Date.now()}_${Math.random().toString(36).substring(7)}.txt`);
                    const netscapeCookies = this.convertCookiesToNetscape(cookies);
                    fs.writeFileSync(cookieFile, netscapeCookies);
                } catch (e) {
                    console.warn('[YoutubeSource] Failed to parse/write YOUTUBE_COOKIES:', e);
                }
            }
            return await callback(cookieFile);
        } finally {
            if (cookieFile && fs.existsSync(cookieFile)) {
                try { fs.unlinkSync(cookieFile); } catch { }
            }
        }
    }

    async search(keyword: string, options?: { artist?: string; duration?: number }): Promise<MusicInfo[]> {
        return this.withCookies(async (cookieFile) => {
            try {
                console.log(`[YoutubeSource] Searching for: ${keyword}`);
                // Escape quotes to prevent shell issues
                const safeKeyword = keyword.replace(/"/g, '\\"');

                // Increase limit slightly to give us more candidates to score
                let command = `yt-dlp --dump-json --no-playlist "ytsearch10:${safeKeyword}"`;
                if (cookieFile) {
                    command += ` --cookies "${cookieFile}"`;
                }

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
                            originalId: data.id,
                            viewCount: data.view_count || data.viewCount || 0
                        });
                    } catch (e) {
                        console.warn('Failed to parse yt-dlp output line', e);
                    }
                }

                // Sort by calculated score
                results.sort((a, b) => {
                    const scoreA = this.calculateScore(a, keyword, options);
                    const scoreB = this.calculateScore(b, keyword, options);
                    // Add score to debug
                    // @ts-ignore
                    a._debugScore = scoreA;
                    // @ts-ignore
                    b._debugScore = scoreB;
                    return scoreB - scoreA;
                });

                // Log top 3 for debugging
                console.log('[YoutubeSource] Top 3 results:', results.slice(0, 3).map(r =>
                    // @ts-ignore
                    `${r.name} (${r._debugScore}) [${r.duration}s]`
                ));

                return results;
            } catch (e) {
                console.error('Youtube search failed:', e);
                return [];
            }
        });
    }

    async getDownloadUrl(info: MusicInfo): Promise<string> {
        // Determine the preferred filename base (Song - Artist) or fallback to ID
        let baseName = info.filename;
        if (!baseName && info.name) {
            baseName = `${info.name} - ${info.artist || 'Unknown'}`;
        }
        baseName = baseName || info.id;
        // We enforce mp3 conversion, so we look for that
        const targetFilename = getSafeFileName(baseName, 'mp3');
        const filePath = path.join(TMP_DIR, targetFilename);

        // If file exists, return it
        if (fs.existsSync(filePath)) {
            const stats = fs.statSync(filePath);
            if (stats.size > 0) {
                return filePath;
            }
        }

        return this.withCookies(async (cookieFile) => {
            try {
                console.log(`[YoutubeSource] Downloading with yt-dlp: ${info.name}`);

                // Construct output template for yt-dlp
                // We use the safe basename + dynamic extension, though we requested mp3
                const safeBaseName = path.basename(targetFilename, '.mp3');
                const outputTemplate = path.join(TMP_DIR, `${safeBaseName}.%(ext)s`);

                // Construct command
                let cmd = `yt-dlp -x --audio-format mp3 --audio-quality 0 -o "${outputTemplate}" "https://www.youtube.com/watch?v=${info.originalId}"`;
                if (cookieFile) {
                    cmd += ` --cookies "${cookieFile}"`;
                }

                // Download best audio and convert to mp3
                await this.execWithRetry(cmd);

                if (fs.existsSync(filePath)) {
                    const stats = fs.statSync(filePath);
                    // Check if file is valid (at least 10KB to be a valid song)
                    if (stats.size > 10 * 1024) {
                        return filePath;
                    }
                    console.warn(`[YoutubeSource] Downloaded file is too small (${stats.size} bytes), deleting...`);
                    fs.unlinkSync(filePath);
                }

                // Fallback: check other extensions if mp3 failed but something else arrived
                // Look for files starting with our safe basename
                const files = fs.readdirSync(TMP_DIR);
                const downloaded = files.find(f => f.startsWith(safeBaseName));
                if (downloaded) {
                    return path.join(TMP_DIR, downloaded);
                }

                throw new Error('Download failed: file not found after yt-dlp execution');
            } catch (e) {
                console.error('Youtube download failed:', e);
                throw e;
            }
        });
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
                return await execAsync(command, { maxBuffer: 10 * 1024 * 1024 });
            } catch (e) {
                if (i === retries - 1) throw e;
                console.warn(`Command failed, retrying (${i + 1}/${retries}): ${command}`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        throw new Error('Unreachable');
    }
}
