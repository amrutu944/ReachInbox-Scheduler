import fs from "fs";
import path from "path";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";

import { env } from "./config/env";
import { emailQueue } from "./queue/emailQueue";
import { redisConnection } from "./queue/redisConnection";
import { recoverPendingEmailsOnBoot } from "./queue/recover";
import { ensureIndex } from "./search/elasticClient";
import { pool } from "./db/pool";

import authRoutes from "./routes/auth";
import emailRoutes from "./routes/emails";
import slackRoutes from "./routes/slack";

const app = express();
app.set("trust proxy", 1); // behind the hosting provider's TLS proxy - needed for secure cookies

// Built React SPA (frontend/dist). When present, the API serves it from the same origin.
const frontendDist = path.resolve(__dirname, "../../frontend/dist");
const serveFrontend = fs.existsSync(path.join(frontendDist, "index.html"));

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || origin === env.frontendUrl || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json());

// Live BullMQ dashboard for real-time queue visibility - http://localhost:4000/admin/queues
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");
createBullBoard({
  queues: [new BullMQAdapter(emailQueue) as any],
  serverAdapter,
});
app.use("/admin/queues", serverAdapter.getRouter());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/", (_req, res, next) => {
  if (serveFrontend) return next();
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>ReachInbox Scheduler Backend</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0f172a; color: #f8fafc; padding: 3rem 1rem; display: flex; justify-content: center; }
          .card { background: #1e293b; border-radius: 16px; border: 1px solid #334155; max-width: 580px; width: 100%; padding: 2rem; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5); }
          h1 { margin-top: 0; font-size: 1.5rem; display: flex; align-items: center; justify-content: space-between; }
          .badge { background: #065f46; color: #34d399; font-size: 0.75rem; padding: 4px 10px; border-radius: 9999px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
          p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; }
          .links { display: flex; flex-direction: column; gap: 12px; margin-top: 1.5rem; }
          .link-card { display: block; padding: 14px 16px; background: #334155; border-radius: 10px; text-decoration: none; color: #f8fafc; transition: all 0.2s; border: 1px solid transparent; }
          .link-card:hover { background: #475569; border-color: #6366f1; transform: translateY(-1px); }
          .link-title { font-weight: 600; color: #818cf8; margin-bottom: 2px; }
          .link-desc { font-size: 0.85rem; color: #94a3b8; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1><span>ReachInbox Scheduler API</span> <span class="badge">Online</span></h1>
          <p>The backend server and BullMQ queue system are running.</p>
          <div class="links">
            <a class="link-card" href="http://localhost:5174" target="_blank">
              <div class="link-title">Frontend Dashboard &rarr;</div>
              <div class="link-desc">Open the React user interface on port 5174</div>
            </a>
            <a class="link-card" href="/admin/queues" target="_blank">
              <div class="link-title">BullMQ Queue Dashboard &rarr;</div>
              <div class="link-desc">Monitor live email queue jobs and rates on /admin/queues</div>
            </a>
            <a class="link-card" href="/health" target="_blank">
              <div class="link-title">Health Check (/health) &rarr;</div>
              <div class="link-desc">Quick JSON ping to verify server responsiveness</div>
            </a>
          </div>
        </div>
      </body>
    </html>
  `);
});

app.use("/api/auth", authRoutes);
app.use("/api/emails", emailRoutes);
app.use("/api/slack", slackRoutes);

if (serveFrontend) {
  app.use(express.static(frontendDist));
  // SPA fallback: any non-API GET renders index.html so client-side routes work on refresh.
  app.get(/^\/(?!api\/|admin\/).*/, (_req, res) => res.sendFile(path.join(frontendDist, "index.html")));
}

async function applySchema() {
  const schemaPath = [path.join(__dirname, "db/schema.sql"), path.resolve(__dirname, "../src/db/schema.sql")].find(
    fs.existsSync
  );
  if (!schemaPath) return;
  await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
  await pool.query(fs.readFileSync(schemaPath, "utf-8"));
  console.log("[db] schema applied");
}

async function main() {
  await applySchema();

  if (env.runWorkerInApi) {
    await import("./queue/worker");
  }

  await ensureIndex().catch(() => {
    console.log("[search] Elasticsearch offline (search index skipped, continuing with Postgres)");
  });

  try {
    // Quick check if Redis is accessible before attempting recovery
    const pingPromise = redisConnection.ping();
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1500));
    await Promise.race([pingPromise, timeoutPromise]);
    await recoverPendingEmailsOnBoot();
  } catch (err) {
    console.warn(`[redis] Warning: Redis is not reachable at ${env.redisHost}:${env.redisPort}. Pending email recovery skipped. (Please start Redis)`);
  }

  app.listen(env.port, () => {
    console.log(`ReachInbox scheduler API listening on http://localhost:${env.port}`);
    console.log(`BullMQ dashboard: http://localhost:${env.port}/admin/queues`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
