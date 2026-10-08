// Listing sites built with Next.js ship their data inside the page instead of
// marking it up. These helpers dig it out; each source knows what to look for.

/** The `__NEXT_DATA__` object of a page (Next.js pages router), or null. */
export function nextData(html: string): unknown {
  const match = /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]) as unknown;
  } catch {
    return null;
  }
}

/** The text a page streams through `self.__next_f.push([1, "..."])` (Next.js app router). */
function flightText(html: string): string {
  let text = '';
  for (const match of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try {
      text += JSON.parse(match[1] ?? '""') as string;
    } catch {
      // One unreadable chunk must not hide the others.
    }
  }
  return text;
}

/** The JSON array that follows `"key":` in the page's streamed data, or null. */
export function flightArray(html: string, key: string): unknown[] | null {
  const text = flightText(html);
  const marker = `"${key}":[`;
  const at = text.indexOf(marker);
  if (at < 0) return null;

  const start = at + marker.length - 1;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === '\\') i++;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === '[' || char === '{') {
      depth++;
    } else if (char === ']' || char === '}') {
      depth--;
      if (depth === 0) {
        try {
          const parsed: unknown = JSON.parse(text.slice(start, i + 1));
          return Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
