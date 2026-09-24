import { Worker, Job, DelayedError } from "bullmq";
import { redisConnection } from "./redisConnection";
import { EMAIL_QUEUE_NAME, EmailJobData } from "./emailQueue";
import { env } from "../config/env";
import { getEmailById, markSent, markFailed, markQueued } from "../db/emailModel";
import { tryReserveSend, msUntilNextHour } from "../services/rateLimiter";
import { sendEmailViaEthereal, listSenders } from "../services/mailer";
import { indexEmail } from "../search/elasticClient";
import { notifyRateLimitHit } from "../services/slackService";

/**
 * Concurrency: how many jobs this worker processes in parallel (env WORKER_CONCURRENCY).
 * Limiter: BullMQ's built-in rate limiter enforces the *global minimum delay* between
 * dequeues (max: 1 job per MIN_DELAY_BETWEEN_EMAILS_MS), mimicking provider throttling.
 * The *per-sender hourly cap* is enforced separately below via Redis counters, because
 * BullMQ's limiter is global/queue-wide and can't key by sender.
 */
export const emailWorker = new Worker<EmailJobData>(
  EMAIL_QUEUE_NAME,
  async (job: Job<EmailJobData>, token?: string) => {
    const email = await getEmailById(job.data.emailId);
    if (!email) {
      console.warn(`[worker] email ${job.data.emailId} not found - dropping stale job`);
      return;
    }

    // Idempotency guard: if this row was already marked sent (e.g. a duplicate job
    // somehow got created), never send twice.
    if (email.status === "sent") {
      return;
    }

    const senders = listSenders();
    const sender = senders.find((s) => s.name === email.sender_name) ?? senders[0];
    if (!sender) throw new Error("No Ethereal senders configured");

    const allowed = await tryReserveSend(sender.name);
    if (!allowed) {
      // Hourly cap hit for this sender: don't drop/fail the job - push it into the
      // next hour window instead, preserving relative order of remaining jobs.
      const delay = msUntilNextHour() + 1000;
      await notifyRateLimitHit(email.user_id, sender.name, env.maxEmailsPerHourPerSender);
      if (!token) {
        // Should not happen in practice (BullMQ always passes a token), but fall back
        // to a plain retry via backoff rather than crashing the worker.
        throw new Error("rate-limited-retry-no-token");
      }
      await job.moveToDelayed(Date.now() + delay, token);
      throw new DelayedError();
    }

    await markQueued(email.id, job.id ?? "");

    try {
      const result = await sendEmailViaEthereal({
        sender,
        to: email.recipient,
        subject: email.subject,
        html: email.body,
      });
      await markSent(email.id);
      await indexEmail({
        id: email.id,
        userId: email.user_id,
        recipient: email.recipient,
        subject: email.subject,
        body: email.body,
        status: "sent",
        senderName: sender.name,
        scheduledTime: email.scheduled_time,
        sentTime: new Date().toISOString(),
      });
      console.log(`[worker] sent ${email.id} to ${email.recipient} via ${sender.name} - preview: ${result.previewUrl}`);
    } catch (err: any) {
      await markFailed(email.id, err.message ?? String(err));
      await indexEmail({
        id: email.id,
        userId: email.user_id,
        recipient: email.recipient,
        subject: email.subject,
        body: email.body,
        status: "failed",
        senderName: sender.name,
        scheduledTime: email.scheduled_time,
      });
      throw err;
    }
  },
  {
    connection: redisConnection,
    concurrency: env.workerConcurrency,
    limiter: {
      max: 1,
      duration: env.minDelayBetweenEmailsMs,
    },
  }
);

emailWorker.on("failed", (job, err) => {
  if (err instanceof DelayedError) return; // expected control-flow, not a real failure
  console.error(`[worker] job ${job?.id} failed:`, err);
});

console.log(
  `[worker] started - concurrency=${env.workerConcurrency}, minDelayMs=${env.minDelayBetweenEmailsMs}, maxEmailsPerHourPerSender=${env.maxEmailsPerHourPerSender}`
);
