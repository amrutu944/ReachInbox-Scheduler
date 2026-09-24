# ReachInbox — Email Job Scheduler (Full-Stack Assignment)

A production-shaped email scheduler: schedule cold-email campaigns from a React dashboard, persist them in Postgres, run them as **BullMQ delayed jobs** on Redis (no cron, anywhere), send via **Ethereal SMTP**, enforce per-sender hourly rate limits with **live Slack alerts**, and make every email **searchable in Elasticsearch**. Includes a live **Bull Board** queue dashboard and survives full server restarts without re-sending or losing jobs.

---

## 1. Architecture Overview

```
┌─────────────┐        ┌──────────────────┐        ┌─────────────┐
│  React SPA   │  HTTP  │   Express API    │  SQL   │  PostgreSQL │
│ (Vite + TS)  │◄──────►│  (backend/src)   │◄──────►│  (source of │
└─────────────┘        │                  │        │   truth)    │
                        │  - auth (Google) │        └─────────────┘
                        │  - /api/emails   │
                        │  - /api/slack    │        ┌─────────────┐
                        │  - Bull Board UI │◄──────►│    Redis    │
                        └─────────┬────────┘        │  (BullMQ +  │
                                  │ enqueue          │  rate limit │
                                  │ delayed job      │  counters)  │
                                  ▼                  └──────┬──────┘
                        ┌──────────────────┐               │
                        │  BullMQ Worker    │◄──────────────┘
                        │ (backend/src/     │
                        │  queue/worker.ts) │
                        │  - concurrency N  │        ┌─────────────┐
                        │  - min-delay      │───────►│  Ethereal   │
                        │    limiter        │  SMTP  │  SMTP (fake)│
                        │  - per-sender     │        └─────────────┘
                        │    hourly cap     │
                        │  - Slack alert    │        ┌─────────────┐
                        │  - ES indexing    │───────►│Elasticsearch│
                        └──────────────────┘        └─────────────┘
```

### How scheduling works (no cron, anywhere)
1. `POST /api/emails/schedule` parses the uploaded leads file, writes **one row per recipient** into the `emails` table (Postgres = source of truth), then calls `enqueueEmailJob()` for each row.
2. `enqueueEmailJob` adds a **BullMQ delayed job** (`queue.add(name, data, { delay, jobId })`) — the job simply won't be picked up by any worker until `scheduled_time` arrives. This is BullMQ's native delayed-job mechanism, backed by a Redis sorted set — not a cron poller.
3. The **jobId is the email's own UUID**. BullMQ refuses to create a second job with an id that already exists, so re-running the schedule endpoint (or the boot-time recovery routine below) against the same email row can never create a duplicate job — this is the idempotency guarantee.

### How persistence on restart is handled
- Postgres holds every email's `status` (`scheduled` → `queued` → `sent`/`failed`) and `scheduled_time`. Redis/BullMQ only holds the *timer*.
- On boot, `queue/recover.ts` (`recoverPendingEmailsOnBoot`, called from `src/index.ts`) loads every row still in `scheduled`/`queued` state and re-adds a BullMQ job for any of them that isn't already present in Redis (checked via `queue.getJob(id)`).
- If the server crashes, or Redis is flushed entirely, or a job's delay elapses while every worker is down, this recovery pass rebuilds every missing timer from Postgres on the next boot — future emails still fire at the correct time and nothing is re-sent, because the worker checks `email.status === 'sent'` before sending and BullMQ's own jobId de-dupe prevents doubled jobs.

### How rate limiting & concurrency are implemented
- **Concurrency**: `WORKER_CONCURRENCY` env var is passed straight into `new Worker(name, processor, { concurrency })`. Multiple jobs run in parallel up to that number.
- **Min delay between sends**: BullMQ's built-in worker `limiter: { max: 1, duration: MIN_DELAY_BETWEEN_EMAILS_MS }` — the worker will not pull more than 1 job per that window, globally, across all its concurrent slots. Default: **2000ms (2s) between sends**.
- **Emails per hour, per sender**: enforced with a **Redis counter keyed by `sender + hour-bucket`** (`services/rateLimiter.ts`), incremented atomically (`INCR`) with an expiry so old buckets clean themselves up. This is safe across multiple worker processes/instances because the counter lives in Redis, not in worker memory.
  - When a sender's bucket is full, the job is **not failed or dropped** — the worker calls `job.moveToDelayed(nextHourStart, token)` and throws BullMQ's `DelayedError`, which re-queues the job for the next hour window while preserving its place in the queue.
  - The moment the cap is hit, `notifyRateLimitHit()` fires a **real Slack message** (see below).
- **1000+ emails scheduled at once**: each recipient gets its own row + its own delayed BullMQ job, staggered by `delayBetweenEmailsMs` starting at the campaign's start time. The worker's concurrency + limiter + per-sender hourly cap naturally throttle throughput no matter how many jobs land in the same minute — excess jobs simply wait in the delayed/rate-limited state instead of being dropped.

### Real Google OAuth
The frontend uses `@react-oauth/google`'s official Google Identity Services button. On success it POSTs the returned Google **ID token** to `/api/auth/google`, which verifies the signature + audience server-side with `google-auth-library` (never trusts the client), upserts the user, and sets an httpOnly session cookie (JWT).

### Real Slack OAuth + live notification
"Connect Slack" hits `GET /api/slack/oauth/authorize`, which redirects the browser into Slack's actual OAuth v2 consent screen (`https://slack.com/oauth/v2/authorize`). Slack redirects back to `/api/slack/oauth/callback?code=...&state=<userId>`, which exchanges the code for a bot token / incoming webhook via `oauth.v2.access` and stores it per-user in `slack_integrations`. The rate-limit hook (`worker.ts`) calls `notifyRateLimitHit()`, which posts a real message via the stored incoming webhook (or `chat.postMessage`). If the user never connected Slack, this is a no-op — no crash, no log spam. If they connect later, the very next rate-limit hit notifies them, no redeploy needed, because the check reads straight from Postgres on every hit.

### Elasticsearch search
Every scheduled/sent/failed email is indexed (`search/elasticClient.ts`) with the same document id as its Postgres row (so ES stays a projection, never a second source of truth). `GET /api/emails/search?q=...` does a `multi_match` across recipient/subject/body, scoped to the logged-in user.

---

## 2. Features implemented

**Backend**
- [x] REST API to schedule emails (multipart upload of a CSV/TXT leads file)
- [x] Postgres schema (`users`, `campaigns`, `emails`, `slack_integrations`) — see `backend/src/db/schema.sql`
- [x] BullMQ delayed jobs, keyed by email UUID (idempotent, no cron anywhere)
- [x] Boot-time recovery pass that rebuilds missing BullMQ jobs from Postgres after a restart
- [x] Ethereal SMTP sending with multiple round-robin senders
- [x] Configurable worker concurrency
- [x] Configurable minimum delay between sends (BullMQ limiter)
- [x] Configurable, Redis-backed, per-sender emails-per-hour cap that reschedules (never drops) overflow
- [x] Live Bull Board dashboard at `/admin/queues`
- [x] Elasticsearch indexing + search endpoint
- [x] Real Google OAuth (ID token verification), httpOnly session cookie
- [x] Real Slack OAuth (Connect/disconnect), live webhook/API notification on rate-limit hit

**Frontend**
- [x] Google login → redirect to dashboard, header shows name/email/avatar, logout
- [x] Tabs for Scheduled / Sent emails with counts
- [x] "Compose New Email" modal: subject, body, CSV/TXT upload with live detected-address count, start time, delay, hourly limit
- [x] Scheduled + Sent tables with loading and empty states
- [x] "Connect Slack" card with connect/disconnect and live status
- [x] Toast-based error handling
- [x] Typed API layer + typed props throughout (`frontend/src/types`)
- [x] Polling refresh so the dashboard reflects the worker sending emails in near real time

---

## 3. Project structure

```
reachinbox-scheduler/
├── docker-compose.yml        # Postgres + Redis + Elasticsearch
├── sample-leads.csv          # sample file for the "Compose" upload
├── backend/
│   ├── src/
│   │   ├── config/env.ts
│   │   ├── db/               # pool, schema.sql, migrate.ts, emailModel.ts
│   │   ├── queue/            # emailQueue.ts, worker.ts, recover.ts, redisConnection.ts
│   │   ├── services/         # mailer.ts (Ethereal), rateLimiter.ts, slackService.ts
│   │   ├── search/           # elasticClient.ts
│   │   ├── routes/           # auth.ts, emails.ts, slack.ts
│   │   ├── middleware/auth.ts
│   │   └── index.ts
│   └── .env.example
└── frontend/
    ├── src/
    │   ├── api/               # client.ts, emails.ts
    │   ├── components/        # Button, Tabs, EmailTable, ComposeModal, Header, SlackConnectCard, ...
    │   ├── context/AuthContext.tsx
    │   ├── pages/              # Login.tsx, Dashboard.tsx
    │   ├── types/index.ts
    │   └── App.tsx / main.tsx
    └── .env.example
```

---

## 4. Setup & running

### Prerequisites
- Node.js 18+
- Docker (recommended) — or your own local Postgres 14+, Redis 6+, Elasticsearch 8+

### Step 1 — Start infrastructure
```bash
docker compose up -d          # Postgres :5432, Redis :6379, Elasticsearch :9200
```

### Step 2 — Ethereal Email (fake SMTP) accounts
1. Go to https://ethereal.email/create and generate one or more test accounts (name, user, pass).
2. Put them into `backend/.env` as a JSON array under `ETHEREAL_SENDERS`, e.g.:
   ```
   ETHEREAL_SENDERS=[{"name":"sender-one","user":"xxx@ethereal.email","pass":"xxx"}]
   ```
3. Every "sent" email logs a preview URL (`https://ethereal.email/message/...`) in the worker's console — open it to see the actual rendered email.

### Step 3 — Google OAuth
1. Create an OAuth 2.0 Client ID (Web application) at https://console.cloud.google.com/apis/credentials.
2. Add `http://localhost:5173` to Authorized JavaScript origins.
3. Put the client id in **both** `backend/.env` (`GOOGLE_CLIENT_ID`) and `frontend/.env` (`VITE_GOOGLE_CLIENT_ID`).

### Step 4 — Slack OAuth (optional but implemented)
1. Create an app at https://api.slack.com/apps → "OAuth & Permissions".
2. Add redirect URL `http://localhost:4000/api/slack/oauth/callback`.
3. Add scopes `incoming-webhook` and `chat:write`.
4. Copy Client ID / Client Secret into `backend/.env`.

### Step 5 — Backend
```bash
cd backend
cp .env.example .env       # fill in the values from steps 1-4
npm install
npm run migrate            # creates tables in Postgres
npm run dev                # starts the Express API on :4000
```
In a **second terminal**, start the worker (kept separate from the API on purpose, so you can scale/restart them independently):
```bash
cd backend
npm run worker
```

### Step 6 — Frontend
```bash
cd frontend
cp .env.example .env       # set VITE_GOOGLE_CLIENT_ID
npm install
npm run dev                # http://localhost:5173
```

### Step 7 — Try it
1. Open http://localhost:5173, sign in with Google.
2. (Optional) Click "Connect Slack".
3. Click "Compose New Email", upload `sample-leads.csv`, set a start time a minute or two in the future, and hit Schedule.
4. Watch the **Scheduled** tab, then watch rows move to **Sent** once their time arrives.
5. Check the live queue at http://localhost:4000/admin/queues.
6. **Restart test**: stop both the API and worker (Ctrl+C), wait past when an email should send, restart both — the recovery log line (`[recover] N pending emails found, M BullMQ jobs re-created`) confirms nothing was lost, and the email still sends at (or shortly after) its scheduled time instead of being skipped or re-sent from scratch.

---

## 5. Assumptions, shortcuts & trade-offs

- Rate limiting is enforced **per sender name**, not per-tenant; with one user this is equivalent, but multi-tenant fairness across senders shared by different users isn't isolated further.
- The CSV parser is intentionally permissive — it extracts any email-shaped token from the uploaded file rather than requiring a strict `email` column, so both a one-column list and a multi-column CSV work.
- Bull Board is left unauthenticated for local/demo purposes; in production it should sit behind the same session auth as the rest of the API.
- Elasticsearch indexing failures are logged and swallowed rather than failing the send — search is a nice-to-have on top of Postgres, which stays authoritative.
- No automated test suite is included given the time box; the restart/idempotency guarantees were validated manually (see Step 7's restart test).
