import { readFile } from 'node:fs/promises';
import { createDevfolioSource, type DevfolioSourceConfig } from './devfolio.js';
import { createDevpostSource, type DevpostSourceConfig } from './devpost.js';
import { createEthGlobalSource, type EthGlobalSourceConfig } from './ethglobal.js';
import { createHackerEarthSource, type HackerEarthSourceConfig } from './hackerearth.js';
import { createJsonLdSource, type JsonLdSourceConfig } from './jsonld.js';
import { createLablabSource, type LablabSourceConfig } from './lablab.js';
import { createLumaSource, type LumaSourceConfig } from './luma.js';
import { createMlhSource, type MlhSourceConfig } from './mlh.js';
import type { Source, SourceContext } from './types.js';

export type SourceConfig =
  | DevpostSourceConfig
  | MlhSourceConfig
  | JsonLdSourceConfig
  | DevfolioSourceConfig
  | HackerEarthSourceConfig
  | LablabSourceConfig
  | LumaSourceConfig
  | EthGlobalSourceConfig;

const FETCH_TIMEOUT_MS = 30_000;
const MAX_PAGE_BYTES = 8 * 1024 * 1024;
// A pause between requests so no listing site sees a burst from the bot.
const REQUEST_GAP_MS = 700;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

export function buildSources(configs: unknown): Source[] {
  if (!Array.isArray(configs) || configs.length === 0) {
    throw new Error('Sources file must be a non-empty JSON array');
  }
  return configs.map((config, index) => {
    if (!isRecord(config)) throw new Error(`Source #${index + 1} must be an object`);
    switch (config['type']) {
      case 'devpost':
        return createDevpostSource(config as unknown as DevpostSourceConfig);
      case 'mlh':
        if (config['url'] !== undefined && !isHttpUrl(config['url'])) {
          throw new Error(`Source #${index + 1} (mlh) has an invalid "url"`);
        }
        return createMlhSource(config as unknown as MlhSourceConfig);
      case 'devfolio':
        return createDevfolioSource(config as unknown as DevfolioSourceConfig);
      case 'hackerearth':
        return createHackerEarthSource(config as unknown as HackerEarthSourceConfig);
      case 'lablab':
        return createLablabSource(config as unknown as LablabSourceConfig);
      case 'ethglobal':
        return createEthGlobalSource(config as unknown as EthGlobalSourceConfig);
      case 'luma': {
        const point = Number.isFinite(config['latitude']) && Number.isFinite(config['longitude']);
        const calendar = typeof config['calendar'] === 'string' && /^cal-[A-Za-z0-9]+$/.test(config['calendar']);
        if (typeof config['name'] !== 'string' || !config['name'].trim() || point === calendar) {
          throw new Error(`Source #${index + 1} (luma) needs a "name" and either "latitude" and "longitude" or a "calendar" id`);
        }
        return createLumaSource(config as unknown as LumaSourceConfig);
      }
      case 'jsonld':
        if (typeof config['name'] !== 'string' || !config['name'].trim() || !isHttpUrl(config['url'])) {
          throw new Error(`Source #${index + 1} (jsonld) needs a "name" and an http(s) "url"`);
        }
        return createJsonLdSource(config as unknown as JsonLdSourceConfig);
      default:
        throw new Error(`Source #${index + 1} has an unknown type "${String(config['type'])}"`);
    }
  });
}

export async function loadSources(path: string): Promise<Source[]> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    throw new Error(`Cannot read the sources file "${path}"`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Sources file "${path}" is not valid JSON`);
  }
  return buildSources(parsed);
}

export interface FetchContextOptions {
  fetch?: typeof fetch;
  now?: () => number;
  userAgent?: string;
  requestGapMs?: number;
}

/** The network side of a source: plain GETs with a timeout, a size cap and a gap between them. */
export function createSourceContext(options: FetchContextOptions = {}): SourceContext {
  const fetchImpl = options.fetch ?? fetch;
  const userAgent = options.userAgent ?? 'Mozilla/5.0 (compatible; hackathon-scout-bot/0.2)';
  const gap = options.requestGapMs ?? REQUEST_GAP_MS;
  let lastRequestAt = 0;

  return {
    now: options.now ?? Date.now,
    async fetchText(url: string, accept = '*/*'): Promise<string> {
      const wait = lastRequestAt + gap - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      lastRequestAt = Date.now();

      const host = new URL(url).hostname;
      let response: Response;
      try {
        response = await fetchImpl(url, {
          headers: { accept, 'user-agent': userAgent },
          redirect: 'follow',
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
      } catch (err) {
        throw new Error(`${host}: request failed (${err instanceof Error ? err.message : 'unknown error'})`);
      }
      if (!response.ok) throw new Error(`${host}: HTTP ${response.status}`);
      const text = await response.text();
      if (text.length > MAX_PAGE_BYTES) throw new Error(`${host}: response is too large`);
      return text;
    },
  };
}
