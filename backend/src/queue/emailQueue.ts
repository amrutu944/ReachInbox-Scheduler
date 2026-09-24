import { Queue } from "bullmq";
import { redisConnection } from "./redisConnection";

export const EMAIL_QUEUE_NAME = "email-send-queue";

export const emailQueue = new Queue(EMAIL_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: { age: 3600 * 24 * 7, count: 5000 },
    removeOnFail: { age: 3600 * 24 * 7, count: 5000 },
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
  },
});

export interface EmailJobData {
  emailId: string; // maps 1:1 to emails.id in Postgres - the idempotency anchor
}

/**
 * Enqueues an email as a BullMQ *delayed* job (no cron). Using the email's own
 * UUID as the BullMQ jobId makes re-enqueuing idempotent: BullMQ will refuse to
 * create a duplicate job with the same id, so a crashed process that replays
 * "pending" rows on boot (see queue/recover.ts) can never double-schedule a send.
 */
export async function enqueueEmailJob(emailId: string, scheduledTimeMs: number) {
  const delay = Math.max(0, scheduledTimeMs - Date.now());
  await emailQueue.add(
    "send-email",
    { emailId } as EmailJobData,
    {
      jobId: emailId,
      delay,
    }
  );
}
