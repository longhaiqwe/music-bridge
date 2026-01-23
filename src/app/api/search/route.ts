import { NextResponse } from 'next/server';
import { downloadManager } from '@/lib/downloader';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');

    if (!q) {
        return NextResponse.json({ error: 'Missing query parameter q' }, { status: 400 });
    }

    try {
        console.log('==================================================');
        console.log(`[Song Search] Query: ${q}`);
        const results = await downloadManager.search(q);
        console.log(`[Song Search] Found ${results.length} results`);
        console.log('==================================================');
        return NextResponse.json({ results });
    } catch (e) {
        console.error('Search failed:', e);
        return NextResponse.json({ error: 'Search failed' }, { status: 500 });
    }
}
