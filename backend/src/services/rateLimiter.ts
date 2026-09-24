import { redisConnection } from "../queue/redisConnection";
import { env } from "../config/env";

/**
 * Redis-backed sliding-hour-window counter, keyed by sender + hour bucket.
 * Using INCR on a key that expires at the end of the hour is atomic and safe
 * across many worker processes/instances (no in-memory counting).
 */
function hourBucketKey(senderName: string, hourStartMs: number): string {
  return `rate:sender:${senderName}:${hourStartMs}`;
}

export function currentHourStart(fromMs = Date.now()): number {
  const d = new Date(fromMs);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

/**
 * Attempts to reserve one send slot for `senderName` in the hour bucket containing `atMs`.
 * Returns true if under the limit (and increments the counter), false if the hour is full.
 */
export async function tryReserveSend(senderName: string, atMs = Date.now()): Promise<boolean> {
  const hourStart = currentHourStart(atMs);
  const key = hourBucketKey(senderName, hourStart);
  const limit = env.maxEmailsPerHourPerSender;

  const count = await redisConnection.incr(key);
  if (count === 1) {
    // first increment in this bucket - set expiry so old buckets clean themselves up
    await redisConnection.expire(key, 3600 + 60);
  }
  if (count > limit) {
    // over budget - release the increment we just took since this slot isn't used
    await redisConnection.decr(key);
    return false;
  }
  return true;
}

export async function getSenderUsage(senderName: string, atMs = Date.now()): Promise<{ used: number; limit: number }> {
  const hourStart = currentHourStart(atMs);
  const key = hourBucketKey(senderName, hourStart);
  const used = parseInt((await redisConnection.get(key)) ?? "0", 10);
  return { used, limit: env.maxEmailsPerHourPerSender };
}

/** ms until the current hour bucket rolls over - used to compute the retry delay. */
export function msUntilNextHour(fromMs = Date.now()): number {
  const nextHour = currentHourStart(fromMs) + 3600_000;
  return nextHour - fromMs;
}
