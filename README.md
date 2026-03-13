This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Agent / CLI

The app now exposes a persistent job API backed by SQLite at `.data/music-bridge.sqlite`.

Common CLI commands:

```bash
npm run cli -- help
npm run cli -- jobs
npm run cli -- search-song "周杰伦 稻香"
npm run cli -- search-artist "周杰伦" --cookie "$NETEASE_COOKIE"
npm run cli -- sync-artist --artist-name 周杰伦 --count 10 --wait --cookie "$NETEASE_COOKIE"
```

You can also point the CLI at another server:

```bash
MUSIC_BRIDGE_BASE_URL=http://127.0.0.1:3000 npm run cli -- jobs
```

For single-song sync, pass a serialized `MusicInfo` object:

```bash
npm run cli -- sync-song --file ./song.json --wait --cookie "$NETEASE_COOKIE"
```

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
