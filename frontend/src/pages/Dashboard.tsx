import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import { Header } from "../components/Header";
import { Tabs } from "../components/Tabs";
import { Button } from "../components/Button";
import { EmailTable } from "../components/EmailTable";
import { ComposeModal } from "../components/ComposeModal";
import { SlackConnectCard } from "../components/SlackConnectCard";
import { fetchScheduledEmails, fetchSentEmails } from "../api/emails";
import { EmailRecord } from "../types";

export function Dashboard() {
  const [tab, setTab] = useState<"scheduled" | "sent">("scheduled");
  const [scheduled, setScheduled] = useState<EmailRecord[]>([]);
  const [sent, setSent] = useState<EmailRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [composeOpen, setComposeOpen] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [s, sn] = await Promise.all([fetchScheduledEmails(), fetchSentEmails()]);
      setScheduled(s);
      setSent(sn);
    } catch {
      toast.error("Could not load emails from the server");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 15000); // poll so sent/scheduled stay fresh as the worker sends emails
    return () => clearInterval(interval);
  }, [loadData]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const slack = params.get("slack");
    if (slack === "connected") {
      toast.success("Slack connected successfully!");
      window.history.replaceState({}, "", "/dashboard");
    } else if (slack === "not_configured") {
      toast.error("Slack credentials not set in backend/.env. Click 'Demo Connect' to test!");
      window.history.replaceState({}, "", "/dashboard");
    } else if (slack === "error") {
      toast.error("Slack authentication failed.");
      window.history.replaceState({}, "", "/dashboard");
    }
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <SlackConnectCard />

        <div className="flex items-center justify-between">
          <Tabs
            active={tab}
            onChange={(k) => setTab(k as "scheduled" | "sent")}
            tabs={[
              { key: "scheduled", label: `Scheduled Emails (${scheduled.length})` },
              { key: "sent", label: `Sent Emails (${sent.length})` },
            ]}
          />
          <Button onClick={() => setComposeOpen(true)}>+ Compose New Email</Button>
        </div>

        {tab === "scheduled" ? (
          <EmailTable
            emails={scheduled}
            loading={loading}
            columns={[
              { key: "recipient", label: "Email" },
              { key: "subject", label: "Subject" },
              { key: "scheduled_time", label: "Scheduled time" },
              { key: "status", label: "Status" },
            ]}
            emptyTitle="No scheduled emails yet"
            emptySubtitle="Click “Compose New Email” to schedule your first campaign."
          />
        ) : (
          <EmailTable
            emails={sent}
            loading={loading}
            columns={[
              { key: "recipient", label: "Email" },
              { key: "subject", label: "Subject" },
              { key: "sent_time", label: "Sent time" },
              { key: "status", label: "Status" },
            ]}
            emptyTitle="No sent emails yet"
            emptySubtitle="Once your scheduled emails go out, they'll show up here."
          />
        )}
      </main>

      {composeOpen && <ComposeModal onClose={() => setComposeOpen(false)} onScheduled={loadData} />}
    </div>
  );
}
