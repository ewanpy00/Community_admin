# Hackathon scout

A bot that reads popular hackathon listing pages and posts the upcoming ones worth knowing about to a Cormonity community: one hackathon per post, one post every six hours while there is something to post. It signs in as a connected agent, with an agent key; it has no wallet and needs no browser.

## Setup

1. A community OWNER or ADMIN creates the agent (see Cormonity's `docs/claude_docs/backend/connected-agents.md`) and gets a key that starts with `cag_`. The key is shown once.
2. Copy `.env.example` to `.env` and fill in `API_BASE_URL`, `AGENT_KEY` and `COMMUNITY_ID`.
3. `npm install`
4. `npm run check-agent` confirms the key works and the agent is allowed to post to the community. It posts nothing.

## What the key can do

Cormonity lets an agent's token do two things: publish a post in the agent's own community, and read back the agent's own posts. Every other request is refused, so the bot cannot see members, other people's posts, messages or anything else, and it asks for none of that.

## Running

| Command | What it does |
|---|---|
| `npm run dry-run` | One pass that prints the next post and when it is due, instead of publishing it. Writes nothing. |
| `npm run once` | One pass, then exit. It posts only if the posting time has come. Use this from cron or a scheduled job. |
| `npm run post-now` | One pass that posts the next hackathon in the queue straight away, whatever the time. For testing. |
| `npm start` | Keeps running: a pass every `FETCH_INTERVAL_MINUTES` (default 180) and one at each posting time. |

## Hosting on GitHub Actions

`.github/workflows/scout.yml` runs `npm run once` at five past each posting time, and once more an hour later in case GitHub dropped the first run. It needs three repository secrets: `API_BASE_URL`, `AGENT_KEY` and `COMMUNITY_ID`. The state file is kept between runs as the single file of the `state` branch.

The cron times in the workflow are UTC and match the default `POST_TIMES` in Dubai; change both together. From the Actions tab, "Run workflow" starts a pass by hand: `once`, `dry-run` or `post-now`.

## What it posts

Each pass collects announcements from every source, then keeps a hackathon only if it has yet to start:

- its start date is known, at least `MIN_DAYS_AHEAD` days away (default 2) and no more than `MAX_DAYS_AHEAD` (default 120). One that is already under way, starts tomorrow, or gives no start date is dropped; so is one dated a year out, which is often a placeholder.

And it is either:

- held in the region (`REGION_KEYWORDS` / `REGION_COUNTRY_CODES`, the UAE by default), or
- online and popular: at least `MIN_POPULARITY` registrations (default 200), or listed by an organiser that vets or runs its own events (MLH, lablab.ai, ETHGlobal, HackerEarth's own hackathons).

In-person hackathons elsewhere are dropped. Set `INCLUDE_ONLINE=false` to post regional ones only.

## When it posts

One post goes out at each of `POST_TIMES` in `POST_TIMEZONE` (00:00, 06:00, 12:00 and 18:00 in Dubai by default), and each post is about one hackathon: its dates, place, prizes and the link to register. For one post a day, set a single time: `POST_TIMES=12:00`.

Every other hackathon worth posting waits in a queue, and at each posting time the one at the head goes out:

- a hackathon in the region goes first, ahead of anything already waiting;
- the rest go in the order the bot first saw them;
- those found in the same pass are ordered by popularity, then by how soon they start.

A hackathon that comes within `MIN_DAYS_AHEAD` of its start, or disappears from every source, while it waits is dropped. When the queue is empty the bot stays silent.

If no pass runs at a posting time, the post still goes out up to `POST_GRACE_HOURS` late (default 3). After that it waits for the next posting time. With `npm run once`, schedule the job at the posting times.

## Sources

`sources.json` lists them. These kinds are supported:

- `devpost`: the Devpost hackathon API, upcoming hackathons only. `queries` are extra query strings (`order_by=recently-added`, `order_by=prize-amount`, `search=dubai`); `pages` is how many pages of each to read.
- `mlh`: the Major League Hacking season page.
- `devfolio`: the Devfolio hackathons page, with participant counts.
- `lablab`: the lablab.ai events page (online AI hackathons), with participant counts.
- `ethglobal`: the ETHGlobal events page; its hackathons only, not its summits and meetups.
- `hackerearth`: the HackerEarth events feed; its hackathons only, not its coding contests.
- `luma`: Luma events, either near a point (`latitude` and `longitude` of a city's centre) or from one organiser's calendar (`calendar`, its `cal-...` id). An organiser can keep an event out of Luma's listings, and then only its calendar has it. Events are kept only if their title says hackathon.
- `jsonld`: any page that marks up its events as schema.org `Event` (Meetup, a single Luma event page and many others). Events are kept only if their title or description says hackathon; add `"hackathonsOnly": true` for a page that lists nothing else. `"assumeRegion": true` marks a page that is itself a regional listing.

To add a page, append a `jsonld` entry and check it with `npm run dry-run`. A page that builds its event list in the browser (Eventbrite, hackathon.com) carries no events in its HTML and will yield nothing.

A source that fails is skipped for that pass and reported in the log; the others carry on.

## State

`data/state.json` records what the bot has seen and posted, which is also what orders the queue. If the file is lost, the bot asks the platform for its own recent posts (it cannot read the feed itself) and does not repeat a link or post twice for the same day; the queue order starts over. Delete the file only if you want that fallback to take over.

## Development

`npm test` runs the suite against an in-memory stand-in for the Cormonity API (`tests/helpers/fake-cormonity.ts`); `npm run typecheck` checks types. The key and access tokens are redacted from every log line (`src/log.ts`).
