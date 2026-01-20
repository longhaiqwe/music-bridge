import { MusicInfo } from './downloader/types';

export const api = {
    search: async (q: string) => {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        return res.json();
    },

    sync: async (info: MusicInfo) => {
        const res = await fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(info)
        });
        return res.json();
    },

    auth: {
        getQr: async () => {
            const res = await fetch('/api/auth/qr');
            return res.json(); // { key, qrimg }
        },
        checkQr: async (key: string) => {
            const res = await fetch(`/api/auth/check?key=${key}`);
            return res.json();
        }
    }
};
