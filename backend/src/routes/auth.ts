import { Router } from "express";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { requireAuth, AuthedRequest } from "../middleware/auth";

const router = Router();
const googleClient = new OAuth2Client(env.googleClientId);

/**
 * Real Google OAuth: the frontend uses Google's "Sign in with Google" button
 * (@react-oauth/google) to obtain an ID token, then posts it here. We verify the
 * token's signature/audience with google-auth-library (never trust the client),
 * upsert the user, and set an httpOnly session cookie.
 */
router.post("/google", async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ error: "idToken is required" });

  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience: env.googleClientId });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      return res.status(401).json({ error: "Invalid Google token" });
    }

    const { rows } = await pool.query(
      `INSERT INTO users (google_id, email, name, avatar_url)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (google_id) DO UPDATE SET name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url
       RETURNING id, email, name, avatar_url`,
      [payload.sub, payload.email, payload.name ?? "", payload.picture ?? ""]
    );
    const user = rows[0];

    const session = jwt.sign(
      { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatar_url },
      env.jwtSecret,
      { expiresIn: "7d" }
    );

    res.cookie("session", session, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 3600 * 1000,
    });

    res.json({ user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatar_url } });
  } catch (err: any) {
    console.error("Google auth failed:", err);
    res.status(401).json({ error: "Google authentication failed" });
  }
});

router.post("/dev-login", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (google_id, email, name, avatar_url)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (google_id) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, email, name, avatar_url`,
      ["demo-user-local", "demo@reachinbox.ai", "Demo User", ""]
    );
    const user = rows[0];

    const session = jwt.sign(
      { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatar_url },
      env.jwtSecret,
      { expiresIn: "7d" }
    );

    res.cookie("session", session, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 3600 * 1000,
    });

    res.json({ user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatar_url } });
  } catch (err: any) {
    console.error("Dev login failed:", err);
    res.status(500).json({ error: "Failed to login as demo user" });
  }
});

router.get("/me", requireAuth, (req: AuthedRequest, res) => {
  res.json({ user: req.user });
});

router.post("/logout", (req, res) => {
  res.clearCookie("session");
  res.json({ ok: true });
});

export default router;
