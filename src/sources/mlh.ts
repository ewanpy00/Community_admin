import { cleanText, isoDate, normalizeUrl } from './text.js';
import type { Announcement, Source, SourceContext } from './types.js';

const ORIGIN = 'https://www.mlh.com';

export interface MlhSourceConfig {
  type: 'mlh';
  name?: string;
  /** Season events page. Defaults to the current season's. */
  url?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** MLH seasons follow the academic year: the 2027 season starts in mid-2026. */
export function mlhSeasonUrl(now: number): string {
  const date = new Date(now);
  const season = date.getUTCMonth() >= 6 ? date.getUTCFullYear() + 1 : date.getUTCFullYear();
  return `${ORIGIN}/seasons/${season}/events`;
}

/**
 * The MLH events page ships its data as JSON inside
 * `<script data-page="app" type="application/json">`; the upcoming events are
 * `props.upcomingEvents`.
 */
export function parseMlh(html: string, sourceName: string): Announcement[] {
  const match = /<script\b[^>]*\bdata-page=["'][^"']*["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!match?.[1]) throw new Error('MLH: page data block not found');
  const page: unknown = JSON.parse(match[1]);
  const props = isRecord(page) && isRecord(page['props']) ? page['props'] : null;
  if (!props || !Array.isArray(props['upcomingEvents'])) {
    throw new Error('MLH: page data has no "upcomingEvents" list');
  }

  const result: Announcement[] = [];
  for (const event of props['upcomingEvents']) {
    if (!isRecord(event)) continue;
    const id = event['id'];
    const title = cleanText(event['name']);
    const url = normalizeUrl(event['websiteUrl']) ?? normalizeUrl(event['url'], ORIGIN);
    if (typeof id !== 'string' || !title || !url) continue;

    const online = event['formatType'] === 'digital';
    const address = isRecord(event['venueAddress']) ? event['venueAddress'] : {};
    const country = typeof address['country'] === 'string' ? address['country'].toUpperCase() : null;

    result.push({
      id: `mlh:${id}`,
      source: sourceName,
      title,
      url,
      startsAt: isoDate(event['startsAt']),
      endsAt: isoDate(event['endsAt']),
      dateText: null,
      location: online ? null : cleanText(event['location']) || null,
      country: online ? null : country,
      online,
      organizer: null,
      popularity: null,
      prize: null,
      themes: [],
      assumeRegion: false,
      curated: true,
    });
  }
  return result;
}

export function createMlhSource(config: MlhSourceConfig): Source {
  const name = config.name ?? 'MLH';
  return {
    name,
    async fetch(context: SourceContext): Promise<Announcement[]> {
      const url = config.url ?? mlhSeasonUrl(context.now());
      return parseMlh(await context.fetchText(url, 'text/html'), name);
    },
  };
}
