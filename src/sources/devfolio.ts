import { nextData } from './embedded.js';
import { cleanText, isoDate } from './text.js';
import type { Announcement, Source, SourceContext } from './types.js';

const PAGE = 'https://devfolio.co/hackathons';
// The lists of the page's data that hold hackathons one can still apply to.
const LISTS = ['open_hackathons', 'upcoming_hackathons', 'featured_hackathons'];

export interface DevfolioSourceConfig {
  type: 'devfolio';
  name?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The object holding the hackathon lists, wherever the page keeps it. */
function findLists(node: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 8 || node === null || typeof node !== 'object') return null;
  if (isRecord(node) && Array.isArray(node['open_hackathons'])) return node;
  for (const value of Object.values(node)) {
    const found = findLists(value, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Turns the Devfolio hackathons page into announcements. */
export function parseDevfolio(html: string, sourceName: string): Announcement[] {
  const lists = findLists(nextData(html));
  if (!lists) throw new Error('Devfolio: page data has no hackathon lists');

  const byId = new Map<string, Announcement>();
  for (const name of LISTS) {
    const list = lists[name];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!isRecord(item)) continue;
      const slug = item['slug'];
      const title = cleanText(item['name']);
      if (typeof slug !== 'string' || !/^[a-z0-9-]+$/i.test(slug) || !title) continue;
      if (typeof item['type'] === 'string' && item['type'] !== 'HACKATHON') continue;

      const online = item['is_online'] === true;
      const location = cleanText(item['location']) || cleanText(item['city']) || null;
      const participants = item['participants_count'];

      byId.set(`devfolio:${slug}`, {
        id: `devfolio:${slug}`,
        source: sourceName,
        title,
        url: `https://${slug.toLowerCase()}.devfolio.co/`,
        startsAt: isoDate(item['starts_at']),
        endsAt: isoDate(item['ends_at']),
        dateText: null,
        location: online ? null : location,
        country: null,
        online,
        organizer: null,
        popularity: typeof participants === 'number' && participants >= 0 ? participants : null,
        prize: null,
        themes: [],
        assumeRegion: false,
        curated: false,
      });
    }
  }
  return [...byId.values()];
}

export function createDevfolioSource(config: DevfolioSourceConfig): Source {
  const name = config.name ?? 'Devfolio';
  return {
    name,
    async fetch(context: SourceContext): Promise<Announcement[]> {
      return parseDevfolio(await context.fetchText(PAGE, 'text/html'), name);
    },
  };
}
