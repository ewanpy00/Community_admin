const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
};

function codePoint(value: number, fallback: string): string {
  return Number.isInteger(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : fallback;
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) return codePoint(parseInt(code.slice(2), 16), match);
    if (code.startsWith('#')) return codePoint(parseInt(code.slice(1), 10), match);
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** Plain single-line text: tags dropped, entities decoded, whitespace collapsed. */
export function cleanText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return decodeEntities(value.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

const TRACKING_PARAM = /^(utm_|ref$|ref_|fbclid$|gclid$|mc_|eventOrigin$|recId$|recSource$|searchId$)/i;

/** Absolute http(s) URL without fragment or tracking parameters, or null. */
export function normalizeUrl(raw: unknown, base?: string): string | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  let url: URL;
  try {
    url = new URL(raw.trim(), base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  for (const name of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(name)) url.searchParams.delete(name);
  }
  return url.toString();
}

/** Comparison key: the same page reached as http/https, with/without www or a trailing slash. */
export function urlKey(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname.replace(/\/+$/, '').toLowerCase();
    parsed.searchParams.sort();
    const query = parsed.searchParams.toString();
    return `${host}${path}${query ? `?${query}` : ''}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

export function titleKey(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// Words that name the event itself.
const HACKATHON_WORDS = /hackathon|hackfest|buildathon|ideathon|datathon|codeathon|makeathon/i;
// Looser wording that only counts in a title: a description that merely
// mentions "CTF challenges" or "our game jam last year" is not an announcement.
const TITLE_ONLY_WORDS =
  /hack[\s-]?day|hack[\s-]?night|hack[\s-]?week|code[\s-]?fest|game[\s-]?jam|capture the flag|\bctf\b/i;

export function looksLikeHackathon(title: string, description?: string | null): boolean {
  if (HACKATHON_WORDS.test(title) || TITLE_ONLY_WORDS.test(title)) return true;
  return typeof description === 'string' && HACKATHON_WORDS.test(description);
}

export function isoDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
