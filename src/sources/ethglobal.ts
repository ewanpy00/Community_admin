import { flightArray } from './embedded.js';
import { cleanText, isoDate } from './text.js';
import type { Announcement, Source, SourceContext } from './types.js';

const PAGE = 'https://ethglobal.com/events';

export interface EthGlobalSourceConfig {
  type: 'ethglobal';
  name?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Turns the ETHGlobal events page into announcements: its hackathons, not its summits and meetups. */
export function parseEthGlobal(html: string, sourceName: string): Announcement[] {
  const events = flightArray(html, 'events');
  if (!events) throw new Error('ETHGlobal: page data has no "events" list');

  const result: Announcement[] = [];
  for (const event of events) {
    if (!isRecord(event)) continue;
    const slug = event['slug'];
    const title = cleanText(event['name']);
    if (typeof slug !== 'string' || !/^[a-z0-9-]+$/i.test(slug) || !title) continue;
    if (event['type'] !== 'hackathon') continue;

    const online = event['medium'] === 'virtual';
    const city = isRecord(event['city']) ? event['city'] : {};
    const country = isRecord(city['country']) ? cleanText(city['country']['name']) : '';
    const place = [cleanText(city['name']), country].filter((part) => part.length > 0).join(', ');
    const code = typeof city['countryCode'] === 'string' ? city['countryCode'].toUpperCase() : null;

    result.push({
      id: `ethglobal:${slug}`,
      source: sourceName,
      title,
      url: `${PAGE}/${slug}`,
      startsAt: isoDate(event['startTime']),
      endsAt: isoDate(event['endTime']),
      dateText: null,
      location: online ? null : place || null,
      country: online ? null : code,
      online,
      organizer: 'ETHGlobal',
      popularity: null,
      prize: null,
      themes: [],
      assumeRegion: false,
      curated: true,
    });
  }
  return result;
}

export function createEthGlobalSource(config: EthGlobalSourceConfig): Source {
  const name = config.name ?? 'ETHGlobal';
  return {
    name,
    async fetch(context: SourceContext): Promise<Announcement[]> {
      return parseEthGlobal(await context.fetchText(PAGE, 'text/html'), name);
    },
  };
}
