export interface MusicInfo {
    id: string;
    name: string;
    artist: string;
    album: string;
    duration: number; // in seconds
    coverUrl?: string; // High quality cover
    source: string; // 'youtube', 'myfreemp3', etc.
    originalId: string; // ID in the source system
    filename?: string; // Optional preferred filename (e.g. "Song - Artist")
    viewCount?: number; // View count for quality ranking (e.g. YouTube views)
    songName?: string; // Explicit song name for strict title matching
}

export interface SearchResult {
    source: string;
    items: MusicInfo[];
}

export interface MusicSource {
    name: string;
    search(keyword: string, options?: { artist?: string; duration?: number; songName?: string }): Promise<MusicInfo[]>;
    getDownloadUrl(info: MusicInfo): Promise<string>;
    // Returns a stream or buffer (handled by caller fetching the URL)
}
