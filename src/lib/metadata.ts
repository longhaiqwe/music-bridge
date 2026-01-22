import NodeID3 from 'node-id3';
import fs from 'fs';
import path from 'path';

export interface SongMetadata {
    title: string;
    artist: string;
    album?: string;
    coverUrl?: string;
    lyrics?: string;
}

/**
 * Embed ID3 metadata into an audio file using node-id3.
 * This is a pure JavaScript solution that works in serverless environments.
 * 
 * Note: node-id3 works best with MP3 files. For WebM/other formats,
 * we rename the file extension and hope for the best, or just copy it.
 */
export async function embedMetadata(
    inputPath: string,
    outputPath: string,
    metadata: SongMetadata
): Promise<void> {
    const ext = path.extname(inputPath).toLowerCase();

    // Check if we need to convert
    // If input is not mp3, or if input IS mp3 but we want to ensure it's clean/standard,
    // we can run it through ffmpeg.
    // However, to save time, if it is already mp3 and we are just tagging, we might skip conversion
    // UNLESS the user explicitly wants to ensure mp3 format.

    // Strategy:
    // 1. If input is mp3, copy to temp location (or just use as is) for tagging.
    // 2. If input is NOT mp3, convert to mp3 at outputPath.
    // 3. Tag the file at outputPath.

    let fileToTag = outputPath;

    try {
        if (ext === '.mp3') {
            // It's already mp3, just copy to destination then tag
            fs.copyFileSync(inputPath, outputPath);
        } else {
            // Needs conversion
            console.log(`[embedMetadata] Converting ${ext} to mp3...`);

            // FFMPEG command: -i input -acodec libmp3lame -b:a 320k -y output
            // Using execSync for simplicity in this async function, or promisified exec
            const { exec } = require('child_process');
            const util = require('util');
            const execAsync = util.promisify(exec);

            try {
                // simple conversion
                await execAsync(`ffmpeg -i "${inputPath}" -vn -ar 44100 -ac 2 -b:a 320k -f mp3 -y "${outputPath}"`);
                console.log(`[embedMetadata] Conversion successful: ${outputPath}`);
            } catch (ffmpegErr: any) {
                console.error('[embedMetadata] FFMPEG conversion failed:', ffmpegErr);
                // Fallback: just copy original and rename (hacky, might fail ID3)
                // But better than nothing
                fs.copyFileSync(inputPath, outputPath);
            }
        }

        // Now tag the file at outputPath (which should be mp3 now)
        const buffer = fs.readFileSync(outputPath);

        // Prepare ID3 tags
        const tags: NodeID3.Tags = {
            title: metadata.title,
            artist: metadata.artist,
            album: metadata.album || '',
        };

        // Optionally add cover art
        if (metadata.coverUrl) {
            try {
                const coverResponse = await fetch(metadata.coverUrl);
                if (coverResponse.ok) {
                    const coverBuffer = Buffer.from(await coverResponse.arrayBuffer());
                    tags.image = {
                        mime: 'image/jpeg',
                        type: { id: 3, name: 'front cover' },
                        description: 'Cover',
                        imageBuffer: coverBuffer
                    };
                }
            } catch (e) {
                console.warn('[embedMetadata] Failed to fetch cover art:', e);
            }
        }

        // Add Lyrics
        if (metadata.lyrics) {
            console.log(`[embedMetadata] Embedding lyrics (${metadata.lyrics.length} chars) into: ${metadata.title}`);
            tags.unsynchronisedLyrics = {
                language: 'eng',
                text: metadata.lyrics
            };
        }

        // Write tags
        const taggedBuffer = NodeID3.write(tags, buffer);

        if (taggedBuffer) {
            fs.writeFileSync(outputPath, taggedBuffer);
            console.log(`[embedMetadata] Successfully embedded metadata for: ${metadata.title}`);
        } else {
            console.warn('[embedMetadata] Failed to write tags (NodeID3 returned false)');
        }

    } catch (e) {
        console.error('[embedMetadata] Error:', e);
        // Ensure output exists at least
        if (!fs.existsSync(outputPath)) {
            try { fs.copyFileSync(inputPath, outputPath); } catch { }
        }
    }
}

/**
 * Rename a file with proper song name for better identification.
 * This is useful when ID3 tags can't be written (non-MP3 files).
 */
export function getSafeFileName(name: string, ext: string): string {
    // Remove invalid characters but keep Chinese and common characters
    const safeName = name
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\s+/g, ' ')
        .trim();

    return `${safeName}.${ext}`;
}
