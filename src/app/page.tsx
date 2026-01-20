'use client';

import { useState } from 'react';
import { LoginPanel } from '@/components/LoginPanel';
import { MusicSearch } from '@/components/MusicSearch';
import { ArtistSync } from '@/components/ArtistSync';
import { CloudLightning } from 'lucide-react';

export default function Home() {
  const [isLogged, setIsLogged] = useState(false);

  const [activeTab, setActiveTab] = useState<'single' | 'artist'>('artist');

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center py-12">
      <div className="text-center mb-10">
        <h1 className="text-4xl font-extrabold text-blue-600 flex items-center justify-center gap-2">
          <CloudLightning className="w-10 h-10" />
          MusicBridge
        </h1>
        <p className="text-gray-600 mt-2">Sync your favorite music to Netease Cloud Disk effortlessly.</p>
      </div>

      <div className="w-full max-w-4xl px-4 grid gap-8">
        {!isLogged && (
          <div className="w-full flex justify-center">
            <LoginPanel onLoginSuccess={() => setIsLogged(true)} />
          </div>
        )}

        {isLogged && (
          <div className="animate-fade-in-up space-y-6">
            <div className="bg-green-100 border border-green-200 text-green-700 px-4 py-2 rounded flex items-center justify-center gap-2">
              <span>✅ Logged in to Netease Cloud Music</span>
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
                Artist Sync
              </button>
              <button
                onClick={() => setActiveTab('single')}
                className={`flex-1 py-2 px-4 rounded-lg text-sm font-semibold transition ${activeTab === 'single'
                  ? 'bg-blue-50 text-blue-600 shadow-sm'
                  : 'text-gray-500 hover:bg-gray-50'
                  }`}
              >
                Single Song Search
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
              <div className="flex-1 py-2 text-center text-gray-400 font-semibold">Artist Sync</div>
              <div className="flex-1 py-2 text-center text-gray-400 font-semibold">Single Search</div>
            </div>
            <MusicSearch />
          </div>
        )}
      </div>

      <footer className="mt-auto py-6 text-gray-400 text-sm">
        <p>© 2026 MusicBridge. Use with standard Youtube & Netease accounts.</p>
      </footer>
    </main>
  );
}
