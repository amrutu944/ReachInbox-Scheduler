import { v4 as uuid } from "uuid";
import { pool } from "./pool";

export type EmailStatus = "scheduled" | "queued" | "sent" | "failed";

export interface EmailRow {
  id: string;
  campaign_id: string | null;
  user_id: string;
  recipient: string;
  subject: string;
  body: string;
  sender_name: string;
  scheduled_time: string;
  status: EmailStatus;
  sent_time: string | null;
  error: string | null;
  bullmq_job_id: string | null;
  idempotency_key: string;
  attempts: number;
}

export async function createCampaign(params: {
  userId: string;
  subject: string;
  body: string;
  startTime: Date;
  delayBetweenEmailsMs: number;
  hourlyLimit: number;
}): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO campaigns (user_id, subject, body, start_time, delay_between_emails_ms, hourly_limit)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [params.userId, params.subject, params.body, params.startTime, params.delayBetweenEmailsMs, params.hourlyLimit]
  );
  return rows[0].id;
}

/**
 * Inserts one row per recipient, staggered by `delayBetweenEmailsMs` starting at `startTime`.
 * idempotency_key = campaignId:recipient so re-running the same CSV against the same
 * campaign can never create duplicate sends.
 */
export async function createEmailsForCampaign(params: {
  campaignId: string;
  userId: string;
  subject: string;
  body: string;
  recipients: string[];
  startTime: Date;
  delayBetweenEmailsMs: number;
  senderNames: string[];
}): Promise<EmailRow[]> {
  const created: EmailRow[] = [];
  for (let i = 0; i < params.recipients.length; i++) {
    const recipient = params.recipients[i];
    const scheduledTime = new Date(params.startTime.getTime() + i * params.delayBetweenEmailsMs);
    const senderName = params.senderNames[i % params.senderNames.length];
    const idempotencyKey = `${params.campaignId}:${recipient}`;
    const id = uuid();
    const { rows } = await pool.query(
      `INSERT INTO emails (id, campaign_id, user_id, recipient, subject, body, sender_name, scheduled_time, status, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'scheduled',$9)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [id, params.campaignId, params.userId, recipient, params.subject, params.body, senderName, scheduledTime, idempotencyKey]
    );
    if (rows[0]) created.push(rows[0]);
  }
  return created;
}

export async function getEmailById(id: string): Promise<EmailRow | null> {
  const { rows } = await pool.query(`SELECT * FROM emails WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function markQueued(id: string, bullmqJobId: string) {
  await pool.query(`UPDATE emails SET status = 'queued', bullmq_job_id = $2, updated_at = now() WHERE id = $1`, [id, bullmqJobId]);
}

export async function markSent(id: string) {
  await pool.query(`UPDATE emails SET status = 'sent', sent_time = now(), updated_at = now() WHERE id = $1`, [id]);
}

export async function markFailed(id: string, error: string) {
  await pool.query(
    `UPDATE emails SET status = 'failed', error = $2, attempts = attempts + 1, updated_at = now() WHERE id = $1`,
    [id, error]
  );
}

export async function rescheduleEmail(id: string, newTime: Date) {
  await pool.query(`UPDATE emails SET scheduled_time = $2, status = 'scheduled', updated_at = now() WHERE id = $1`, [
    id,
    newTime,
  ]);
}

export async function listScheduledEmails(userId: string) {
  const { rows } = await pool.query(
    `SELECT * FROM emails WHERE user_id = $1 AND status IN ('scheduled','queued') ORDER BY scheduled_time ASC`,
    [userId]
  );
  return rows as EmailRow[];
}

export async function listSentEmails(userId: string) {
  const { rows } = await pool.query(
    `SELECT * FROM emails WHERE user_id = $1 AND status IN ('sent','failed') ORDER BY sent_time DESC NULLS LAST, updated_at DESC`,
    [userId]
  );
  return rows as EmailRow[];
}

/** All rows still pending after a restart - used to re-enqueue BullMQ jobs on boot. */
export async function listPendingEmails(): Promise<EmailRow[]> {
  const { rows } = await pool.query(`SELECT * FROM emails WHERE status IN ('scheduled','queued')`);
  return rows as EmailRow[];
}
