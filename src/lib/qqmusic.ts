import qq from 'qq-music-api';

// Set minimal log level to avoid noise
// Set minimal log level to avoid noise
// qq.setLog({
//    level: 'error',
// });

export interface SongInfo {
    id: string | number;
    name: string;
    ar: { id: string | number; name: string }[];
    al: { id: string | number; name: string; picUrl?: string };
    dt: number; // Duration in ms
    source: 'qq' | 'netease';
}

export class QQMusicService {

    // Search for an artist and return their hot songs
    async getArtistHotSongs(artistName: string): Promise<SongInfo[]> {
        try {
            // 1. Search for the artist to to confirm we can find them.
            // Using a limit of 5 to just get the top result which is likely the artist.
            // @ts-ignore
            const searchRes = await qq.api('search', {
                key: artistName
            });

            // @ts-ignore
            const list = searchRes?.list || searchRes?.data?.list || [];

            if (list.length > 0) {
                // Even a general search usually puts the artist's songs first if we search for the artist name?
                // Actually standard behavior: searching "ArtistName" returns songs by that artist sorted by popularity.
                // This is the simplest way to get "Hot Songs".

                // Filter to ensure the song artist matches the requested artist (fuzzy match)
                // @ts-ignore
                const filtered = list.filter(item => {
                    // @ts-ignore
                    const singers = item.singer || [];
                    // @ts-ignore
                    return singers.some(s => s.name.includes(artistName) || artistName.includes(s.name));
                });

                // @ts-ignore
                return filtered.map(s => {
                    return {
                        id: s.songmid || s.mid || s.songid, // Prefer songmid
                        name: s.songname || s.name || s.title,
                        ar: (s.singer || []).map((art: any) => ({
                            id: art.mid || art.id,
                            name: art.name
                        })),
                        al: {
                            id: s.albummid || s.albumid || s.album?.mid,
                            name: s.albumname || s.album?.name || '',
                            picUrl: (s.albummid || s.album?.mid) ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.albummid || s.album?.mid}.jpg` : undefined
                        },
                        dt: (s.interval || 0) * 1000, // QQ uses seconds, convert to ms
                        source: 'qq'
                    } as SongInfo;
                });
            }

            return [];

        } catch (e) {
            console.error('QQ Music Search failed:', e);
            // Return empty array to allow fallback to original NetEase sorting
            return [];
        }
    }
}

export const qqMusicService = new QQMusicService();
