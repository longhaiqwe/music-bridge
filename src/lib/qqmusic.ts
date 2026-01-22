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
                key: artistName,
                pageSize: 50 // Increase limit to fetch more songs
            });

            // @ts-ignore
            const list = searchRes?.list || searchRes?.data?.list || [];

            if (list.length > 0) {
                // Even a general search usually puts the artist's songs first if we search for the artist name?
                // Actually standard behavior: searching "ArtistName" returns songs by that artist sorted by popularity.
                // This is the simplest way to get "Hot Songs".

                // Filter to ensure the song artist matches the requested artist (fuzzy match)
                // Normalize function: remove spaces and convert to lower case
                const normalize = (str: string) => str.toLowerCase().replace(/\s+/g, '');
                const normalizedArtistName = normalize(artistName);

                // @ts-ignore
                const filtered = list.filter(item => {
                    // @ts-ignore
                    const singers = item.singer || [];
                    // @ts-ignore
                    return singers.some(s => {
                        const sName = normalize(s.name);
                        return sName.includes(normalizedArtistName) || normalizedArtistName.includes(sName);
                    });
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
            } else {
                console.warn(`[QQ Music Debug] No results found for ${artistName}. Raw keys: ${Object.keys(searchRes || {})}`);
                if (searchRes && searchRes.data) {
                    console.warn(`[QQ Music Debug] searchRes.data keys: ${Object.keys(searchRes.data)}`);
                }
                // Try logging the code or message if available
                // @ts-ignore
                if (searchRes?.code) console.warn(`[QQ Music Debug] Code: ${searchRes.code}`);
                // @ts-ignore
                if (searchRes?.subcode) console.warn(`[QQ Music Debug] Subcode: ${searchRes.subcode}`);
            }

            return [];

        } catch (e) {
            console.error('QQ Music Search failed:', e);
            // Return empty array to allow fallback to original NetEase sorting
            // Return empty array to allow fallback to original NetEase sorting
            return [];
        }
    }

    // General search for songs
    async search(keyword: string): Promise<SongInfo[]> {
        try {
            // @ts-ignore
            const searchRes = await qq.api('search', {
                key: keyword,
                pageSize: 10
            });

            // @ts-ignore
            const list = searchRes?.list || searchRes?.data?.list || [];

            // @ts-ignore
            return list.map(s => {
                return {
                    id: s.songmid || s.mid || s.songid,
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
                    dt: (s.interval || 0) * 1000,
                    source: 'qq'
                } as SongInfo;
            });
        } catch (e) {
            console.error('QQ General Search failed:', e);
            return [];
        }
    }
    async getLyric(songId: string | number): Promise<string> {
        try {
            // @ts-ignore
            const res = await qq.api('lyric', {
                songmid: songId // QQ Music uses songmid for lyrics usually
            });

            // @ts-ignore
            if (res?.data?.lyric) return res.data.lyric;
            // @ts-ignore
            if (res?.lyric) return res.lyric;

            return '';
        } catch (e) {
            console.error('QQ Music getLyric failed:', e);
            return '';
        }
    }
}

export const qqMusicService = new QQMusicService();
