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

        // Construct a search query for YouTube
        const query = `${info.name} ${info.artist} audio`;

        try {
            // Search YouTube for the best match using the metadata from QQ Music
            const ytResults = await this.youtubeSource.search(query);

            if (ytResults.length === 0) {
                throw new Error('No matching song found on YouTube');
            }

            // Pick the first result
            const bestMatch = ytResults[0];
            console.log(`[QQMusicSource] Found YouTube match: ${bestMatch.name} (${bestMatch.id})`);

            // Delegate download to YoutubeSource
            return await this.youtubeSource.getDownloadUrl(bestMatch);

        } catch (e) {
            console.error('[QQMusicSource] Proxy download failed', e);
            throw e;
        }
    }
}
