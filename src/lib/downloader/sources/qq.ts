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
            const results = await this.youtubeSource.search(searchQuery);
            const candidates: string[] = [];

            let bestMatch: MusicInfo | null = null;
            let bestScore = -1;

            // Prepare Traditional Chinese variants for matching
            const infoNameTrad = converter(info.name);
            const infoArtistTrad = converter(info.artist);

            const infoNameNorm = this.normalize(info.name);
            const infoNameTradNorm = this.normalize(infoNameTrad);

            const infoArtistNorm = this.normalize(info.artist);
            const infoArtistTradNorm = this.normalize(infoArtistTrad);

            for (const res of results) {
                const resNameRaw = res.name;
                const resNameNorm = this.normalize(resNameRaw);
                const resArtistNorm = this.normalize(res.artist);

                candidates.push(`${res.name} (${res.artist})`);

                // Check 1: Does title contain song name? (Check both Simplified and Traditional)
                const nameMatch = resNameNorm.includes(infoNameNorm) || resNameNorm.includes(infoNameTradNorm);

                if (!nameMatch) {
                    continue;
                }

                let score = 0;
                score += 100; // Base score for name match

                // Score 2: Artist Match (Check both Simplified and Traditional)
                const artistMatch = resNameNorm.includes(infoArtistNorm) ||
                    resNameNorm.includes(infoArtistTradNorm) ||
                    resArtistNorm.includes(infoArtistNorm) ||
                    resArtistNorm.includes(infoArtistTradNorm);

                if (artistMatch) {
                    score += 50;
                }

                // Score 3: Live Status Match
                const resIsLive = /live|concert|现场|演唱会/i.test(resNameRaw);
                if (isLiveRequest === resIsLive) {
                    score += 50;
                } else {
                    score -= 50;
                }

                // Score 4: DJ/Remix Status Match (Negative Filtering)
                // If original song is NOT DJ/Remix, reject or heavily penalize DJ/Remix versions
                if (!isDJRequest) {
                    const resIsDJ = /dj|remix|mix|串烧|土嗨|慢摇|bootleg/i.test(resNameRaw);
                    if (resIsDJ) {
                        score -= 200; // Heavy penalty to effectively filter it out
                    }
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = res;
                }
            }

            // Only accept if score is reasonable (e.g. positive)
            if (bestScore <= 0) {
                return { match: null, candidates };
            }

            return { match: bestMatch, candidates };
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
                console.log(`[QQMusicSource] Found match on attempt 1: ${attempt1Result.match.name}`);
                attempt1Result.match.filename = `${info.name} - ${info.artist}`;
                return await this.youtubeSource.getDownloadUrl(attempt1Result.match);
            }

            console.warn(`[QQMusicSource] No strict match for detailed query. Candidates: ${JSON.stringify(attempt1Result.candidates)}`);

            // Attempt 2: Simplified Query (Name + Artist only)
            const simpleQuery = `${info.name} ${info.artist}`;
            console.log(`[QQMusicSource] Retrying with simplified query: ${simpleQuery}`);

            const attempt2Result = await findMatch(simpleQuery);
            if (attempt2Result.match) {
                console.log(`[QQMusicSource] Found match on attempt 2: ${attempt2Result.match.name}`);
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
                    console.log(`[QQMusicSource] Found match on attempt 3 (Traditional): ${attempt3Result.match.name}`);
                    attempt3Result.match.filename = `${info.name} - ${info.artist}`;
                    return await this.youtubeSource.getDownloadUrl(attempt3Result.match);
                }
            }

            // Attempt 4: Just the name
            const nameQuery = `${info.name}`;
            console.log(`[QQMusicSource] Retrying with name-only query: ${nameQuery}`);
            const attempt4Result = await findMatch(nameQuery);
            if (attempt4Result.match) {
                console.log(`[QQMusicSource] Found match on attempt 4: ${attempt4Result.match.name}`);
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
