import { runSongSync } from '@/core/sync-song';
import { getArtistSyncSongs } from '@/core/artist-songs';
import { ArtistSyncInput, ArtistSyncResult, ArtistSyncSong, SongSyncEvent } from '@/core/types';
import { neteaseService } from '@/lib/netease';

interface ArtistSyncContext {
  onEvent?: (event: SongSyncEvent) => void;
  onProgress?: (progress: { current: number; total: number; message: string; songName?: string }) => void;
}

function mapSongToMusicInfo(song: ArtistSyncSong, fallbackArtistName: string) {
  const artistsList = song.ar || song.artists || [];
  const albumObj = song.al || song.album || {};
  const artistStr = artistsList.map((artist) => artist.name).join(', ') || fallbackArtistName;

  return {
    id: String(song.id),
    name: song.name,
    artist: artistStr,
    album: albumObj.name || '',
    duration: song.dt ? song.dt / 1000 : 0,
    coverUrl: albumObj.picUrl,
    source: song.source || 'netease',
    originalId: String(song.id),
  };
}

function mapEventMessage(event: SongSyncEvent): string {
  switch (event.type) {
    case 'song.download_started':
      return '正在下载音频...';
    case 'song.metadata_started':
    case 'song.metadata_embedded':
      return '正在写入元数据...';
    case 'song.upload_started':
      return '正在上传到云盘...';
    case 'song.uploaded':
      return '上传成功';
    case 'song.failed':
      return event.message || '处理失败';
    default:
      return event.message || '正在处理...';
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '同步失败';
}

export async function runArtistSync(
  input: ArtistSyncInput,
  context: ArtistSyncContext = {}
): Promise<ArtistSyncResult> {
  const emit = context.onEvent || (() => undefined);
  const updateProgress = context.onProgress || (() => undefined);
  const neteaseCookie = input.neteaseCookie;

  let targetSongs = input.songs && input.songs.length > 0 ? input.songs : [];

  if (targetSongs.length === 0) {
    const topSongs = await getArtistSyncSongs(input.artistId, input.artistName);
    targetSongs = topSongs.slice(0, input.count);
  }

  const results: ArtistSyncResult = {
    success: 0,
    failed: 0,
    failedSongs: [],
    playlistId: null,
  };
  const cloudIds: Array<string | number> = [];
  const total = targetSongs.length;

  for (let index = 0; index < targetSongs.length; index += 1) {
    const song = targetSongs[index];
    const baseInfo = mapSongToMusicInfo(song, input.artistName);
    const current = index + 1;

    updateProgress({
      current,
      total,
      message: '正在搜索资源...',
      songName: baseInfo.name,
    });
    emit({
      type: 'song.started',
      message: `开始处理 ${baseInfo.name}`,
      data: { current, total, songName: baseInfo.name },
    });

    try {
      const uploadRes = await runSongSync(
        {
          info: baseInfo,
          neteaseCookie,
        },
        {
          onEvent: (event) => {
            emit(event);
            updateProgress({
              current,
              total,
              message: mapEventMessage(event),
              songName: baseInfo.name,
            });
          },
        }
      );

      if (uploadRes.songId) {
        cloudIds.push(uploadRes.songId);
        results.success += 1;
      } else {
        results.failed += 1;
        results.failedSongs.push(`${baseInfo.name} (Upload ID missing)`);
      }
    } catch (error: unknown) {
      results.failed += 1;
      results.failedSongs.push(`${baseInfo.name} (${getErrorMessage(error)})`);
    }
  }

  if (input.createPlaylist && cloudIds.length > 0) {
    try {
      const playlist = await neteaseService.createPlaylist(input.artistName, neteaseCookie);
      if (playlist?.id) {
        const reversedCloudIds = [...new Set(cloudIds)].reverse();
        const added = await neteaseService.addSongsToPlaylist(playlist.id, reversedCloudIds, neteaseCookie);
        if (added) {
          results.playlistId = playlist.id;
        }
      }
    } catch {
      // Playlist creation remains best-effort. The main job should still succeed.
    }
  }

  return results;
}
