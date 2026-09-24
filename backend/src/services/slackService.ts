import { pool } from "../db/pool";
import { env } from "../config/env";

export interface SlackIntegration {
  access_token: string;
  incoming_webhook_url: string | null;
  team_name: string | null;
}

/** OAuth v2 "authorize" URL the frontend's "Connect Slack" button redirects to. */
export function buildSlackAuthorizeUrl(userId: string): string {
  const params = new URLSearchParams({
    client_id: env.slackClientId,
    scope: "incoming-webhook,chat:write",
    redirect_uri: env.slackRedirectUri,
    state: userId, // ties the callback back to the user who clicked "Connect Slack"
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

/** Exchanges the OAuth `code` for a bot token + incoming webhook, called from the callback route. */
export async function exchangeSlackCode(code: string) {
  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.slackClientId,
      client_secret: env.slackClientSecret,
      code,
      redirect_uri: env.slackRedirectUri,
    }),
  });
  const data = (await res.json()) as any;
  if (!data.ok) {
    throw new Error(`Slack OAuth exchange failed: ${data.error}`);
  }
  return data as {
    access_token: string;
    team: { id: string; name: string };
    bot_user_id: string;
    incoming_webhook?: { url: string; channel: string };
  };
}

export async function saveSlackIntegration(userId: string, data: Awaited<ReturnType<typeof exchangeSlackCode>>) {
  await pool.query(
    `INSERT INTO slack_integrations (user_id, team_id, team_name, access_token, incoming_webhook_url, incoming_webhook_channel, bot_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (user_id) DO UPDATE SET
       team_id = EXCLUDED.team_id,
       team_name = EXCLUDED.team_name,
       access_token = EXCLUDED.access_token,
       incoming_webhook_url = EXCLUDED.incoming_webhook_url,
       incoming_webhook_channel = EXCLUDED.incoming_webhook_channel,
       bot_user_id = EXCLUDED.bot_user_id,
       connected_at = now()`,
    [
      userId,
      data.team.id,
      data.team.name,
      data.access_token,
      data.incoming_webhook?.url ?? null,
      data.incoming_webhook?.channel ?? null,
      data.bot_user_id,
    ]
  );
}

export async function getSlackIntegration(userId: string): Promise<SlackIntegration | null> {
  const { rows } = await pool.query(
    `SELECT access_token, incoming_webhook_url, team_name FROM slack_integrations WHERE user_id = $1`,
    [userId]
  );
  return rows[0] ?? null;
}

export async function disconnectSlack(userId: string) {
  await pool.query(`DELETE FROM slack_integrations WHERE user_id = $1`, [userId]);
}

/**
 * Fires a real Slack message the moment a sender's hourly limit is hit.
 * If the user hasn't connected Slack, this is a no-op (never throws, never crashes the worker).
 */
export async function notifyRateLimitHit(userId: string, senderName: string, limit: number) {
  const integration = await getSlackIntegration(userId);
  if (!integration) return; // not connected - silently skip, per spec

  const text = `:rotating_light: *ReachInbox rate limit hit*\nSender *${senderName}* reached its hourly cap of *${limit}* emails. Remaining emails for this sender have been rescheduled into the next hour window.`;

  try {
    if (integration.incoming_webhook_url) {
      await fetch(integration.incoming_webhook_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
    } else {
      await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${integration.access_token}`,
        },
        body: JSON.stringify({ channel: "#general", text }),
      });
    }
  } catch (err) {
    console.error("Slack notification failed (non-fatal):", err);
  }
}
