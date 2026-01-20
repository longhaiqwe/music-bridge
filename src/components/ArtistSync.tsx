'use client';

import { useState, useRef, useEffect } from 'react';
import { Loader2, Music, CheckCircle2, RotateCcw } from 'lucide-react';

interface Artist {
    id: number;
    name: string;
    picUrl: string;
    albumSize: number;
    musicSize: number;
}

export function ArtistSync() {
    const [keyword, setKeyword] = useState('');
    const [loading, setLoading] = useState(false);
    const [artists, setArtists] = useState<Artist[]>([]);
    const [selectedArtist, setSelectedArtist] = useState<Artist | null>(null);
    const [syncCount, setSyncCount] = useState(10);
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [toSyncSongs, setToSyncSongs] = useState<any[]>([]); // Songs to be synced
    const [isSyncing, setIsSyncing] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const logsEndRef = useRef<HTMLDivElement>(null);

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!keyword) return;
        setLoading(true);
        setArtists([]);
        setSelectedArtist(null);
        setToSyncSongs([]); // Clear old songs
        try {
            const res = await fetch(`/api/artist/search?q=${encodeURIComponent(keyword)}`);
            const data = await res.json();
            if (Array.isArray(data)) {
                setArtists(data);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleFetchTopSongs = async () => {
        if (!selectedArtist) return;
        setLoadingPreview(true);
        setToSyncSongs([]);
        try {
            const res = await fetch(`/api/artist/top-songs?id=${selectedArtist.id}`);
            const data = await res.json();
            if (Array.isArray(data)) {
                // Slice by count
                setToSyncSongs(data.slice(0, syncCount));
            }
        } catch (e) {
            console.error(e);
            alert('Failed to fetch top songs');
        } finally {
            setLoadingPreview(false);
        }
    };

    const handleStartSync = async () => {
        if (!selectedArtist) return;

        setIsSyncing(true);
        setLogs([]);

        try {
            const res = await fetch('/api/artist/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    artistId: selectedArtist.id,
                    artistName: selectedArtist.name,
                    count: syncCount,
                    songs: toSyncSongs // Pass selected songs
                })
            });

            if (!res.body) throw new Error('No response body');

            const reader = res.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n').filter(Boolean);

                lines.forEach(line => {
                    try {
                        const event = JSON.parse(line);
                        if (event.type === 'log') {
                            setLogs(prev => [...prev, event.message]);
                        }
                    } catch (e) {
                        // Ignore parse errors for partial chunks
                    }
                });
            }

        } catch (e: any) {
            setLogs(prev => [...prev, `Error: ${e.message}`]);
        } finally {
            setIsSyncing(false);
        }
    };

    // Auto-scroll logs
    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    return (
        <div className="w-full max-w-4xl mx-auto p-4 space-y-8">
            {/* 1. Search Section */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                    <Music className="w-5 h-5 text-blue-500" />
                    Step 1: Search Artist
                </h2>
                <form onSubmit={handleSearch} className="flex gap-2">
                    <input
                        type="text"
                        value={keyword}
                        onChange={(e) => setKeyword(e.target.value)}
                        placeholder="Artist Name (e.g. Zhou Jielun)"
                        className="flex-1 p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                    <button
                        type="submit"
                        disabled={loading}
                        className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium transition"
                    >
                        {loading ? <Loader2 className="animate-spin" /> : 'Search'}
                    </button>
                </form>

                {/* Results Grid */}
                {artists.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                        {artists.map((artist) => (
                            <div
                                key={artist.id}
                                onClick={() => {
                                    if (!isSyncing) {
                                        setSelectedArtist(artist);
                                        setToSyncSongs([]); // Reset when changing artist
                                    }
                                }}
                                className={`
                                    cursor-pointer p-3 rounded-lg border transition-all hover:shadow-md
                                    ${selectedArtist?.id === artist.id
                                        ? 'border-blue-500 ring-2 ring-blue-100 bg-blue-50'
                                        : 'border-gray-200 bg-white'
                                    }
                                    ${isSyncing ? 'opacity-50 pointer-events-none' : ''}
                                `}
                            >
                                <img
                                    src={artist.picUrl}
                                    alt={artist.name}
                                    className="w-full aspect-square object-cover rounded-md mb-2"
                                />
                                <div className="font-semibold text-gray-900 truncate">{artist.name}</div>
                                <div className="text-xs text-gray-500">{artist.musicSize} Songs</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* 2. Configure & Sync Section */}
            {selectedArtist && (
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 animate-fade-in">
                    <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                        <RotateCcw className="w-5 h-5 text-green-500" />
                        Step 2: Start Sync
                    </h2>

                    <div className="mb-6">
                        {!toSyncSongs.length ? (
                            <div className="flex gap-4 items-end">
                                <div className="flex-1">
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Select Number of Top Songs
                                    </label>
                                    <select
                                        value={syncCount}
                                        onChange={(e) => setSyncCount(Number(e.target.value))}
                                        disabled={loadingPreview}
                                        className="w-full p-3 border rounded-lg bg-gray-50 font-medium"
                                    >
                                        <option value={3}>Top 3 Songs</option>
                                        <option value={5}>Top 5 Songs</option>
                                        <option value={10}>Top 10 Songs</option>
                                        <option value={20}>Top 20 Songs</option>
                                        <option value={50}>Top 50 Songs</option>
                                    </select>
                                </div>
                                <button
                                    onClick={handleFetchTopSongs}
                                    disabled={loadingPreview}
                                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition disabled:opacity-50"
                                >
                                    {loadingPreview ? <Loader2 className="animate-spin" /> : 'Preview Songs'}
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="flex justify-between items-center">
                                    <h3 className="font-semibold text-lg text-gray-800">
                                        Found {toSyncSongs.length} Songs will be synced:
                                    </h3>
                                    <button
                                        onClick={() => setToSyncSongs([])}
                                        disabled={isSyncing}
                                        className="text-sm text-blue-600 hover:underline"
                                    >
                                        Change Selection
                                    </button>
                                </div>

                                <div className="max-h-60 overflow-y-auto border rounded-lg bg-gray-50 p-2 space-y-1">
                                    {toSyncSongs.map((song, i) => (
                                        <div key={song.id} className="text-sm p-2 bg-white rounded shadow-sm flex justify-between">
                                            <span className="font-medium text-gray-700">{i + 1}. {song.name}</span>
                                            <span className="text-gray-500 text-xs">{(song.dt / 1000 / 60).toFixed(2)} min</span>
                                        </div>
                                    ))}
                                </div>

                                <button
                                    onClick={handleStartSync}
                                    disabled={isSyncing}
                                    className={`
                                        w-full py-3 rounded-lg font-bold text-white shadow-lg transition
                                        flex items-center justify-center gap-2
                                        ${isSyncing
                                            ? 'bg-gray-400 cursor-not-allowed'
                                            : 'bg-green-600 hover:bg-green-700 hover:scale-[1.01] active:scale-[0.99]'
                                        }
                                    `}
                                >
                                    {isSyncing ? (
                                        <>
                                            <Loader2 className="animate-spin" /> Syncing...
                                        </>
                                    ) : (
                                        <>
                                            <CheckCircle2 /> Confirm & Start Sync
                                        </>
                                    )}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Terminal / Logs */}
                    <div className="bg-gray-900 rounded-lg p-4 font-mono text-sm h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600">
                        {logs.length === 0 ? (
                            <div className="text-gray-500 italic">Waiting to start... Logs will appear here.</div>
                        ) : (
                            <div className="space-y-1">
                                {logs.map((log, i) => (
                                    <div key={i} className="text-green-400 border-l-2 border-green-800 pl-2">
                                        <span className="text-gray-500 mr-2">[{new Date().toLocaleTimeString()}]</span>
                                        {log}
                                    </div>
                                ))}
                                <div ref={logsEndRef} />
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
