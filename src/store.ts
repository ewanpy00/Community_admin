import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { urlKey } from './sources/text.js';
import type { Announcement } from './sources/types.js';

export interface StoredItem {
  title: string;
  url: string;
  firstSeenAt: string;
  lastSeenAt: string;
  postedAt: string | null;
}

/** What the bot remembers between runs: which announcements it has seen and which it posted. */
export interface State {
  version: 1;
  lastPostAt: string | null;
  items: Record<string, StoredItem>;
}

// An announcement that has not been listed anywhere for this long is forgotten.
const FORGET_AFTER_MS = 120 * 24 * 60 * 60 * 1000;

export function emptyState(): State {
  return { version: 1, lastPostAt: null, items: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function loadState(path: string): Promise<State> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if (isRecord(err) && err['code'] === 'ENOENT') return emptyState();
    throw new Error(`Cannot read the state file "${path}"`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`State file "${path}" is not valid JSON — fix or delete it`);
  }
  if (!isRecord(parsed) || parsed['version'] !== 1 || !isRecord(parsed['items'])) {
    throw new Error(`State file "${path}" has an unexpected shape — fix or delete it`);
  }
  const lastPostAt = typeof parsed['lastPostAt'] === 'string' ? parsed['lastPostAt'] : null;
  return { version: 1, lastPostAt, items: parsed['items'] as Record<string, StoredItem> };
}

/** Written to a temporary file first, so an interrupted run never leaves half a state file. */
export async function saveState(path: string, state: State): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

export function markSeen(state: State, items: Announcement[], now: number): void {
  const at = new Date(now).toISOString();
  for (const item of items) {
    const known = state.items[item.id];
    if (known) {
      known.lastSeenAt = at;
      known.title = item.title;
      known.url = item.url;
    } else {
      state.items[item.id] = { title: item.title, url: item.url, firstSeenAt: at, lastSeenAt: at, postedAt: null };
    }
  }
}

export function markPosted(state: State, items: Announcement[], now: number): void {
  const at = new Date(now).toISOString();
  markSeen(state, items, now);
  for (const item of items) {
    const known = state.items[item.id];
    if (known) known.postedAt = at;
  }
}

/** Pages already posted, whichever source listed them. */
export function postedUrlKeys(state: State): Set<string> {
  const keys = new Set<string>();
  for (const item of Object.values(state.items)) {
    if (item.postedAt) keys.add(urlKey(item.url));
  }
  return keys;
}

export function isPosted(state: State, item: Announcement, postedUrls: Set<string>): boolean {
  return Boolean(state.items[item.id]?.postedAt) || postedUrls.has(urlKey(item.url));
}

export function prune(state: State, now: number): void {
  for (const [id, item] of Object.entries(state.items)) {
    if (now - Date.parse(item.lastSeenAt) > FORGET_AFTER_MS) delete state.items[id];
  }
}
