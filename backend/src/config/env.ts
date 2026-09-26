import dotenv from "dotenv";
dotenv.config();

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

export interface EtherealSenderConfig {
  name: string;
  user: string;
  pass: string;
}

function parseSenders(): EtherealSenderConfig[] {
  const raw = process.env.ETHEREAL_SENDERS ?? "[]";
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export const env = {
  port: parseInt(process.env.PORT ?? "4000", 10),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173",

  databaseUrl: required("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/reachinbox"),

  redisUrl: process.env.REDIS_URL || undefined,
  redisHost: process.env.REDIS_HOST ?? "localhost",
  redisPort: parseInt(process.env.REDIS_PORT ?? "6379", 10),
  redisPassword: process.env.REDIS_PASSWORD || undefined,

  esNode: process.env.ELASTICSEARCH_NODE ?? "http://localhost:9200",
  esIndex: process.env.ELASTICSEARCH_INDEX ?? "reachinbox-emails",

  etherealSenders: parseSenders(),

  workerConcurrency: parseInt(process.env.WORKER_CONCURRENCY ?? "5", 10),
  minDelayBetweenEmailsMs: parseInt(process.env.MIN_DELAY_BETWEEN_EMAILS_MS ?? "2000", 10),
  maxEmailsPerHourPerSender: parseInt(process.env.MAX_EMAILS_PER_HOUR_PER_SENDER ?? "200", 10),

  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-change-me",

  // Run the BullMQ worker inside the API process (single-service deploys).
  runWorkerInApi: process.env.RUN_WORKER_IN_API === "true",

  slackClientId: process.env.SLACK_CLIENT_ID ?? "",
  slackClientSecret: process.env.SLACK_CLIENT_SECRET ?? "",
  slackRedirectUri: process.env.SLACK_REDIRECT_URI ?? "http://localhost:4000/api/slack/oauth/callback",
};
