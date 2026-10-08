import { cleanText, isoDate, looksLikeHackathon, normalizeUrl, urlKey } from './text.js';
import type { Announcement, Source, SourceContext } from './types.js';

export interface JsonLdSourceConfig {
  type: 'jsonld';
  name: string;
  /** Any page that describes its events with schema.org `Event` markup (Luma, Meetup, ...). */
  url: string;
  /** The page lists hackathons only, so no keyword check is needed. */
  hackathonsOnly?: boolean;
  /** The page is itself a listing for the configured region. */
  assumeRegion?: boolean;
}

const LD_SCRIPT = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typesOf(node: Record<string, unknown>): string[] {
  const type = node['@type'];
  if (typeof type === 'string') return [type];
  return Array.isArray(type) ? type.filter((t): t is string => typeof t === 'string') : [];
}

/** Every schema.org Event (or subtype, e.g. `SocialEvent`) anywhere in the document. */
function collectEvents(node: unknown, out: Record<string, unknown>[], depth = 0): void {
  if (depth > 12) return;
  if (Array.isArray(node)) {
    for (const item of node) collectEvents(item, out, depth + 1);
    return;
  }
  if (!isRecord(node)) return;
  if (typesOf(node).some((type) => type.endsWith('Event'))) out.push(node);
  for (const value of Object.values(node)) collectEvents(value, out, depth + 1);
}

interface Place {
  text: string | null;
  country: string | null;
  virtual: boolean;
}

function describePlace(location: unknown): Place {
  const places = Array.isArray(location) ? location : [location];
  const parts: string[] = [];
  let country: string | null = null;
  let virtual = false;

  for (const place of places) {
    if (typeof place === 'string') {
      parts.push(cleanText(place));
      continue;
    }
    if (!isRecord(place)) continue;
    if (typesOf(place).includes('VirtualLocation')) {
      virtual = true;
      continue;
    }
    parts.push(cleanText(place['name']));
    const address = place['address'];
    if (typeof address === 'string') {
      parts.push(cleanText(address));
    } else if (isRecord(address)) {
      parts.push(cleanText(address['addressLocality']), cleanText(address['addressRegion']));
      const rawCountry = address['addressCountry'];
      const countryText = cleanText(isRecord(rawCountry) ? rawCountry['name'] : rawCountry);
      if (/^[A-Za-z]{2}$/.test(countryText)) country = countryText.toUpperCase();
      else parts.push(countryText);
    }
  }

  const unique = [...new Set(parts.filter((part) => part.length > 0))];
  return { text: unique.length > 0 ? unique.join(', ') : null, country, virtual };
}

export function parseJsonLdEvents(html: string, config: JsonLdSourceConfig): Announcement[] {
  const events: Record<string, unknown>[] = [];
  for (const match of html.matchAll(LD_SCRIPT)) {
    try {
      collectEvents(JSON.parse(match[1] ?? ''), events);
    } catch {
      // One malformed block must not hide the others.
    }
  }

  const byUrl = new Map<string, Announcement>();
  for (const event of events) {
    const title = cleanText(event['name']);
    const url = normalizeUrl(event['url'], config.url) ?? normalizeUrl(event['@id'], config.url);
    if (!title || !url) continue;
    if (!config.hackathonsOnly && !looksLikeHackathon(title, cleanText(event['description']))) continue;

    const place = describePlace(event['location']);
    const mode = typeof event['eventAttendanceMode'] === 'string' ? event['eventAttendanceMode'] : '';
    const online = mode.includes('OnlineEventAttendanceMode') || (place.virtual && place.text === null);
    const organizer = Array.isArray(event['organizer']) ? event['organizer'][0] : event['organizer'];

    const key = urlKey(url);
    if (byUrl.has(key)) continue;
    byUrl.set(key, {
      id: `${config.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}:${key}`,
      source: config.name,
      title,
      url,
      startsAt: isoDate(event['startDate']),
      endsAt: isoDate(event['endDate']),
      dateText: null,
      location: online ? null : place.text,
      country: online ? null : place.country,
      online,
      organizer: isRecord(organizer) ? cleanText(organizer['name']) || null : null,
      popularity: null,
      prize: null,
      themes: [],
      assumeRegion: config.assumeRegion === true && !online,
      curated: false,
    });
  }
  return [...byUrl.values()];
}

export function createJsonLdSource(config: JsonLdSourceConfig): Source {
  return {
    name: config.name,
    async fetch(context: SourceContext): Promise<Announcement[]> {
      return parseJsonLdEvents(await context.fetchText(config.url, 'text/html'), config);
    },
  };
}
