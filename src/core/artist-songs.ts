import { ArtistSyncSong } from '@/core/types';
import { qqMusicService } from '@/lib/qqmusic';

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, '').trim();
}

export async function resolveQQArtist(keyword: string) {
  const artists = await qqMusicService.searchArtists(keyword);
  if (artists.length === 0) {
    return null;
  }

  const target = normalize(keyword);
  return (
    artists.find((artist) => normalize(artist.name) === target) ||
    artists.find((artist) => normalize(artist.name).includes(target) || target.includes(normalize(artist.name))) ||
    artists[0]
  );
}

export async function getArtistSyncSongs(artistId: string | number, artistName?: string): Promise<ArtistSyncSong[]> {
  let singerMid = String(artistId || '');

  if (!singerMid && artistName) {
    const artist = await resolveQQArtist(artistName);
    singerMid = artist?.id || '';
  }

  if (!singerMid) {
    return [];
  }

  const qqSongs = await qqMusicService.getArtistHotSongsBySingerMid(singerMid);
  return qqSongs.map((song) => ({
    id: song.id,
    name: song.name,
    ar: song.ar,
    al: song.al,
    dt: song.dt,
    source: song.source,
  }));
}
