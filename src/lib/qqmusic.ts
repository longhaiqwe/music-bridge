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
    singerid?: string | number;
    singerName?: string;
    singername?: string;
    name?: string;
    mid?: string | number;
    id?: string | number;
}

interface QQSongArtist {
    singerMID?: string;
    singerMid?: string;
    singermid?: string;
    singerID?: string | number;
    singerId?: string | number;
    singerid?: string | number;
    singerName?: string;
    singername?: string;
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

interface QQMusicSearchResponse {
    req?: {
        data?: {
            body?: {
                song?: {
                    list?: QQSongRecord[];
                };
                singer?: {
                    list?: QQSearchSinger[];
                };
                zhida?: {
                    singer?: QQSearchSinger[];
                    singeritem?: QQSearchSinger[];
                    list?: QQSearchSinger[];
                };
            };
            meta?: {
                code?: number;
                msg?: string;
            };
        };
    };
}

export class QQMusicService {
    private readonly searchEndpoint = 'https://u.y.qq.com/cgi-bin/musicu.fcg';

    private normalizeText(value: string): string {
        return value.toLowerCase().replace(/\s+/g, '').trim();
    }

    private normalizeArtist(rawArtist: QQSearchSinger | QQSongArtist): QQArtistInfo | null {
        const singerMid = String(
            rawArtist.singerMID ||
            rawArtist.singerMid ||
            rawArtist.singermid ||
            rawArtist.mid ||
            rawArtist.singerID ||
            rawArtist.singerId ||
            rawArtist.singerid ||
            rawArtist.id ||
            ''
        );
        const name = String(
            rawArtist.singerName ||
            rawArtist.singername ||
            rawArtist.name ||
            ''
        ).trim();

        if (!singerMid || !name) {
            return null;
        }

        return {
            id: singerMid,
            name,
            picUrl: `https://y.gtimg.cn/music/photo_new/T001R300x300M000${singerMid}.jpg`
        };
    }

    private dedupeAndRankArtists(keyword: string, artists: Array<QQArtistInfo | null>): QQArtistInfo[] {
        const normalizedKeyword = this.normalizeText(keyword);
        const unique = new Map<string, QQArtistInfo>();

        for (const artist of artists) {
            if (!artist) {
                continue;
            }

            if (!unique.has(artist.id)) {
                unique.set(artist.id, artist);
            }
        }

        return [...unique.values()]
            .sort((a, b) => {
                const aName = this.normalizeText(a.name);
                const bName = this.normalizeText(b.name);
                const aScore = aName === normalizedKeyword ? 0 : (aName.includes(normalizedKeyword) || normalizedKeyword.includes(aName) ? 1 : 2);
                const bScore = bName === normalizedKeyword ? 0 : (bName.includes(normalizedKeyword) || normalizedKeyword.includes(bName) ? 1 : 2);

                if (aScore !== bScore) {
                    return aScore - bScore;
                }

                return a.name.localeCompare(b.name, 'zh-Hans-CN');
            })
            .slice(0, 10);
    }

    private async searchArtistsViaMusicu(keyword: string, pageSize = 10): Promise<QQArtistInfo[]> {
        const payload = {
            comm: {
                ct: 19,
                cv: 1859,
                uin: '0'
            },
            req: {
                method: 'DoSearchForQQMusicDesktop',
                module: 'music.search.SearchCgiService',
                param: {
                    grp: 1,
                    num_per_page: pageSize,
                    page_num: 1,
                    query: keyword,
                    search_type: 9
                }
            }
        };

        const response = await fetch(this.searchEndpoint, {
            method: 'POST',
            headers: {
                Accept: 'application/json, text/plain, */*',
                'Content-Type': 'application/json;charset=utf-8',
                Referer: 'https://y.qq.com/',
                Origin: 'https://y.qq.com',
                'User-Agent': 'Mozilla/5.0'
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) {
            throw new Error(`QQ artist search request failed with status ${response.status}`);
        }

        const data = await response.json() as QQMusicSearchResponse;
        const meta = data.req?.data?.meta;

        if (meta?.code && meta.code !== 0) {
            throw new Error(meta.msg || `QQ artist search returned code ${meta.code}`);
        }

        const body = data.req?.data?.body;
        const singerCandidates = [
            ...(body?.singer?.list || []),
            ...(body?.zhida?.singer || []),
            ...(body?.zhida?.singeritem || []),
            ...(body?.zhida?.list || [])
        ];

        return this.dedupeAndRankArtists(
            keyword,
            singerCandidates.map((artist) => this.normalizeArtist(artist))
        );
    }

    private async deriveArtistsFromSongs(keyword: string): Promise<QQArtistInfo[]> {
        const songs = await this.searchSongsViaMusicu(keyword, 30);
        const artists = songs.flatMap((song) => (song.musicData || song).singer || []);

        return this.dedupeAndRankArtists(
            keyword,
            artists.map((artist) => this.normalizeArtist(artist))
        );
    }

    private async searchSongsViaMusicu(keyword: string, pageSize = 10): Promise<QQSongRecord[]> {
        const payload = {
            comm: {
                ct: 19,
                cv: 1859,
                uin: '0'
            },
            req: {
                method: 'DoSearchForQQMusicDesktop',
                module: 'music.search.SearchCgiService',
                param: {
                    grp: 1,
                    num_per_page: pageSize,
                    page_num: 1,
                    query: keyword,
                    search_type: 0
                }
            }
        };

        const response = await fetch(this.searchEndpoint, {
            method: 'POST',
            headers: {
                Accept: 'application/json, text/plain, */*',
                'Content-Type': 'application/json;charset=utf-8',
                Referer: 'https://y.qq.com/',
                Origin: 'https://y.qq.com',
                'User-Agent': 'Mozilla/5.0'
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) {
            throw new Error(`QQ search request failed with status ${response.status}`);
        }

        const data = await response.json() as QQMusicSearchResponse;
        const meta = data.req?.data?.meta;

        if (meta?.code && meta.code !== 0) {
            throw new Error(meta.msg || `QQ search returned code ${meta.code}`);
        }

        return data.req?.data?.body?.song?.list || [];
    }

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
            const artists = await this.searchArtistsViaMusicu(keyword, 10);
            if (artists.length > 0) {
                return artists;
            }
        } catch (error) {
            console.error('QQ Artist Search failed:', error);
        }

        try {
            return await this.deriveArtistsFromSongs(keyword);
        } catch (fallbackError) {
            console.error('QQ Artist Search fallback failed:', fallbackError);
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
            const list = await this.searchSongsViaMusicu(keyword, 10);
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
