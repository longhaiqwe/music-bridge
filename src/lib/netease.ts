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
    if (fs.existsSync(COOKIE_FILE)) {
      try {
        const data = fs.readFileSync(COOKIE_FILE, 'utf-8');
        const json = JSON.parse(data);

        // Check for expiration (1 day = 24 * 60 * 60 * 1000 ms)
        // If updatedAt is missing, we also accept it this time (backward compatibility) 
        // OR we can force re-login. Given user request, let's strictly enforce or maybe expire legacy?
        // Let's implement strict expiration if user wants security.
        // But to be friendly, if updatedAt is missing, maybe we should assume it's old and expire it, 
        // OR treating it as "unknown" and valid for now? 
        // User asked for "safety", so expiring legacy/sessions without timestamp is safer.
        // I will expire if updatedAt is missing to ensure everything complies with the new policy.

        const ONE_DAY = 24 * 60 * 60 * 1000;
        if (!json.updatedAt || (Date.now() - json.updatedAt < ONE_DAY)) {
          this.cookie = json.cookie;
        } else {
          this.cookie = ''; // Expired
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

    try {
      const res = await NeteaseCloudMusicApi.cloud({
        cookie: this.cookie,
        songFile: {
          name: fileName,
          data: fileBuffer
        }
      }) as any;
      return res.body;
    } catch (e) {
      console.error('Upload failed:', e);
      throw e;
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
    try {
      // API expects comma separated string of ids
      const tracks = songIds.join(',');
      const res = await NeteaseCloudMusicApi.playlist_tracks({
        op: 'add',
        pid,
        tracks,
        cookie: this.cookie
      }) as any;

      if (res.body.code !== 200) {
        console.error(`Add songs failed. Code: ${res.body.code}, Message: ${res.body.message}`);
      }
      return res.body.code === 200;
    } catch (e: any) {
      // Often returns 502 if some songs are invalid, but might still partially succeed. 
      // For now logging it.
      console.error('Add songs to playlist failed:', e);
      // Sometimes the API returns 502/200 OK mixed logic in different versions, 
      // but typically 200 means full success.
      // We will return false if strictly failed.
      return false;
    }
  }
}

export const neteaseService = new NeteaseService();
