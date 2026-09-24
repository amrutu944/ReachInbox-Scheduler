import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { api, API_URL } from "../api/client";
import { Button } from "./Button";

export function SlackConnectCard() {
  const [connected, setConnected] = useState(false);
  const [teamName, setTeamName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const { data } = await api.get("/api/slack/status");
      setConnected(data.connected);
      setTeamName(data.teamName);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function disconnect() {
    await api.post("/api/slack/disconnect");
    toast.success("Slack disconnected");
    refresh();
  }

  async function connectDemo() {
    try {
      await api.post("/api/slack/dev-connect");
      toast.success("Connected to Demo Slack Workspace!");
      refresh();
    } catch {
      toast.error("Failed to connect demo Slack");
    }
  }

  if (loading) return null;

  return (
    <div className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-3">
      <div>
        <p className="text-sm font-medium">Slack notifications</p>
        <p className="text-xs text-gray-500">
          {connected ? `Connected to ${teamName ?? "your workspace"}` : "Get notified in Slack when an hourly rate limit is hit"}
        </p>
      </div>
      {connected ? (
        <Button variant="secondary" onClick={disconnect}>
          Disconnect
        </Button>
      ) : (
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={connectDemo}>
            Demo Connect
          </Button>
          <a href={`${API_URL}/api/slack/oauth/authorize`}>
            <Button>Connect Slack</Button>
          </a>
        </div>
      )}
    </div>
  );
}
