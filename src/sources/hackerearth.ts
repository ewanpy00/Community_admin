import { cleanText, isoDate, looksLikeHackathon, normalizeUrl } from './text.js';
import type { Announcement, Source, SourceContext } from './types.js';

const API = 'https://www.hackerearth.com/chrome-extension/events/';

export interface HackerEarthSourceConfig {
  type: 'hackerearth';
  name?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Turns the HackerEarth events feed into announcements. Its challenges are held online. */
export function parseHackerEarth(jsonText: string, sourceName: string): Announcement[] {
  const parsed: unknown = JSON.parse(jsonText);
  if (!isRecord(parsed) || !Array.isArray(parsed['response'])) {
    throw new Error('HackerEarth: response has no "response" list');
  }
  const result: Announcement[] = [];
  for (const item of parsed['response']) {
    if (!isRecord(item)) continue;
    const title = cleanText(item['title']);
    const url = normalizeUrl(item['url']);
    if (!title || !url) continue;
    // The feed also lists coding contests and hiring challenges.
    if (!url.includes('/hackathon/') && !looksLikeHackathon(title)) continue;

    result.push({
      id: `hackerearth:${new URL(url).pathname.replace(/\/+$/, '')}`,
      source: sourceName,
      title,
      url,
      startsAt: isoDate(item['start_utc_tz']),
      endsAt: isoDate(item['end_utc_tz']),
      dateText: null,
      location: null,
      country: null,
      online: true,
      organizer: null,
      popularity: null,
      prize: null,
      themes: [],
      assumeRegion: false,
      // Only what HackerEarth itself runs with the sponsoring company counts as vetted.
      curated: item['is_hackerearth'] === true,
    });
  }
  return result;
}

export function createHackerEarthSource(config: HackerEarthSourceConfig): Source {
  const name = config.name ?? 'HackerEarth';
  return {
    name,
    async fetch(context: SourceContext): Promise<Announcement[]> {
      return parseHackerEarth(await context.fetchText(API, 'application/json'), name);
    },
  };
}
