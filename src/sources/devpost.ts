import { cleanText, normalizeUrl } from './text.js';
import type { Announcement, Source, SourceContext } from './types.js';

const API = 'https://devpost.com/api/hackathons';
// Only hackathons that have not started yet.
const BASE_QUERY = 'status[]=upcoming';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export interface DevpostSourceConfig {
  type: 'devpost';
  name?: string;
  /** Extra query strings, one listing each, e.g. `order_by=recently-added` or `search=dubai`. */
  queries?: string[];
  /** Pages fetched per query (9 hackathons a page). */
  pages?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Devpost states its dates as words — "Nov 13, 2026", "Oct 17 - 18, 2026",
 * "Oct 05 - Nov 25, 2026", "Dec 15, 2026 - Jan 20, 2027" — in whole days and
 * with no time zone. They are read as UTC days: first day from its start, last
 * day to its end.
 */
export function parseDevpostDates(text: string): { startsAt: string; endsAt: string } | null {
  const match = /^([A-Za-z]+) (\d{1,2})(?:, (\d{4}))?(?: [-–] (?:([A-Za-z]+) )?(\d{1,2}), (\d{4}))?$/.exec(text.trim());
  if (!match) return null;
  const [, firstMonth, firstDay, firstYear, lastMonth, lastDay, lastYear] = match;
  const month = (name: string | undefined): number => MONTHS.indexOf((name ?? '').slice(0, 3).toLowerCase());
  const startYear = Number(firstYear ?? lastYear);
  const startMonth = month(firstMonth);
  const endMonth = lastDay === undefined ? startMonth : month(lastMonth ?? firstMonth);
  if (!Number.isFinite(startYear) || startMonth < 0 || endMonth < 0) return null;

  const start = Date.UTC(startYear, startMonth, Number(firstDay));
  const end = Date.UTC(Number(lastYear ?? firstYear), endMonth, Number(lastDay ?? firstDay), 23, 59, 59);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return { startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() };
}

/** Turns one page of the Devpost hackathon API into announcements. */
export function parseDevpost(jsonText: string, sourceName: string): Announcement[] {
  const parsed: unknown = JSON.parse(jsonText);
  if (!isRecord(parsed) || !Array.isArray(parsed['hackathons'])) {
    throw new Error('Devpost: response has no "hackathons" list');
  }
  const result: Announcement[] = [];
  for (const item of parsed['hackathons']) {
    if (!isRecord(item)) continue;
    const id = item['id'];
    const title = cleanText(item['title']);
    const url = normalizeUrl(item['url']);
    if ((typeof id !== 'number' && typeof id !== 'string') || !title || !url) continue;
    // Invite-only hackathons are of no use to a community feed.
    if (item['invite_only'] === true) continue;

    const place = isRecord(item['displayed_location']) ? item['displayed_location'] : {};
    const location = cleanText(place['location']) || null;
    const online = place['icon'] === 'globe' || location?.toLowerCase() === 'online';

    const prize = cleanText(item['prize_amount']);
    const hasPrize = /[1-9]/.test(prize);
    const registrations = item['registrations_count'];
    const dateText = cleanText(item['submission_period_dates']) || null;
    const dates = dateText ? parseDevpostDates(dateText) : null;
    const themes = Array.isArray(item['themes'])
      ? item['themes'].map((theme) => (isRecord(theme) ? cleanText(theme['name']) : '')).filter((name) => name)
      : [];

    result.push({
      id: `devpost:${id}`,
      source: sourceName,
      title,
      url,
      startsAt: dates?.startsAt ?? null,
      endsAt: dates?.endsAt ?? null,
      dateText,
      location: online ? null : location,
      country: null,
      online,
      organizer: cleanText(item['organization_name']) || null,
      popularity: typeof registrations === 'number' && registrations >= 0 ? registrations : null,
      prize: hasPrize ? prize.replace(/\s+/g, '') : null,
      themes,
      assumeRegion: false,
      curated: false,
    });
  }
  return result;
}

export function createDevpostSource(config: DevpostSourceConfig): Source {
  const name = config.name ?? 'Devpost';
  const queries = config.queries?.length ? config.queries : ['order_by=recently-added'];
  const pages = Math.max(1, Math.min(config.pages ?? 1, 5));

  return {
    name,
    async fetch(context: SourceContext): Promise<Announcement[]> {
      const byId = new Map<string, Announcement>();
      for (const query of queries) {
        for (let page = 1; page <= pages; page++) {
          const url = `${API}?${BASE_QUERY}&${query}&page=${page}`;
          const items = parseDevpost(await context.fetchText(url, 'application/json'), name);
          for (const item of items) byId.set(item.id, item);
          if (items.length === 0) break;
        }
      }
      return [...byId.values()];
    },
  };
}
