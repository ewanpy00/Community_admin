import { registerSecret } from '../log.js';
import { CormonityApiError, errorDetail } from './errors.js';
import type { NewPost, OwnPost, Post, TokenInfo } from './types.js';

const REQUEST_TIMEOUT_MS = 20_000;
// Get a new access token this long before the current one actually expires.
const EXPIRY_MARGIN_MS = 60_000;
const AGENT_KEY_PATTERN = /^cag_[A-Za-z0-9_-]{32,}$/;

export interface CormonityClientOptions {
  /** API base including the `/api` prefix, e.g. `https://example.com/api`. */
  baseUrl: string;
  /** Agent key (`cag_...`) issued when the community admin created the agent. */
  agentKey: string;
  fetch?: typeof fetch;
  now?: () => number;
  userAgent?: string;
}

interface RequestOptions {
  body?: unknown;
  /** Attach the bearer token (obtaining or renewing it when needed). */
  auth?: boolean;
}

interface RawResponse {
  status: number;
  text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Cormonity API client for a connected agent. The agent key is exchanged for a
 * 15-minute access token; there is no refresh token, so when the token runs
 * out (or the server answers 401) the key is simply exchanged again.
 *
 * The platform lets that token do two things only — post to the agent's own
 * community and read back the agent's own posts — and answers 403 to anything
 * else. This client offers nothing beyond those two.
 */
export class CormonityClient {
  private readonly baseUrl: string;
  private readonly agentKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly userAgent: string;

  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;
  // The exchange endpoint allows 5 calls a minute per IP, so concurrent
  // callers must share one request.
  private exchangeInFlight: Promise<TokenInfo> | null = null;

  constructor(options: CormonityClientOptions) {
    const url = new URL(options.baseUrl);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      throw new Error('API_BASE_URL must use https (http is allowed for localhost only)');
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');

    const key = options.agentKey.trim();
    // Validated here so a malformed value never reaches a server error message.
    if (!AGENT_KEY_PATTERN.test(key)) {
      throw new Error('AGENT_KEY has an invalid format (expected "cag_" followed by the key)');
    }
    registerSecret(key);
    this.agentKey = key;

    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.userAgent = options.userAgent ?? 'hackathon-scout-bot/0.2';
  }

  async health(): Promise<void> {
    const body = await this.request('GET', '/health');
    if (!isRecord(body) || body['status'] !== 'ok') {
      throw new CormonityApiError('GET', '/health', 200, 'unexpected health response');
    }
  }

  /** Exchanges the agent key for a fresh access token. */
  authenticate(): Promise<TokenInfo> {
    this.exchangeInFlight ??= this.exchangeKey().finally(() => {
      this.exchangeInFlight = null;
    });
    return this.exchangeInFlight;
  }

  private async exchangeKey(): Promise<TokenInfo> {
    const path = '/auth/agent-token';
    const raw = await this.rawRequest('POST', path, { body: { key: this.agentKey } });
    const body = this.parseBody('POST', path, raw);
    if (
      !isRecord(body) ||
      typeof body['accessToken'] !== 'string' ||
      body['accessToken'].length === 0 ||
      typeof body['expiresIn'] !== 'number' ||
      !(body['expiresIn'] > 0)
    ) {
      throw new CormonityApiError('POST', path, raw.status, 'response has no access token');
    }
    registerSecret(body['accessToken']);
    this.accessToken = body['accessToken'];
    this.accessTokenExpiresAt = this.now() + body['expiresIn'] * 1000;
    return { expiresIn: body['expiresIn'] };
  }

  /** The agent's own posts, newest first. The server clamps `take` to 1..100. */
  async ownPosts(options: { take?: number } = {}): Promise<OwnPost[]> {
    const suffix = options.take === undefined ? '' : `?take=${options.take}`;
    const body = await this.request('GET', `/agent/posts${suffix}`, { auth: true });
    if (!isRecord(body) || !Array.isArray(body['data'])) {
      throw new CormonityApiError('GET', '/agent/posts', 200, 'unexpected response shape');
    }
    return body['data'].map((item: unknown) => {
      if (
        !isRecord(item) ||
        typeof item['id'] !== 'string' ||
        typeof item['communityId'] !== 'string' ||
        typeof item['body'] !== 'string' ||
        typeof item['createdAt'] !== 'string'
      ) {
        throw new CormonityApiError('GET', '/agent/posts', 200, 'unexpected post shape');
      }
      const linkUrl = item['linkUrl'];
      return {
        id: item['id'],
        communityId: item['communityId'],
        body: item['body'],
        linkUrl: typeof linkUrl === 'string' ? linkUrl : null,
        createdAt: item['createdAt'],
      };
    });
  }

  /**
   * Checks that the agent may post to the community, without posting. An empty
   * post is sent: the server checks access before it validates the body, so a
   * 400 means access was granted, and a 403 that this is not the agent's community.
   */
  async assertCanPost(communityId: string): Promise<void> {
    const path = `/communities/${encodeURIComponent(communityId)}/posts`;
    await this.ensureFreshToken();
    const raw = await this.rawRequest('POST', path, { auth: true, body: {} });
    if (raw.status === 400) return;
    const detail = raw.status >= 200 && raw.status < 300 ? 'an empty post was accepted' : errorDetail(raw.text);
    throw new CormonityApiError('POST', path, raw.status, detail);
  }

  async createPost(communityId: string, post: NewPost): Promise<Post> {
    const path = `/communities/${encodeURIComponent(communityId)}/posts`;
    const body = await this.request('POST', path, { auth: true, body: post });
    return this.parsePost(body, 'POST', path);
  }

  private parsePost(body: unknown, method: string, path: string): Post {
    const author = isRecord(body) ? body['author'] : undefined;
    if (
      !isRecord(body) ||
      typeof body['id'] !== 'string' ||
      typeof body['communityId'] !== 'string' ||
      typeof body['body'] !== 'string' ||
      typeof body['createdAt'] !== 'string' ||
      !isRecord(author) ||
      typeof author['id'] !== 'string'
    ) {
      throw new CormonityApiError(method, path, 200, 'unexpected post shape');
    }
    const linkUrl = body['linkUrl'];
    const channelId = body['channelId'];
    return {
      id: body['id'],
      communityId: body['communityId'],
      channelId: typeof channelId === 'string' ? channelId : null,
      body: body['body'],
      linkUrl: typeof linkUrl === 'string' ? linkUrl : null,
      author: {
        id: author['id'],
        username: typeof author['username'] === 'string' ? author['username'] : '',
        displayName: typeof author['displayName'] === 'string' ? author['displayName'] : '',
      },
      createdAt: body['createdAt'],
    };
  }

  private async ensureFreshToken(): Promise<void> {
    if (this.accessToken && this.now() < this.accessTokenExpiresAt - EXPIRY_MARGIN_MS) return;
    await this.authenticate();
  }

  /** JSON request. Throws CormonityApiError on any non-2xx answer. */
  async request(method: string, path: string, options: RequestOptions = {}): Promise<unknown> {
    if (options.auth) await this.ensureFreshToken();
    let raw = await this.rawRequest(method, path, options);
    if (raw.status === 401 && options.auth) {
      // The token may have been issued before a restart or expired early. One
      // new exchange decides it: if the key itself was revoked, this throws.
      await this.authenticate();
      raw = await this.rawRequest(method, path, options);
    }
    return this.parseBody(method, path, raw);
  }

  private parseBody(method: string, path: string, raw: RawResponse): unknown {
    const pathname = path.split('?', 1)[0] ?? path;
    if (raw.status < 200 || raw.status >= 300) {
      throw new CormonityApiError(method, pathname, raw.status, errorDetail(raw.text));
    }
    if (raw.text.length === 0) return null;
    try {
      return JSON.parse(raw.text) as unknown;
    } catch {
      throw new CormonityApiError(method, pathname, raw.status, 'response is not valid JSON');
    }
  }

  private async rawRequest(method: string, path: string, options: RequestOptions = {}): Promise<RawResponse> {
    const headers: Record<string, string> = { accept: 'application/json', 'user-agent': this.userAgent };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.auth && this.accessToken) headers['authorization'] = `Bearer ${this.accessToken}`;

    const pathname = path.split('?', 1)[0] ?? path;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      throw new CormonityApiError(method, pathname, 0, `network error: ${reason}`);
    }
    return { status: response.status, text: await response.text() };
  }
}
