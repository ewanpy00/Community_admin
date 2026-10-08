const MAX_DETAIL_LENGTH = 300;

/** Non-2xx (or malformed) answer from the Cormonity API. Never carries request bodies or headers. */
export class CormonityApiError extends Error {
  override readonly name = 'CormonityApiError';

  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
    detail: string,
  ) {
    super(`${method} ${path} -> ${status}: ${detail.slice(0, MAX_DETAIL_LENGTH)}`);
  }
}

/** Extracts NestJS `{ message }` from an error body, falling back to the raw text. */
export function errorDetail(bodyText: string): string {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (typeof parsed === 'object' && parsed !== null && 'message' in parsed) {
      const message = (parsed as { message: unknown }).message;
      if (Array.isArray(message)) return message.join(', ');
      if (typeof message === 'string') return message;
    }
  } catch {
    // not JSON — fall through to the raw text
  }
  return bodyText.trim() || '(empty body)';
}
