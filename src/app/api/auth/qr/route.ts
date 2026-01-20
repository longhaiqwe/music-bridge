import { NextResponse } from 'next/server';
import { neteaseService } from '@/lib/netease';

export async function GET() {
    try {
        const key = await neteaseService.loginQrCodeKey();
        const qrimg = await neteaseService.loginQrCodeCreate(key);
        return NextResponse.json({ key, qrimg });
    } catch (e) {
        console.error('Auth QR generation failed:', e);
        return NextResponse.json({ error: 'Failed to generate QR code' }, { status: 500 });
    }
}
