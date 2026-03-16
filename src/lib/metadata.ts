import NodeID3 from 'node-id3';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import util from 'util';

const execFileAsync = util.promisify(execFile);

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export interface SongMetadata {
    title: string;
    artist: string;
    album?: string;
    coverUrl?: string;
    lyrics?: string;
}

/**
 * Embed metadata into an audio file.
 * - FLAC files: uses ffmpeg to write Vorbis Comments (title/artist/album/cover/lyrics)
 * - MP3 files: uses node-id3 for ID3 tags
 * - Other formats: converts to the target format first, then tags
 */
export async function embedMetadata(
    inputPath: string,
    outputPath: string,
    metadata: SongMetadata
): Promise<void> {
    const ext = path.extname(inputPath).toLowerCase();
    const outExt = path.extname(outputPath).toLowerCase();

    try {
        // ── FLAC path: use ffmpeg for Vorbis Comments ──
        if (ext === '.flac' || outExt === '.flac') {
            await embedFlacMetadata(inputPath, outputPath, metadata);
            return;
        }

        // ── MP3 path: use node-id3 ──
        if (ext === '.mp3') {
            fs.copyFileSync(inputPath, outputPath);
        } else {
            // Convert other formats to mp3
            console.log(`[embedMetadata] Converting ${ext} to mp3...`);
            try {
                await execFileAsync('ffmpeg', [
                    '-i',
                    inputPath,
                    '-vn',
                    '-ar',
                    '44100',
                    '-ac',
                    '2',
                    '-b:a',
                    '320k',
                    '-f',
                    'mp3',
                    '-y',
                    outputPath
                ]);
                console.log(`[embedMetadata] Conversion successful: ${outputPath}`);
            } catch (ffmpegErr: unknown) {
                console.error('[embedMetadata] FFMPEG conversion failed:', getErrorMessage(ffmpegErr));
                fs.copyFileSync(inputPath, outputPath);
            }
        }

        // Tag the MP3 file with node-id3
        const buffer = fs.readFileSync(outputPath);
        const tags: NodeID3.Tags = {
            title: metadata.title,
            artist: metadata.artist,
            album: metadata.album || '',
        };

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

        if (metadata.lyrics) {
            tags.unsynchronisedLyrics = {
                language: 'eng',
                text: metadata.lyrics
            };
        }

        const taggedBuffer = NodeID3.write(tags, buffer);
        if (taggedBuffer) {
            fs.writeFileSync(outputPath, taggedBuffer);
            console.log(`[embedMetadata] Successfully embedded metadata for: ${metadata.title} (Lyrics: ${metadata.lyrics?.length || 0} chars)`);
        } else {
            console.warn('[embedMetadata] Failed to write tags (NodeID3 returned false)');
        }

    } catch (e) {
        console.error('[embedMetadata] Error:', e);
        if (!fs.existsSync(outputPath)) {
            try { fs.copyFileSync(inputPath, outputPath); } catch { }
        }
    }
}

/**
 * Embed metadata into a FLAC file using ffmpeg.
 * FLAC uses Vorbis Comments for metadata, which ffmpeg can write via -metadata flags.
 * Cover art is embedded as a FLAC metadata block via ffmpeg.
 */
async function embedFlacMetadata(
    inputPath: string,
    outputPath: string,
    metadata: SongMetadata
): Promise<void> {
    const tmpDir = path.dirname(outputPath);
    let coverPath: string | null = null;

    try {
        // Download cover art to a temp file if available
        if (metadata.coverUrl) {
            try {
                const coverResponse = await fetch(metadata.coverUrl);
                if (coverResponse.ok) {
                    const coverBuffer = Buffer.from(await coverResponse.arrayBuffer());
                    coverPath = path.join(tmpDir, `_cover_${Date.now()}.jpg`);
                    fs.writeFileSync(coverPath, coverBuffer);
                }
            } catch (e) {
                console.warn('[embedFlacMetadata] Failed to fetch cover art:', e);
            }
        }

        const args = ['-i', inputPath];

        if (coverPath) {
            args.push('-i', coverPath);
        }

        args.push('-map', '0:a');

        if (coverPath) {
            args.push('-map', '1', '-disposition:v', 'attached_pic');
        }

        args.push(
            '-codec',
            'copy',
            '-metadata',
            `title=${metadata.title}`,
            '-metadata',
            `artist=${metadata.artist}`
        );

        if (metadata.album) {
            args.push('-metadata', `album=${metadata.album}`);
        }

        if (metadata.lyrics) {
            args.push('-metadata', `LYRICS=${metadata.lyrics.substring(0, 10000)}`);
        }

        args.push('-y', outputPath);

        await execFileAsync('ffmpeg', args);
        console.log(`[embedFlacMetadata] Successfully embedded metadata for: ${metadata.title} (Lyrics: ${metadata.lyrics?.length || 0} chars)`);

    } catch (e: unknown) {
        console.error('[embedFlacMetadata] Error:', getErrorMessage(e));
        // Fallback: just copy the file without metadata
        if (!fs.existsSync(outputPath)) {
            try { fs.copyFileSync(inputPath, outputPath); } catch { }
        }
    } finally {
        // Cleanup temp files
        if (coverPath && fs.existsSync(coverPath)) {
            try { fs.unlinkSync(coverPath); } catch { }
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
