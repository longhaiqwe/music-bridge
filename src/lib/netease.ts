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
  // 服务器默认 Cookie（用于兼容旧模式，如环境变量配置）
  private defaultCookie: string = '';

  constructor() {
    this.loadDefaultCookie();
  }

  /**
   * 获取有效的 Cookie：优先使用传入的。
   * 如果传入了 clientCookie（即使是空字符串），说明是客户端请求，不再回退到服务器默认账号。
   */
  private getCookie(clientCookie?: string): string {
    if (clientCookie !== undefined) {
      return clientCookie;
    }
    // 只有在非 API 请求（内部直接调用且无上下文）时才回退到默认
    return this.defaultCookie;
  }

  /**
   * 加载默认 Cookie（从环境变量或本地文件）
   */
  private loadDefaultCookie() {
    // 优先从环境变量读取 Cookie（用于云端部署）
    const envCookie = process.env.NETEASE_COOKIES;
    if (envCookie) {
      try {
        if (envCookie.startsWith('{')) {
          const json = JSON.parse(envCookie);
          this.defaultCookie = json.cookie || envCookie;
          console.log('[NeteaseService] Loaded default cookie from NETEASE_COOKIES env (JSON format).');
        } else {
          this.defaultCookie = envCookie;
          console.log('[NeteaseService] Loaded default cookie from NETEASE_COOKIES env (raw string).');
        }
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
          this.defaultCookie = json.cookie;
          console.log('[NeteaseService] Default cookie is valid and loaded.');
        } else {
          this.defaultCookie = '';
          console.log('[NeteaseService] Default cookie is EXPIRED. (Age > 24h)');
        }
      } catch (e) {
        console.error('Failed to load cookie:', e);
      }
    }
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
      console.log('[NeteaseService] Login successful (803).');
      return {
        ...res.body,
        cookie: res.body.cookie // 将 cookie 返回给前端保存
      };
    }

    return res.body;
  }

  async getUserInfo(clientCookie?: string): Promise<any> {
    const cookie = this.getCookie(clientCookie);
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

  async uploadToCloudDisk(filePath: string, clientCookie?: string): Promise<any> {
    const cookie = this.getCookie(clientCookie);
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

  async getCloudDiskSongs(limit: number = 200, offset: number = 0, clientCookie?: string): Promise<any[]> {
    const cookie = this.getCookie(clientCookie);
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

  async searchArtist(keyword: string, clientCookie?: string): Promise<any[]> {
    const cookie = this.getCookie(clientCookie);
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

  async searchSong(keyword: string, clientCookie?: string): Promise<any[]> {
    const cookie = this.getCookie(clientCookie);
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

  async getLyric(songId: string | number, clientCookie?: string): Promise<string> {
    const cookie = this.getCookie(clientCookie);
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

  async getArtistTopSongs(artistId: string | number, clientCookie?: string): Promise<any[]> {
    const cookie = this.getCookie(clientCookie);
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

  async getArtistDetail(artistId: string | number, clientCookie?: string): Promise<any> {
    const cookie = this.getCookie(clientCookie);
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

  async createPlaylist(name: string, clientCookie?: string): Promise<any> {
    const cookie = this.getCookie(clientCookie);
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

  async addSongsToPlaylist(pid: string | number, songIds: (string | number)[], clientCookie?: string): Promise<boolean> {
    const cookie = this.getCookie(clientCookie);
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
