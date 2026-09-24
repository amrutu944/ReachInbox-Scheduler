import { api } from "./client";
import { EmailRecord, ScheduleFormValues, ScheduleResponse } from "../types";

export async function fetchScheduledEmails(): Promise<EmailRecord[]> {
  const { data } = await api.get("/api/emails/scheduled");
  return data.emails;
}

export async function fetchSentEmails(): Promise<EmailRecord[]> {
  const { data } = await api.get("/api/emails/sent");
  return data.emails;
}

export async function scheduleEmails(values: ScheduleFormValues): Promise<ScheduleResponse> {
  const form = new FormData();
  form.append("subject", values.subject);
  form.append("body", values.body);
  form.append("startTime", values.startTime);
  form.append("delayBetweenEmailsMs", String(values.delayBetweenEmailsMs));
  form.append("hourlyLimit", String(values.hourlyLimit));
  if (values.leadsFile) form.append("leadsFile", values.leadsFile);

  const { data } = await api.post("/api/emails/schedule", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}
