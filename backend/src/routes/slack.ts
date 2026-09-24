import { Router } from "express";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { buildSlackAuthorizeUrl, exchangeSlackCode, saveSlackIntegration, getSlackIntegration, disconnectSlack } from "../services/slackService";
import { env } from "../config/env";

const router = Router();

router.get("/status", requireAuth, async (req: AuthedRequest, res) => {
  const integration = await getSlackIntegration(req.user!.id);
  res.json({ connected: !!integration, teamName: integration?.team_name ?? null });
});

/** "Connect Slack" button hits this - redirects the browser into Slack's real OAuth consent screen. */
router.get("/oauth/authorize", requireAuth, (req: AuthedRequest, res) => {
  if (!env.slackClientId) {
    return res.redirect(`${env.frontendUrl}/dashboard?slack=not_configured`);
  }
  res.redirect(buildSlackAuthorizeUrl(req.user!.id));
});

/** Quick simulated Slack connection for local demo/testing without needing Slack OAuth credentials */
router.post("/dev-connect", requireAuth, async (req: AuthedRequest, res) => {
  try {
    await saveSlackIntegration(req.user!.id, {
      access_token: "xoxb-demo-mock-token",
      team: { id: "T_DEMO_TEAM", name: "ReachInbox Demo Workspace" },
      bot_user_id: "U_DEMO_BOT",
      incoming_webhook: {
        url: "https://httpbin.org/post",
        channel: "#rate-limit-alerts",
      },
    });
    res.json({ ok: true, teamName: "ReachInbox Demo Workspace" });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Failed to connect demo Slack" });
  }
});

/** Slack redirects back here with ?code=...&state=<userId>. */
router.get("/oauth/callback", async (req, res) => {
  const { code, state } = req.query as { code?: string; state?: string };
  if (!code || !state) {
    return res.redirect(`${env.frontendUrl}/dashboard?slack=error`);
  }
  try {
    const data = await exchangeSlackCode(code);
    await saveSlackIntegration(state, data);
    res.redirect(`${env.frontendUrl}/dashboard?slack=connected`);
  } catch (err) {
    console.error("Slack OAuth callback failed:", err);
    res.redirect(`${env.frontendUrl}/dashboard?slack=error`);
  }
});

router.post("/disconnect", requireAuth, async (req: AuthedRequest, res) => {
  await disconnectSlack(req.user!.id);
  res.json({ ok: true });
});

export default router;
