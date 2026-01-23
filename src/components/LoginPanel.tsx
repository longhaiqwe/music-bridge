'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

export function LoginPanel({ onLoginSuccess }: { onLoginSuccess: () => void }) {
    const [qrImg, setQrImg] = useState('');
    const [unikey, setUnikey] = useState('');
    const [status, setStatus] = useState('Waiting for QR code...');
    const [isLogged, setIsLogged] = useState(false);

    useEffect(() => {
        loadQr();
    }, []);

    useEffect(() => {
        let timer: NodeJS.Timeout;
        if (unikey && !isLogged) {
            timer = setInterval(checkStatus, 2000);
        }
        return () => clearInterval(timer);
    }, [unikey, isLogged]);

    const loadQr = async () => {
        try {
            const data = await api.auth.getQr();
            setUnikey(data.key);
            setQrImg(data.qrimg);
            setStatus('请使用网易云音乐 APP 扫码登录');
        } catch (e) {
            setStatus('获取二维码失败');
        }
    };

    const checkStatus = async () => {
        if (!unikey) return;
        try {
            const res = await api.auth.checkQr(unikey);
            if (res.code === 800) {
                setStatus('二维码已过期，正在刷新...');
                loadQr();
            } else if (res.code === 801) {
                setStatus('等待扫码...');
            } else if (res.code === 802) {
                setStatus('已扫码，请在手机上确认登录');
            } else if (res.code === 803) {
                setStatus('登录成功！');
                if (res.cookie) {
                    localStorage.setItem('netease_cookie', res.cookie);
                    console.log('[LoginPanel] Cookie saved to localStorage');
                }
                setIsLogged(true);
                onLoginSuccess();
            }
        } catch (e) {
            console.error(e);
        }
    };

    return (
        <div className="p-4 border rounded shadow bg-white max-w-sm mx-auto text-center">
            <h2 className="text-xl font-bold mb-4">登录网易云音乐</h2>
            {qrImg ? (
                <img src={qrImg} alt="二维码" className="mx-auto mb-4 w-48 h-48" />
            ) : (
                <div className="w-48 h-48 bg-gray-200 mx-auto mb-4 animate-pulse"></div>
            )}
            <p className="text-gray-600">{status}</p>
        </div>
    );
}
