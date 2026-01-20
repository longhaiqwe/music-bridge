import NodeID3 from 'node-id3';
import fs from 'fs';
import path from 'path';

export interface SongMetadata {
    title: string;
    artist: string;
    album?: string;
    coverUrl?: string;
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

    // node-id3 only works with MP3 files
    // For other formats (webm, m4a, etc.), we just copy and hope
    // the filename carries the metadata
    if (ext !== '.mp3') {
        // For non-MP3 files, just copy with the correct name
        // The filename itself will help identify the song
        fs.copyFileSync(inputPath, outputPath);
        console.log(`[embedMetadata] Non-MP3 file (${ext}), copied without ID3 tags`);
        return;
    }

    try {
        // Read the original file
        const buffer = fs.readFileSync(inputPath);

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

        // Write tags
        const taggedBuffer = NodeID3.write(tags, buffer);

        if (taggedBuffer) {
            fs.writeFileSync(outputPath, taggedBuffer);
            console.log(`[embedMetadata] Successfully embedded metadata for: ${metadata.title}`);
        } else {
            // Fallback: just copy
            fs.copyFileSync(inputPath, outputPath);
            console.warn('[embedMetadata] Failed to write tags, copied original file');
        }
    } catch (e) {
        console.error('[embedMetadata] Error:', e);
        // Fallback: just copy
        fs.copyFileSync(inputPath, outputPath);
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
