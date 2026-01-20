import { MusicInfo, MusicSource } from '../types';
import YouTube from 'youtube-sr';
import ytdl from '@distube/ytdl-core';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const TMP_DIR = path.join(process.cwd(), 'tmp_downloads');

if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
}

export class YoutubeSource implements MusicSource {
    name = 'youtube';

    async search(keyword: string): Promise<MusicInfo[]> {
        try {
            console.log(`[YoutubeSource] Searching for: ${keyword}`);
            const videos = await YouTube.search(keyword, { limit: 5, type: 'video' });

            return videos.filter(v => v.id).map(video => ({
                id: video.id!,
                name: video.title || 'Unknown Title',
                artist: video.channel?.name || 'Unknown Artist',
                album: 'YouTube',
                duration: video.duration / 1000,
                coverUrl: video.thumbnail?.url,
                source: this.name,
                originalId: video.id!
            }));
        } catch (e) {
            console.error('Youtube search failed:', e);
            return [];
        }
    }

    async getDownloadUrl(info: MusicInfo): Promise<string> {
        const filePath = path.join(TMP_DIR, `${info.id}.mp3`);

        // If file exists, return it
        if (fs.existsSync(filePath)) {
            const stats = fs.statSync(filePath);
            if (stats.size > 0) {
                console.log(`[YoutubeSource] Cached file found: ${filePath}`);
                return filePath;
            }
        }

        console.log(`[YoutubeSource] Downloading: ${info.name} (${info.id})`);

        return new Promise((resolve, reject) => {
            try {
                const videoUrl = `https://www.youtube.com/watch?v=${info.originalId}`;

                // Create agent with cookies if available
                let agent;
                try {
                    const cookieStr = process.env.YOUTUBE_COOKIES;
                    if (cookieStr) {
                        const cookies = JSON.parse(cookieStr);
                        agent = ytdl.createAgent(cookies);
                        console.log('[YoutubeSource] Using provided YouTube cookies');
                    }
                } catch (e) {
                    console.warn('[YoutubeSource] Failed to parse YOUTUBE_COOKIES:', e);
                }

                const audioStream = ytdl(videoUrl, {
                    quality: 'highestaudio',
                    filter: 'audioonly',
                    agent
                });

                // Use ffmpeg to convert to mp3
                const ffmpeg = spawn('ffmpeg', [
                    '-i', 'pipe:3',       // Input from pipe 3
                    '-b:a', '192k',       // Audio bitrate
                    '-f', 'mp3',          // Format
                    '-y',                 // Overwrite output file
                    filePath
                ], {
                    stdio: [
                        'inherit', 'inherit', 'inherit',
                        'pipe' // pipe:3
                    ]
                });

                // Pipe ytdl output to ffmpeg input (pipe 3)
                audioStream.pipe(ffmpeg.stdio[3] as any);

                ffmpeg.on('close', (code) => {
                    if (code === 0) {
                        console.log(`[YoutubeSource] Download and conversion complete: ${filePath}`);
                        resolve(filePath);
                    } else {
                        reject(new Error(`ffmpeg exited with code ${code}`));
                    }
                });

                ffmpeg.on('error', (err) => {
                    reject(new Error(`ffmpeg failed: ${err.message}`));
                });

                audioStream.on('error', (err) => {
                    reject(new Error(`ytdl failed: ${err.message}`));
                });

            } catch (e) {
                reject(e);
            }
        });
    }
}
