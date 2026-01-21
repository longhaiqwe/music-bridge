'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { MusicInfo } from '@/lib/downloader/types';
import { Loader2, Download, Check, AlertCircle } from 'lucide-react';

export function MusicSearch() {
    const [keyword, setKeyword] = useState('');
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState<MusicInfo[]>([]);
    // Store sync status for each song: key=id, value='idle'|'syncing'|'success'|'error'
    const [syncStatus, setSyncStatus] = useState<Record<string, string>>({});

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!keyword) return;
        setLoading(true);
        setResults([]);
        try {
            const data = await api.search(keyword);
            setResults(data.results || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleSync = async (info: MusicInfo) => {
        setSyncStatus(prev => ({ ...prev, [info.id]: 'syncing' }));
        try {
            const res = await api.sync(info);
            if (res.success) {
                setSyncStatus(prev => ({ ...prev, [info.id]: 'success' }));
            } else {
                setSyncStatus(prev => ({ ...prev, [info.id]: 'error' }));
            }
        } catch (e) {
            setSyncStatus(prev => ({ ...prev, [info.id]: 'error' }));
        }
    };

    return (
        <div className="w-full max-w-2xl mx-auto p-4">
            <form onSubmit={handleSearch} className="flex gap-2 mb-6">
                <input
                    type="text"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="搜索音乐 (如: 周杰伦)"
                    className="flex-1 p-2 border rounded shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                    type="submit"
                    disabled={loading}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                    {loading ? <Loader2 className="animate-spin" /> : '搜索'}
                </button>
            </form>

            <div className="space-y-4">
                {results.map((item) => (
                    <div key={item.id} className="flex items-center justify-between p-4 bg-white border rounded shadow-sm hover:shadow-md transition">
                        <div className="flex items-center gap-4">
                            {item.coverUrl ? (
                                <img src={item.coverUrl} alt={item.name} className="w-12 h-12 rounded object-cover" />
                            ) : (
                                <div className="w-12 h-12 bg-gray-200 rounded flex items-center justify-center text-gray-400">?</div>
                            )}
                            <div>
                                <h3 className="font-semibold text-gray-800">{item.name}</h3>
                                <p className="text-sm text-gray-500">{item.artist}{item.album ? ` • ${item.album}` : ''}</p>
                            </div>
                        </div>

                        <button
                            onClick={() => handleSync(item)}
                            disabled={syncStatus[item.id] === 'syncing' || syncStatus[item.id] === 'success'}
                            className={`p-2 rounded-full transition ${syncStatus[item.id] === 'success'
                                ? 'bg-green-100 text-green-600'
                                : syncStatus[item.id] === 'error'
                                    ? 'bg-red-100 text-red-600'
                                    : 'bg-gray-100 hover:bg-blue-50 text-blue-600'
                                }`}
                        >
                            {syncStatus[item.id] === 'syncing' ? (
                                <Loader2 className="animate-spin w-5 h-5" />
                            ) : syncStatus[item.id] === 'success' ? (
                                <Check className="w-5 h-5" />
                            ) : syncStatus[item.id] === 'error' ? (
                                <AlertCircle className="w-5 h-5" />
                            ) : (
                                <Download className="w-5 h-5" />
                            )}
                        </button>
                    </div>
                ))}

                {results.length === 0 && !loading && keyword && (
                    <p className="text-center text-gray-500">未找到结果。</p>
                )}
            </div>
        </div>
    );
}
