'use client';

import { useState, useRef, useEffect } from 'react';
import { Loader2, Music, CheckCircle2, RotateCcw, AlertCircle, ArrowLeft, X } from 'lucide-react';

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
    const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
    const [progress, setProgress] = useState({ current: 0, total: 10 });
    const [currentSong, setCurrentSong] = useState('');
    const [statusMessage, setStatusMessage] = useState('初始化中...');

    // Cache all songs to support removal/replenishment
    const [allCachedSongs, setAllCachedSongs] = useState<any[]>([]);
    const [ignoredSongIds, setIgnoredSongIds] = useState<Set<number>>(new Set());

    // New state for detailed sync result
    const [syncResult, setSyncResult] = useState<{ success: number, failed: number, failedSongs: string[] } | null>(null);

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!keyword) return;
        setLoading(true);
        setArtists([]);
        setSelectedArtist(null);
        setToSyncSongs([]);
        setAllCachedSongs([]);
        setIgnoredSongIds(new Set());
        try {
            const res = await fetch(`/api/artist/search?q=${encodeURIComponent(keyword)}`);
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
                setArtists(data);
                // Auto-select the first artist
                const firstArtist = data[0];
                setSelectedArtist(firstArtist);

                // Fetching is now handled by useEffect
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
    // 1. Fetch songs when selectedArtist changes
    useEffect(() => {
        if (!selectedArtist) return;

        const fetchSongs = async () => {
            setLoadingPreview(true);
            try {
                const res = await fetch(`/api/artist/top-songs?id=${selectedArtist.id}`);
                const data = await res.json();
                if (Array.isArray(data)) {
                    setAllCachedSongs(data);
                }
            } catch (e) {
                console.error(e);
            } finally {
                setLoadingPreview(false);
            }
        };

        fetchSongs();
    }, [selectedArtist?.id]);

    // 2. Update toSyncSongs when cache, ignore list, or count changes
    useEffect(() => {
        if (allCachedSongs.length === 0) {
            setToSyncSongs([]);
            return;
        }

        const filtered = allCachedSongs.filter(song => !ignoredSongIds.has(song.id));
        const limit = typeof syncCount === 'number' ? syncCount : 0;
        setToSyncSongs(filtered.slice(0, limit));

    }, [allCachedSongs, ignoredSongIds, syncCount]);

    const handleRemoveSong = (songId: number) => {
        const newSet = new Set(ignoredSongIds);
        newSet.add(songId);
        setIgnoredSongIds(newSet);
    };

    // Duplicate detection logic (Name + Artists based)
    const duplicateInfo = (() => {
        const seenKeys = new Set<string>();
        let duplicatesCount = 0;
        toSyncSongs.forEach(song => {
            const name = song.name.trim();
            const artists = song.ar?.map((a: any) => a.name).sort().join(',') || '';
            const key = `${name}|${artists}`;

            if (seenKeys.has(key)) {
                duplicatesCount++;
            } else {
                seenKeys.add(key);
            }
        });
        return { count: duplicatesCount, hasDuplicates: duplicatesCount > 0 };
    })();

    const handleRemoveDuplicates = () => {
        const seenKeys = new Set<string>();
        const songsToRemove: number[] = [];

        // Iterate and mark duplicates for removal (add to ignored list)
        toSyncSongs.forEach(song => {
            const name = song.name.trim();
            const artists = song.ar?.map((a: any) => a.name).sort().join(',') || '';
            const key = `${name}|${artists}`;

            if (seenKeys.has(key)) {
                songsToRemove.push(song.id);
            } else {
                seenKeys.add(key);
            }
        });

        if (songsToRemove.length > 0) {
            const newSet = new Set(ignoredSongIds);
            songsToRemove.forEach(id => newSet.add(id));
            setIgnoredSongIds(newSet);
        }
    };


    const handleStartSync = async () => {
        if (!selectedArtist) return;

        setSyncStatus('syncing');
        setSyncResult(null); // Reset result
        setProgress({ current: 0, total: toSyncSongs.length || Number(syncCount) });
        setStatusMessage('准备开始...');
        setCurrentSong('');

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
                            const msg = event.message as string;


                            // Parse progress
                            // Log format: [1/10] Processing: SongName
                            const progressMatch = msg.match(/\[(\d+)\/(\d+)\] Processing: (.+)/);
                            if (progressMatch) {
                                setProgress({
                                    current: parseInt(progressMatch[1]),
                                    total: parseInt(progressMatch[2])
                                });
                                setCurrentSong(progressMatch[3]);
                                setStatusMessage('正在搜索资源...');
                            }

                            // Parse other status updates
                            if (msg.includes('Downloading')) setStatusMessage('正在下载音频...');
                            if (msg.includes('Embedding metadata')) setStatusMessage('正在写入元数据...');
                            if (msg.includes('Uploading')) setStatusMessage('正在上传到云盘...');
                            if (msg.includes('Uploaded success')) setStatusMessage('上传成功！');
                            if (msg.includes('Selection] Picked')) setStatusMessage('已找到最佳音源');
                        } else if (event.type === 'summary') {
                            setSyncResult(event.stats);
                        }
                    } catch (e) {
                        // Ignore parse errors for partial chunks
                    }
                });
            }

            setSyncStatus('success');

        } catch (e: any) {

            setStatusMessage(e.message);
            setSyncStatus('error');
        }
    };



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
                            className="flex-1 p-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:ring-0 outline-none text-lg transition-colors placeholder:text-gray-500 text-gray-900"
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
                        disabled={syncStatus === 'syncing'}
                        className="w-full p-3 border-2 border-gray-200 rounded-xl bg-white focus:border-blue-500 focus:ring-0 outline-none text-lg text-gray-900 placeholder:text-gray-500"
                    />
                </div>
            </div>

            {/* Main Display Area */}
            <div className="relative w-full min-h-[500px] border-4 border-gray-100 rounded-2xl bg-white shadow-sm p-6 overflow-hidden flex flex-col">

                {/* State 1: Empty / Initial */}
                {!selectedArtist && syncStatus === 'idle' && (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-300">
                        <Music className="w-20 h-20 mb-4 opacity-20" />
                        <p className="text-lg">请在上方搜索歌手，系统将自动展示热门歌曲</p>
                    </div>
                )}

                {/* State 2: Song Preview & Sync Confirm */}
                {selectedArtist && syncStatus === 'idle' && (
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

                            <div className="flex items-center gap-4">
                                {duplicateInfo.hasDuplicates && (
                                    <div className="flex items-center gap-3 bg-yellow-50 text-yellow-700 px-4 py-2 rounded-lg border border-yellow-100 animate-fade-in">
                                        <AlertCircle className="w-5 h-5" />
                                        <span className="text-sm font-medium">
                                            检测到 {duplicateInfo.count} 首重复歌曲
                                        </span>
                                        <button
                                            onClick={handleRemoveDuplicates}
                                            className="text-xs bg-yellow-100 hover:bg-yellow-200 text-yellow-800 px-3 py-1 rounded-md transition-colors font-bold"
                                        >
                                            移除重复
                                        </button>
                                    </div>
                                )}

                                <button
                                    onClick={handleStartSync}
                                    className="px-8 py-2 bg-green-500 text-white font-bold rounded-lg shadow hover:bg-green-600 transition-colors flex items-center gap-2"
                                >
                                    <CheckCircle2 className="w-5 h-5" />
                                    开始同步
                                </button>
                            </div>
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
                                            <div key={song.id} className="group flex items-center p-3 gap-2 bg-white hover:bg-blue-50 rounded-lg transition-colors border border-transparent hover:border-blue-100">
                                                {/* 1. Song Info (Index, Image, Name) - Flex 1 */}
                                                <div className="flex items-center gap-4 flex-1 min-w-0 pr-4">
                                                    <span className="text-gray-400 font-mono w-6 text-right font-medium flex-shrink-0">{i + 1}</span>
                                                    {song.al?.picUrl && (
                                                        <img
                                                            src={song.al.picUrl}
                                                            alt={song.al.name}
                                                            className="w-10 h-10 rounded-md object-cover border border-gray-100 flex-shrink-0"
                                                            loading="lazy"
                                                        />
                                                    )}
                                                    <div className="truncate font-medium text-gray-700 group-hover:text-blue-700" title={song.name}>
                                                        {song.name}
                                                    </div>
                                                </div>

                                                {/* 2. Artist Column - Fixed Width ~25% */}
                                                <div className="hidden md:block w-1/4 px-2 text-sm text-gray-800 truncate" title={song.ar?.map((a: any) => a.name).join(' / ')}>
                                                    {song.ar?.map((a: any) => a.name).join(' / ')}
                                                </div>

                                                {/* 3. Album Column - Fixed Width ~25% */}
                                                <div className="hidden md:block w-1/4 px-2 text-sm text-gray-700 truncate" title={song.al?.name}>
                                                    {song.al?.name}
                                                </div>

                                                {/* 4. Action Column */}
                                                <div className="w-10 flex justify-end shrink-0">
                                                    <button
                                                        onClick={() => handleRemoveSong(song.id)}
                                                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                                        title="移除此歌曲"
                                                    >
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* State 3: Syncing / Progress */}
                {syncStatus === 'syncing' && (
                    <div className="flex-1 flex flex-col items-center justify-center animate-fade-in py-12">
                        <div className="w-full max-w-md space-y-8 text-center">

                            {/* Progress Circle or Icon */}
                            <div className="relative mx-auto w-24 h-24">
                                <svg className="w-full h-full transform -rotate-90">
                                    <circle
                                        cx="48"
                                        cy="48"
                                        r="40"
                                        stroke="currentColor"
                                        strokeWidth="8"
                                        fill="transparent"
                                        className="text-gray-100"
                                    />
                                    <circle
                                        cx="48"
                                        cy="48"
                                        r="40"
                                        stroke="currentColor"
                                        strokeWidth="8"
                                        fill="transparent"
                                        strokeDasharray={251.2}
                                        strokeDashoffset={251.2 - (251.2 * (progress.current / Math.max(progress.total, 1)))}
                                        className="text-blue-500 transition-all duration-1000 ease-out"
                                        strokeLinecap="round"
                                    />
                                </svg>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <span className="text-xl font-bold text-blue-600 font-mono">
                                        {progress.current}/{progress.total}
                                    </span>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <h3 className="text-2xl font-bold text-gray-800">
                                    正在同步...
                                </h3>

                                <div className="bg-blue-50 border border-blue-100 rounded-xl p-6 shadow-sm">
                                    <p className="text-sm text-gray-500 uppercase tracking-wider mb-2 font-semibold">
                                        当前正在处理
                                    </p>
                                    <p className="text-xl font-medium text-blue-900 truncate px-4">
                                        {currentSong || '准备中...'}
                                    </p>
                                    <p className="text-sm text-blue-400 mt-2 animate-pulse">
                                        {statusMessage}
                                    </p>
                                </div>
                            </div>

                            <p className="text-xs text-gray-400 mt-8">
                                请勿关闭页面，这可能需要几分钟...
                            </p>
                        </div>
                    </div>
                )}

                {/* State 4: Success / Partial Success */}
                {syncStatus === 'success' && (
                    <div className="flex-1 flex flex-col items-center justify-center animate-fade-in p-6">
                        <div className="text-center space-y-6 w-full max-w-2xl">
                            {syncResult?.failed && syncResult.failed > 0 ? (
                                <>
                                    <div className="w-20 h-20 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                        <AlertCircle className="w-10 h-10 text-yellow-600" />
                                    </div>
                                    <h2 className="text-2xl font-bold text-gray-800">同步完成 (有部分失败)</h2>
                                    <div className="bg-white border rounded-lg shadow-sm text-left overflow-hidden">
                                        <div className="bg-gray-50 px-4 py-2 border-b text-sm font-semibold text-gray-600 flex justify-between">
                                            <span>失败列表 ({syncResult.failed})</span>
                                            <span className="text-green-600">成功: {syncResult.success}</span>
                                        </div>
                                        <div className="max-h-60 overflow-y-auto p-4 space-y-2">
                                            {syncResult.failedSongs.map((s, i) => (
                                                <div key={i} className="text-sm text-red-600 flex items-start gap-2">
                                                    <span className="mt-0.5">•</span>
                                                    <span>{s}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                        <CheckCircle2 className="w-12 h-12 text-green-600" />
                                    </div>
                                    <h2 className="text-3xl font-bold text-gray-800">同步完成!</h2>
                                    <p className="text-gray-500">
                                        已成功将 {progress.current} 首歌曲同步到您的网易云盘。
                                    </p>
                                </>
                            )}

                            <button
                                onClick={() => setSyncStatus('idle')}
                                className="px-8 py-3 bg-gray-900 text-white rounded-xl hover:bg-gray-800 font-bold transition-transform active:scale-95 flex items-center gap-2 mx-auto"
                            >
                                <ArrowLeft className="w-5 h-5" />
                                返回
                            </button>
                        </div>
                    </div>
                )}

                {/* State 5: Error */}
                {syncStatus === 'error' && (
                    <div className="flex-1 flex flex-col items-center justify-center animate-fade-in">
                        <div className="text-center space-y-6 max-w-md mx-auto">
                            <div className="w-24 h-24 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                <AlertCircle className="w-12 h-12 text-red-600" />
                            </div>
                            <h2 className="text-3xl font-bold text-gray-800">同步失败</h2>
                            <div className="bg-red-50 p-4 rounded-xl text-red-700 border border-red-100">
                                {statusMessage}
                            </div>
                            <div className="flex gap-4 justify-center">
                                <button
                                    onClick={() => setSyncStatus('idle')}
                                    className="px-8 py-3 bg-gray-200 text-gray-700 rounded-xl hover:bg-gray-300 font-bold transition-transform active:scale-95 flex items-center gap-2"
                                >
                                    <ArrowLeft className="w-5 h-5" />
                                    返回
                                </button>
                                <button
                                    onClick={handleStartSync}
                                    className="px-8 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-bold transition-transform active:scale-95 flex items-center gap-2"
                                >
                                    <RotateCcw className="w-5 h-5" />
                                    重试
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
