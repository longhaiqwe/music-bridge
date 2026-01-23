import { NextResponse } from 'next/server';
import { neteaseService } from '@/lib/netease';

export async function GET(request: Request) {
    try {
        const cookie = request.headers.get('x-netease-cookie') || undefined;
        const user = await neteaseService.getUserInfo(cookie);
        if (user) {
            return NextResponse.json(user);
        } else {
            return NextResponse.json({ error: 'Not logged in' }, { status: 401 });
        }
    } catch (e) {
        console.error('Check user failed:', e);
        return NextResponse.json(
            { error: 'Failed to check status' },
            { status: 500 }
        );
    }
}
