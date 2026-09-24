export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string;
}

export type EmailStatus = "scheduled" | "queued" | "sent" | "failed";

export interface EmailRecord {
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
}

export interface ScheduleFormValues {
  subject: string;
  body: string;
  startTime: string;
  delayBetweenEmailsMs: number;
  hourlyLimit: number;
  leadsFile: File | null;
}

export interface ScheduleResponse {
  campaignId: string;
  recipientsDetected: number;
  emailsScheduled: number;
}
