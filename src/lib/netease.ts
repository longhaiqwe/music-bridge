import fs from 'fs';
import path from 'path';
// @ts-ignore
import NeteaseCloudMusicApi from 'NeteaseCloudMusicApi';

// @ts-ignore
import NeteaseCloudMusicApi from 'NeteaseCloudMusicApi';

// Interface for API responses (simplified)
interface ApiResponse {
  status: number;
  body: any;
  cookie?: string[];
}

export class NeteaseService {
  constructor() {
  }

  async loginQrCodeKey(): Promise<string> {
    const res = await NeteaseCloudMusicApi.login_qr_key({ timestamp: Date.now() } as any) as any;
    return res.body.data.unikey;
  }

  async loginQrCodeCreate(key: string): Promise<string> {
    const res = await NeteaseCloudMusicApi.login_qr_create({
      key,
      qrimg: true,
      timestamp: Date.now()
    } as any) as any;
    return res.body.data.qrimg;
  }

  /**
   * 检查二维码登录状态
   * @returns 包含 code 和 cookie（如果登录成功）
   */
  async loginQrCodeCheck(key: string): Promise<any> {
    const res = await NeteaseCloudMusicApi.login_qr_check({
      key,
      timestamp: Date.now()
    } as any) as any;

    // 登录成功时返回 cookie 给调用方
    if (res?.body?.code === 803) {
      console.log('[NeteaseService] Login successful (803). Returning cookie to client.');
      return {
        ...res.body,
        cookie: res.body.cookie // 将 cookie 返回给前端保存
      };
    }

    return res.body;
  }

  async getUserInfo(cookie?: string): Promise<any> {
    if (!cookie) return null;
    try {
      const res = await NeteaseCloudMusicApi.user_account({
        cookie,
        timestamp: Date.now()
      } as any) as any;
      return res.body;
    } catch (e) {
      return null;
    }
  }

  async uploadToCloudDisk(filePath: string, cookie?: string): Promise<any> {
    if (!cookie) throw new Error('Not logged in');

    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);

    let lastError;
    const MAX_RETRIES = 5;

    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        if (i > 0) {
          const delay = 2000 * i;
          console.log(`Retrying upload (${i + 1}/${MAX_RETRIES}) after ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
        }

        const res = await NeteaseCloudMusicApi.cloud({
          cookie,
          songFile: {
            name: fileName,
            data: fileBuffer
          }
        }) as any;
        return res.body;
      } catch (e: any) {
        const errMsg = (e && typeof e === 'object' && e.message) ? e.message : String(e);
        console.error(`Upload failed (attempt ${i + 1}/${MAX_RETRIES}):`, errMsg);
        lastError = e;
      }
    }

    throw lastError;
  }

  async getCloudDiskSongs(limit: number = 200, offset: number = 0, cookie?: string): Promise<any[]> {
    if (!cookie) throw new Error('Not logged in');
    try {
      const res = await NeteaseCloudMusicApi.user_cloud({
        limit,
        offset,
        cookie
      }) as any;
      return res.body.data || [];
    } catch (e) {
      console.error('Get cloud disk songs failed:', e);
      return [];
    }
  }

  async searchArtist(keyword: string, cookie?: string): Promise<any[]> {
    if (!cookie) throw new Error('Not logged in');
    try {
      const res = await NeteaseCloudMusicApi.cloudsearch({
        keywords: keyword,
        type: 100, // 100: artist
        limit: 10,
        cookie
      }) as any;
      return res.body.result?.artists || [];
    } catch (e) {
      console.error('Search artist failed:', e);
      return [];
    }
  }

  async searchSong(keyword: string, cookie?: string): Promise<any[]> {
    if (!cookie) {
      console.warn('[searchSong] Not logged in, returning empty results');
      return [];
    }
    try {
      const res = await NeteaseCloudMusicApi.cloudsearch({
        keywords: keyword,
        type: 1, // 1: song
        limit: 5,
        cookie
      }) as any;
      return res.body.result?.songs || [];
    } catch (e) {
      console.error('Search song failed:', e);
      return [];
    }
  }

  async getLyric(songId: string | number, cookie?: string): Promise<string> {
    try {
      const res = await NeteaseCloudMusicApi.lyric({
        id: songId,
        cookie
      }) as any;
      return res.body.lrc?.lyric || '';
    } catch (e) {
      console.error('Get lyric failed:', e);
      return '';
    }
  }

  async getArtistTopSongs(artistId: string | number, cookie?: string): Promise<any[]> {
    if (!cookie) throw new Error('Not logged in');
    try {
      const res = await NeteaseCloudMusicApi.artist_top_song({
        id: artistId,
        cookie
      }) as any;
      return res.body.songs || [];
    } catch (e) {
      console.error('Get artist top songs failed:', e);
      return [];
    }
  }

  async getArtistDetail(artistId: string | number, cookie?: string): Promise<any> {
    if (!cookie) throw new Error('Not logged in');
    try {
      const res = await NeteaseCloudMusicApi.artist_detail({
        id: artistId,
        cookie
      }) as any;
      return res.body.data?.artist || {};
    } catch (e) {
      console.error('Get artist detail failed:', e);
      return {};
    }
  }

  async createPlaylist(name: string, cookie?: string): Promise<any> {
    if (!cookie) throw new Error('Not logged in');
    try {
      const res = await NeteaseCloudMusicApi.playlist_create({
        name,
        privacy: 10,
        cookie
      }) as any;
      return res.body.playlist;
    } catch (e) {
      console.error('Create playlist failed:', e);
      throw e;
    }
  }

  async addSongsToPlaylist(pid: string | number, songIds: (string | number)[], cookie?: string): Promise<boolean> {
    if (!cookie) throw new Error('Not logged in');

    const tracks = songIds.join(',');
    const MAX_RETRIES = 3;

    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        if (i > 0) {
          console.log(`Retrying add songs to playlist (${i + 1}/${MAX_RETRIES})...`);
          await new Promise(r => setTimeout(r, 1500 * i));
        }

        const res = await NeteaseCloudMusicApi.playlist_tracks({
          op: 'add',
          pid,
          tracks,
          cookie
        }) as any;

        if (res && res.body) {
          const code = res.body.code || (res.body.body && res.body.body.code);

          if (code === 200 || code === 502) {
            if (code === 200) {
              return true;
            }
            console.log(`Add songs API returned code ${code} (likely duplicates), treating as success.`);
            return true;
          }
          console.log(`Add songs API returned code ${code}:`, res.body);
        } else {
          console.error(`Add songs failed. Full Response:`, JSON.stringify(res, null, 2));
        }
      } catch (e: any) {
        console.error(`Add songs to playlist failed (attempt ${i + 1}/${MAX_RETRIES}):`, e);
        if (i === MAX_RETRIES - 1) return false;
      }
    }
    return false;
  }
}


export const neteaseService = new NeteaseService();
