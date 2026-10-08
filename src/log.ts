const secrets = new Set<string>();

const MIN_SECRET_LENGTH = 8;
// Safety nets for values that were never registered: agent keys, any 32-byte
// hex string and anything shaped like a JWT.
const AGENT_KEY = /cag_[A-Za-z0-9_-]{16,}/g;
const HEX_32_BYTES = /(?<![0-9a-fA-F])(?:0x)?[0-9a-fA-F]{64}(?![0-9a-fA-F])/g;
const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Registers a value that must never appear in any output. */
export function registerSecret(value: string | null | undefined): void {
  if (!value || value.length < MIN_SECRET_LENGTH) return;
  secrets.add(value);
}

export function redact(text: string): string {
  let out = text;
  for (const secret of secrets) {
    out = out.replace(new RegExp(escapeRegExp(secret), 'g'), '[redacted]');
  }
  return out.replace(AGENT_KEY, '[redacted]').replace(HEX_32_BYTES, '[redacted]').replace(JWT, '[redacted]');
}

/** Renders any thrown value as a single redacted line (no stack, no cause chain). */
export function describeError(err: unknown): string {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return redact(message);
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export const log: Logger = {
  info(message: string): void {
    console.log(redact(message));
  },
  warn(message: string): void {
    console.warn(redact(message));
  },
  error(message: string): void {
    console.error(redact(message));
  },
};
