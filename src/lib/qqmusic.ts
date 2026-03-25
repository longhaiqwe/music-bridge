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

export interface QQAlbumInfo {
    id: string;
    name: string;
    artistName: string;
    picUrl: string;
    publishTime?: string;
    songCount?: number;
    artistId?: string;
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

interface QQAlbumSearchSinger {
    id?: string | number;
    mid?: string | number;
    name?: string;
    title?: string;
}

interface QQAlbumSearchRecord {
    albumMID?: string;
    albumMid?: string;
    albummid?: string;
    albumID?: string | number;
    albumid?: string | number;
    albumName?: string;
    albumname?: string;
    albumPic?: string;
    albumpic?: string;
    publicTime?: string;
    publictime?: string;
    singerMID?: string | number;
    singermid?: string | number;
    singerName?: string;
    singername?: string;
    singer_list?: QQAlbumSearchSinger[];
    song_count?: number;
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
    private readonly apiTimeoutMs = 10000;

    private async withTimeout<T>(promise: Promise<T>, operation: string, timeoutMs = this.apiTimeoutMs): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined;

        try {
            return await Promise.race([
                promise,
                new Promise<T>((_, reject) => {
                    timer = setTimeout(() => {
                        reject(new Error(`${operation} timed out after ${timeoutMs}ms`));
                    }, timeoutMs);
                })
            ]);
        } finally {
            if (timer) {
                clearTimeout(timer);
            }
        }
    }

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

    private normalizeAlbum(rawAlbum: QQAlbumSearchRecord): QQAlbumInfo | null {
        const albumMid = String(
            rawAlbum.albumMID ||
            rawAlbum.albumMid ||
            rawAlbum.albummid ||
            ''
        );
        const name = String(rawAlbum.albumName || rawAlbum.albumname || '').trim();
        const artistName = String(
            rawAlbum.singerName ||
            rawAlbum.singername ||
            rawAlbum.singer_list?.map((artist) => artist.name || artist.title || '').filter(Boolean).join(', ') ||
            ''
        ).trim();

        if (!albumMid || !name) {
            return null;
        }

        return {
            id: albumMid,
            name,
            artistName,
            picUrl: albumMid
                ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`
                : String(rawAlbum.albumPic || rawAlbum.albumpic || ''),
            publishTime: rawAlbum.publicTime || rawAlbum.publictime || undefined,
            songCount: typeof rawAlbum.song_count === 'number' ? rawAlbum.song_count : undefined,
            artistId: String(
                rawAlbum.singerMID ||
                rawAlbum.singermid ||
                rawAlbum.singer_list?.[0]?.mid ||
                rawAlbum.singer_list?.[0]?.id ||
                ''
            ) || undefined,
        };
    }

    private dedupeAndRankAlbums(keyword: string, albums: Array<QQAlbumInfo | null>): QQAlbumInfo[] {
        const normalizedKeyword = this.normalizeText(keyword);
        const unique = new Map<string, QQAlbumInfo>();

        for (const album of albums) {
            if (!album) {
                continue;
            }

            if (!unique.has(album.id)) {
                unique.set(album.id, album);
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

                if (a.publishTime && b.publishTime && a.publishTime !== b.publishTime) {
                    return b.publishTime.localeCompare(a.publishTime);
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

    async searchAlbums(keyword: string): Promise<QQAlbumInfo[]> {
        try {
            const result = await this.withTimeout(
                qq.api('search', {
                    key: keyword,
                    t: 8,
                    pageNo: 1,
                    pageSize: 10,
                }),
                'QQ album search'
            ) as { list?: QQAlbumSearchRecord[] };

            return this.dedupeAndRankAlbums(
                keyword,
                (result.list || []).map((album) => this.normalizeAlbum(album))
            );
        } catch (error) {
            console.error('QQ Album Search failed:', error);
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
            const result = await this.withTimeout(
                qq.api('singer/songs', {
                    singermid: singerMid,
                    num,
                    page: 1
                }),
                'QQ artist hot songs'
            ) as {
                data?: { list?: QQSongRecord[] };
                list?: QQSongRecord[];
            };

            const list = result?.data?.list || result?.list || [];
            return list.map((song: QQSongRecord) => this.normalizeSong(song));
        } catch (error) {
            console.error('QQ Artist Hot Songs failed:', error);
            return [];
        }
    }

    async getAlbumSongsByAlbumMid(albumMid: string): Promise<SongInfo[]> {
        try {
            const result = await this.withTimeout(
                qq.api('album/songs', {
                    albummid: albumMid,
                }),
                'QQ album songs'
            ) as { list?: QQSongRecord[] };

            return (result.list || []).map((song: QQSongRecord) => this.normalizeSong(song));
        } catch (error) {
            console.error('QQ Album Songs failed:', error);
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
            const res = await this.withTimeout(
                qq.api('lyric', {
                    songmid: songId // QQ Music uses songmid for lyrics usually
                }),
                `QQ lyric ${songId}`
            ) as {
                data?: { lyric?: string };
                lyric?: string;
            };

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
