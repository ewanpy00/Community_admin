import { cleanText, isoDate, looksLikeHackathon } from './text.js';
import type { Announcement, Source, SourceContext } from './types.js';

const API = 'https://api.lu.ma';
const EVENT_PAGE = 'https://luma.com';
const PAGE_SIZE = 50;

export interface LumaSourceConfig {
  type: 'luma';
  name: string;
  /** The public events Luma lists near this point (a city's centre)... */
  latitude?: number;
  longitude?: number;
  /**
   * ...or every event of one organiser's calendar, by its `cal-...` id. An
   * organiser can keep an event out of Luma's listings; its calendar still has it.
   */
  calendar?: string;
  /** Pages read (50 events a page). */
  pages?: number;
  /** Everything found here is in the configured region, even with the address hidden. */
  assumeRegion?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Turns one page of a Luma event listing into announcements, and says where the next page starts. */
export function parseLuma(jsonText: string, config: LumaSourceConfig): { items: Announcement[]; next: string | null } {
  const parsed: unknown = JSON.parse(jsonText);
  if (!isRecord(parsed) || !Array.isArray(parsed['entries'])) {
    throw new Error('Luma: response has no "entries" list');
  }
  const items: Announcement[] = [];
  for (const entry of parsed['entries']) {
    const event = isRecord(entry) && isRecord(entry['event']) ? entry['event'] : null;
    if (!isRecord(entry) || !event) continue;
    const id = event['api_id'];
    const slug = event['url'];
    const title = cleanText(event['name']);
    if (typeof id !== 'string' || typeof slug !== 'string' || !/^[\w.-]+$/.test(slug) || !title) continue;
    if (event['visibility'] !== 'public' || !looksLikeHackathon(title)) continue;

    const geo = isRecord(event['geo_address_info']) ? event['geo_address_info'] : null;
    // An in-person event may hide its address until a guest is approved.
    const online = event['location_type'] !== 'offline' && geo === null;
    const place = geo
      ? [cleanText(geo['address']), cleanText(geo['city_state']) || cleanText(geo['city'])]
          .filter((part) => part.length > 0)
          .join(', ')
      : '';
    const country = geo && typeof geo['country_code'] === 'string' ? geo['country_code'].toUpperCase() : null;
    const hosts = Array.isArray(entry['hosts']) ? entry['hosts'] : [];
    const host = isRecord(hosts[0]) ? cleanText(hosts[0]['name']) : '';
    const guests = entry['guest_count'];

    items.push({
      id: `luma:${id}`,
      source: config.name,
      title,
      url: `${EVENT_PAGE}/${slug}`,
      startsAt: isoDate(event['start_at']),
      endsAt: isoDate(event['end_at']),
      dateText: null,
      location: online ? null : place || null,
      country: online ? null : country,
      online,
      organizer: host || null,
      // Luma reports 0 when the organiser hides the guest list.
      popularity: typeof guests === 'number' && guests > 0 ? guests : null,
      prize: null,
      themes: [],
      assumeRegion: config.assumeRegion === true && !online,
      curated: false,
    });
  }
  const next = parsed['has_more'] === true && typeof parsed['next_cursor'] === 'string' ? parsed['next_cursor'] : null;
  return { items, next };
}

export function createLumaSource(config: LumaSourceConfig): Source {
  const pages = Math.max(1, Math.min(config.pages ?? 4, 8));
  const listing = config.calendar
    ? `${API}/calendar/get-items?calendar_api_id=${encodeURIComponent(config.calendar)}&period=future`
    : `${API}/discover/get-paginated-events?latitude=${config.latitude}&longitude=${config.longitude}`;

  return {
    name: config.name,
    async fetch(context: SourceContext): Promise<Announcement[]> {
      const byId = new Map<string, Announcement>();
      let cursor: string | null = null;
      for (let page = 0; page < pages; page++) {
        const url = `${listing}&pagination_limit=${PAGE_SIZE}${cursor ? `&pagination_cursor=${encodeURIComponent(cursor)}` : ''}`;
        const { items, next } = parseLuma(await context.fetchText(url, 'application/json'), config);
        for (const item of items) byId.set(item.id, item);
        if (!next) break;
        cursor = next;
      }
      return [...byId.values()];
    },
  };
}
