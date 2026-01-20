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
            setStatus('Please scan with Netease Cloud Music App');
        } catch (e) {
            setStatus('Failed to load QR code');
        }
    };

    const checkStatus = async () => {
        if (!unikey) return;
        try {
            const res = await api.auth.checkQr(unikey);
            if (res.code === 800) {
                setStatus('Expired. Refreshing...');
                loadQr();
            } else if (res.code === 801) {
                setStatus('Waiting for scan...');
            } else if (res.code === 802) {
                setStatus('Scanned. Please confirm on phone.');
            } else if (res.code === 803) {
                setStatus('Login successful!');
                setIsLogged(true);
                onLoginSuccess();
            }
        } catch (e) {
            console.error(e);
        }
    };

    return (
        <div className="p-4 border rounded shadow bg-white max-w-sm mx-auto text-center">
            <h2 className="text-xl font-bold mb-4">Login to NetEase</h2>
            {qrImg ? (
                <img src={qrImg} alt="QR Code" className="mx-auto mb-4 w-48 h-48" />
            ) : (
                <div className="w-48 h-48 bg-gray-200 mx-auto mb-4 animate-pulse"></div>
            )}
            <p className="text-gray-600">{status}</p>
        </div>
    );
}
