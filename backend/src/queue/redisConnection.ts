import IORedis from "ioredis";
import { env } from "../config/env";

// REDIS_URL (used by hosted Redis providers) takes precedence over host/port/password.
export const redisConnection = env.redisUrl
  ? new IORedis(env.redisUrl, { maxRetriesPerRequest: null })
  : new IORedis({
      host: env.redisHost,
      port: env.redisPort,
      password: env.redisPassword,
      maxRetriesPerRequest: null, // required by BullMQ
    });
