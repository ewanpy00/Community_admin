import { describe, expect, it } from 'vitest';
import { CormonityClient } from '../src/cormonity-client/client.js';
import { CormonityApiError } from '../src/cormonity-client/errors.js';
import { describeError } from '../src/log.js';
import { FakeCormonity } from './helpers/fake-cormonity.js';

function setup(options: { accessTtlSeconds?: number } = {}) {
  let time = Date.parse('2026-10-07T08:00:00Z');
  const clock = { now: () => time, advance: (ms: number) => (time += ms) };
  const api = new FakeCormonity({ now: clock.now, accessTtlSeconds: options.accessTtlSeconds });
  const client = new CormonityClient({ baseUrl: api.baseUrl, agentKey: api.agentKey, fetch: api.fetch, now: clock.now });
  return { api, client, clock };
}

describe('CormonityClient (agent key)', () => {
  it('exchanges the key once and reuses the token for later calls', async () => {
    const { api, client } = setup();

    await client.ownPosts();
    await client.createPost(api.community.id, { body: 'first' });
    await client.ownPosts();

    expect(api.exchanges).toBe(1);
    const authed = api.requests.filter((request) => request.path !== '/auth/agent-token');
    expect(authed.every((request) => request.headers['authorization'] === `Bearer ${api.issuedTokens[0]}`)).toBe(true);
  });

  it('sends the key only in the exchange request body', async () => {
    const { api, client } = setup();
    await client.ownPosts();
    await client.createPost(api.community.id, { body: 'hello' });

    for (const request of api.requests) {
      const carriesKey = JSON.stringify([request.headers, request.body]).includes(api.agentKey);
      expect(carriesKey).toBe(request.path === '/auth/agent-token');
    }
  });

  it('gets a new token shortly before the current one expires', async () => {
    const { api, client, clock } = setup({ accessTtlSeconds: 900 });
    await client.ownPosts();
    clock.advance(14 * 60_000 + 30_000); // 30 s left — inside the safety margin
    await client.ownPosts();
    expect(api.exchanges).toBe(2);
  });

  it('shares one exchange between concurrent calls', async () => {
    const { api, client } = setup();
    await Promise.all([client.ownPosts(), client.ownPosts(), client.createPost(api.community.id, { body: 'x' })]);
    expect(api.exchanges).toBe(1);
  });

  it('re-exchanges once and retries when the server stops accepting the token', async () => {
    const { api, client } = setup();
    await client.ownPosts();
    api.invalidateTokens();

    await expect(client.ownPosts()).resolves.toEqual([]);
    expect(api.exchanges).toBe(2);
  });

  it('fails with 401 once the key is revoked, without looping', async () => {
    const { api, client } = setup();
    await client.ownPosts();
    api.keyRevoked = true;

    const error = await client.ownPosts().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(CormonityApiError);
    expect((error as CormonityApiError).status).toBe(401);
    expect((error as CormonityApiError).path).toBe('/auth/agent-token');
    expect(api.exchanges).toBe(2);
    expect(describeError(error)).not.toContain(api.agentKey);
  });

  it('reports a disabled agents feature as the 404 it is', async () => {
    const { api, client } = setup();
    api.agentsEnabled = false;
    await expect(client.authenticate()).rejects.toMatchObject({ status: 404 });
  });

  it('publishes a post with its link', async () => {
    const { api, client } = setup();
    const post = await client.createPost(api.community.id, { body: 'Digest', linkUrl: 'https://example.com/h' });

    expect(post).toMatchObject({ body: 'Digest', linkUrl: 'https://example.com/h', communityId: api.community.id });
    expect(api.posts).toHaveLength(1);
  });

  it('reads back its own posts and never anyone else\'s', async () => {
    const { api, client } = setup();
    api.seedPost('some-human', 'A post by a person', '2026-10-07T07:00:00.000Z');
    await client.createPost(api.community.id, { body: 'By the agent', linkUrl: 'https://example.com/h' });

    expect(await client.ownPosts({ take: 10 })).toEqual([
      {
        id: api.posts[1]?.id,
        communityId: api.community.id,
        body: 'By the agent',
        linkUrl: 'https://example.com/h',
        createdAt: '2026-10-07T08:00:00.000Z',
      },
    ]);
  });

  it('reports a 403 as it is, without exchanging the key again', async () => {
    const { api, client } = setup();
    await client.ownPosts();

    const error = await client.createPost('someone-elses-community', { body: 'hello' }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(CormonityApiError);
    expect((error as CormonityApiError).status).toBe(403);
    expect(api.exchanges).toBe(1);
    expect(api.posts).toHaveLength(0);
  });

  it('checks that it may post without posting anything', async () => {
    const { api, client } = setup();

    await expect(client.assertCanPost(api.community.id)).resolves.toBeUndefined();
    await expect(client.assertCanPost('someone-elses-community')).rejects.toMatchObject({ status: 403 });
    expect(api.posts).toHaveLength(0);
  });

  it('rejects a malformed key without echoing it', () => {
    const bad = 'not-a-real-key-value-1234567890';
    const create = () => new CormonityClient({ baseUrl: 'https://cormonity.test/api', agentKey: bad });
    expect(create).toThrow(/AGENT_KEY has an invalid format/);
    try {
      create();
    } catch (err) {
      expect(String(err)).not.toContain(bad);
    }
  });

  it('refuses plain http outside localhost', () => {
    const agentKey = `cag_${'a'.repeat(43)}`;
    expect(() => new CormonityClient({ baseUrl: 'http://cormonity.test/api', agentKey })).toThrow(/https/);
    expect(() => new CormonityClient({ baseUrl: 'http://localhost:3000/api', agentKey })).not.toThrow();
  });
});
