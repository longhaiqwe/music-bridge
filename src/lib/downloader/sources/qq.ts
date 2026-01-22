import { MusicInfo, MusicSource } from '../types';
import { qqMusicService } from '../../qqmusic';
import { YoutubeSource } from './youtube';
import * as OpenCC from 'opencc-js';

const converter = OpenCC.Converter({ from: 'cn', to: 'hk' });

export class QQMusicSource implements MusicSource {
    name = 'qq';
    private youtubeSource: YoutubeSource;

    constructor() {
        this.youtubeSource = new YoutubeSource();
    }

    // Helper function to format view count
    private formatViewCount(views: number): string {
        if (views >= 1000000) {
            return `${(views / 1000000).toFixed(1)}M`;
        } else if (views >= 1000) {
            return `${(views / 1000).toFixed(1)}K`;
        }
        return views.toString();
    }

    async search(keyword: string): Promise<MusicInfo[]> {
        // Use existing QQ Music service to search
        const songs = await qqMusicService.search(keyword);

        return songs.map(song => ({
            id: String(song.id),
            name: song.name,
            artist: song.ar.map(a => a.name).join('/'),
            album: song.al.name,
            duration: song.dt / 1000,
            coverUrl: song.al.picUrl,
            source: this.name,
            originalId: String(song.id)
        }));
    }

    private cleanTitle(str: string): string {
        // Remove content in parentheses (e.g. "(with ...)", "(feat ...)")
        // Also remove the parentheses themselves
        return str.replace(/\s*[\(（][^)\）]*[\)）]\s*/g, ' ').trim();
    }

    private normalize(str: string): string {
        // Remove symbols, punctuation, and spaces, keep only letters and numbers (unicode supported)
        return str.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    }

    async getDownloadUrl(info: MusicInfo): Promise<string> {
        // PROXY DOWNLOAD STRATEGY
        console.log(`[QQMusicSource] Proxying download for: ${info.name} - ${info.artist} to YouTube`);

        const isLiveRequest = /live|concert|现场|演唱会/i.test(info.name);
        const isDJRequest = /dj|remix|mix|串烧|土嗨|慢摇|bootleg/i.test(info.name);

        // Helper to execute search and matching
        const findMatch = async (searchQuery: string): Promise<{ match: MusicInfo | null, candidates: string[] }> => {
            const results = await this.youtubeSource.search(searchQuery, {
                artist: info.artist,
                duration: info.duration
            });
            const candidates: string[] = [];

            // Prepare Traditional Chinese variants for matching
            const infoNameTrad = converter(info.name);
            const infoNameNorm = this.normalize(info.name);
            const infoNameTradNorm = this.normalize(infoNameTrad);

            for (const res of results) {
                const resNameNorm = this.normalize(res.name);
                const viewStr = res.viewCount ? `${this.formatViewCount(res.viewCount)} views` : 'N/A';
                candidates.push(`${res.name} (${res.artist}) [Score:${(res as any)._debugScore}] - ${viewStr}`);

                // Basic Name Validation
                // Since YoutubeSource already sorts by score (Official > Cover, etc), we just need to verify 
                // that the video title actually contains the song name to avoid completely random results.

                const nameMatch = resNameNorm.includes(infoNameNorm) || resNameNorm.includes(infoNameTradNorm);

                if (nameMatch) {
                    console.log(`[QQMusicSource] Selected match: ${res.name}`);
                    return { match: res, candidates };
                }
            }

            return { match: null, candidates };
        };

        try {
            // Attempt 1: Detailed Query
            let query = `${info.name} ${info.artist}`;
            if (info.album && info.album !== info.name) {
                query += ` ${info.album}`;
            }

            if (!isLiveRequest) {
                query += ' 原版';
            } else {
                query += ' live audio';
            }

            const attempt1Result = await findMatch(query);
            if (attempt1Result.match) {
                const viewStr = attempt1Result.match.viewCount ? ` (${this.formatViewCount(attempt1Result.match.viewCount)} views)` : '';
                console.log(`[QQMusicSource] Found match on attempt 1: ${attempt1Result.match.name}${viewStr}`);
                attempt1Result.match.filename = `${info.name} - ${info.artist}`;
                return await this.youtubeSource.getDownloadUrl(attempt1Result.match);
            }

            console.warn(`[QQMusicSource] No strict match for detailed query. Candidates: ${JSON.stringify(attempt1Result.candidates)}`);

            // Attempt 2: Simplified Query (Name + Artist only)
            const simpleQuery = `${info.name} ${info.artist}`;
            console.log(`[QQMusicSource] Retrying with simplified query: ${simpleQuery}`);

            const attempt2Result = await findMatch(simpleQuery);
            if (attempt2Result.match) {
                const viewStr = attempt2Result.match.viewCount ? ` (${this.formatViewCount(attempt2Result.match.viewCount)} views)` : '';
                console.log(`[QQMusicSource] Found match on attempt 2: ${attempt2Result.match.name}${viewStr}`);
                attempt2Result.match.filename = `${info.name} - ${info.artist}`;
                return await this.youtubeSource.getDownloadUrl(attempt2Result.match);
            }

            console.warn(`[QQMusicSource] No strict match for simplified query. Candidates: ${JSON.stringify(attempt2Result.candidates)}`);

            // Attempt 3: Traditional Chinese Query (Cantonese/TC support)
            // Convert Name and Artist to Traditional Chinese (Hong Kong standard)
            const traditionalName = converter(info.name);
            const traditionalArtist = converter(info.artist);

            // Only try if there's a difference (otherwise it's same as Attempt 2)
            if (traditionalName !== info.name || traditionalArtist !== info.artist) {
                const traditionalQuery = `${traditionalName} ${traditionalArtist}`;
                console.log(`[QQMusicSource] Retrying with Traditional Chinese query: ${traditionalQuery}`);

                const attempt3Result = await findMatch(traditionalQuery);
                if (attempt3Result.match) {
                    const viewStr = attempt3Result.match.viewCount ? ` (${this.formatViewCount(attempt3Result.match.viewCount)} views)` : '';
                    console.log(`[QQMusicSource] Found match on attempt 3 (Traditional): ${attempt3Result.match.name}${viewStr}`);
                    attempt3Result.match.filename = `${info.name} - ${info.artist}`;
                    return await this.youtubeSource.getDownloadUrl(attempt3Result.match);
                }
            }

            // Attempt 4: Just the name
            const nameQuery = `${info.name}`;
            console.log(`[QQMusicSource] Retrying with name-only query: ${nameQuery}`);
            const attempt4Result = await findMatch(nameQuery);
            if (attempt4Result.match) {
                const viewStr = attempt4Result.match.viewCount ? ` (${this.formatViewCount(attempt4Result.match.viewCount)} views)` : '';
                console.log(`[QQMusicSource] Found match on attempt 4: ${attempt4Result.match.name}${viewStr}`);
                attempt4Result.match.filename = `${info.name} - ${info.artist}`;
                return await this.youtubeSource.getDownloadUrl(attempt4Result.match);
            }

            throw new Error(`No video title matched song name "${info.name}" in YouTube results after retries.`);

        } catch (e) {
            console.error('[QQMusicSource] Proxy download failed', e);
            throw e;
        }
    }
}
