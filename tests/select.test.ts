import { describe, expect, it } from 'vitest';
import { composePost, linksIn } from '../src/compose.js';
import { dedupe, isEligible, isLocal, queueOrder, rank, type SelectionPolicy } from '../src/select.js';
import { announcement } from './helpers/announcement.js';

const DAY = 24 * 3_600_000;
const policy: SelectionPolicy = {
  regionKeywords: ['united arab emirates', 'uae', 'dubai', 'abu dhabi'],
  regionCountryCodes: ['AE'],
  includeOnline: true,
  minPopularity: 200,
  minLeadMs: 2 * DAY,
  maxAheadMs: 120 * DAY,
};
const now = Date.parse('2026-10-07T08:00:00Z');

describe('what counts as local', () => {
  it('matches a place name as whole words, in any case', () => {
    expect(isLocal(announcement({ location: 'DIFC Innovation Hub, Dubai' }), policy)).toBe(true);
    expect(isLocal(announcement({ location: 'Hub71, ABU DHABI' }), policy)).toBe(true);
    expect(isLocal(announcement({ location: 'Museum of the Future, UAE' }), policy)).toBe(true);
  });

  it('does not match a keyword buried inside another word', () => {
    expect(isLocal(announcement({ location: 'Quaestor Hall, Lisbon' }), policy)).toBe(false);
    expect(isLocal(announcement({ location: 'Dubailand Road, Texas' }), policy)).toBe(false);
  });

  it('accepts a country code or a regional listing instead of a name', () => {
    expect(isLocal(announcement({ location: 'Yas Island', country: 'AE' }), policy)).toBe(true);
    expect(isLocal(announcement({ location: 'Some venue', assumeRegion: true }), policy)).toBe(true);
  });

  it('never calls an online hackathon local', () => {
    expect(isLocal(announcement({ online: true, assumeRegion: true }), policy)).toBe(false);
  });
});

describe('what is worth posting', () => {
  it('takes every local hackathon, however small', () => {
    expect(isEligible(announcement({ location: 'Dubai', popularity: 3 }), policy, now)).toBe(true);
  });

  it('takes an online hackathon only when it is popular enough', () => {
    expect(isEligible(announcement({ online: true, popularity: 200 }), policy, now)).toBe(true);
    expect(isEligible(announcement({ online: true, popularity: 199 }), policy, now)).toBe(false);
  });

  it('takes an online hackathon without a count only from a curated source', () => {
    expect(isEligible(announcement({ online: true, curated: true }), policy, now)).toBe(true);
    expect(isEligible(announcement({ online: true }), policy, now)).toBe(false);
  });

  it('leaves out in-person hackathons elsewhere, even popular ones', () => {
    expect(isEligible(announcement({ location: 'Fort Worth', popularity: 90_000 }), policy, now)).toBe(false);
  });

  it('leaves out online hackathons when they are switched off', () => {
    const localOnly = { ...policy, includeOnline: false };
    expect(isEligible(announcement({ online: true, popularity: 5000 }), localOnly, now)).toBe(false);
  });

  it('leaves out what has ended or is already under way', () => {
    const ended = announcement({ location: 'Dubai', startsAt: '2026-10-01T05:00:00Z', endsAt: '2026-10-02T14:00:00Z' });
    const running = announcement({ location: 'Dubai', startsAt: '2026-10-06T05:00:00Z', endsAt: '2026-10-28T14:00:00Z' });
    expect(isEligible(ended, policy, now)).toBe(false);
    expect(isEligible(running, policy, now)).toBe(false);
  });

  it('wants the start at least two days ahead, and no more than 120', () => {
    const startingIn = (days: number) =>
      announcement({ location: 'Dubai', startsAt: new Date(now + days * DAY).toISOString(), endsAt: null });
    expect(isEligible(startingIn(1.9), policy, now)).toBe(false);
    expect(isEligible(startingIn(2), policy, now)).toBe(true);
    expect(isEligible(startingIn(120), policy, now)).toBe(true);
    expect(isEligible(startingIn(121), policy, now)).toBe(false);
  });

  it('leaves out a hackathon whose start date the source does not give', () => {
    const undated = announcement({ online: true, popularity: 9000, startsAt: null, endsAt: null });
    expect(isEligible(undated, policy, now)).toBe(false);
  });
});

describe('order and duplicates', () => {
  it('puts local first, then the most popular, then the soonest', () => {
    const popular = announcement({ title: 'Popular online', online: true, popularity: 9000 });
    const smaller = announcement({ title: 'Smaller online', online: true, popularity: 400 });
    const later = announcement({ title: 'Local later', location: 'Dubai', startsAt: '2026-12-01T05:00:00Z' });
    const sooner = announcement({ title: 'Local sooner', location: 'Dubai', startsAt: '2026-10-20T05:00:00Z' });

    expect(rank([smaller, later, popular, sooner], policy).map((item) => item.title)).toEqual([
      'Local sooner',
      'Local later',
      'Popular online',
      'Smaller online',
    ]);
  });

  it('drops the same hackathon listed by two sources', () => {
    const first = announcement({ title: 'Dubai AI Hack', url: 'https://www.dubai-ai.example/hack/' });
    const samePage = announcement({ title: 'Dubai AI Hack 2026', url: 'http://dubai-ai.example/hack' });
    const sameTitle = announcement({ title: 'Dubai AI Hack!', url: 'https://lu.ma/dubai-ai' });
    const other = announcement({ title: 'Sharjah Game Jam' });

    expect(dedupe([first, samePage, sameTitle, other])).toEqual([first, other]);
  });
});

describe('the posting queue', () => {
  it('keeps first-seen order, breaks ties by rank, and lets the region go first', () => {
    const early = announcement({ title: 'Early online', online: true, popularity: 300 });
    const lateBig = announcement({ title: 'Late and big', online: true, popularity: 90_000 });
    const lateSmall = announcement({ title: 'Late and small', online: true, popularity: 400 });
    const lateLocal = announcement({ title: 'Late in Dubai', location: 'Dubai' });
    const seen = new Map([
      [early.id, 1],
      [lateBig.id, 2],
      [lateSmall.id, 2],
      [lateLocal.id, 3],
    ]);

    const queue = queueOrder([lateSmall, lateLocal, lateBig, early], policy, (item) => seen.get(item.id) ?? 0);

    expect(queue.map((item) => item.title)).toEqual(['Late in Dubai', 'Early online', 'Late and big', 'Late and small']);
  });
});

describe('the post', () => {
  it('is about one hackathon: what, when, where, and where to register', () => {
    const post = composePost(
      announcement({
        title: 'PayPal AI Hackathon',
        url: 'https://paypal.devpost.com/',
        online: true,
        // Devpost gives whole days in words; the post repeats them as given.
        startsAt: '2026-10-20T00:00:00.000Z',
        endsAt: '2026-11-12T23:59:59.000Z',
        dateText: 'Oct 20 - Nov 12, 2026',
        prize: '$67,500',
        popularity: 8504,
        organizer: 'PayPal',
      }),
    );

    expect(post.body).toBe(
      [
        'PayPal AI Hackathon',
        '',
        'When: Oct 20 - Nov 12, 2026',
        'Where: Online',
        'Prizes: $67,500',
        'Organiser: PayPal',
        'Registered so far: 8,504',
        '',
        'Register: https://paypal.devpost.com/',
        '',
        'Found on Devpost.',
      ].join('\n'),
    );
    expect(post.linkUrl).toBe('https://paypal.devpost.com/');
    expect(linksIn(post.body)).toEqual(['https://paypal.devpost.com/']);
  });

  it('formats real dates in Dubai time and names the venue', () => {
    const post = composePost(
      announcement({
        title: 'GITEX AI Hackathon',
        url: 'https://gitex.example/hack',
        startsAt: '2026-10-14T05:00:00Z',
        endsAt: '2026-10-15T14:00:00Z',
        location: 'Dubai World Trade Centre',
        organizer: 'GITEX',
        source: 'Luma Dubai',
      }),
    );

    expect(post.body).toBe(
      [
        'GITEX AI Hackathon',
        '',
        'When: 14 Oct 2026 – 15 Oct 2026',
        'Where: Dubai World Trade Centre',
        'Organiser: GITEX',
        '',
        'Register: https://gitex.example/hack',
        '',
        'Found on Luma Dubai.',
      ].join('\n'),
    );
  });

  it('leaves out what the source did not say', () => {
    const post = composePost(announcement({ title: 'Bare Hack', url: 'https://bare.example/', startsAt: null, endsAt: null }));

    expect(post.body).toBe(['Bare Hack', '', 'Register: https://bare.example/', '', 'Found on Devpost.'].join('\n'));
  });

  it('shortens an overlong title rather than the registration link', () => {
    const post = composePost(announcement({ title: 'x'.repeat(6000), url: 'https://long.example/register', online: true }));

    expect(post.body.length).toBeLessThanOrEqual(5000);
    expect(post.body).toContain('…');
    expect(linksIn(post.body)).toEqual(['https://long.example/register']);
  });
});
