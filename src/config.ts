import { registerSecret } from './log.js';
import { assertTimeZone, parsePostTimes, type PostSchedule } from './schedule.js';

export interface Config {
  apiBaseUrl: string;
  agentKey: string;
  communityId: string;
  fetchIntervalMinutes: number;
  postSchedule: PostSchedule;
  regionKeywords: string[];
  regionCountryCodes: string[];
  includeOnline: boolean;
  minPopularity: number;
  minDaysAhead: number;
  maxDaysAhead: number;
  stateFile: string;
  sourcesFile: string;
}

const DEFAULT_REGION_KEYWORDS =
  'united arab emirates,uae,dubai,abu dhabi,sharjah,ajman,ras al khaimah,fujairah,umm al quwain,al ain';

const DEFAULT_POST_TIMES = '00:00,06:00,12:00,18:00';

type Env = Record<string, string | undefined>;

// Settings from the digest era: the bot now posts one hackathon at each set time.
const OBSOLETE_SETTINGS = ['POST_MIN_INTERVAL_HOURS', 'MAX_ITEMS_PER_POST', 'POST_TITLE'];

/** Names of settings that are still set but no longer have any effect. */
export function obsoleteSettings(env: Env = process.env): string[] {
  return OBSOLETE_SETTINGS.filter((name) => env[name]?.trim());
}

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Environment variable ${name} is not set`);
  return value;
}

function numberAtLeast(env: Env, name: string, fallback: number, min: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min) {
    throw new Error(`Environment variable ${name} must be a number of at least ${min}`);
  }
  return value;
}

function flag(env: Env, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new Error(`Environment variable ${name} must be true or false`);
}

function list(env: Env, name: string, fallback: string): string[] {
  return (env[name]?.trim() || fallback)
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function postSchedule(env: Env): PostSchedule {
  const timeZone = env['POST_TIMEZONE']?.trim() || 'Asia/Dubai';
  assertTimeZone(timeZone);
  return {
    // POST_TIME is the older name, from when there was one post a day.
    times: parsePostTimes(env['POST_TIMES']?.trim() || env['POST_TIME']?.trim() || DEFAULT_POST_TIMES),
    timeZone,
    graceMs: numberAtLeast(env, 'POST_GRACE_HOURS', 3, 0) * 3_600_000,
  };
}

export function loadConfig(env: Env = process.env): Config {
  const agentKey = required(env, 'AGENT_KEY');
  registerSecret(agentKey);
  return {
    apiBaseUrl: required(env, 'API_BASE_URL'),
    agentKey,
    communityId: required(env, 'COMMUNITY_ID'),
    fetchIntervalMinutes: numberAtLeast(env, 'FETCH_INTERVAL_MINUTES', 180, 5),
    postSchedule: postSchedule(env),
    regionKeywords: list(env, 'REGION_KEYWORDS', DEFAULT_REGION_KEYWORDS).map((k) => k.toLowerCase()),
    regionCountryCodes: list(env, 'REGION_COUNTRY_CODES', 'AE').map((c) => c.toUpperCase()),
    includeOnline: flag(env, 'INCLUDE_ONLINE', true),
    minPopularity: numberAtLeast(env, 'MIN_POPULARITY', 200, 0),
    minDaysAhead: numberAtLeast(env, 'MIN_DAYS_AHEAD', 2, 0),
    maxDaysAhead: numberAtLeast(env, 'MAX_DAYS_AHEAD', 120, 1),
    stateFile: env['STATE_FILE']?.trim() || 'data/state.json',
    sourcesFile: env['SOURCES_FILE']?.trim() || 'sources.json',
  };
}
