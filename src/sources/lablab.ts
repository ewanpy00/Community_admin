import { flightArray } from './embedded.js';
import { cleanText, isoDate } from './text.js';
import type { Announcement, Source, SourceContext } from './types.js';

const PAGE = 'https://lablab.ai/event';

export interface LablabSourceConfig {
  type: 'lablab';
  name?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Turns the lablab.ai events page into announcements. Its hackathons are held online. */
export function parseLablab(html: string, sourceName: string): Announcement[] {
  const events = flightArray(html, 'sortedEvents');
  if (!events) throw new Error('lablab.ai: page data has no "sortedEvents" list');

  const result: Announcement[] = [];
  for (const event of events) {
    if (!isRecord(event)) continue;
    const slug = event['slug'];
    const title = cleanText(event['name']);
    if (typeof slug !== 'string' || !/^[a-z0-9-]+$/i.test(slug) || !title) continue;
    if (event['type'] !== 'HACKATHON' || event['active'] !== true) continue;
    // Dates still to be announced, or sign-up closed: nothing to register for.
    if (event['toBeAnnounced'] === true || event['signupActive'] !== true) continue;

    const count = isRecord(event['_count']) ? event['_count']['participants'] : null;
    result.push({
      id: `lablab:${slug}`,
      source: sourceName,
      title,
      url: `${PAGE}/${slug}`,
      startsAt: isoDate(event['startAt']),
      endsAt: isoDate(event['endAt']),
      dateText: null,
      location: null,
      country: null,
      online: true,
      organizer: null,
      popularity: typeof count === 'number' && count >= 0 ? count : null,
      prize: null,
      themes: [],
      assumeRegion: false,
      curated: true,
    });
  }
  return result;
}

export function createLablabSource(config: LablabSourceConfig): Source {
  const name = config.name ?? 'lablab.ai';
  return {
    name,
    async fetch(context: SourceContext): Promise<Announcement[]> {
      return parseLablab(await context.fetchText(PAGE, 'text/html'), name);
    },
  };
}
