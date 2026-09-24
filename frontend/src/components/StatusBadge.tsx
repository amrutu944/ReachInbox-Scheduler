import { EmailStatus } from "../types";

const styles: Record<EmailStatus, string> = {
  scheduled: "bg-blue-100 text-blue-700",
  queued: "bg-amber-100 text-amber-700",
  sent: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

export function StatusBadge({ status }: { status: EmailStatus }) {
  return (
    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${styles[status]}`}>
      {status}
    </span>
  );
}
