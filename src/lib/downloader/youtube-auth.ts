export type YoutubeCookieAuthSource = 'browser' | 'none';

export interface YoutubeCookieAuthConfig {
  args: string[];
  source: YoutubeCookieAuthSource;
  description: string;
}

type YoutubeAuthEnv = Record<string, string | undefined>;

export function resolveYoutubeCookieAuth(env: YoutubeAuthEnv = process.env): YoutubeCookieAuthConfig {
  const useFromBrowser = env.YOUTUBE_COOKIES_FROM_BROWSER !== 'false';
  const browser = env.YOUTUBE_COOKIES_BROWSER?.trim() || 'chrome';

  if (useFromBrowser) {
    return {
      args: ['--cookies-from-browser', browser],
      source: 'browser',
      description: `browser cookies (${browser})`,
    };
  }

  return {
    args: [],
    source: 'none',
    description: 'anonymous session',
  };
}
