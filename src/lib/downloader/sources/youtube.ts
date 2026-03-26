import { MusicInfo, MusicSource } from '../types';
import { getSafeFileName } from '../../metadata';
import { execFile } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';
import { debugLog, debugWarn } from '@/lib/logging';
import { ensureBgutilPotServer } from '../bgutil-pot';
import { resolveYoutubeCookieAuth, type YoutubeCookieAuthConfig } from '../youtube-auth';

const execFileAsync = util.promisify(execFile);
const TMP_DIR = path.join(process.cwd(), 'tmp_downloads');

if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
}


import * as OpenCC from 'opencc-js';

const converter = OpenCC.Converter({ from: 'cn', to: 'hk' });

interface ScoredMusicInfo extends MusicInfo {
    _debugScore?: number;
}

interface ExecFailureDetails {
    stdout: string;
    stderr: string;
}

type YtDlpOperation = 'search' | 'download';

export class YoutubeAuthenticationError extends Error {
    readonly stderr: string;

    constructor(message: string, stderr = '') {
        super(message);
        this.name = 'YoutubeAuthenticationError';
        this.stderr = stderr;
    }
}

export class YoutubeSource implements MusicSource {
    name = 'youtube';

    // Helper to normalize strings for comparison
    private normalize(str: string): string {
        return str.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    }

    private cleanTitle(str: string): string {
        return str.replace(/\s*[\(（][^)\）]*[\)）]\s*/g, ' ').trim();
    }

    private calculateScore(video: MusicInfo, keyword: string, options?: { artist?: string; duration?: number; songName?: string }): number {
        let score = 0;
        const videoNameRaw = video.name;
        const videoNameNorm = this.normalize(videoNameRaw);

        // We might not have the original song name easily if keyword is a mix, 
        // but we can try to infer or just rely on keywords.
        // If options.artist is present, we can use it.

        const artist = options?.artist || '';
        const duration = options?.duration || 0;
        const songName = options?.songName || '';

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

        // NEW: Title Mismatch Penalty
        // If we know the exact song name, the video title MUST contain it (normalized).
        if (songName) {
            const songNameNorm = this.normalize(songName);
            const songNameTradNorm = this.normalize(converter(songName));
            if (!videoNameNorm.includes(songNameNorm) && !videoNameNorm.includes(songNameTradNorm)) {
                // Strict penalty for unrelated songs that might have matched just the artist or some description keywords
                score -= 50;
            }
        }

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
        // Known official channels (could be expanded in the future via config)
        // Removed specific check for JVR/Zhou Jie Lun to keep logic generic

        // 3. Duration Match
        if (duration > 0 && video.duration > 0) {
            const diff = Math.abs(video.duration - duration);
            if (diff < 5) score += 100; // Strong priority for exact duration match
            else if (diff < 10) score += 50;
            else if (diff > 30) {
                // Penalize significant duration mismatch
                score -= 50;
            } else if (diff > 60) {
                score -= 100;
            }
        }

        // 4. View Count (Logarithmic)
        // 1M = 6 * 2 = 12. 100M = 8 * 2 = 16.
        if (video.viewCount && video.viewCount > 0) {
            score += Math.log10(video.viewCount) * 2;
        }

        return score;
    }

    /**
     * 构建 yt-dlp 的认证参数。
     * 仅保留浏览器 cookies 方案：
     *   1. --cookies-from-browser
     *   2. 匿名访问（显式关闭时）
     */
    private buildCookieArgs(): YoutubeCookieAuthConfig {
        const authConfig = resolveYoutubeCookieAuth(process.env);

        if (authConfig.source === 'browser') {
            debugLog(`[YoutubeSource] Using browser cookies: ${authConfig.description}`);
        } else {
            console.warn('[YoutubeSource] Browser cookies are disabled; yt-dlp will run anonymously');
        }

        return authConfig;
    }

    private getCommonYtDlpArgs(operation: YtDlpOperation): string[] {
        const args: string[] = [];
        const extractorArgs = (process.env.YOUTUBE_EXTRACTOR_ARGS || process.env.YTDLP_EXTRACTOR_ARGS || '').trim();
        const userAgent = (process.env.YTDLP_USER_AGENT || '').trim();
        const sleepRequests = (process.env.YTDLP_SLEEP_REQUESTS || '').trim();
        const minSleepInterval = (process.env.YTDLP_MIN_SLEEP_INTERVAL || '').trim();
        const maxSleepInterval = (process.env.YTDLP_MAX_SLEEP_INTERVAL || '').trim();
        const retries = (process.env.YTDLP_RETRIES || '').trim();
        const extractorRetries = (process.env.YTDLP_EXTRACTOR_RETRIES || '').trim();
        const socketTimeout = (process.env.YTDLP_SOCKET_TIMEOUT || '').trim();

        if (operation === 'search') {
            args.push('--ignore-errors');
        }

        if (extractorArgs) {
            args.push('--extractor-args', extractorArgs);
        }

        if (userAgent) {
            args.push('--user-agent', userAgent);
        }

        if (sleepRequests) {
            args.push('--sleep-requests', sleepRequests);
        }

        if (minSleepInterval) {
            args.push('--min-sleep-interval', minSleepInterval);
        }

        if (maxSleepInterval) {
            args.push('--max-sleep-interval', maxSleepInterval);
        }

        if (retries) {
            args.push('--retries', retries);
        }

        if (extractorRetries) {
            args.push('--extractor-retries', extractorRetries);
        }

        if (socketTimeout) {
            args.push('--socket-timeout', socketTimeout);
        }

        return args;
    }

    private parseSearchResults(
        stdout: string,
        keyword: string,
        options?: { artist?: string; duration?: number; songName?: string }
    ): ScoredMusicInfo[] {
        const results: ScoredMusicInfo[] = [];
        const lines = stdout.trim().split('\n');

        for (const line of lines) {
            if (!line) continue;
            try {
                const data = JSON.parse(line) as Record<string, unknown>;
                results.push({
                    id: String(data.id || ''),
                    name: String(data.title || ''),
                    artist: String(data.uploader || 'Unknown'),
                    album: 'YouTube',
                    duration: Number(data.duration || 0),
                    coverUrl: typeof data.thumbnail === 'string' ? data.thumbnail : undefined,
                    source: this.name,
                    originalId: String(data.id || ''),
                    viewCount: Number(data.view_count || data.viewCount || 0)
                });
            } catch (e) {
                console.warn('Failed to parse yt-dlp output line', e);
            }
        }

        results.sort((a, b) => {
            const scoreA = this.calculateScore(a, keyword, options);
            const scoreB = this.calculateScore(b, keyword, options);
            a._debugScore = scoreA;
            b._debugScore = scoreB;
            return scoreB - scoreA;
        });

        return results;
    }

    private getExecFailureDetails(error: unknown): ExecFailureDetails {
        if (typeof error === 'object' && error !== null) {
            const details = error as { stdout?: string; stderr?: string };
            return {
                stdout: details.stdout || '',
                stderr: details.stderr || '',
            };
        }

        return { stdout: '', stderr: '' };
    }

    private summarizeYtDlpError(stderr: string, fallback: string): string {
        const lines = stderr
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
        const errorLines = lines.filter((line) => /^ERROR:/i.test(line));
        const relevantLines = (errorLines.length > 0 ? errorLines : lines).slice(0, 3);

        return relevantLines.join(' | ') || fallback;
    }

    private getProxyHint(): string {
        const entries = [
            ['HTTPS_PROXY', process.env.HTTPS_PROXY || process.env.https_proxy],
            ['HTTP_PROXY', process.env.HTTP_PROXY || process.env.http_proxy],
            ['ALL_PROXY', process.env.ALL_PROXY || process.env.all_proxy],
        ].filter(([, value]) => typeof value === 'string' && value.trim().length > 0);

        if (entries.length === 0) {
            return '';
        }

        const details = entries
            .map(([name, value]) => `${name}=${String(value)}`)
            .join(', ');

        return ` 当前检测到代理环境：${details}。如果浏览器会话和 PO Token provider 都已配置仍失败，常见原因是代理出口 IP 被 YouTube 风控；建议先切换节点再重试。`;
    }

    private isYouTubeAuthFailure(text: string): boolean {
        return [
            /sign in to confirm you['’]re not a bot/i,
            /the page needs to be reloaded/i,
            /use --cookies-from-browser or --cookies/i,
            /this helps protect our community/i,
            /po token/i,
            /please sign in/i,
            /login required/i,
        ].some((pattern) => pattern.test(text));
    }

    private toHelpfulYtDlpError(error: unknown, operation: YtDlpOperation, authConfig: YoutubeCookieAuthConfig): Error {
        if (error instanceof YoutubeAuthenticationError) {
            return error;
        }

        const fallback = error instanceof Error ? error.message : String(error);
        const { stderr } = this.getExecFailureDetails(error);
        const summary = this.summarizeYtDlpError(stderr, fallback);

        if (this.isYouTubeAuthFailure(`${fallback}\n${stderr}`)) {
            const authHint = authConfig.source === 'browser'
                ? '当前正在使用浏览器会话，请确认对应浏览器 profile 仍处于登录状态，并且该 profile 可以正常打开 YouTube。'
                : '当前未启用浏览器 cookies，请开启 YOUTUBE_COOKIES_FROM_BROWSER 并配置 YOUTUBE_COOKIES_BROWSER。';
            const poTokenHint = '如仍被拦截，请通过 YOUTUBE_EXTRACTOR_ARGS / YTDLP_EXTRACTOR_ARGS 为 yt-dlp 配置 YouTube 的 extractor args（例如 PO Token provider）。';
            const proxyHint = this.getProxyHint();
            return new YoutubeAuthenticationError(
                `YouTube ${operation === 'search' ? '搜索' : '下载'}认证失败。${authHint} ${poTokenHint}${proxyHint} 当前认证来源：${authConfig.description}。原始错误：${summary}`,
                stderr
            );
        }

        return new Error(`yt-dlp ${operation === 'search' ? '搜索' : '下载'}失败：${summary}`);
    }

    async search(keyword: string, options?: { artist?: string; duration?: number; songName?: string }): Promise<MusicInfo[]> {
        await ensureBgutilPotServer();
        const authConfig = this.buildCookieArgs();
        try {
            debugLog(`[YoutubeSource] Searching for: ${keyword}`);
            const args = [
                '--dump-json',
                '--no-playlist',
                `ytsearch10:${keyword}`,
                ...this.getCommonYtDlpArgs('search'),
                ...authConfig.args
            ];
            const { stdout } = await this.execWithRetry('yt-dlp', args);
            const results = this.parseSearchResults(stdout, keyword, options);

            // Sort by calculated score
            // Log top 3 for debugging
            debugLog('[YoutubeSource] Top 3 results:', results.slice(0, 3).map(r =>
                `${(r.name.length > 30 ? r.name.substring(0, 30) + '...' : r.name)} (${Math.round(r._debugScore ?? 0)}) [${r.duration}s]`
            ));

            return results;
        } catch (e) {
            const { stdout, stderr } = this.getExecFailureDetails(e);
            if (stdout.trim()) {
                debugWarn(`[YoutubeSource] yt-dlp search returned partial results: ${this.summarizeYtDlpError(stderr, 'partial failure')}`);
                return this.parseSearchResults(stdout, keyword, options);
            }

            const helpfulError = this.toHelpfulYtDlpError(e, 'search', authConfig);
            throw helpfulError;
        }
    }

    async getDownloadUrl(info: MusicInfo): Promise<string> {
        await ensureBgutilPotServer();
        // Determine the preferred filename base (Song - Artist) or fallback to ID
        let baseName = info.filename;
        if (!baseName && info.name) {
            baseName = `${info.name} - ${info.artist || 'Unknown'}`;
        }
        baseName = baseName || info.id;
        // We enforce flac conversion for lossless quality
        const targetFilename = getSafeFileName(baseName, 'flac');
        const filePath = path.join(TMP_DIR, targetFilename);

        // If file exists, return it
        if (fs.existsSync(filePath)) {
            const stats = fs.statSync(filePath);
            if (stats.size > 0) {
                return filePath;
            }
        }

        const authConfig = this.buildCookieArgs();
        try {
            debugLog(`[YoutubeSource] Downloading with yt-dlp: ${info.name}`);

            // Construct output template for yt-dlp
            // We use the safe basename + dynamic extension, though we requested flac
            const safeBaseName = path.basename(targetFilename, '.flac');
            const outputTemplate = path.join(TMP_DIR, `${safeBaseName}.%(ext)s`);

            const args = [
                '-x',
                '--audio-format',
                'flac',
                '-o',
                outputTemplate,
                `https://www.youtube.com/watch?v=${info.originalId}`,
                ...this.getCommonYtDlpArgs('download'),
                ...authConfig.args
            ];

            await this.execWithRetry('yt-dlp', args);

            if (fs.existsSync(filePath)) {
                const stats = fs.statSync(filePath);
                // Check if file is valid (at least 10KB to be a valid song)
                if (stats.size > 10 * 1024) {
                    return filePath;
                }
                debugWarn(`[YoutubeSource] Downloaded file is too small (${stats.size} bytes), deleting...`);
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
            const helpfulError = this.toHelpfulYtDlpError(e, 'download', authConfig);
            throw helpfulError;
        }
    }

    private async execWithRetry(
        file: string,
        args: string[],
        retries = 3,
        delay = 1000
    ): Promise<{ stdout: string; stderr: string }> {
        for (let i = 0; i < retries; i++) {
            try {
                const result = await execFileAsync(file, args, { maxBuffer: 10 * 1024 * 1024 });
                return {
                    stdout: result.stdout,
                    stderr: result.stderr,
                };
            } catch (e) {
                const { stderr } = this.getExecFailureDetails(e);
                if (this.isYouTubeAuthFailure(stderr)) {
                    throw e;
                }

                if (i === retries - 1) throw e;
                debugWarn(`Command failed, retrying (${i + 1}/${retries}): ${file} ${args.join(' ')}`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        throw new Error('Unreachable');
    }
}
