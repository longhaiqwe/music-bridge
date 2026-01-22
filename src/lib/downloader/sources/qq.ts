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
            const results = await this.youtubeSource.search(searchQuery);
            const candidates: string[] = [];

            let bestMatch: MusicInfo | null = null;
            let bestScore = -1;

            // Prepare Traditional Chinese variants for matching
            const infoNameTrad = converter(info.name);
            const infoArtistTrad = converter(info.artist);

            const infoNameNorm = this.normalize(info.name);
            const infoNameTradNorm = this.normalize(infoNameTrad);

            // Clean title (remove parens) for looser matching
            const infoNameBase = this.cleanTitle(info.name);
            const infoNameBaseTrad = converter(infoNameBase);
            const infoNameBaseNorm = this.normalize(infoNameBase);
            const infoNameBaseTradNorm = this.normalize(infoNameBaseTrad);
            const useBaseMatch = infoNameBaseNorm.length > 0 && infoNameBaseNorm !== infoNameNorm;

            const infoArtistNorm = this.normalize(info.artist);
            const infoArtistTradNorm = this.normalize(infoArtistTrad);

            for (const res of results) {
                const resNameRaw = res.name;
                const resNameNorm = this.normalize(resNameRaw);
                const resArtistNorm = this.normalize(res.artist);

                const viewStr = res.viewCount ? `${this.formatViewCount(res.viewCount)} views` : 'N/A';
                candidates.push(`${res.name} (${res.artist}) - ${viewStr}`);

                // Check 1: Does title contain song name? (Check both Simplified and Traditional)
                let nameMatch = resNameNorm.includes(infoNameNorm) || resNameNorm.includes(infoNameTradNorm);

                // If strict match fails, try base name match
                if (!nameMatch && useBaseMatch) {
                    nameMatch = resNameNorm.includes(infoNameBaseNorm) || resNameNorm.includes(infoNameBaseTradNorm);
                }

                // SPECIAL CASE: If view count is very high (>1M), relax the name match requirement
                const isHighViewCount = res.viewCount && res.viewCount > 1000000;
                if (!nameMatch && isHighViewCount) {
                    console.log(`[Match] High view count video (${viewStr}) doesn't match title, including anyway: ${resNameRaw}`);
                    nameMatch = true; // Allow high view count videos even without perfect title match
                }

                if (!nameMatch) {
                    console.log(`[Match] Skipped (no title match): ${resNameRaw} - ${viewStr}`);
                    continue;
                }

                let score = 0;
                score += 100; // Base score for name match

                // Score 1: Exact Match Bonus
                if (resNameNorm === infoNameNorm || resNameNorm === infoNameTradNorm) {
                    score += 100;
                }

                // Score 2: Artist - Song Pattern Bonus
                // If title explicitly contains artist and matched the song name, it's a strong signal (e.g. "Artist - Song" or "Song - Artist")
                const titleHasArtist = resNameNorm.includes(infoArtistNorm) ||
                    resNameNorm.includes(infoArtistTradNorm);

                if (titleHasArtist) {
                    score += 150;
                }

                // Score 3: Length Penalty
                // Deduct based on length difference to avoid medleys matching short song names
                const lengthDiff = Math.abs(resNameNorm.length - infoNameNorm.length);
                score -= lengthDiff * 1;

                // Score 4: Keyword Penalty for Medleys (Expanded)
                const medleyKeywords = /合集|全集|三部曲|串烧|medley|mashup|compilation|greatest hits/i;
                if (medleyKeywords.test(resNameRaw) && !medleyKeywords.test(info.name)) {
                    score -= 100;
                }

                // Score 5: Keyword Penalty for Instrumental/Cover
                // Unless specifically requested, instrumental and cover versions should be penalized
                const badKeywords = /伴奏|纯音乐|消音|instrumental|karaoke|backing? track|off?vocal|无歌词|inst(\s|\.|\d)?|伴奏版|消音版|乐器版|演奏版|唯有|只有伴奏|cover\s+by|翻唱|live\s+cover|acoustic/i;
                const isRequestingBadVersion = badKeywords.test(info.name);

                if (!isRequestingBadVersion && badKeywords.test(resNameRaw)) {
                    score -= 300; // Heavy penalty to effectively filter out instrumental/cover versions
                    console.log(`[Penalty] Bad version detected: ${resNameRaw} (-300 points)`);
                }

                // Score 5.5: Penalty for preview/sample versions
                if (/试听|preview|sample|snippet|demo|片段/i.test(resNameRaw)) {
                    score -= 100;
                    console.log(`[Penalty] Preview/sample version detected: ${resNameRaw} (-100 points)`);
                }

                // Score 5: Duration Match
                // Tolerance: 3 minutes diff is huge penalty, 1 minute is big penalty, small diff is bonus
                if (info.duration > 0 && res.duration > 0) {
                    const durationDiff = Math.abs(info.duration - res.duration);

                    if (durationDiff > 180) { // > 3 mins difference
                        score -= 200; // Impossible to be the same song (unless it's a 10min version vs 3min)
                    } else if (durationDiff > 60) { // > 1 min difference
                        score -= 50;
                    } else if (durationDiff <= 10) { // Very close match
                        score += 50;
                    }
                }

                // Score 6: Artist Match (Check match in channel/artist field OR title)
                // Note: Title match is already partially rewarded in Score 2, but this checks the explicit 'artist' field too
                const artistMatch = resNameNorm.includes(infoArtistNorm) ||
                    resNameNorm.includes(infoArtistTradNorm) ||
                    resArtistNorm.includes(infoArtistNorm) ||
                    resArtistNorm.includes(infoArtistTradNorm);

                if (artistMatch) {
                    score += 50;
                }

                // Score 7: Live Status Match
                const resIsLive = /live|concert|现场|演唱会/i.test(resNameRaw);
                if (isLiveRequest === resIsLive) {
                    score += 50;
                } else {
                    score -= 50;
                }

                // Score 7: DJ/Remix Status Match (Negative Filtering)
                // If original song is NOT DJ/Remix, reject or heavily penalize DJ/Remix versions
                if (!isDJRequest) {
                    const resIsDJ = /dj|remix|mix|串烧|土嗨|慢摇|bootleg/i.test(resNameRaw);
                    if (resIsDJ) {
                        score -= 200; // Heavy penalty to effectively filter it out
                    }
                }

                // Score 8: View Count Bonus (Quality indicator)
                // Higher views = more popular = likely better quality/official version
                if (res.viewCount && res.viewCount > 0) {
                    // Logarithmic scale to avoid overwhelming other factors
                    // 1K views = +10, 10K views = +20, 100K views = +30, 1M views = +40, 10M views = +50
                    const viewBonus = Math.floor(Math.log10(res.viewCount) * 10);
                    const cappedBonus = Math.min(viewBonus, 50);
                    score += cappedBonus;
                    console.log(`[Match] View count bonus: +${cappedBonus} (${viewStr})`);
                }

                console.log(`[Match] Score: ${score} for "${resNameRaw}" (${viewStr})`);

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
