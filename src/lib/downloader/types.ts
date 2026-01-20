export interface MusicInfo {
    id: string;
    name: string;
    artist: string;
    album: string;
    duration: number; // in seconds
    coverUrl?: string; // High quality cover
    source: string; // 'youtube', 'myfreemp3', etc.
    originalId: string; // ID in the source system
}

export interface SearchResult {
    source: string;
    items: MusicInfo[];
}

export interface MusicSource {
    name: string;
    search(keyword: string): Promise<MusicInfo[]>;
    getDownloadUrl(info: MusicInfo): Promise<string>;
    // Returns a stream or buffer (handled by caller fetching the URL)
}
