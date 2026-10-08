import { describe, expect, it } from 'vitest';
import { loadConfig, obsoleteSettings } from '../src/config.js';
import {
  describeInstant,
  isPostDue,
  latestSlot,
  nextSlot,
  parsePostTime,
  parsePostTimes,
  type PostSchedule,
} from '../src/schedule.js';

const HOUR = 3_600_000;
const at = (iso: string): number => Date.parse(iso);
const iso = (instant: number): string => new Date(instant).toISOString();

// Noon in Dubai is 08:00 UTC all year: the UAE has no daylight saving time.
const dubaiNoon: PostSchedule = { times: [{ hour: 12, minute: 0 }], timeZone: 'Asia/Dubai', graceMs: 3 * HOUR };
// Four times a day in Dubai: 20:00, 02:00, 08:00 and 14:00 UTC.
const everySixHours: PostSchedule = {
  times: [
    { hour: 0, minute: 0 },
    { hour: 6, minute: 0 },
    { hour: 12, minute: 0 },
    { hour: 18, minute: 0 },
  ],
  timeZone: 'Asia/Dubai',
  graceMs: 3 * HOUR,
};

describe('the posting time', () => {
  it('reads HH:MM', () => {
    expect(parsePostTime('12:00')).toEqual({ hour: 12, minute: 0 });
    expect(parsePostTime(' 9:05 ')).toEqual({ hour: 9, minute: 5 });
    expect(parsePostTime('23:59')).toEqual({ hour: 23, minute: 59 });
  });

  it.each(['24:00', '12:60', '12', 'noon', '12:0', ''])('rejects "%s"', (value) => {
    expect(() => parsePostTime(value)).toThrow(/not a time of day/);
  });

  it('reads a comma-separated list of times', () => {
    expect(parsePostTimes('00:00, 06:00,12:00,18:00')).toEqual(everySixHours.times);
    expect(() => parsePostTimes(' , ')).toThrow(/At least one posting time/);
    expect(() => parsePostTimes('06:00,noon')).toThrow(/not a time of day/);
  });

  it('with several times a day, finds the nearest one on either side', () => {
    const midMorning = at('2026-10-07T05:30:00Z'); // 09:30 in Dubai
    expect(iso(latestSlot(midMorning, everySixHours))).toBe('2026-10-07T02:00:00.000Z');
    expect(iso(nextSlot(midMorning, everySixHours))).toBe('2026-10-07T08:00:00.000Z');

    // Just before midnight in Dubai: the next time is on the next calendar day.
    const lateNight = at('2026-10-07T19:30:00Z');
    expect(iso(latestSlot(lateNight, everySixHours))).toBe('2026-10-07T14:00:00.000Z');
    expect(iso(nextSlot(lateNight, everySixHours))).toBe('2026-10-07T20:00:00.000Z');
  });

  it('finds the scheduled moment before and after an instant', () => {
    const beforeNoon = at('2026-10-07T07:59:00Z');
    expect(iso(latestSlot(beforeNoon, dubaiNoon))).toBe('2026-10-06T08:00:00.000Z');
    expect(iso(nextSlot(beforeNoon, dubaiNoon))).toBe('2026-10-07T08:00:00.000Z');

    const atNoon = at('2026-10-07T08:00:00Z');
    expect(iso(latestSlot(atNoon, dubaiNoon))).toBe('2026-10-07T08:00:00.000Z');
    expect(iso(nextSlot(atNoon, dubaiNoon))).toBe('2026-10-08T08:00:00.000Z');
  });

  it('uses the zone\'s own calendar day, not the UTC one', () => {
    // 22:30 UTC on the 7th is already 02:30 on the 8th in Dubai.
    const lateEvening = at('2026-10-07T22:30:00Z');
    expect(iso(latestSlot(lateEvening, dubaiNoon))).toBe('2026-10-07T08:00:00.000Z');
    expect(iso(nextSlot(lateEvening, dubaiNoon))).toBe('2026-10-08T08:00:00.000Z');
  });

  it('follows a clock change in a zone that has one', () => {
    const berlinNoon: PostSchedule = { ...dubaiNoon, timeZone: 'Europe/Berlin' };
    // Clocks in Berlin go forward on 29 March 2026: noon moves from 11:00 to 10:00 UTC.
    expect(iso(latestSlot(at('2026-03-28T15:00:00Z'), berlinNoon))).toBe('2026-03-28T11:00:00.000Z');
    expect(iso(latestSlot(at('2026-03-29T15:00:00Z'), berlinNoon))).toBe('2026-03-29T10:00:00.000Z');
    expect(iso(nextSlot(at('2026-03-28T15:00:00Z'), berlinNoon))).toBe('2026-03-29T10:00:00.000Z');
  });

  it('describes an instant in the schedule\'s zone', () => {
    expect(describeInstant(at('2026-10-08T08:00:00Z'), 'Asia/Dubai')).toMatch(/Thu,? 8 Oct,? 12:00/);
  });
});

describe('when a post is due', () => {
  const slot = '2026-10-07T08:00:00Z';

  it('is due from the scheduled moment until the grace period runs out', () => {
    expect(isPostDue(at('2026-10-07T07:59:59Z'), '2026-10-06T08:00:00Z', dubaiNoon)).toBe(false);
    expect(isPostDue(at(slot), '2026-10-06T08:00:00Z', dubaiNoon)).toBe(true);
    expect(isPostDue(at('2026-10-07T11:00:00Z'), '2026-10-06T08:00:00Z', dubaiNoon)).toBe(true);
    expect(isPostDue(at('2026-10-07T11:00:01Z'), '2026-10-06T08:00:00Z', dubaiNoon)).toBe(false);
  });

  it('is not due again once a post has gone out for that moment', () => {
    expect(isPostDue(at('2026-10-07T08:30:00Z'), '2026-10-07T08:00:05Z', dubaiNoon)).toBe(false);
    expect(isPostDue(at('2026-10-08T08:00:00Z'), '2026-10-07T08:00:05Z', dubaiNoon)).toBe(true);
  });

  it('is due once for each of several times a day', () => {
    const lastPost = '2026-10-07T02:00:05Z';
    expect(isPostDue(at('2026-10-07T07:59:00Z'), lastPost, everySixHours)).toBe(false);
    expect(isPostDue(at('2026-10-07T08:00:00Z'), lastPost, everySixHours)).toBe(true);
    expect(isPostDue(at('2026-10-07T08:30:00Z'), '2026-10-07T08:00:05Z', everySixHours)).toBe(false);
    expect(isPostDue(at('2026-10-07T14:00:00Z'), '2026-10-07T08:00:05Z', everySixHours)).toBe(true);
  });

  it('waits for the scheduled moment even when nothing was ever posted', () => {
    expect(isPostDue(at('2026-10-07T05:00:00Z'), null, dubaiNoon)).toBe(false);
    expect(isPostDue(at(slot), null, dubaiNoon)).toBe(true);
  });
});

describe('schedule settings', () => {
  const base = { API_BASE_URL: 'https://cormonity.test/api', AGENT_KEY: 'cag_test-key-for-settings', COMMUNITY_ID: 'c1' };

  it('defaults to every six hours in Dubai with three hours of grace', () => {
    expect(loadConfig(base).postSchedule).toEqual(everySixHours);
  });

  it('reads POST_TIMES, POST_TIMEZONE and POST_GRACE_HOURS', () => {
    const config = loadConfig({ ...base, POST_TIMES: '09:30,21:30', POST_TIMEZONE: 'Europe/Berlin', POST_GRACE_HOURS: '1' });
    expect(config.postSchedule).toEqual({
      times: [
        { hour: 9, minute: 30 },
        { hour: 21, minute: 30 },
      ],
      timeZone: 'Europe/Berlin',
      graceMs: HOUR,
    });
  });

  it('still reads the older POST_TIME as a single time a day', () => {
    expect(loadConfig({ ...base, POST_TIME: '12:00' }).postSchedule).toEqual(dubaiNoon);
  });

  it('reads how far ahead a hackathon must start', () => {
    expect(loadConfig(base)).toMatchObject({ minDaysAhead: 2, maxDaysAhead: 120 });
    expect(loadConfig({ ...base, MIN_DAYS_AHEAD: '5', MAX_DAYS_AHEAD: '60' })).toMatchObject({ minDaysAhead: 5, maxDaysAhead: 60 });
  });

  it('rejects a time zone that does not exist', () => {
    expect(() => loadConfig({ ...base, POST_TIMEZONE: 'Mars/Olympus' })).toThrow(/not a known time zone/);
  });

  it('names digest-era settings that are still set', () => {
    expect(obsoleteSettings({ ...base, POST_MIN_INTERVAL_HOURS: '0', POST_TITLE: ' ' })).toEqual(['POST_MIN_INTERVAL_HOURS']);
    expect(obsoleteSettings(base)).toEqual([]);
  });
});
