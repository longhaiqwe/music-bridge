'use client';

import { useState, useEffect } from 'react';
import { LoginPanel } from '@/components/LoginPanel';
import { MusicSearch } from '@/components/MusicSearch';
import { ArtistSync } from '@/components/ArtistSync';
import { CloudLightning } from 'lucide-react';

export default function Home() {
  const [isLogged, setIsLogged] = useState(false);

  const [activeTab, setActiveTab] = useState<'single' | 'artist'>('artist');

  useEffect(() => {
    // Check if we already have a session
    fetch('/api/user')
      .then((res) => {
        if (res.ok) {
          setIsLogged(true);
        }
      })
      .catch((err) => console.error('Failed to check login status', err));
  }, []);

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center py-6 md:py-12">
      <div className="text-center mb-6 md:mb-10 px-4">
        <h1 className="text-2xl md:text-4xl font-extrabold text-blue-600 flex items-center justify-center gap-2">
          <CloudLightning className="w-7 h-7 md:w-10 md:h-10" />
          MusicBridge
        </h1>
        <p className="text-sm md:text-base text-gray-600 mt-2">轻松同步你喜欢的音乐到网易云音乐云盘。</p>
      </div>

      <div className="w-full max-w-4xl px-2 md:px-4 grid gap-6 md:gap-8">
        {!isLogged && (
          <div className="w-full flex justify-center">
            <LoginPanel onLoginSuccess={() => setIsLogged(true)} />
          </div>
        )}

        {isLogged && (
          <div className="animate-fade-in-up space-y-6">
            <div className="bg-green-100 border border-green-200 text-green-700 px-4 py-2 rounded flex items-center justify-center gap-2">
              <span>✅ 已登录网易云音乐</span>
            </div>

            {/* Tabs */}
            <div className="flex bg-white p-1 rounded-xl shadow-sm border border-gray-100">
              <button
                onClick={() => setActiveTab('artist')}
                className={`flex-1 py-2 px-4 rounded-lg text-sm font-semibold transition ${activeTab === 'artist'
                  ? 'bg-blue-50 text-blue-600 shadow-sm'
                  : 'text-gray-500 hover:bg-gray-50'
                  }`}
              >
                歌手同步
              </button>
              <button
                onClick={() => setActiveTab('single')}
                className={`flex-1 py-2 px-4 rounded-lg text-sm font-semibold transition ${activeTab === 'single'
                  ? 'bg-blue-50 text-blue-600 shadow-sm'
                  : 'text-gray-500 hover:bg-gray-50'
                  }`}
              >
                单曲搜索
              </button>
            </div>

            {/* Content */}
            {activeTab === 'single' ? <MusicSearch /> : <ArtistSync />}
          </div>
        )}

        {/* Grayed out search if not logged (optional, for visual consistency) */}
        {!isLogged && (
          <div className="opacity-50 pointer-events-none filter blur-sm">
            <div className="flex bg-white p-1 rounded-xl shadow-sm border mb-6">
              <div className="flex-1 py-2 text-center text-gray-400 font-semibold">歌手同步</div>
              <div className="flex-1 py-2 text-center text-gray-400 font-semibold">单曲搜索</div>
            </div>
            <MusicSearch />
          </div>
        )}
      </div>

      <footer className="mt-auto py-6 text-gray-400 text-sm">
        <p>© 2026 MusicBridge. 请使用标准 YouTube 和网易云音乐账号。</p>
      </footer>
    </main>
  );
}
