import { MusicInfo, MusicSource } from '../types';
import { qqMusicService } from '../../qqmusic';
import { YoutubeSource } from './youtube';

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

        // Helper to execute search and matching
        const findMatch = async (searchQuery: string): Promise<{ match: MusicInfo | null, candidates: string[] }> => {
            const results = await this.youtubeSource.search(searchQuery);
            const candidates: string[] = [];

            let bestMatch: MusicInfo | null = null;
            let bestScore = -1;

            for (const res of results) {
                const resNameRaw = res.name;
                const resNameNorm = this.normalize(resNameRaw);
                const infoNameNorm = this.normalize(info.name);
                const infoArtistNorm = this.normalize(info.artist);

                candidates.push(`${res.name} (${res.artist})`);

                // Check 1: Does title contain song name?
                // We check if targetNameMap is a substring of resNameNorm
                if (!resNameNorm.includes(infoNameNorm)) {
                    continue;
                }

                let score = 0;
                score += 100; // Base score for name match

                // Score 2: Artist Match
                if (resNameNorm.includes(infoArtistNorm) || this.normalize(res.artist).includes(infoArtistNorm)) {
                    score += 50;
                }

                // Score 3: Live Status Match
                const resIsLive = /live|concert|现场|演唱会/i.test(resNameRaw);
                if (isLiveRequest === resIsLive) {
                    score += 50;
                } else {
                    score -= 50;
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = res;
                }
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
                query += ' official audio';
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

            // Attempt 3: Just the name
            const nameQuery = `${info.name}`;
            console.log(`[QQMusicSource] Retrying with name-only query: ${nameQuery}`);
            const attempt3Result = await findMatch(nameQuery);
            if (attempt3Result.match) {
                console.log(`[QQMusicSource] Found match on attempt 3: ${attempt3Result.match.name}`);
                attempt3Result.match.filename = `${info.name} - ${info.artist}`;
                return await this.youtubeSource.getDownloadUrl(attempt3Result.match);
            }

            throw new Error(`No video title matched song name "${info.name}" in YouTube results after retries.`);

        } catch (e) {
            console.error('[QQMusicSource] Proxy download failed', e);
            throw e;
        }
    }
}
