import { describe, expect, it } from 'vitest';
import { parseDevfolio } from '../src/sources/devfolio.js';
import { createDevpostSource, parseDevpost, parseDevpostDates } from '../src/sources/devpost.js';
import { parseEthGlobal } from '../src/sources/ethglobal.js';
import { parseHackerEarth } from '../src/sources/hackerearth.js';
import { buildSources } from '../src/sources/index.js';
import { parseJsonLdEvents } from '../src/sources/jsonld.js';
import { parseLablab } from '../src/sources/lablab.js';
import { createLumaSource, parseLuma } from '../src/sources/luma.js';
import { mlhSeasonUrl, parseMlh } from '../src/sources/mlh.js';
import { looksLikeHackathon, normalizeUrl, urlKey } from '../src/sources/text.js';

const devpostPage = JSON.stringify({
  hackathons: [
    {
      id: 101,
      title: 'Build &amp; Ship AI',
      url: 'https://build-ship.devpost.com/?ref_feature=challenge&utm_source=x',
      displayed_location: { icon: 'globe', location: 'Online' },
      submission_period_dates: 'Oct 01 - Nov 12, 2026',
      prize_amount: '$<span data-currency-value>67,500</span>',
      registrations_count: 8504,
      organization_name: 'PayPal',
      themes: [{ id: 1, name: 'Machine Learning/AI' }, { id: 2, name: 'Web' }],
      invite_only: false,
    },
    {
      id: 102,
      title: 'Dubai FinTech Hack',
      url: 'https://dubai-fintech.devpost.com/',
      displayed_location: { icon: 'map-marker-alt', location: 'DIFC Innovation Hub, Dubai' },
      submission_period_dates: 'Nov 20 - 22, 2026',
      prize_amount: '$<span data-currency-value>0</span>',
      registrations_count: 40,
      organization_name: null,
      themes: [],
      invite_only: false,
    },
    { id: 103, title: 'Members only', url: 'https://private.devpost.com/', invite_only: true },
    { id: 104, title: '', url: 'https://untitled.devpost.com/' },
  ],
  meta: { total_count: 4, per_page: 9 },
});

describe('Devpost source', () => {
  it('reads title, link, place, popularity and prize from the API', () => {
    const [online, local] = parseDevpost(devpostPage, 'Devpost');

    expect(online).toMatchObject({
      id: 'devpost:101',
      title: 'Build & Ship AI',
      url: 'https://build-ship.devpost.com/',
      online: true,
      location: null,
      popularity: 8504,
      prize: '$67,500',
      organizer: 'PayPal',
      dateText: 'Oct 01 - Nov 12, 2026',
      startsAt: '2026-10-01T00:00:00.000Z',
      endsAt: '2026-11-12T23:59:59.000Z',
      themes: ['Machine Learning/AI', 'Web'],
    });
    expect(local).toMatchObject({
      id: 'devpost:102',
      online: false,
      location: 'DIFC Innovation Hub, Dubai',
      prize: null,
      popularity: 40,
    });
  });

  it('skips invite-only and incomplete entries', () => {
    expect(parseDevpost(devpostPage, 'Devpost').map((item) => item.id)).toEqual(['devpost:101', 'devpost:102']);
  });

  it('fails loudly when the response is not the expected shape', () => {
    expect(() => parseDevpost('{"error":"nope"}', 'Devpost')).toThrow(/no "hackathons" list/);
  });

  it('reads the dates Devpost gives in words', () => {
    expect(parseDevpostDates('Nov 13, 2026')).toEqual({
      startsAt: '2026-11-13T00:00:00.000Z',
      endsAt: '2026-11-13T23:59:59.000Z',
    });
    expect(parseDevpostDates('Oct 17 - 18, 2026')).toEqual({
      startsAt: '2026-10-17T00:00:00.000Z',
      endsAt: '2026-10-18T23:59:59.000Z',
    });
    expect(parseDevpostDates('Dec 15, 2026 - Jan 20, 2027')).toEqual({
      startsAt: '2026-12-15T00:00:00.000Z',
      endsAt: '2027-01-20T23:59:59.000Z',
    });
    expect(parseDevpostDates('Dates to be announced')).toBeNull();
    expect(parseDevpostDates('Foo 13, 2026')).toBeNull();
  });

  it('asks for hackathons yet to start and merges the listings without duplicates', async () => {
    const requested: string[] = [];
    const source = createDevpostSource({ type: 'devpost', queries: ['order_by=recently-added', 'search=dubai'] });
    const items = await source.fetch({
      now: () => 0,
      fetchText: (url) => {
        requested.push(url);
        return Promise.resolve(devpostPage);
      },
    });

    expect(requested).toEqual([
      'https://devpost.com/api/hackathons?status[]=upcoming&order_by=recently-added&page=1',
      'https://devpost.com/api/hackathons?status[]=upcoming&search=dubai&page=1',
    ]);
    expect(items).toHaveLength(2);
  });
});

const mlhPage = `<!doctype html><html><body><div id="app"></div>
<script data-page="app" type="application/json">${JSON.stringify({
  component: 'SeasonEvents/Index',
  props: {
    upcomingEvents: [
      {
        id: 'ev-1',
        name: 'HackNC',
        startsAt: '2026-10-09T13:00:00Z',
        endsAt: '2026-10-11T20:00:00Z',
        url: '/events/hacknc/prizes',
        websiteUrl: 'https://hacknc.com/',
        location: 'Chapel Hill, North Carolina',
        formatType: 'physical',
        venueAddress: { city: 'Chapel Hill', state: 'North Carolina', country: 'US' },
      },
      {
        id: 'ev-2',
        name: 'Global Hack Week: AI',
        startsAt: '2026-11-06T00:00:00Z',
        endsAt: '2026-11-12T23:59:00Z',
        url: '/events/ghw-ai',
        websiteUrl: null,
        location: 'Everywhere, Worldwide',
        formatType: 'digital',
        venueAddress: { city: 'Everywhere', state: null, country: null },
      },
      {
        id: 'ev-3',
        name: 'HackAbuDhabi',
        startsAt: '2026-12-04T05:00:00Z',
        endsAt: '2026-12-06T14:00:00Z',
        url: '/events/hackabudhabi',
        websiteUrl: 'https://hackabudhabi.example/',
        location: 'Abu Dhabi',
        formatType: 'physical',
        venueAddress: { city: 'Abu Dhabi', state: null, country: 'ae' },
      },
    ],
    pastEvents: [{ id: 'old', name: 'Old Hack', websiteUrl: 'https://old.example/' }],
  },
})}</script></body></html>`;

describe('MLH source', () => {
  it('reads the upcoming events embedded in the page', () => {
    const items = parseMlh(mlhPage, 'MLH');

    expect(items.map((item) => item.title)).toEqual(['HackNC', 'Global Hack Week: AI', 'HackAbuDhabi']);
    expect(items[0]).toMatchObject({
      id: 'mlh:ev-1',
      url: 'https://hacknc.com/',
      startsAt: '2026-10-09T13:00:00.000Z',
      endsAt: '2026-10-11T20:00:00.000Z',
      location: 'Chapel Hill, North Carolina',
      country: 'US',
      online: false,
      curated: true,
    });
    expect(items[1]).toMatchObject({ online: true, location: null, url: 'https://www.mlh.com/events/ghw-ai' });
    expect(items[2]).toMatchObject({ country: 'AE' });
  });

  it('fails loudly when the page no longer carries its data block', () => {
    expect(() => parseMlh('<html><body>redesigned</body></html>', 'MLH')).toThrow(/page data block not found/);
  });

  it('follows the academic-year season', () => {
    expect(mlhSeasonUrl(Date.parse('2026-10-07T00:00:00Z'))).toBe('https://www.mlh.com/seasons/2027/events');
    expect(mlhSeasonUrl(Date.parse('2027-03-01T00:00:00Z'))).toBe('https://www.mlh.com/seasons/2027/events');
  });
});

const eventsPage = `<html><head>
<script type="application/ld+json">{ this block is broken </script>
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  itemListElement: [
    {
      '@type': 'ListItem',
      item: {
        '@type': 'Event',
        name: 'GITEX AI Hackathon &amp; Demo Day',
        url: '/gitex-ai-hackathon?utm_source=list',
        startDate: '2026-10-14T09:00:00+04:00',
        endDate: '2026-10-15T18:00:00+04:00',
        eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        location: {
          '@type': 'Place',
          name: 'Dubai World Trade Centre',
          address: { '@type': 'PostalAddress', addressLocality: 'Dubai', addressCountry: 'AE' },
        },
        organizer: { '@type': 'Organization', name: 'GITEX' },
      },
    },
    {
      '@type': 'ListItem',
      item: {
        '@type': 'SocialEvent',
        name: 'Sunrise Yoga',
        url: 'https://events.example/yoga',
        startDate: '2026-10-10T06:00:00+04:00',
        location: { '@type': 'Place', name: 'Kite Beach' },
      },
    },
    {
      '@type': 'ListItem',
      item: {
        '@type': 'Event',
        name: 'Founders Night',
        description: 'A 24-hour buildathon for first-time founders.',
        url: 'https://events.example/founders-night',
        startDate: '2026-10-20T18:00:00+04:00',
        eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
        location: { '@type': 'VirtualLocation', url: 'https://events.example/live' },
      },
    },
  ],
})}</script></head><body></body></html>`;

describe('schema.org Event source', () => {
  const config = { type: 'jsonld' as const, name: 'Luma Dubai', url: 'https://events.example/dubai', assumeRegion: true };

  it('keeps hackathons only, survives a broken block, and resolves relative links', () => {
    const items = parseJsonLdEvents(eventsPage, config);

    expect(items.map((item) => item.title)).toEqual(['GITEX AI Hackathon & Demo Day', 'Founders Night']);
    expect(items[0]).toMatchObject({
      id: 'luma-dubai:events.example/gitex-ai-hackathon',
      url: 'https://events.example/gitex-ai-hackathon',
      startsAt: '2026-10-14T05:00:00.000Z',
      location: 'Dubai World Trade Centre, Dubai',
      country: 'AE',
      organizer: 'GITEX',
      online: false,
      assumeRegion: true,
    });
  });

  it('treats an online event as online, not as local to the listing', () => {
    const online = parseJsonLdEvents(eventsPage, config)[1];
    expect(online).toMatchObject({ online: true, location: null, assumeRegion: false });
  });

  it('keeps every event of a hackathons-only listing', () => {
    const items = parseJsonLdEvents(eventsPage, { ...config, hackathonsOnly: true });
    expect(items).toHaveLength(3);
  });
});

const devfolioPage = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
  props: {
    pageProps: {
      dehydratedState: {
        queries: [
          {
            state: {
              data: {
                open_hackathons: [
                  {
                    slug: 'wild-bugs',
                    name: 'Wild Bugs',
                    type: 'HACKATHON',
                    starts_at: '2026-10-13T18:30:00+00:00',
                    ends_at: '2026-10-15T18:29:00+00:00',
                    is_online: true,
                    participants_count: 666,
                  },
                  { slug: 'bad slug!', name: 'Broken', type: 'HACKATHON' },
                ],
                upcoming_hackathons: [
                  {
                    slug: 'Q-Hack',
                    name: 'Q-HACK 2026',
                    type: 'HACKATHON',
                    starts_at: '2026-10-30T03:30:00+00:00',
                    ends_at: '2026-10-31T14:30:00+00:00',
                    is_online: false,
                    participants_count: 902,
                  },
                  { slug: 'wild-bugs', name: 'Wild Bugs', type: 'HACKATHON', is_online: true },
                ],
                past_hackathons: [{ slug: 'old', name: 'Old Hack', type: 'HACKATHON' }],
              },
            },
          },
        ],
      },
    },
  },
})}</script></body></html>`;

describe('Devfolio source', () => {
  it('reads the open and upcoming hackathons embedded in the page, once each', () => {
    const items = parseDevfolio(devfolioPage, 'Devfolio');

    expect(items.map((item) => item.id)).toEqual(['devfolio:wild-bugs', 'devfolio:Q-Hack']);
    expect(items[1]).toMatchObject({
      title: 'Q-HACK 2026',
      url: 'https://q-hack.devfolio.co/',
      startsAt: '2026-10-30T03:30:00.000Z',
      endsAt: '2026-10-31T14:30:00.000Z',
      online: false,
      popularity: 902,
      curated: false,
    });
  });

  it('fails loudly when the page no longer carries its lists', () => {
    expect(() => parseDevfolio('<html><body>redesigned</body></html>', 'Devfolio')).toThrow(/no hackathon lists/);
  });
});

/** A page that streams its data the way the Next.js app router does. */
const streamedPage = (data: unknown): string =>
  `<html><body><script>self.__next_f.push([1,${JSON.stringify(`6:["$","$L27",null,${JSON.stringify(data)}]\n`)}])</script></body></html>`;

const lablabPage = streamedPage({
  sortedEvents: [
    {
      name: 'Vultr: Agent Rush Hackathon',
      slug: 'vultr-hackathon',
      type: 'HACKATHON',
      active: true,
      signupActive: true,
      toBeAnnounced: false,
      description: 'Build "agents" [fast] {really}',
      startAt: '2026-11-03T15:00:00.000Z',
      endAt: '2026-11-08T22:00:00.000Z',
      _count: { participants: 638 },
    },
    { name: 'Sign-up closed', slug: 'closed', type: 'HACKATHON', active: true, signupActive: false },
    { name: 'No dates yet', slug: 'tba', type: 'HACKATHON', active: true, signupActive: true, toBeAnnounced: true },
    { name: 'A workshop', slug: 'workshop', type: 'WORKSHOP', active: true, signupActive: true },
  ],
});

describe('lablab.ai source', () => {
  it('reads the hackathons open for sign-up from the streamed page data', () => {
    const items = parseLablab(lablabPage, 'lablab.ai');

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'lablab:vultr-hackathon',
      title: 'Vultr: Agent Rush Hackathon',
      url: 'https://lablab.ai/event/vultr-hackathon',
      startsAt: '2026-11-03T15:00:00.000Z',
      online: true,
      popularity: 638,
      curated: true,
    });
  });

  it('fails loudly when the page no longer carries its list', () => {
    expect(() => parseLablab('<html><body>redesigned</body></html>', 'lablab.ai')).toThrow(/no "sortedEvents" list/);
  });
});

const ethGlobalPage = streamedPage({
  events: [
    {
      name: 'ETHGlobal Mumbai',
      slug: 'mumbai',
      type: 'hackathon',
      medium: 'physical',
      startTime: '2026-11-05T00:00:00.000Z',
      endTime: '2026-11-07T00:00:00.000Z',
      city: { name: 'Mumbai', country: { name: 'India' }, countryCode: 'IN' },
    },
    {
      name: 'ETHOnline 2026',
      slug: 'ethonline2026',
      type: 'hackathon',
      medium: 'virtual',
      startTime: '2026-11-13T16:00:00.000Z',
      endTime: '2026-11-25T16:00:00.000Z',
      city: null,
    },
    { name: 'Pragma Mumbai', slug: 'pragma-mumbai', type: 'summit', medium: 'physical' },
  ],
});

describe('ETHGlobal source', () => {
  it('reads its hackathons, in person and online, and leaves out summits', () => {
    const [inPerson, online] = parseEthGlobal(ethGlobalPage, 'ETHGlobal');

    expect(inPerson).toMatchObject({
      id: 'ethglobal:mumbai',
      url: 'https://ethglobal.com/events/mumbai',
      location: 'Mumbai, India',
      country: 'IN',
      online: false,
      curated: true,
    });
    expect(online).toMatchObject({ id: 'ethglobal:ethonline2026', online: true, location: null, country: null });
    expect(parseEthGlobal(ethGlobalPage, 'ETHGlobal')).toHaveLength(2);
  });
});

const hackerEarthFeed = JSON.stringify({
  response: [
    {
      title: 'GoDaddy Inclusive Innovation Hackathon 2026',
      url: 'https://www.hackerearth.com/challenges/hackathon/godaddy-inclusive-innovation/',
      status: 'UPCOMING',
      start_utc_tz: '2026-10-31 07:30:00+00:00',
      end_utc_tz: '2026-11-30 18:29:00+00:00',
      is_hackerearth: true,
    },
    {
      title: 'October Circuits',
      url: 'https://www.hackerearth.com/challenges/competitive/october-circuits/',
      status: 'UPCOMING',
      start_utc_tz: '2026-10-20 15:30:00+00:00',
      is_hackerearth: true,
    },
    {
      title: 'Campus Hackathon',
      url: 'https://www.hackerearth.com/challenges/hackathon/campus-hackathon/',
      start_utc_tz: '2026-11-02 04:30:00+00:00',
      is_hackerearth: false,
    },
  ],
});

describe('HackerEarth source', () => {
  it('reads the hackathons of the feed and leaves out coding contests', () => {
    const items = parseHackerEarth(hackerEarthFeed, 'HackerEarth');

    expect(items.map((item) => item.title)).toEqual(['GoDaddy Inclusive Innovation Hackathon 2026', 'Campus Hackathon']);
    expect(items[0]).toMatchObject({
      id: 'hackerearth:/challenges/hackathon/godaddy-inclusive-innovation',
      startsAt: '2026-10-31T07:30:00.000Z',
      endsAt: '2026-11-30T18:29:00.000Z',
      online: true,
      curated: true,
    });
  });

  it('vouches only for the hackathons HackerEarth runs itself', () => {
    expect(parseHackerEarth(hackerEarthFeed, 'HackerEarth')[1]).toMatchObject({ curated: false });
  });
});

const lumaEntry = (event: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  event: { visibility: 'public', location_type: 'offline', start_at: '2026-10-31T04:00:00.000Z', ...event },
  hosts: [{ name: 'Founding MENA' }],
  guest_count: 0,
  ...extra,
});
const lumaPage = (entries: unknown[], next: string | null = null): string =>
  JSON.stringify({ entries, has_more: next !== null, next_cursor: next });

describe('Luma source', () => {
  const config = { type: 'luma' as const, name: 'Luma Dubai', latitude: 25.2, longitude: 55.27, assumeRegion: true };

  it('keeps the public hackathons of a listing, with place, host and guest count', () => {
    const { items } = parseLuma(
      lumaPage([
        lumaEntry(
          {
            api_id: 'evt-1',
            name: 'Dubai AI Hackathon',
            url: 'dubai-ai',
            end_at: '2026-10-31T16:00:00.000Z',
            geo_address_info: { address: 'DIFC Innovation Hub', city: 'Dubai', city_state: 'Dubai, United Arab Emirates', country_code: 'ae' },
          },
          { guest_count: 240 },
        ),
        lumaEntry({ api_id: 'evt-2', name: 'Founders Breakfast', url: 'breakfast' }),
        lumaEntry({ api_id: 'evt-3', name: 'Invite-only Hackathon', url: 'private', visibility: 'private' }),
      ]),
      config,
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'luma:evt-1',
      title: 'Dubai AI Hackathon',
      url: 'https://luma.com/dubai-ai',
      startsAt: '2026-10-31T04:00:00.000Z',
      endsAt: '2026-10-31T16:00:00.000Z',
      location: 'DIFC Innovation Hub, Dubai, United Arab Emirates',
      country: 'AE',
      online: false,
      organizer: 'Founding MENA',
      popularity: 240,
      assumeRegion: true,
    });
  });

  it('takes an in-person event with a hidden address as held in the region, and a hidden guest list as unknown', () => {
    const { items } = parseLuma(
      lumaPage([lumaEntry({ api_id: 'evt-4', name: 'Founding MENA x Replit: Dubai Hackathon', url: 'wzjsa324', geo_address_info: null })]),
      config,
    );
    expect(items[0]).toMatchObject({ online: false, location: null, popularity: null, assumeRegion: true });
  });

  it('never calls an online event local', () => {
    const { items } = parseLuma(
      lumaPage([lumaEntry({ api_id: 'evt-5', name: 'Global Online Hackathon', url: 'global', location_type: 'zoom', geo_address_info: null })]),
      config,
    );
    expect(items[0]).toMatchObject({ online: true, assumeRegion: false });
  });

  it('reads a listing near a point page by page, and an organiser calendar by its id', async () => {
    const requested: string[] = [];
    const context = {
      now: () => 0,
      fetchText: (url: string) => {
        requested.push(url);
        const first = !url.includes('pagination_cursor');
        return Promise.resolve(
          lumaPage([lumaEntry({ api_id: first ? 'evt-a' : 'evt-b', name: 'Hackathon', url: first ? 'a' : 'b' })], first ? 'c2' : null),
        );
      },
    };

    const nearby = await createLumaSource(config).fetch(context);
    await createLumaSource({ type: 'luma', name: 'Organiser', calendar: 'cal-abc123' }).fetch(context);

    expect(nearby.map((item) => item.id)).toEqual(['luma:evt-a', 'luma:evt-b']);
    expect(requested).toEqual([
      'https://api.lu.ma/discover/get-paginated-events?latitude=25.2&longitude=55.27&pagination_limit=50',
      'https://api.lu.ma/discover/get-paginated-events?latitude=25.2&longitude=55.27&pagination_limit=50&pagination_cursor=c2',
      'https://api.lu.ma/calendar/get-items?calendar_api_id=cal-abc123&period=future&pagination_limit=50',
      'https://api.lu.ma/calendar/get-items?calendar_api_id=cal-abc123&period=future&pagination_limit=50&pagination_cursor=c2',
    ]);
  });

  it('fails loudly when the response is not the expected shape', () => {
    expect(() => parseLuma('{"error":"nope"}', config)).toThrow(/no "entries" list/);
  });
});

describe('text helpers', () => {
  it('recognises hackathon wording but not every "hack"', () => {
    expect(looksLikeHackathon('Abu Dhabi Climate Hackathon')).toBe(true);
    expect(looksLikeHackathon('Winter Game Jam')).toBe(true);
    expect(looksLikeHackathon('Hack The Box Dubai | Cybersecurity Community Meetup')).toBe(false);
    expect(looksLikeHackathon('Growth hacks for founders', null)).toBe(false);
  });

  it('counts loose wording only in the title, explicit wording in the description too', () => {
    const meetup = 'Hack The Box Dubai Cyberverse 2026 | Cybersecurity Community Meetup';
    expect(looksLikeHackathon(meetup, 'Networking • Hands-on CTF / cybersecurity challenges')).toBe(false);
    expect(looksLikeHackathon('Dubai University CTF 2026', 'Teams of four.')).toBe(true);
    expect(looksLikeHackathon('Founders Night', 'A 24-hour buildathon for first-time founders.')).toBe(true);
  });

  it('normalises links for comparison', () => {
    expect(normalizeUrl('https://x.devpost.com/?utm_source=a&ref=b#top')).toBe('https://x.devpost.com/');
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(urlKey('https://www.Example.com/Hack/')).toBe(urlKey('http://example.com/hack'));
  });
});

describe('sources file', () => {
  it('builds the configured sources', () => {
    const sources = buildSources([
      { type: 'devpost' },
      { type: 'mlh' },
      { type: 'jsonld', name: 'Luma Dubai', url: 'https://lu.ma/dubai' },
      { type: 'devfolio' },
      { type: 'lablab' },
      { type: 'ethglobal' },
      { type: 'hackerearth' },
    ]);
    expect(sources.map((source) => source.name)).toEqual([
      'Devpost',
      'MLH',
      'Luma Dubai',
      'Devfolio',
      'lablab.ai',
      'ETHGlobal',
      'HackerEarth',
    ]);
  });

  it('rejects an unknown type, a missing url and an empty list', () => {
    expect(() => buildSources([{ type: 'rss', url: 'https://x.example' }])).toThrow(/unknown type "rss"/);
    expect(() => buildSources([{ type: 'jsonld', name: 'No url' }])).toThrow(/needs a "name" and an http\(s\) "url"/);
    expect(() => buildSources([{ type: 'luma', name: 'No place' }])).toThrow(/either "latitude" and "longitude" or a "calendar" id/);
    expect(() => buildSources([])).toThrow(/non-empty JSON array/);
  });
});
