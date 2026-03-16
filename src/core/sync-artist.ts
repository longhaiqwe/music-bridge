import { runSongSync } from '@/core/sync-song';
import { getArtistSyncSongs } from '@/core/artist-songs';
import { ArtistSyncInput, ArtistSyncResult, ArtistSyncSong, SongSyncEvent } from '@/core/types';
import { neteaseService } from '@/lib/netease';

interface ArtistSyncContext {
  onEvent?: (event: SongSyncEvent) => void;
  onProgress?: (progress: { current: number; total: number; message: string; songName?: string }) => void;
}

const DEFAULT_ARTIST_SYNC_CONCURRENCY = 2;
const MAX_ARTIST_SYNC_CONCURRENCY = 3;

function getArtistSyncConcurrency() {
  const rawValue = Number(process.env.ARTIST_SYNC_CONCURRENCY || DEFAULT_ARTIST_SYNC_CONCURRENCY);
  if (!Number.isFinite(rawValue)) {
    return DEFAULT_ARTIST_SYNC_CONCURRENCY;
  }

  return Math.min(MAX_ARTIST_SYNC_CONCURRENCY, Math.max(1, Math.floor(rawValue)));
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

function withConcurrencyLabel(message: string, activeCount: number) {
  if (activeCount <= 1) {
    return message;
  }

  return `${message} (并行 ${activeCount} 首)`;
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
  const total = targetSongs.length;
  const concurrency = Math.min(getArtistSyncConcurrency(), Math.max(total, 1));
  const cloudIdsByIndex: Array<string | number | null> = new Array(total).fill(null);
  const failedSongsByIndex: Array<string | null> = new Array(total).fill(null);
  const activeSongs = new Map<number, string>();
  let completedCount = 0;
  let nextIndex = 0;

  const emitProgress = (message: string, songName?: string) => {
    updateProgress({
      current: completedCount,
      total,
      message: withConcurrencyLabel(message, activeSongs.size),
      songName,
    });
  };

  if (total === 0) {
    emitProgress('未找到可同步歌曲');
    return results;
  }

  const syncOneSong = async (index: number) => {
    const song = targetSongs[index];
    const baseInfo = mapSongToMusicInfo(song, input.artistName);
    activeSongs.set(index, baseInfo.name);
    emitProgress('正在搜索资源...', baseInfo.name);

    try {
      const uploadRes = await runSongSync(
        {
          info: baseInfo,
          neteaseCookie,
        },
        {
          onEvent: (event) => {
            emit(event);
            emitProgress(mapEventMessage(event), baseInfo.name);
          },
        }
      );

      if (uploadRes.songId) {
        cloudIdsByIndex[index] = uploadRes.songId;
      } else {
        failedSongsByIndex[index] = `${baseInfo.name} (Upload ID missing)`;
      }
    } catch (error: unknown) {
      failedSongsByIndex[index] = `${baseInfo.name} (${getErrorMessage(error)})`;
    } finally {
      activeSongs.delete(index);
      completedCount += 1;

      const nextSongName = activeSongs.values().next().value as string | undefined;
      emitProgress(completedCount === total ? '同步完成' : '正在处理其余歌曲...', nextSongName);
    }
  };

  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= total) {
        return;
      }

      await syncOneSong(index);
    }
  };

  emitProgress(`开始同步，共 ${total} 首`, mapSongToMusicInfo(targetSongs[0], input.artistName).name);
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const cloudIds = cloudIdsByIndex.filter((songId): songId is string | number => songId !== null);
  results.success = cloudIds.length;
  results.failedSongs = failedSongsByIndex.filter((song): song is string => Boolean(song));
  results.failed = results.failedSongs.length;

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
