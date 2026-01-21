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

    async getDownloadUrl(info: MusicInfo): Promise<string> {
        // PROXY DOWNLOAD STRATEGY
        console.log(`[QQMusicSource] Proxying download for: ${info.name} - ${info.artist} to YouTube`);

        const isLiveRequest = /live|concert|现场|演唱会/i.test(info.name);

        // Construct a search query for YouTube
        let query = `${info.name} ${info.artist}`;
        if (!isLiveRequest) {
            query += ' official audio';
        } else {
            query += ' live audio';
        }

        try {
            // Search YouTube for the best match using the metadata from QQ Music
            const ytResults = await this.youtubeSource.search(query);

            if (ytResults.length === 0) {
                throw new Error(`No matching song found on YouTube for query: "${query}"`);
            }

            // Filter logic: If we didn't ask for a live version, try to find one that isn't live
            let bestMatch = ytResults[0];

            if (!isLiveRequest) {
                // Try to find a result that doesn't contain "Live", "Concert", "现场" in the title
                const nonLiveMatch = ytResults.find(res => !/live|concert|现场|演唱会/i.test(res.name));
                if (nonLiveMatch) {
                    bestMatch = nonLiveMatch;
                    console.log(`[QQMusicSource] Selected non-live match: ${bestMatch.name}`);
                } else {
                    console.warn(`[QQMusicSource] Could not find a strictly non-live match, using top result: ${bestMatch.name}`);
                }
            } else {
                console.log(`[QQMusicSource] Live version requested, using top result: ${bestMatch.name}`);
            }

            console.log(`[QQMusicSource] Found YouTube match: ${bestMatch.name} (${bestMatch.id})`);

            // Delegate download to YoutubeSource
            return await this.youtubeSource.getDownloadUrl(bestMatch);

        } catch (e) {
            console.error('[QQMusicSource] Proxy download failed', e);
            throw e;
        }
    }
}
