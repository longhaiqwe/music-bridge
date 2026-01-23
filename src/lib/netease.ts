import fs from 'fs';
import path from 'path';
// @ts-ignore
import NeteaseCloudMusicApi from 'NeteaseCloudMusicApi';

const COOKIE_FILE = path.join(process.cwd(), 'cookie.json');

// Interface for API responses (simplified)
interface ApiResponse {
  status: number;
  body: any;
  cookie?: string[];
}

export class NeteaseService {
  private cookie: string = '';

  constructor() {
    this.loadCookie();
  }

  private loadCookie() {
    // 优先从环境变量读取 Cookie（用于云端部署）
    const envCookie = process.env.NETEASE_COOKIES;
    if (envCookie) {
      try {
        // 环境变量可以是 JSON 格式 {"cookie": "...", "updatedAt": ...} 或纯 cookie 字符串
        if (envCookie.startsWith('{')) {
          const json = JSON.parse(envCookie);
          this.cookie = json.cookie || envCookie;
          console.log('[NeteaseService] Loaded cookie from NETEASE_COOKIES env (JSON format).');
        } else {
          this.cookie = envCookie;
          console.log('[NeteaseService] Loaded cookie from NETEASE_COOKIES env (raw string).');
        }
        // 环境变量中的 Cookie 不检查过期，由用户自己管理
        return;
      } catch (e) {
        console.warn('[NeteaseService] Failed to parse NETEASE_COOKIES env:', e);
      }
    }

    // Fallback: 从本地文件读取
    if (fs.existsSync(COOKIE_FILE)) {
      try {
        const data = fs.readFileSync(COOKIE_FILE, 'utf-8');
        const json = JSON.parse(data);
        console.log('[NeteaseService] Loaded cookie file. UpdatedAt:', new Date(json.updatedAt).toLocaleString());

        const ONE_DAY = 24 * 60 * 60 * 1000;
        if (!json.updatedAt || (Date.now() - json.updatedAt < ONE_DAY)) {
          this.cookie = json.cookie;
          console.log('[NeteaseService] Cookie is valid and loaded.');
        } else {
          this.cookie = ''; // Expired
          console.log('[NeteaseService] Cookie is EXPIRED. (Age > 24h)');
        }
      } catch (e) {
        console.error('Failed to load cookie:', e);
      }
    }
  }

  private saveCookie(cookie: string) {
    this.cookie = cookie;
    fs.writeFileSync(COOKIE_FILE, JSON.stringify({
      cookie,
      updatedAt: Date.now()
    }));
    console.log('[NeteaseService] Saved new cookie. Length:', cookie.length);
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

  async loginQrCodeCheck(key: string): Promise<any> {
    const res = await NeteaseCloudMusicApi.login_qr_check({
      key,
      timestamp: Date.now()
    } as any) as any;

    if (res?.body?.code === 803) {
      // Login successful, save cookie
      console.log('[NeteaseService] Login successful (803). Saving cookie...');
      this.saveCookie(res.body.cookie);
    }

    return res.body;
  }

  async getUserInfo(): Promise<any> {
    if (!this.cookie) return null;
    try {
      const res = await NeteaseCloudMusicApi.user_account({
        cookie: this.cookie,
        timestamp: Date.now()
      } as any) as any;
      return res.body;
    } catch (e) {
      return null;
    }
  }

  async uploadToCloudDisk(filePath: string): Promise<any> {
    if (!this.cookie) throw new Error('Not logged in');

    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);

    let lastError;
    const MAX_RETRIES = 5;

    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        if (i > 0) {
          // Exponential-ish backoff: 2s, 4s, 6s, 8s
          const delay = 2000 * i;
          console.log(`Retrying upload (${i + 1}/${MAX_RETRIES}) after ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
        }

        const res = await NeteaseCloudMusicApi.cloud({
          cookie: this.cookie,
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

        // If it's not a network/server error (e.g. 4xx), maybe don't retry? 
        // But usually "Client network socket disconnected" or 502 are worth retrying.
        // Safe to retry most upload errors.
      }
    }

    throw lastError;
  }

  async getCloudDiskSongs(limit: number = 200, offset: number = 0): Promise<any[]> {
    if (!this.cookie) throw new Error('Not logged in');
    try {
      const res = await NeteaseCloudMusicApi.user_cloud({
        limit,
        offset,
        cookie: this.cookie
      }) as any;
      return res.body.data || [];
    } catch (e) {
      console.error('Get cloud disk songs failed:', e);
      return [];
    }
  }

  async searchArtist(keyword: string): Promise<any[]> {
    if (!this.cookie) throw new Error('Not logged in');
    try {
      const res = await NeteaseCloudMusicApi.cloudsearch({
        keywords: keyword,
        type: 100, // 100: artist
        limit: 10,
        cookie: this.cookie
      }) as any;
      return res.body.result?.artists || [];
    } catch (e) {
      console.error('Search artist failed:', e);
      return [];
    }
  }

  async searchSong(keyword: string): Promise<any[]> {
    if (!this.cookie) {
      console.warn('[searchSong] Not logged in, returning empty results');
      return [];
    }
    try {
      const res = await NeteaseCloudMusicApi.cloudsearch({
        keywords: keyword,
        type: 1, // 1: song
        limit: 5,
        cookie: this.cookie
      }) as any;
      return res.body.result?.songs || [];
    } catch (e) {
      console.error('Search song failed:', e);
      return [];
    }
  }

  async getLyric(songId: string | number): Promise<string> {
    // Note: Lyric API works without login sometimes, but better safe
    try {
      const res = await NeteaseCloudMusicApi.lyric({
        id: songId,
        cookie: this.cookie
      }) as any;
      return res.body.lrc?.lyric || '';
    } catch (e) {
      console.error('Get lyric failed:', e);
      return '';
    }
  }

  async getArtistTopSongs(artistId: string | number): Promise<any[]> {
    if (!this.cookie) throw new Error('Not logged in');
    try {
      const res = await NeteaseCloudMusicApi.artist_top_song({
        id: artistId,
        cookie: this.cookie
      }) as any;
      return res.body.songs || [];
    } catch (e) {
      console.error('Get artist top songs failed:', e);
      return [];
    }
  }

  async getArtistDetail(artistId: string | number): Promise<any> {
    if (!this.cookie) throw new Error('Not logged in');
    try {
      const res = await NeteaseCloudMusicApi.artist_detail({
        id: artistId,
        cookie: this.cookie
      }) as any;
      return res.body.data?.artist || {};
    } catch (e) {
      console.error('Get artist detail failed:', e);
      return {};
    }
  }

  async createPlaylist(name: string): Promise<any> {
    if (!this.cookie) throw new Error('Not logged in');
    try {
      const res = await NeteaseCloudMusicApi.playlist_create({
        name,
        privacy: 10, // 10: public, 0: private (could vary by API version but usually required)
        cookie: this.cookie
      }) as any;
      return res.body.playlist; // Contains id and other info
    } catch (e) {
      console.error('Create playlist failed:', e);
      throw e;
    }
  }

  async addSongsToPlaylist(pid: string | number, songIds: (string | number)[]): Promise<boolean> {
    if (!this.cookie) throw new Error('Not logged in');

    // API expects comma separated string of ids
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
          cookie: this.cookie
        }) as any;

        if (res && res.body) {
          // Fix: Netease API response is sometimes nested in body.body or body.code
          const code = res.body.code || (res.body.body && res.body.body.code);

          if (code === 200 || code === 502) {
            if (code === 200) {
              return true;
            }
            // 502 usually means duplicate songs, which is fine if we partially succeeded or it's just a warning
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
