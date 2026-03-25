import { ArtistSyncSong } from '@/core/types';
import { qqMusicService } from '@/lib/qqmusic';

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, '').trim();
}

export async function resolveQQAlbum(keyword: string) {
  const albums = await qqMusicService.searchAlbums(keyword);
  if (albums.length === 0) {
    return null;
  }

  const target = normalize(keyword);
  return (
    albums.find((album) => normalize(album.name) === target) ||
    albums.find((album) => normalize(album.name).includes(target) || target.includes(normalize(album.name))) ||
    albums[0]
  );
}

export async function getAlbumSyncSongs(albumId: string | number, albumName?: string): Promise<ArtistSyncSong[]> {
  let albumMid = String(albumId || '');

  if (!albumMid && albumName) {
    const album = await resolveQQAlbum(albumName);
    albumMid = album?.id || '';
  }

  if (!albumMid) {
    return [];
  }

  const qqSongs = await qqMusicService.getAlbumSongsByAlbumMid(albumMid);
  return qqSongs.map((song) => ({
    id: song.id,
    name: song.name,
    ar: song.ar,
    al: song.al,
    dt: song.dt,
    source: song.source,
  }));
}
