import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CormonityClient } from '../src/cormonity-client/client.js';
import type { Logger } from '../src/log.js';
import { runCycle, type ScoutOptions } from '../src/scout.js';
import type { Announcement, Source } from '../src/sources/types.js';
import type { State } from '../src/store.js';
import { announcement } from './helpers/announcement.js';
import { FakeCormonity } from './helpers/fake-cormonity.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Noon in Dubai — the moment the bot is scheduled to post.
const NOON = Date.parse('2026-10-07T08:00:00Z');

let dir: string;
let time: number;
let api: FakeCormonity;
let listed: Announcement[];
let lines: string[];

const quietLog: Logger = {
  info: (message) => void lines.push(message),
  warn: (message) => void lines.push(message),
  error: (message) => void lines.push(message),
};

function options(overrides: Partial<ScoutOptions> = {}): ScoutOptions {
  const source: Source = { name: 'Devpost', fetch: () => Promise.resolve(listed) };
  return {
    sources: [source],
    context: { now: () => time, fetchText: () => Promise.reject(new Error('not used')) },
    publisher: new CormonityClient({ baseUrl: api.baseUrl, agentKey: api.agentKey, fetch: api.fetch, now: () => time }),
    communityId: api.community.id,
    policy: {
      regionKeywords: ['dubai', 'abu dhabi'],
      regionCountryCodes: ['AE'],
      includeOnline: true,
      minPopularity: 200,
      minLeadMs: 2 * DAY,
      maxAheadMs: 120 * DAY,
    },
    schedule: { times: [{ hour: 12, minute: 0 }], timeZone: 'Asia/Dubai', graceMs: 3 * HOUR },
    postNow: false,
    statePath: join(dir, 'state.json'),
    dryRun: false,
    log: quietLog,
    now: () => time,
    ...overrides,
  };
}

const readState = (): State => JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) as State;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scout-'));
  time = NOON;
  api = new FakeCormonity({ now: () => time });
  lines = [];
  listed = [
    announcement({ title: 'Small online', online: true, popularity: 250 }),
    announcement({ title: 'Dubai Hack', location: 'Dubai' }),
    announcement({ title: 'Big online', online: true, popularity: 9000 }),
    announcement({ title: 'Elsewhere', location: 'Fort Worth', popularity: 50_000 }),
  ];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const postedTitle = (result: { posted: Announcement | null }): string | undefined => result.posted?.title;

describe('one pass of the bot', () => {
  it('posts one hackathon at the scheduled time, with its registration link, and queues the rest', async () => {
    const result = await runCycle(options());

    expect(result).toMatchObject({ outcome: 'posted', collected: 4, eligible: 3, queued: 3 });
    expect(postedTitle(result)).toBe('Dubai Hack');
    expect(api.posts).toHaveLength(1);
    const dubaiHack = listed.find((item) => item.title === 'Dubai Hack');
    expect(api.posts[0]?.body).toContain('Dubai Hack');
    expect(api.posts[0]?.body).toContain(`Register: ${dubaiHack?.url}`);
    expect(api.posts[0]?.linkUrl).toBe(dubaiHack?.url);
    for (const other of ['Big online', 'Small online', 'Elsewhere']) expect(api.posts[0]?.body).not.toContain(other);

    const state = readState();
    expect(state.lastPostAt).toBe('2026-10-07T08:00:00.000Z');
    const posted = Object.values(state.items).filter((item) => item.postedAt).map((item) => item.title);
    expect(posted).toEqual(['Dubai Hack']);
    expect(lines.join('\n')).toContain('2 left in the queue');
  });

  it('works through the queue one post a day and then falls silent', async () => {
    const titles: (string | undefined)[] = [];
    for (let day = 0; day < 4; day++) {
      titles.push(postedTitle(await runCycle(options())));
      time += DAY;
    }

    expect(titles).toEqual(['Dubai Hack', 'Big online', 'Small online', undefined]);
    expect(api.posts).toHaveLength(3);
  });

  it('does not post twice for the same scheduled time', async () => {
    await runCycle(options());

    time += 2 * HOUR;
    expect(await runCycle(options())).toMatchObject({ outcome: 'not-due', queued: 2 });
    expect(api.posts).toHaveLength(1);
    expect(lines.join('\n')).toMatch(/Next post is due Thu,? 8 Oct,? 12:00/);
  });

  it('does not post before the scheduled time', async () => {
    time = NOON - HOUR;
    expect(await runCycle(options())).toMatchObject({ outcome: 'not-due', queued: 3 });
    expect(api.posts).toHaveLength(0);
    expect(lines.join('\n')).toMatch(/Next post is due Wed,? 7 Oct,? 12:00/);

    time = NOON;
    expect((await runCycle(options())).outcome).toBe('posted');
  });

  it('still posts when the pass runs a little late', async () => {
    time = NOON + 2 * HOUR;
    expect((await runCycle(options())).outcome).toBe('posted');
  });

  it('skips the day when the scheduled time was missed by more than the grace period', async () => {
    time = NOON + 4 * HOUR;
    expect((await runCycle(options())).outcome).toBe('not-due');
    expect(api.posts).toHaveLength(0);

    time = NOON + DAY;
    expect(postedTitle(await runCycle(options()))).toBe('Dubai Hack');
  });

  it('posts straight away when asked to, whatever the schedule says', async () => {
    time = NOON - 5 * HOUR;
    expect(postedTitle(await runCycle(options({ postNow: true })))).toBe('Dubai Hack');
    expect(postedTitle(await runCycle(options({ postNow: true })))).toBe('Big online');
    expect(api.posts).toHaveLength(2);
  });

  it('stays silent when nothing new has appeared', async () => {
    listed = listed.filter((item) => item.title === 'Dubai Hack');
    await runCycle(options());

    time += DAY;
    expect(await runCycle(options())).toMatchObject({ outcome: 'nothing-new', queued: 0 });
    expect(api.posts).toHaveLength(1);
  });

  it('never reposts a hackathon another source lists under the same link', async () => {
    await runCycle(options());

    time += DAY;
    const dubaiHack = listed.find((item) => item.title === 'Dubai Hack');
    listed = [announcement({ title: 'Dubai Hack (Luma)', location: 'Dubai', url: dubaiHack?.url, source: 'Luma Dubai' })];
    expect((await runCycle(options())).outcome).toBe('nothing-new');
    expect(api.posts).toHaveLength(1);
  });

  it('prints the next post in a dry run without publishing or writing state', async () => {
    const result = await runCycle(options({ dryRun: true }));

    expect(result.outcome).toBe('dry-run');
    expect(postedTitle(result)).toBe('Dubai Hack');
    expect(api.posts).toHaveLength(0);
    expect(existsSync(join(dir, 'state.json'))).toBe(false);
    expect(lines.join('\n')).toContain('next in the queue (1 of 3), due now');
    expect(lines.join('\n')).toContain('Dubai Hack');
  });

  it('shows in a dry run when the next post would go out', async () => {
    time = NOON + 5 * HOUR;
    const result = await runCycle(options({ dryRun: true }));

    expect(result.outcome).toBe('dry-run');
    expect(lines.join('\n')).toMatch(/due Thu,? 8 Oct,? 12:00/);
  });
});

describe('the queue', () => {
  beforeEach(() => {
    listed = [
      announcement({ title: 'Small online', online: true, popularity: 250 }),
      announcement({ title: 'Big online', online: true, popularity: 9000 }),
    ];
  });

  it('puts a hackathon announced later behind the ones already waiting', async () => {
    expect(postedTitle(await runCycle(options()))).toBe('Big online');

    time += DAY;
    listed = [...listed, announcement({ title: 'Huge online', online: true, popularity: 99_000 })];
    expect(postedTitle(await runCycle(options()))).toBe('Small online');

    time += DAY;
    expect(postedTitle(await runCycle(options()))).toBe('Huge online');
  });

  it('lets a hackathon in the region go ahead of the backlog', async () => {
    await runCycle(options());

    time += DAY;
    listed = [...listed, announcement({ title: 'Abu Dhabi Climate Hack', location: 'Hub71, Abu Dhabi' })];
    expect(postedTitle(await runCycle(options()))).toBe('Abu Dhabi Climate Hack');

    time += DAY;
    expect(postedTitle(await runCycle(options()))).toBe('Small online');
  });

  it('drops a hackathon that came too close to its start while it was waiting', async () => {
    listed = [
      announcement({ title: 'Big online', online: true, popularity: 9000 }),
      announcement({ title: 'Soon online', online: true, popularity: 500, startsAt: new Date(NOON + 2 * DAY + 12 * HOUR).toISOString() }),
      announcement({ title: 'Small online', online: true, popularity: 250 }),
    ];
    expect(postedTitle(await runCycle(options()))).toBe('Big online');

    time += DAY;
    expect(postedTitle(await runCycle(options()))).toBe('Small online');
    expect(api.posts.map((post) => post.body).join('\n')).not.toContain('Soon online');
  });
});

describe('when the state file is lost', () => {
  it('recognises its own earlier posts in the feed and does not repeat them', async () => {
    await runCycle(options());
    rmSync(join(dir, 'state.json'));

    time += DAY;
    expect(postedTitle(await runCycle(options()))).toBe('Big online');
    expect(api.posts).toHaveLength(2);
  });

  it('still posts once per scheduled time, taking the time of its last post from the feed', async () => {
    await runCycle(options());
    rmSync(join(dir, 'state.json'));

    time += 2 * HOUR;
    expect((await runCycle(options())).outcome).toBe('not-due');
    expect(api.posts).toHaveLength(1);
    expect(readState().lastPostAt).toBe('2026-10-07T08:00:00.000Z');
  });

  it('ignores links in other people’s posts', async () => {
    const dubaiHack = listed.find((item) => item.title === 'Dubai Hack');
    api.seedPost('some-human', `Look at this: ${dubaiHack?.url}`, '2026-10-07T07:00:00.000Z');

    expect(postedTitle(await runCycle(options()))).toBe('Dubai Hack');
  });
});

describe('when sources misbehave', () => {
  const broken: Source = { name: 'MLH', fetch: () => Promise.reject(new Error('MLH: page data block not found')) };

  it('carries on with the sources that still work', async () => {
    const working: Source = { name: 'Devpost', fetch: () => Promise.resolve(listed) };
    const result = await runCycle(options({ sources: [broken, working] }));

    expect(result.outcome).toBe('posted');
    expect(lines.join('\n')).toContain('MLH: failed');
  });

  it('posts nothing and keeps its state untouched when every source fails', async () => {
    const result = await runCycle(options({ sources: [broken] }));

    expect(result.outcome).toBe('no-sources');
    expect(api.posts).toHaveLength(0);
    expect(api.requests).toHaveLength(0);
    expect(existsSync(join(dir, 'state.json'))).toBe(false);
  });

  it('does not mark anything posted when publishing fails', async () => {
    api.keyRevoked = true;
    await expect(runCycle(options())).rejects.toMatchObject({ status: 401 });
    expect(existsSync(join(dir, 'state.json'))).toBe(false);

    api.keyRevoked = false;
    expect(postedTitle(await runCycle(options()))).toBe('Dubai Hack');
  });
});
