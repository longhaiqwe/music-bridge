import { MusicInfo } from './downloader/types';

// 从 LocalStorage 获取网易云 Cookie
export const getNeteaseCookie = () => {
    if (typeof window !== 'undefined') {
        return localStorage.getItem('netease_cookie') || '';
    }
    return '';
};

// 封装 fetch，自动添加 Cookie 请求头
async function customFetch(url: string, options: RequestInit = {}) {
    const cookie = getNeteaseCookie();
    const headers = {
        ...options.headers,
        'x-netease-cookie': cookie || '',
    };
    return fetch(url, { ...options, headers });
}

export const api = {
    search: async (q: string) => {
        const res = await customFetch(`/api/search?q=${encodeURIComponent(q)}`);
        return res.json();
    },

    sync: async (info: MusicInfo) => {
        const res = await customFetch('/api/sync', {
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
    },

    artist: {
        search: async (q: string) => {
            const res = await customFetch(`/api/artist/search?q=${encodeURIComponent(q)}`);
            return res.json();
        },
        getTopSongs: async (id: number | string) => {
            const res = await customFetch(`/api/artist/top-songs?id=${id}`);
            return res.json();
        }
    }
};

// 导出通用的 fetch 封装，方便流式请求使用
export { customFetch as fetch };
