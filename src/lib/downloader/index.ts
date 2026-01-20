import { MusicInfo, MusicSource } from './types';
import { YoutubeSource } from './sources/youtube';
import { QQMusicSource } from './sources/qq';

export class DownloadManager {
    private sources: MusicSource[] = [];

    constructor() {
        this.registerSource(new QQMusicSource());
        this.registerSource(new YoutubeSource());
    }

    registerSource(source: MusicSource) {
        this.sources.push(source);
        console.log(`Registered source: ${source.name}`);
    }

    async search(keyword: string): Promise<MusicInfo[]> {
        const results = await Promise.all(
            this.sources.map(async (source) => {
                try {
                    return await source.search(keyword);
                } catch (e) {
                    console.error(`Error searching ${source.name}:`, e);
                    return [];
                }
            })
        );
        // Flatten and maybe sort/deduplicate
        return results.flat();
    }

    async getDownloadUrl(info: MusicInfo): Promise<string> {
        const source = this.sources.find((s) => s.name === info.source);
        if (!source) {
            throw new Error(`Source ${info.source} not found`);
        }
        return source.getDownloadUrl(info);
    }
}

export const downloadManager = new DownloadManager();
