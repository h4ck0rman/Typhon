/**
 * Simple in-memory sliding-window rate limiter.
 * Tracks timestamps of recent actions per key and rejects
 * calls that exceed the configured limit within the window.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, number[]>();

  constructor(
    private readonly maxActions: number,
    private readonly windowMs: number,
  ) {}

  /**
   * Check if an action is allowed for the given key.
   * Returns true if allowed, false if rate-limited.
   * Automatically prunes expired timestamps.
   */
  check(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    let timestamps = this.buckets.get(key);
    if (!timestamps) {
      timestamps = [];
      this.buckets.set(key, timestamps);
    }

    // Prune expired entries
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }

    if (timestamps.length >= this.maxActions) {
      return false;
    }

    timestamps.push(now);
    return true;
  }

  /**
   * Get the number of remaining actions for a key within the current window.
   */
  remaining(key: string): number {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const timestamps = this.buckets.get(key);
    if (!timestamps) return this.maxActions;
    const active = timestamps.filter((t) => t >= cutoff);
    return Math.max(0, this.maxActions - active.length);
  }
}

// Flag check: max 10 attempts per minute per lab
export const flagRateLimiter = new RateLimiter(10, 60_000);

// Feedback: max 5 submissions per minute
export const feedbackRateLimiter = new RateLimiter(5, 60_000);
