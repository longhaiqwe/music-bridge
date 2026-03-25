'use client';

import { useState, useEffect } from 'react';
import { Loader2, Disc3, CheckCircle2, RotateCcw, AlertCircle, ArrowLeft, X } from 'lucide-react';
import { api } from '@/lib/api';
import { ArtistSyncResult, ArtistSyncSong } from '@/core/types';

const JOB_POLL_INTERVAL_MS = 2500;

interface Album {
    id: string;
    name: string;
    artistName: string;
    picUrl: string;
    publishTime?: string;
    songCount?: number;
}

export function AlbumSync() {
    const [keyword, setKeyword] = useState('');
    const [loading, setLoading] = useState(false);
    const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
    const [syncCount, setSyncCount] = useState<number | ''>('');
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [toSyncSongs, setToSyncSongs] = useState<ArtistSyncSong[]>([]);
    const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
    const [progress, setProgress] = useState({ current: 0, total: 0 });
    const [currentSong, setCurrentSong] = useState('');
    const [statusMessage, setStatusMessage] = useState('初始化中...');
    const [createPlaylist, setCreatePlaylist] = useState(true);
    const [allCachedSongs, setAllCachedSongs] = useState<ArtistSyncSong[]>([]);
    const [ignoredSongIds, setIgnoredSongIds] = useState<Set<string>>(new Set());
    const [syncResult, setSyncResult] = useState<ArtistSyncResult | null>(null);
    const [jobId, setJobId] = useState<string | null>(null);

    const getArtistNames = (song: ArtistSyncSong) => (song.ar || song.artists || []).map((artist) => artist.name).sort().join(',');

    const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : '请求失败';

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!keyword.trim()) return;
        setLoading(true);
        setSelectedAlbum(null);
        setToSyncSongs([]);
        setAllCachedSongs([]);
        setIgnoredSongIds(new Set());
        setSyncCount('');
        try {
            const data = await api.album.search(keyword);
            if (Array.isArray(data) && data.length > 0) {
                const firstAlbum = data[0] as Album;
                setSelectedAlbum(firstAlbum);
                setSyncCount(firstAlbum.songCount || '');
            } else {
                alert('未找到相关专辑');
            }
        } catch (error: unknown) {
            console.error(error);
            alert('搜索失败');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!selectedAlbum) return;

        const fetchSongs = async () => {
            setLoadingPreview(true);
            try {
                const data = await api.album.getSongs(selectedAlbum.id);
                if (Array.isArray(data)) {
                    setAllCachedSongs(data as ArtistSyncSong[]);
                    setSyncCount((prev) => {
                        if (typeof prev !== 'number' || prev <= 0 || prev > data.length) {
                            return data.length;
                        }
                        return prev;
                    });
                }
            } catch (error: unknown) {
                console.error(error);
            } finally {
                setLoadingPreview(false);
            }
        };

        fetchSongs();
    }, [selectedAlbum]);

    useEffect(() => {
        if (allCachedSongs.length === 0) {
            setToSyncSongs([]);
            return;
        }

        const filtered = allCachedSongs.filter(song => !ignoredSongIds.has(String(song.id)));
        const limit = typeof syncCount === 'number' ? syncCount : filtered.length;
        setToSyncSongs(filtered.slice(0, limit));
    }, [allCachedSongs, ignoredSongIds, syncCount]);

    const handleRemoveSong = (songId: number | string) => {
        const newSet = new Set(ignoredSongIds);
        newSet.add(String(songId));
        setIgnoredSongIds(newSet);
    };

    const duplicateInfo = (() => {
        const seenKeys = new Set<string>();
        let duplicatesCount = 0;
        toSyncSongs.forEach(song => {
            const name = song.name.trim();
            const artists = getArtistNames(song);
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
        const songsToRemove: string[] = [];

        toSyncSongs.forEach(song => {
            const name = song.name.trim();
            const artists = getArtistNames(song);
            const key = `${name}|${artists}`;

            if (seenKeys.has(key)) {
                songsToRemove.push(String(song.id));
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
        if (!selectedAlbum) return;

        setSyncStatus('syncing');
        setSyncResult(null);
        setProgress({ current: 0, total: toSyncSongs.length || Number(syncCount) });
        setStatusMessage('准备开始...');
        setCurrentSong('');

        try {
            const job = await api.jobs.create('sync_artist', {
                artistId: selectedAlbum.id,
                artistName: selectedAlbum.name,
                count: typeof syncCount === 'number' ? syncCount : toSyncSongs.length,
                songs: toSyncSongs,
                createPlaylist
            });

            if (!job.jobId) throw new Error(job.error || '创建同步任务失败');
            setJobId(job.jobId);

        } catch (error: unknown) {
            setStatusMessage(getErrorMessage(error));
            setSyncStatus('error');
        }
    };

    useEffect(() => {
        if (!jobId || syncStatus !== 'syncing') return;

        let stopped = false;

        const poll = async () => {
            try {
                const status = await api.jobs.get(jobId);
                if (stopped) return;

                if (status.progress) {
                    setProgress({
                        current: status.progress.current,
                        total: status.progress.total
                    });
                    setCurrentSong(status.progress.songName || '');
                    setStatusMessage(status.progress.message || '处理中...');
                }

                if (status.status === 'succeeded') {
                    setSyncResult(status.result as ArtistSyncResult | null);
                    setSyncStatus('success');
                    setJobId(null);
                    return;
                }

                if (status.status === 'failed' || status.status === 'cancelled') {
                    setStatusMessage(status.error || '同步失败');
                    setSyncStatus('error');
                    setJobId(null);
                    return;
                }

                setTimeout(poll, JOB_POLL_INTERVAL_MS);
            } catch (error: unknown) {
                if (stopped) return;
                setStatusMessage(getErrorMessage(error) || '同步状态查询失败');
                setSyncStatus('error');
                setJobId(null);
            }
        };

        poll();

        return () => {
            stopped = true;
        };
    }, [jobId, syncStatus]);

    return (
        <div className="w-full max-w-5xl mx-auto p-3 md:p-6 space-y-4 md:space-y-6">
            <div className="flex flex-col md:flex-row gap-4 items-end">
                <div className="flex-1 w-full">
                    <label className="block text-sm font-bold text-gray-700 mb-2">
                        专辑
                    </label>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={keyword}
                            onChange={(e) => setKeyword(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearch(e)}
                            placeholder="输入专辑名 (如: 十一月的萧邦)"
                            className="flex-1 p-2 border rounded shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder:text-gray-500"
                        />
                        <button
                            onClick={handleSearch}
                            disabled={loading}
                            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                        >
                            {loading ? <Loader2 className="animate-spin" /> : '搜索'}
                        </button>
                    </div>
                </div>

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
                        className="w-full p-2 border rounded shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder:text-gray-500"
                    />
                </div>
            </div>

            <div className={`relative w-full border-2 md:border-4 border-gray-100 rounded-xl md:rounded-2xl bg-white shadow-sm p-3 md:p-6 overflow-hidden flex flex-col ${!selectedAlbum && syncStatus === 'idle' ? 'min-h-[180px]' : 'min-h-[400px] md:min-h-[500px]'}`}>

                {!selectedAlbum && syncStatus === 'idle' && (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-300 py-8">
                        <Disc3 className="w-12 h-12 md:w-16 md:h-16 mb-3 opacity-20" />
                        <p className="text-sm md:text-base text-gray-500 text-center px-4">请在上方搜索专辑，系统将自动展示专辑曲目</p>
                    </div>
                )}

                {selectedAlbum && syncStatus === 'idle' && (
                    <div className="flex-1 flex flex-col animate-fade-in">
                        <div className="flex flex-col gap-4 mb-4">
                            <div className="flex items-center gap-3">
                                <img src={selectedAlbum.picUrl} alt={selectedAlbum.name} className="w-12 h-12 md:w-10 md:h-10 rounded-xl object-cover shadow-sm flex-shrink-0" />
                                <div className="flex flex-col gap-1 min-w-0">
                                    <h3 className="text-lg md:text-xl font-bold text-gray-900 truncate">
                                        {selectedAlbum.name}
                                    </h3>
                                    <div className="flex flex-wrap items-center gap-2 text-xs md:text-sm text-gray-500">
                                        <span>{selectedAlbum.artistName || '未知歌手'}</span>
                                        {selectedAlbum.publishTime && <span>• {selectedAlbum.publishTime}</span>}
                                        <span className="bg-gray-100 px-2 md:px-3 py-0.5 md:py-1 rounded-full text-gray-600">
                                            将同步 {toSyncSongs.length} 首歌曲
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {duplicateInfo.hasDuplicates && (
                                <div className="flex flex-wrap items-center gap-2 md:gap-3 bg-yellow-50 text-yellow-700 px-3 md:px-4 py-2 rounded-lg border border-yellow-100 animate-fade-in">
                                    <AlertCircle className="w-4 h-4 md:w-5 md:h-5 flex-shrink-0" />
                                    <span className="text-xs md:text-sm font-medium">
                                        检测到 {duplicateInfo.count} 首重复歌曲
                                    </span>
                                    <button
                                        onClick={handleRemoveDuplicates}
                                        className="text-xs bg-yellow-100 hover:bg-yellow-200 text-yellow-800 px-3 py-1.5 rounded-md transition-colors font-bold active:scale-95"
                                    >
                                        移除重复
                                    </button>
                                </div>
                            )}

                            <div className="flex items-center justify-between gap-3">
                                <label htmlFor="albumCreatePlaylist" className="flex items-center gap-2 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        id="albumCreatePlaylist"
                                        checked={createPlaylist}
                                        onChange={(e) => setCreatePlaylist(e.target.checked)}
                                        className="w-5 h-5 md:w-5 md:h-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer"
                                    />
                                    <div className="text-sm font-medium text-gray-700">
                                        创建歌单
                                        <span className="text-xs text-gray-400 block font-normal">使用专辑名创建歌单</span>
                                    </div>
                                </label>

                                <button
                                    onClick={handleStartSync}
                                    className="px-5 md:px-8 py-2.5 md:py-2 bg-green-500 text-white font-bold rounded-lg shadow hover:bg-green-600 transition-colors flex items-center gap-2 active:scale-95 flex-shrink-0"
                                >
                                    <CheckCircle2 className="w-5 h-5" />
                                    <span className="hidden sm:inline">开始同步</span>
                                    <span className="sm:hidden">同步</span>
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto border border-gray-100 rounded-xl bg-gray-50/50 p-2">
                            {loadingPreview ? (
                                <div className="h-full flex items-center justify-center text-gray-400 gap-2">
                                    <Loader2 className="animate-spin w-8 h-8" />
                                    <span>正在加载专辑曲目...</span>
                                </div>
                            ) : (
                                <div className="space-y-1">
                                    {toSyncSongs.length === 0 ? (
                                        <p className="text-center py-10 text-gray-400">未找到歌曲</p>
                                    ) : (
                                        toSyncSongs.map((song, i) => (
                                            <div key={song.id} className="group flex items-center p-2 md:p-3 gap-2 bg-white hover:bg-blue-50 rounded-lg transition-colors border border-transparent hover:border-blue-100 active:bg-blue-50">
                                                <div className="flex items-center gap-2 md:gap-4 flex-1 min-w-0">
                                                    <span className="text-gray-400 font-mono w-5 md:w-6 text-right text-sm md:text-base font-medium flex-shrink-0">{i + 1}</span>
                                                    {song.al?.picUrl && (
                                                        <img
                                                            src={song.al.picUrl}
                                                            alt={song.al.name}
                                                            className="w-10 h-10 md:w-10 md:h-10 rounded-md object-cover border border-gray-100 flex-shrink-0"
                                                            loading="lazy"
                                                        />
                                                    )}
                                                    <div className="truncate font-medium text-sm md:text-base text-gray-700 group-hover:text-blue-700" title={song.name}>
                                                        {song.name}
                                                    </div>
                                                </div>

                                                <div className="hidden md:block w-1/4 px-2 text-sm text-gray-800 truncate" title={getArtistNames(song).replaceAll(',', ' / ')}>
                                                    {getArtistNames(song).replaceAll(',', ' / ')}
                                                </div>

                                                <div className="hidden md:block w-1/4 px-2 text-sm text-gray-700 truncate" title={song.al?.name}>
                                                    {song.al?.name}
                                                </div>

                                                <div className="w-8 md:w-10 flex justify-end shrink-0">
                                                    <button
                                                        onClick={() => handleRemoveSong(song.id)}
                                                        className="p-2 md:p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all md:opacity-0 md:group-hover:opacity-100 active:bg-red-100"
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

                {syncStatus === 'syncing' && (
                    <div className="flex-1 flex flex-col items-center justify-center animate-fade-in py-12">
                        <div className="w-full max-w-md space-y-8 text-center">
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
                                        已成功将 {progress.current} 首专辑歌曲同步到您的网易云盘。
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
