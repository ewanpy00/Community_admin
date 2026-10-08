/**
 * Hackathon scout: collects hackathon announcements from the listing pages in
 * sources.json and posts them to a Cormonity community as a connected agent —
 * one hackathon per post, one post at each of POST_TIMES; the rest wait in a queue.
 *
 *   npm start          keep running: collect every FETCH_INTERVAL_MINUTES, post at POST_TIMES
 *   npm run once       one pass, then exit (for cron or a scheduled job)
 *   npm run dry-run    one pass that prints the next post instead of publishing it
 *   npm run post-now   one pass that posts the next hackathon straight away
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig, obsoleteSettings } from './config.js';
import { CormonityClient } from './cormonity-client/client.js';
import { describeError, log } from './log.js';
import { nextSlot } from './schedule.js';
import { runCycle } from './scout.js';
import { createSourceContext, loadSources } from './sources/index.js';

const DAY_MS = 24 * 60 * 60 * 1000;

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const once = args.has('--once');
  const dryRun = args.has('--dry-run');
  const postNow = args.has('--now');

  try {
    process.loadEnvFile('.env');
  } catch {
    // no .env file — rely on the real environment
  }
  const config = loadConfig();
  for (const name of obsoleteSettings()) {
    log.warn(`${name} is set but no longer used — the bot posts one hackathon at each of POST_TIMES.`);
  }
  const sources = await loadSources(config.sourcesFile);
  const client = new CormonityClient({ baseUrl: config.apiBaseUrl, agentKey: config.agentKey });

  const cycle = () =>
    runCycle({
      sources,
      context: createSourceContext(),
      publisher: client,
      communityId: config.communityId,
      policy: {
        regionKeywords: config.regionKeywords,
        regionCountryCodes: config.regionCountryCodes,
        includeOnline: config.includeOnline,
        minPopularity: config.minPopularity,
        minLeadMs: config.minDaysAhead * DAY_MS,
        maxAheadMs: config.maxDaysAhead * DAY_MS,
      },
      schedule: config.postSchedule,
      postNow,
      statePath: config.stateFile,
      dryRun,
      log,
    });

  if (once) {
    await cycle();
    return;
  }

  const stop = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      log.info(`${signal} received — stopping.`);
      stop.abort();
    });
  }

  const { times, timeZone } = config.postSchedule;
  const postTimes = times
    .map(({ hour, minute }) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)
    .join(', ');
  log.info(
    `Hackathon scout started: ${sources.length} source(s), a pass every ${config.fetchIntervalMinutes} min, one post at ${postTimes} ${timeZone}.`,
  );
  while (!stop.signal.aborted) {
    try {
      await cycle();
    } catch (err) {
      // A failed pass is retried at the next interval rather than ending the bot.
      log.error(`Pass failed — ${describeError(err)}`);
    }
    // Wake for the next collection or for the posting time, whichever is first.
    const untilPost = nextSlot(Date.now(), config.postSchedule) - Date.now() + 1_000;
    try {
      await sleep(Math.min(config.fetchIntervalMinutes * 60_000, untilPost), undefined, { signal: stop.signal });
    } catch {
      break; // aborted while waiting
    }
  }
}

main().catch((err: unknown) => {
  log.error(`Fatal: ${describeError(err)}`);
  process.exitCode = 1;
});
