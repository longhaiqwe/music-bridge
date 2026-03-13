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

export interface QQArtistInfo {
    id: string;
    name: string;
    picUrl: string;
}

interface QQSearchSinger {
    singerMID?: string;
    singerMid?: string;
    singermid?: string;
    singerID?: string | number;
    singerId?: string | number;
    singerName?: string;
    singername?: string;
    name?: string;
}

interface QQSongArtist {
    mid?: string | number;
    id?: string | number;
    name?: string;
}

interface QQSongAlbum {
    mid?: string | number;
    id?: string | number;
    name?: string;
}

interface QQSongRecord {
    songmid?: string | number;
    mid?: string | number;
    songid?: string | number;
    id?: string | number;
    songname?: string;
    name?: string;
    title?: string;
    singer?: QQSongArtist[];
    album?: QQSongAlbum;
    albumid?: string | number;
    albummid?: string | number;
    albumname?: string;
    interval?: number;
    musicData?: QQSongRecord;
}

export class QQMusicService {
    private normalizeSong(rawSong: QQSongRecord): SongInfo {
        const song = rawSong.musicData || rawSong;
        const albumMid = song.albummid || song.album?.mid;

        return {
            id: song.songmid || song.mid || song.songid || song.id || '',
            name: song.songname || song.name || song.title || '',
            ar: (song.singer || []).map((artist) => ({
                id: artist.mid || artist.id || '',
                name: artist.name || ''
            })),
            al: {
                id: albumMid || song.albumid || song.album?.id || '',
                name: song.albumname || song.album?.name || '',
                picUrl: albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : undefined
            },
            dt: (song.interval || 0) * 1000,
            source: 'qq'
        };
    }

    async searchArtists(keyword: string): Promise<QQArtistInfo[]> {
        try {
            const searchRes = await qq.api('search', {
                key: keyword,
                t: 9,
                pageSize: 10
            });

            const list = searchRes?.data?.list || searchRes?.list || [];

            return list
                .map((artist: QQSearchSinger) => {
                    const singerMid = artist.singerMID || artist.singerMid || artist.singermid;
                    const name = artist.singerName || artist.singername || artist.name || '';

                    if (!singerMid || !name) {
                        return null;
                    }

                    return {
                        id: singerMid,
                        name,
                        picUrl: `https://y.gtimg.cn/music/photo_new/T001R300x300M000${singerMid}.jpg`
                    } satisfies QQArtistInfo;
                })
                .filter((artist: QQArtistInfo | null): artist is QQArtistInfo => Boolean(artist));
        } catch (error) {
            console.error('QQ Artist Search failed:', error);
            return [];
        }
    }

    // Search for an artist and return their hot songs
    async getArtistHotSongs(artistName: string): Promise<SongInfo[]> {
        const artists = await this.searchArtists(artistName);
        const exactMatch = artists.find((artist) => artist.name.replace(/\s+/g, '') === artistName.replace(/\s+/g, ''));
        const resolvedArtist = exactMatch || artists[0];

        if (!resolvedArtist) {
            return [];
        }

        return this.getArtistHotSongsBySingerMid(resolvedArtist.id);
    }

    async getArtistHotSongsBySingerMid(singerMid: string, num = 20): Promise<SongInfo[]> {
        try {
            const result = await qq.api('singer/songs', {
                singermid: singerMid,
                num,
                page: 1
            });

            const list = result?.data?.list || result?.list || [];
            return list.map((song: QQSongRecord) => this.normalizeSong(song));
        } catch (error) {
            console.error('QQ Artist Hot Songs failed:', error);
            return [];
        }
    }

    // General search for songs
    async search(keyword: string): Promise<SongInfo[]> {
        try {
            const searchRes = await qq.api('search', {
                key: keyword,
                pageSize: 10
            });

            const list = searchRes?.list || searchRes?.data?.list || [];
            return list.map((song: QQSongRecord) => this.normalizeSong(song));
        } catch (error) {
            console.error('QQ General Search failed:', error);
            return [];
        }
    }
    async getLyric(songId: string | number): Promise<string> {
        try {
            const res = await qq.api('lyric', {
                songmid: songId // QQ Music uses songmid for lyrics usually
            });

            if (res?.data?.lyric) return res.data.lyric;
            if (res?.lyric) return res.lyric;

            return '';
        } catch (e) {
            console.error('QQ Music getLyric failed:', e);
            return '';
        }
    }
}

export const qqMusicService = new QQMusicService();
