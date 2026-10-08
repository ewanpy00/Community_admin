import type { Announcement } from '../../src/sources/types.js';

let counter = 0;

/**
 * An announcement with sensible defaults; a test states only what it is about.
 * It starts six weeks after the tests' clocks (7 October 2026), so it is still ahead.
 */
export function announcement(overrides: Partial<Announcement> = {}): Announcement {
  counter++;
  return {
    id: `test:${counter}`,
    source: 'Devpost',
    title: `Hackathon ${counter}`,
    url: `https://hack-${counter}.example/`,
    startsAt: '2026-11-20T05:00:00.000Z',
    endsAt: '2026-11-22T14:00:00.000Z',
    dateText: null,
    location: null,
    country: null,
    online: false,
    organizer: null,
    popularity: null,
    prize: null,
    themes: [],
    assumeRegion: false,
    curated: false,
    ...overrides,
  };
}
