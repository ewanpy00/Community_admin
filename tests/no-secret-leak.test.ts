import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { CormonityClient } from '../src/cormonity-client/client.js';
import { describeError, log, redact } from '../src/log.js';
import { runCycle } from '../src/scout.js';
import { announcement } from './helpers/announcement.js';
import { FakeCormonity } from './helpers/fake-cormonity.js';

let output: string[];
let dir: string;

beforeEach(() => {
  output = [];
  dir = mkdtempSync(join(tmpdir(), 'scout-leak-'));
  const capture = (...args: unknown[]): void => {
    output.push(args.map(String).join(' '));
  };
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'warn').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function expectNoSecrets(text: string, api: FakeCormonity): void {
  expect(text).not.toContain(api.agentKey);
  expect(text).not.toContain(api.agentKey.slice(4));
  for (const token of api.issuedTokens) expect(text).not.toContain(token);
}

const DAY = 24 * 3_600_000;
// This pass runs on the real clock, so the hackathon must be ahead of today.
const aWeekAhead = (): string => new Date(Date.now() + 7 * DAY).toISOString();

describe('secrets never reach the output or the state file', () => {
  it('a full pass logs and stores no key and no token', async () => {
    const api = new FakeCormonity();
    const client = new CormonityClient({ baseUrl: api.baseUrl, agentKey: api.agentKey, fetch: api.fetch });
    const statePath = join(dir, 'state.json');

    await runCycle({
      sources: [{ name: 'Devpost', fetch: () => Promise.resolve([announcement({ location: 'Dubai', startsAt: aWeekAhead() })]) }],
      context: { now: Date.now, fetchText: () => Promise.reject(new Error('not used')) },
      publisher: client,
      communityId: api.community.id,
      policy: {
        regionKeywords: ['dubai'],
        regionCountryCodes: ['AE'],
        includeOnline: true,
        minPopularity: 200,
        minLeadMs: 2 * DAY,
        maxAheadMs: 120 * DAY,
      },
      schedule: { times: [{ hour: 12, minute: 0 }], timeZone: 'Asia/Dubai', graceMs: 3 * 3_600_000 },
      postNow: true,
      statePath,
      dryRun: false,
      log,
    });

    expect(api.posts).toHaveLength(1);
    expect(api.issuedTokens.length).toBeGreaterThan(0);
    expectNoSecrets(output.join('\n'), api);
    expectNoSecrets(readFileSync(statePath, 'utf8'), api);
    expectNoSecrets(api.posts[0]?.body ?? '', api);
  });

  it('a rejected key produces an error without the key in it', async () => {
    const api = new FakeCormonity();
    api.keyRevoked = true;
    const client = new CormonityClient({ baseUrl: api.baseUrl, agentKey: api.agentKey, fetch: api.fetch });

    const error = await client.ownPosts().catch((err: unknown) => err);
    log.error(`Pass failed — ${describeError(error)}`);

    expect(output.join('\n')).toContain('401');
    expectNoSecrets(output.join('\n'), api);
  });

  it('a network failure does not leak the request', async () => {
    const api = new FakeCormonity();
    const failing: typeof fetch = () => Promise.reject(new Error(`connect failed for key ${api.agentKey}`));
    const client = new CormonityClient({ baseUrl: api.baseUrl, agentKey: api.agentKey, fetch: failing });

    const error = await client.authenticate().catch((err: unknown) => err);
    expectNoSecrets(describeError(error), api);
  });

  it('redacts a key from the environment as soon as the config is loaded', () => {
    const agentKey = `cag_${'k'.repeat(43)}`;
    loadConfig({ API_BASE_URL: 'https://cormonity.test/api', AGENT_KEY: agentKey, COMMUNITY_ID: 'c1' });
    expect(redact(`key is ${agentKey}`)).toBe('key is [redacted]');
  });

  it('redacts agent keys and tokens it was never told about', () => {
    const strayKey = `cag_${'Z9'.repeat(20)}`;
    const strayJwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJlLXZhbHVl';
    const text = redact(`key=${strayKey} token=${strayJwt}`);
    expect(text).not.toContain(strayKey);
    expect(text).not.toContain(strayJwt);
  });
});
