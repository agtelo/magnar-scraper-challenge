/**
 * Exponential backoff for 429 / transient failures.
 *
 * wait = min(cap, base * 2^attempt) + jitter, or Retry-After when present.
 */

export type BackoffOptions = {
  baseMs?: number;
  capMs?: number;
  maxAttempts?: number;
  jitter?: number;
};

export const DEFAULT_BACKOFF: Required<BackoffOptions> = {
  baseMs: 1_000,
  capMs: 60_000,
  maxAttempts: 5,
  jitter: 0.25,
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseRetryAfter(header: string | undefined, now = Date.now()): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }
  const date = Date.parse(trimmed);
  if (Number.isFinite(date)) {
    return Math.max(0, date - now);
  }
  return null;
}

export function delayForAttempt(
  attempt: number,
  opts: BackoffOptions = {},
  retryAfterMs: number | null = null,
): number {
  const { baseMs, capMs, jitter } = { ...DEFAULT_BACKOFF, ...opts };
  const expo = Math.min(capMs, baseMs * 2 ** attempt);
  const spread = expo * jitter;
  const jittered = expo + (Math.random() * 2 - 1) * spread;
  return Math.max(retryAfterMs ?? 0, Math.round(jittered));
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

export type RetryOutcome<T> =
  | { ok: true; value: T; attempts: number; retries429: number }
  | { ok: false; error: unknown; attempts: number; retries429: number; lastStatus: number | null };

export async function withBackoff<T>(
  task: () => Promise<{ status: number; value: T }>,
  opts: BackoffOptions = {},
  onRetry?: (info: { attempt: number; waitMs: number; status: number }) => void,
): Promise<RetryOutcome<T>> {
  const { maxAttempts } = { ...DEFAULT_BACKOFF, ...opts };
  let retries429 = 0;
  let lastStatus: number | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await task();
      lastStatus = result.status;
      if (!isRetryableStatus(result.status)) {
        return { ok: true, value: result.value, attempts: attempt + 1, retries429 };
      }
      if (result.status === 429) retries429 += 1;
      const wait = delayForAttempt(attempt, opts);
      onRetry?.({ attempt: attempt + 1, waitMs: wait, status: result.status });
      await sleep(wait);
    } catch (error) {
      lastError = error;
      const wait = delayForAttempt(attempt, opts);
      onRetry?.({ attempt: attempt + 1, waitMs: wait, status: 0 });
      await sleep(wait);
    }
  }

  return { ok: false, error: lastError, attempts: maxAttempts, retries429, lastStatus };
}
