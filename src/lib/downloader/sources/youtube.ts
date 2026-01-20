import { MusicInfo, MusicSource } from '../types';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = util.promisify(exec);
const TMP_DIR = path.join(process.cwd(), 'tmp_downloads');

if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
}

export class YoutubeSource implements MusicSource {
    name = 'youtube';

    async search(keyword: string): Promise<MusicInfo[]> {
        try {
            // ytsearch5: Limit to 5 results
            // --dump-json: Output JSON
            // --flat-playlist: Don't extract video details (faster, but might miss duration)
            // Actually without flat-playlist is better for duration, but slower.
            // Let's try without flat-playlist for metadata.
            const { stdout } = await execAsync(`yt-dlp --dump-json --no-playlist "ytsearch5:${keyword}"`);

            const results: MusicInfo[] = [];
            const lines = stdout.trim().split('\n');

            for (const line of lines) {
                if (!line) continue;
                try {
                    const data = JSON.parse(line);
                    results.push({
                        id: data.id,
                        name: data.title,
                        artist: data.uploader || 'Unknown',
                        album: 'YouTube',
                        duration: data.duration,
                        coverUrl: data.thumbnail,
                        source: this.name,
                        originalId: data.id
                    });
                } catch (e) {
                    console.warn('Failed to parse yt-dlp output line', e);
                }
            }
            return results;
        } catch (e) {
            console.error('Youtube search failed:', e);
            return [];
        }
    }

    async getDownloadUrl(info: MusicInfo): Promise<string> {
        const filePath = path.join(TMP_DIR, `${info.id}.mp3`);

        // If file exists, return it
        if (fs.existsSync(filePath)) {
            return filePath;
        }

        try {
            // Download best audio and convert to mp3
            // -x: Extract audio
            // --audio-format mp3
            // -o: Output template
            await execAsync(`yt-dlp -x --audio-format mp3 -o "${path.join(TMP_DIR, '%(id)s.%(ext)s')}" ${info.originalId}`);

            // Check if file exists now (yt-dlp might keep original ext if conversion fails, but we asked for mp3)
            // Note: yt-dlp with --audio-format mp3 usually ensures .mp3 extension
            if (fs.existsSync(filePath)) {
                return filePath;
            }

            // Fallback: check other extensions
            const files = fs.readdirSync(TMP_DIR);
            const downloaded = files.find(f => f.startsWith(info.id));
            if (downloaded) {
                return path.join(TMP_DIR, downloaded);
            }

            throw new Error('Download failed: file not found');
        } catch (e) {
            console.error('Youtube download failed:', e);
            throw e;
        }
    }
}
