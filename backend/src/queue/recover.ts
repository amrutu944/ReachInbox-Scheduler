import { listPendingEmails } from "../db/emailModel";
import { emailQueue, enqueueEmailJob } from "./emailQueue";

/**
 * Runs once on server boot. Postgres is the source of truth for "what still needs
 * to be sent"; BullMQ/Redis is just the timer. If Redis was flushed, or the process
 * crashed between "insert email row" and "enqueue BullMQ job", this re-creates any
 * missing delayed jobs. Because enqueueEmailJob uses the email's own id as the BullMQ
 * jobId, calling it again for a job that already exists in Redis is a safe no-op -
 * nothing is duplicated or restarted from scratch.
 */
export async function recoverPendingEmailsOnBoot() {
  const pending = await listPendingEmails();
  let recovered = 0;

  for (const email of pending) {
    const existingJob = await emailQueue.getJob(email.id);
    if (existingJob) continue; // already scheduled in Redis - untouched

    await enqueueEmailJob(email.id, new Date(email.scheduled_time).getTime());
    recovered++;
  }

  console.log(`[recover] ${pending.length} pending emails found, ${recovered} BullMQ jobs re-created.`);
}
