import { titleKey, urlKey } from './sources/text.js';
import type { Announcement } from './sources/types.js';

export interface SelectionPolicy {
  /** Lowercase place names; a hackathon held in one of them is "local". */
  regionKeywords: string[];
  regionCountryCodes: string[];
  includeOnline: boolean;
  /** Registrations an online hackathon needs before it is worth posting. */
  minPopularity: number;
  /** A hackathon must start at least this far ahead: one already under way is not announced. */
  minLeadMs: number;
  /** ...and no further ahead than this: a date a year out is often a placeholder. */
  maxAheadMs: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Held in the configured region, by place name, country code or the listing it came from. */
export function isLocal(item: Announcement, policy: SelectionPolicy): boolean {
  if (item.online) return false;
  if (item.assumeRegion) return true;
  if (item.country && policy.regionCountryCodes.includes(item.country)) return true;
  const location = item.location?.toLowerCase();
  if (!location) return false;
  // Whole words only: "uae" must not match inside another word.
  return policy.regionKeywords.some((keyword) =>
    new RegExp(`(?<![\\p{L}])${escapeRegExp(keyword)}(?![\\p{L}])`, 'u').test(location),
  );
}

/**
 * Starts within the announcing window. A hackathon whose start the source
 * does not state is left out: there is no telling whether it is still ahead.
 */
export function startsAhead(item: Announcement, policy: SelectionPolicy, now: number): boolean {
  if (item.startsAt === null) return false;
  const lead = Date.parse(item.startsAt) - now;
  return lead >= policy.minLeadMs && lead <= policy.maxAheadMs;
}

/**
 * Worth posting: yet to start, and either held in the region, or online and
 * popular enough. An in-person hackathon elsewhere is of no use to this feed.
 */
export function isEligible(item: Announcement, policy: SelectionPolicy, now: number): boolean {
  if (!startsAhead(item, policy, now)) return false;
  if (isLocal(item, policy)) return true;
  if (!item.online || !policy.includeOnline) return false;
  return item.popularity === null ? item.curated : item.popularity >= policy.minPopularity;
}

/** Drops the same hackathon listed twice (same page, or same title), keeping the first seen. */
export function dedupe(items: Announcement[]): Announcement[] {
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const result: Announcement[] = [];
  for (const item of items) {
    const url = urlKey(item.url);
    const title = titleKey(item.title);
    if (seenUrls.has(url) || (title.length > 0 && seenTitles.has(title))) continue;
    seenUrls.add(url);
    if (title.length > 0) seenTitles.add(title);
    result.push(item);
  }
  return result;
}

function startTime(item: Announcement): number {
  return item.startsAt ? Date.parse(item.startsAt) : Number.POSITIVE_INFINITY;
}

/** Local hackathons first, then the most popular, then the soonest. */
export function rank(items: Announcement[], policy: SelectionPolicy): Announcement[] {
  return [...items].sort((a, b) => {
    const local = Number(isLocal(b, policy)) - Number(isLocal(a, policy));
    if (local !== 0) return local;
    const popularity = (b.popularity ?? 0) - (a.popularity ?? 0);
    if (popularity !== 0) return popularity;
    const start = startTime(a) - startTime(b);
    if (start !== 0 && Number.isFinite(start)) return start;
    return a.title.localeCompare(b.title);
  });
}

/**
 * The posting queue. A hackathon in the region goes first — it is what the
 * feed is for and it cannot wait behind a backlog. Otherwise announcements
 * are posted in the order they were first seen, and those found in the same
 * pass keep their rank.
 */
export function queueOrder(
  items: Announcement[],
  policy: SelectionPolicy,
  firstSeenAt: (item: Announcement) => number,
): Announcement[] {
  // Array.prototype.sort is stable, so ties fall back to the rank order.
  return rank(items, policy).sort(
    (a, b) => Number(isLocal(b, policy)) - Number(isLocal(a, policy)) || firstSeenAt(a) - firstSeenAt(b),
  );
}
