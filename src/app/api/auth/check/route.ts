import { NextResponse } from 'next/server';
import { neteaseService } from '@/lib/netease';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (!key) {
        return NextResponse.json({ error: 'Missing key parameter' }, { status: 400 });
    }

    try {
        const res = await neteaseService.loginQrCodeCheck(key);
        return NextResponse.json(res);
    } catch (e) {
        console.error('Auth check failed:', e);
        return NextResponse.json({ error: 'Failed to check status', details: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
}
