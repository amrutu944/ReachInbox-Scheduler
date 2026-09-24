import { Router } from "express";
import multer from "multer";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { createCampaign, createEmailsForCampaign, listScheduledEmails, listSentEmails } from "../db/emailModel";
import { enqueueEmailJob } from "../queue/emailQueue";
import { markQueued } from "../db/emailModel";
import { indexEmail } from "../search/elasticClient";
import { listSenders } from "../services/mailer";
import { searchEmails } from "../search/elasticClient";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function parseRecipients(fileBuffer: Buffer): string[] {
  const text = fileBuffer.toString("utf-8");
  const emailRegex = /[^\s,;<>()"]+@[^\s,;<>()"]+\.[^\s,;<>()"]+/g;
  const matches = text.match(emailRegex) ?? [];
  return [...new Set(matches.map((e) => e.trim().toLowerCase()))];
}

/**
 * POST /api/emails/schedule
 * multipart/form-data: subject, body, startTime (ISO), delayBetweenEmailsMs, hourlyLimit, leadsFile (csv/txt)
 */
router.post("/schedule", requireAuth, upload.single("leadsFile"), async (req: AuthedRequest, res) => {
  try {
    const { subject, body, startTime, delayBetweenEmailsMs, hourlyLimit } = req.body;
    if (!subject || !body || !startTime || !req.file) {
      return res.status(400).json({ error: "subject, body, startTime and leadsFile are required" });
    }

    const recipients = parseRecipients(req.file.buffer);
    if (recipients.length === 0) {
      return res.status(400).json({ error: "No valid email addresses found in the uploaded file" });
    }

    const delay = parseInt(delayBetweenEmailsMs, 10) || 2000;
    const hourly = parseInt(hourlyLimit, 10) || 200;
    const start = new Date(startTime);

    const campaignId = await createCampaign({
      userId: req.user!.id,
      subject,
      body,
      startTime: start,
      delayBetweenEmailsMs: delay,
      hourlyLimit: hourly,
    });

    const senderNames = listSenders().map((s) => s.name);
    if (senderNames.length === 0) {
      return res.status(500).json({ error: "No Ethereal senders configured on the server" });
    }

    const emails = await createEmailsForCampaign({
      campaignId,
      userId: req.user!.id,
      subject,
      body,
      recipients,
      startTime: start,
      delayBetweenEmailsMs: delay,
      senderNames,
    });

    // Enqueue BullMQ delayed jobs (no cron) - one per email, timed by scheduled_time.
    for (const email of emails) {
      await enqueueEmailJob(email.id, new Date(email.scheduled_time).getTime());
      await markQueued(email.id, email.id);
      await indexEmail({
        id: email.id,
        userId: email.user_id,
        recipient: email.recipient,
        subject: email.subject,
        body: email.body,
        status: "scheduled",
        senderName: email.sender_name,
        scheduledTime: email.scheduled_time,
      });
    }

    res.status(201).json({
      campaignId,
      recipientsDetected: recipients.length,
      emailsScheduled: emails.length,
    });
  } catch (err: any) {
    console.error("Schedule failed:", err);
    res.status(500).json({ error: err.message ?? "Failed to schedule emails" });
  }
});

router.get("/scheduled", requireAuth, async (req: AuthedRequest, res) => {
  const rows = await listScheduledEmails(req.user!.id);
  res.json({ emails: rows });
});

router.get("/sent", requireAuth, async (req: AuthedRequest, res) => {
  const rows = await listSentEmails(req.user!.id);
  res.json({ emails: rows });
});

/** GET /api/emails/search?q=... - full-text search across scheduled + sent emails via Elasticsearch. */
router.get("/search", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const q = (req.query.q as string) ?? "";
    const hits = await searchEmails(req.user!.id, q);
    res.json({ results: hits });
  } catch (err: any) {
    console.error("Search failed:", err);
    res.status(500).json({ error: "Search is temporarily unavailable" });
  }
});

export default router;
