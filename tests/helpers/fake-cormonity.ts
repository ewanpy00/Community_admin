import { randomBytes, randomUUID } from 'node:crypto';

// In-memory stand-in for the Cormonity API, mirroring the behaviour of the real
// agent, community and community-post modules the bot depends on: key exchange
// for a 15-minute access token (no refresh token), revocation that kills live
// tokens at once, and the post endpoints.

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string | null;
}

export interface FakePost {
  id: string;
  communityId: string;
  channelId: string | null;
  body: string;
  linkUrl: string | null;
  author: { id: string; username: string; displayName: string; avatarUrl: null; isAgent: boolean };
  createdAt: string;
}

export interface FakeCormonityOptions {
  now?: () => number;
  accessTtlSeconds?: number;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function fail(status: number, message: string): Response {
  return json(status, { statusCode: status, message });
}

export class FakeCormonity {
  readonly baseUrl = 'https://cormonity.test/api';
  readonly requests: RecordedRequest[] = [];
  readonly posts: FakePost[] = [];
  /** Every access token ever issued — none of them may reach the bot's output. */
  readonly issuedTokens: string[] = [];
  readonly agentKey = `cag_${randomBytes(32).toString('base64url')}`;
  readonly agentUserId = randomUUID();
  readonly community = {
    id: randomUUID(),
    name: 'Hack Club',
    slug: 'hack-club',
    type: 'club',
    enabledModules: ['POSTS'],
    settings: null,
  };

  exchanges = 0;
  keyRevoked = false;
  agentsEnabled = true;

  private readonly now: () => number;
  private readonly accessTtlSeconds: number;
  private readonly tokens = new Map<string, number>();

  constructor(options: FakeCormonityOptions = {}) {
    this.now = options.now ?? Date.now;
    this.accessTtlSeconds = options.accessTtlSeconds ?? 900;
  }

  /** Drops every live access token, as a server restart with new keys would. */
  invalidateTokens(): void {
    this.tokens.clear();
  }

  seedPost(authorId: string, body: string, createdAt: string): FakePost {
    const post: FakePost = {
      id: randomUUID(),
      communityId: this.community.id,
      channelId: null,
      body,
      linkUrl: null,
      author: { id: authorId, username: 'someone', displayName: 'Someone', avatarUrl: null, isAgent: false },
      createdAt,
    };
    this.posts.push(post);
    return post;
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const body = typeof init?.body === 'string' ? init.body : null;
    const path = url.pathname.replace(/^\/api/, '');
    this.requests.push({ method, path, headers, body });
    return this.route(method, path, url.searchParams, headers, body);
  };

  private route(
    method: string,
    path: string,
    query: URLSearchParams,
    headers: Record<string, string>,
    body: string | null,
  ): Response {
    if (method === 'GET' && path === '/health') return json(200, { status: 'ok' });

    if (method === 'POST' && path === '/auth/agent-token') {
      if (!this.agentsEnabled) return fail(404, 'Cannot POST /api/auth/agent-token');
      this.exchanges++;
      const key = (JSON.parse(body ?? '{}') as { key?: unknown }).key;
      if (key !== this.agentKey || this.keyRevoked) return fail(401, 'Invalid agent key');
      const part = () => randomBytes(18).toString('base64url');
      const token = `eyJ${part()}.${part()}.${part()}`;
      this.tokens.set(token, this.now() + this.accessTtlSeconds * 1000);
      this.issuedTokens.push(token);
      return json(201, { accessToken: token, tokenType: 'Bearer', expiresIn: this.accessTtlSeconds });
    }

    const token = headers['authorization']?.replace(/^Bearer /, '') ?? '';
    const expiresAt = this.tokens.get(token);
    if (expiresAt === undefined || expiresAt <= this.now() || this.keyRevoked) return fail(401, 'Unauthorized');

    // What follows mirrors the real platform: an agent's token reaches these
    // two routes and is refused with 403 everywhere else.
    if (method === 'GET' && path === '/agent/posts') {
      const take = Math.min(Math.max(Number(query.get('take') ?? 50) || 50, 1), 100);
      const own = this.posts
        .filter((post) => post.author.id === this.agentUserId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, take)
        .map(({ id, communityId, body: text, linkUrl, createdAt }) => ({ id, communityId, body: text, linkUrl, createdAt }));
      return json(200, { data: own });
    }

    if (path === `/communities/${this.community.id}/posts`) {
      if (method === 'POST') {
        const dto = JSON.parse(body ?? '{}') as { body?: unknown; linkUrl?: unknown };
        if (typeof dto.body !== 'string' || dto.body.length < 1 || dto.body.length > 5000) {
          return fail(400, 'body must be shorter than or equal to 5000 characters');
        }
        if (dto.linkUrl !== undefined && !/^https?:\/\//.test(String(dto.linkUrl))) {
          return fail(400, 'linkUrl must be a URL address');
        }
        const post: FakePost = {
          id: randomUUID(),
          communityId: this.community.id,
          channelId: null,
          body: dto.body,
          linkUrl: typeof dto.linkUrl === 'string' ? dto.linkUrl : null,
          author: {
            id: this.agentUserId,
            username: 'agent_1a2b3c',
            displayName: 'Hackathon scout',
            avatarUrl: null,
            isAgent: true,
          },
          createdAt: new Date(this.now()).toISOString(),
        };
        this.posts.push(post);
        return json(201, post);
      }
    }
    return fail(403, 'Agent accounts can only post to their own community feed');
  }
}
