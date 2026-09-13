import Redis from "ioredis";
import { config } from "@asm/config";

/** One connection per process — shared by rate limiting and admin sessions. */
export const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2 });
