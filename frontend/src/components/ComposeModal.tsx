import { useState } from "react";
import toast from "react-hot-toast";
import { Button } from "./Button";
import { scheduleEmails } from "../api/emails";
import { ScheduleFormValues } from "../types";

export function ComposeModal({ onClose, onScheduled }: { onClose: () => void; onScheduled: () => void }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [startTime, setStartTime] = useState("");
  const [delayMs, setDelayMs] = useState(2000);
  const [hourlyLimit, setHourlyLimit] = useState(200);
  const [file, setFile] = useState<File | null>(null);
  const [detectedCount, setDetectedCount] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleFile(f: File | null) {
    setFile(f);
    setDetectedCount(null);
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const matches = text.match(/[^\s,;<>()"]+@[^\s,;<>()"]+\.[^\s,;<>()"]+/g) ?? [];
      setDetectedCount(new Set(matches.map((m) => m.toLowerCase())).size);
    };
    reader.readAsText(f);
  }

  async function handleSubmit() {
    if (!subject || !body || !startTime || !file) {
      toast.error("Subject, body, start time and a leads file are all required");
      return;
    }
    setSubmitting(true);
    try {
      const values: ScheduleFormValues = {
        subject,
        body,
        startTime,
        delayBetweenEmailsMs: delayMs,
        hourlyLimit,
        leadsFile: file,
      };
      const res = await scheduleEmails(values);
      toast.success(`Scheduled ${res.emailsScheduled} emails (${res.recipientsDetected} leads detected)`);
      onScheduled();
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? "Failed to schedule emails");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-lg">Compose New Email</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">
            &times;
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700">Subject</label>
            <input
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Quick question about your growth stack"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">Body</label>
            <textarea
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm h-28 focus:outline-none focus:ring-2 focus:ring-brand-500"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Hi {{name}}, ..."
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">Upload leads (CSV/TXT)</label>
            <input
              type="file"
              accept=".csv,.txt"
              className="mt-1 w-full text-sm"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
            {detectedCount !== null && (
              <p className="text-xs text-gray-500 mt-1">{detectedCount} email address(es) detected</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Start time</label>
              <input
                type="datetime-local"
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Delay between emails (ms)</label>
              <input
                type="number"
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={delayMs}
                onChange={(e) => setDelayMs(Number(e.target.value))}
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">Hourly limit (per sender)</label>
            <input
              type="number"
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={hourlyLimit}
              onChange={(e) => setHourlyLimit(Number(e.target.value))}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Scheduling..." : "Schedule"}
          </Button>
        </div>
      </div>
    </div>
  );
}
