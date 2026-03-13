import { processSongSync } from '@/lib/sync-service';
import { SongSyncEvent, SongSyncInput, SongSyncResult } from '@/core/types';

interface SongSyncContext {
  onEvent?: (event: SongSyncEvent) => void;
}

export async function runSongSync(
  input: SongSyncInput,
  context: SongSyncContext = {}
): Promise<SongSyncResult> {
  const { info, neteaseCookie } = input;
  const emit = context.onEvent || (() => undefined);

  emit({
    type: 'song.started',
    message: `开始处理 ${info.name}`,
    data: { songName: info.name, artist: info.artist },
  });

  const uploadResult = await processSongSync(info, {
    neteaseCookie,
    onEvent: emit,
  });

  return {
    uploadResult,
    songId: uploadResult?.songId ?? null,
  };
}
