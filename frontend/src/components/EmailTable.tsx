import { EmailRecord } from "../types";
import { StatusBadge } from "./StatusBadge";
import { EmptyState } from "./EmptyState";
import { Spinner } from "./Spinner";

interface Column {
  key: "recipient" | "subject" | "scheduled_time" | "sent_time" | "status";
  label: string;
}

export function EmailTable({
  emails,
  loading,
  columns,
  emptyTitle,
  emptySubtitle,
}: {
  emails: EmailRecord[];
  loading: boolean;
  columns: Column[];
  emptyTitle: string;
  emptySubtitle: string;
}) {
  if (loading) return <Spinner label="Fetching emails..." />;
  if (emails.length === 0) return <EmptyState title={emptyTitle} subtitle={emptySubtitle} />;

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-gray-500 uppercase text-xs tracking-wide">
          <tr>
            {columns.map((col) => (
              <th key={col.key} className="text-left px-4 py-3 font-medium">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {emails.map((email) => (
            <tr key={email.id} className="hover:bg-gray-50">
              {columns.map((col) => (
                <td key={col.key} className="px-4 py-3 text-gray-700 whitespace-nowrap">
                  {renderCell(email, col.key)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderCell(email: EmailRecord, key: Column["key"]) {
  if (key === "status") return <StatusBadge status={email.status} />;
  if (key === "scheduled_time" || key === "sent_time") {
    const value = email[key];
    return value ? new Date(value).toLocaleString() : "—";
  }
  return email[key];
}
