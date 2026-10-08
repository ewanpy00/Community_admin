import { composePost, linksIn } from './compose.js';
import type { NewPost, OwnPost, Post } from './cormonity-client/types.js';
import { describeError, type Logger } from './log.js';
import { describeInstant, isPostDue, nextSlot, type PostSchedule } from './schedule.js';
import { dedupe, isEligible, queueOrder, type SelectionPolicy } from './select.js';
import { urlKey } from './sources/text.js';
import type { Announcement, Source, SourceContext } from './sources/types.js';
import { isPosted, loadState, markPosted, markSeen, postedUrlKeys, prune, saveState } from './store.js';

/** The part of the Cormonity client a cycle needs. */
export interface Publisher {
  ownPosts(options?: { take?: number }): Promise<OwnPost[]>;
  createPost(communityId: string, post: NewPost): Promise<Post>;
}

export interface ScoutOptions {
  sources: Source[];
  context: SourceContext;
  publisher: Publisher;
  communityId: string;
  policy: SelectionPolicy;
  schedule: PostSchedule;
  /** Post the head of the queue straight away, whatever the schedule says. */
  postNow: boolean;
  statePath: string;
  /** Collect and choose, print the next post, but publish nothing and remember nothing. */
  dryRun: boolean;
  log: Logger;
  now?: () => number;
}

export type CycleOutcome = 'posted' | 'dry-run' | 'nothing-new' | 'not-due' | 'no-sources';

export interface CycleResult {
  outcome: CycleOutcome;
  collected: number;
  eligible: number;
  /** Announcements waiting to be posted, counted before this pass posted one. */
  queued: number;
  posted: Announcement | null;
}

const OWN_POSTS_TO_CHECK = 50;

async function collect(options: ScoutOptions): Promise<{ items: Announcement[]; succeeded: number }> {
  const items: Announcement[] = [];
  let succeeded = 0;
  for (const source of options.sources) {
    try {
      const found = await source.fetch(options.context);
      options.log.info(`  ${source.name}: ${found.length} announcement(s)`);
      items.push(...found);
      succeeded++;
    } catch (err) {
      // One site being down or changing its markup must not stop the others.
      options.log.warn(`  ${source.name}: failed — ${describeError(err)}`);
    }
  }
  return { items, succeeded };
}

/**
 * One pass: read every source, queue what is worth posting, and — if a post is
 * due — publish the hackathon at the head of the queue. The rest wait their
 * turn, one per scheduled time.
 */
export async function runCycle(options: ScoutOptions): Promise<CycleResult> {
  const now = (options.now ?? Date.now)();
  const { log } = options;

  log.info('Collecting announcements:');
  const { items, succeeded } = await collect(options);
  if (succeeded === 0) {
    log.warn('No source could be read — nothing is posted this time.');
    return { outcome: 'no-sources', collected: 0, eligible: 0, queued: 0, posted: null };
  }

  const eligible = dedupe(items).filter((item) => isEligible(item, options.policy, now));
  const state = await loadState(options.statePath);
  markSeen(state, eligible, now);
  prune(state, now);

  let postedUrls = postedUrlKeys(state);
  let fresh = eligible.filter((item) => !isPosted(state, item, postedUrls));
  const base = { collected: items.length, eligible: eligible.length };
  log.info(`${items.length} collected, ${eligible.length} worth posting, ${fresh.length} in the queue.`);

  const finish = async (outcome: CycleOutcome, posted: Announcement | null = null): Promise<CycleResult> => {
    if (!options.dryRun) await saveState(options.statePath, state);
    return { ...base, outcome, queued: fresh.length, posted };
  };

  if (fresh.length === 0) {
    log.info('Nothing new to post.');
    return finish('nothing-new');
  }

  // The platform is the source of truth: if the state file was lost, the bot's
  // own posts still say what was published and when. The agent can read only
  // those — never the feed, which holds other people's posts.
  const ownPosts = await options.publisher.ownPosts({ take: OWN_POSTS_TO_CHECK });
  for (const post of ownPosts) {
    for (const link of linksIn(post.body)) postedUrls.add(urlKey(link));
    const createdAt = Date.parse(post.createdAt);
    if (Number.isFinite(createdAt) && (!state.lastPostAt || createdAt > Date.parse(state.lastPostAt))) {
      state.lastPostAt = new Date(createdAt).toISOString();
    }
  }
  const alreadyInFeed = fresh.filter((item) => postedUrls.has(urlKey(item.url)));
  if (alreadyInFeed.length > 0) markPosted(state, alreadyInFeed, now);
  postedUrls = postedUrlKeys(state);
  fresh = fresh.filter((item) => !isPosted(state, item, postedUrls));

  if (fresh.length === 0) {
    log.info('Everything new is already in the community feed.');
    return finish('nothing-new');
  }

  const firstSeenAt = (item: Announcement): number => {
    const at = Date.parse(state.items[item.id]?.firstSeenAt ?? '');
    return Number.isFinite(at) ? at : now;
  };
  const [next] = queueOrder(fresh, options.policy, firstSeenAt);
  if (!next) return finish('nothing-new');
  const post = composePost(next);

  const due = options.postNow || isPostDue(now, state.lastPostAt, options.schedule);
  const dueText = due ? 'now' : describeInstant(nextSlot(now, options.schedule), options.schedule.timeZone);

  if (options.dryRun) {
    log.info(`Dry run — next in the queue (1 of ${fresh.length}), due ${dueText}:\n`);
    log.info(post.body);
    return finish('dry-run', next);
  }

  if (!due) {
    log.info(`Next post is due ${dueText} — ${fresh.length} in the queue.`);
    return finish('not-due');
  }

  const created = await options.publisher.createPost(options.communityId, post);
  markPosted(state, [next], now);
  state.lastPostAt = new Date(now).toISOString();
  log.info(`Posted "${next.title}" — post ${created.id}. ${fresh.length - 1} left in the queue.`);
  return finish('posted', next);
}
