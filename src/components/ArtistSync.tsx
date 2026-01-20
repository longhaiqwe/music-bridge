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
    const [syncCount, setSyncCount] = useState<number | ''>(10);
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
        setToSyncSongs([]);
        try {
            const res = await fetch(`/api/artist/search?q=${encodeURIComponent(keyword)}`);
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
                setArtists(data);
                // Auto-select the first artist
                const firstArtist = data[0];
                setSelectedArtist(firstArtist);

                // Immediately fetch songs for the first artist
                setLoadingPreview(true);
                try {
                    const songsRes = await fetch(`/api/artist/top-songs?id=${firstArtist.id}`);
                    const songsData = await songsRes.json();
                    if (Array.isArray(songsData)) {
                        setToSyncSongs(songsData.slice(0, Number(syncCount)));
                    }
                } catch (e) {
                    console.error(e);
                } finally {
                    setLoadingPreview(false);
                }
            } else {
                alert('未找到相关歌手');
            }
        } catch (e) {
            console.error(e);
            alert('搜索失败');
        } finally {
            setLoading(false);
        }
    };

    // Re-fetch songs if syncCount changes and we have an artist
    useEffect(() => {
        if (selectedArtist && !isSyncing) {
            const fetchSongs = async () => {
                setLoadingPreview(true);
                try {
                    const res = await fetch(`/api/artist/top-songs?id=${selectedArtist.id}`);
                    const data = await res.json();
                    if (Array.isArray(data)) {
                        setToSyncSongs(data.slice(0, Number(syncCount)));
                    }
                } catch (e) {
                    console.error(e);
                } finally {
                    setLoadingPreview(false);
                }
            };
            fetchSongs();
        }
    }, [syncCount, selectedArtist?.id]); // Depend on ID to avoid loop if object ref changes


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
                    count: Number(syncCount),
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
            setLogs(prev => [...prev, `错误: ${e.message}`]);
        } finally {
            setIsSyncing(false);
        }
    };

    // Auto-scroll logs
    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    return (
        <div className="w-full max-w-5xl mx-auto p-6 space-y-6">
            {/* Top Controls: Singer & Quantity */}
            <div className="flex flex-col md:flex-row gap-4 items-end">
                {/* Singer Input */}
                <div className="flex-1 w-full">
                    <label className="block text-sm font-bold text-gray-700 mb-2">
                        歌手
                    </label>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={keyword}
                            onChange={(e) => setKeyword(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearch(e)}
                            placeholder="输入歌手名字 (如: 周杰伦)"
                            className="flex-1 p-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:ring-0 outline-none text-lg transition-colors"
                        />
                        <button
                            onClick={handleSearch}
                            disabled={loading}
                            className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 font-bold transition-transform active:scale-95 whitespace-nowrap"
                        >
                            {loading ? <Loader2 className="animate-spin" /> : '搜索'}
                        </button>
                    </div>
                </div>

                {/* Quantity Input */}
                <div className="w-full md:w-48">
                    <label className="block text-sm font-bold text-gray-700 mb-2">
                        数量
                    </label>
                    <input
                        type="number"
                        value={syncCount}
                        onChange={(e) => {
                            const val = e.target.value;
                            if (val === '') {
                                setSyncCount('');
                            } else {
                                const num = parseInt(val);
                                if (!isNaN(num)) setSyncCount(num);
                            }
                        }}
                        min={0}
                        max={500}
                        disabled={isSyncing}
                        className="w-full p-3 border-2 border-gray-200 rounded-xl bg-white focus:border-blue-500 focus:ring-0 outline-none text-lg"
                    />
                </div>
            </div>

            {/* Main Display Area */}
            <div className="relative w-full min-h-[500px] border-4 border-gray-100 rounded-2xl bg-white shadow-sm p-6 overflow-hidden flex flex-col">

                {/* State 1: Empty / Initial */}
                {!selectedArtist && !isSyncing && (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-300">
                        <Music className="w-20 h-20 mb-4 opacity-20" />
                        <p className="text-lg">请在上方搜索歌手，系统将自动展示热门歌曲</p>
                    </div>
                )}

                {/* State 2: Song Preview & Sync Confirm */}
                {selectedArtist && !isSyncing && (
                    <div className="flex-1 flex flex-col animate-fade-in">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <h3 className="text-xl font-bold flex items-center gap-2">
                                    <img src={selectedArtist.picUrl} className="w-10 h-10 rounded-full object-cover shadow-sm" />
                                    {selectedArtist.name}
                                    <span className="text-sm font-normal text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
                                        将同步前 {toSyncSongs.length} 首歌曲
                                    </span>
                                </h3>
                            </div>
                            <button
                                onClick={handleStartSync}
                                className="px-8 py-2 bg-green-500 text-white font-bold rounded-lg shadow hover:bg-green-600 transition-colors flex items-center gap-2"
                            >
                                <CheckCircle2 className="w-5 h-5" />
                                开始同步
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto border border-gray-100 rounded-xl bg-gray-50/50 p-2">
                            {loadingPreview ? (
                                <div className="h-full flex items-center justify-center text-gray-400 gap-2">
                                    <Loader2 className="animate-spin w-8 h-8" />
                                    <span>正在加载歌曲列表...</span>
                                </div>
                            ) : (
                                <div className="space-y-1">
                                    {toSyncSongs.length === 0 ? (
                                        <p className="text-center py-10 text-gray-400">未找到歌曲</p>
                                    ) : (
                                        toSyncSongs.map((song, i) => (
                                            <div key={song.id} className="group flex items-center justify-between p-3 bg-white hover:bg-blue-50 rounded-lg transition-colors border border-transparent hover:border-blue-100">
                                                <div className="flex items-center gap-4 overflow-hidden">
                                                    <span className="text-gray-400 font-mono w-6 text-right font-medium">{i + 1}</span>
                                                    <div className="truncate font-medium text-gray-700 group-hover:text-blue-700">
                                                        {song.name}
                                                    </div>
                                                </div>
                                                <div className="text-xs text-gray-400 font-mono">
                                                    {(song.dt / 1000 / 60).toFixed(2)} min
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* State 3: Syncing / Logs */}
                {isSyncing && (
                    <div className="flex-1 flex flex-col animate-fade-in">
                        <h3 className="text-lg font-bold text-gray-700 mb-4 flex items-center gap-2">
                            <Loader2 className="animate-spin text-blue-500" />
                            正在同步...
                        </h3>
                        <div className="flex-1 bg-gray-900 rounded-xl p-4 font-mono text-sm overflow-y-auto shadow-inner text-green-400 space-y-1 scrollbar-thin scrollbar-thumb-gray-700">
                            {logs.map((log, i) => (
                                <div key={i} className="break-all border-l-2 border-transparent hover:border-green-600 pl-2 transition-colors">
                                    <span className="opacity-50 mr-2">[{new Date().toLocaleTimeString()}]</span>
                                    {log}
                                </div>
                            ))}
                            <div ref={logsEndRef} />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
