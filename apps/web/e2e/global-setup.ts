import { mkdirSync } from "node:fs";
import { request, type FullConfig } from "@playwright/test";
import { prisma } from "@asm/db";
import { VIEWER_EMAIL, VIEWER_PASSWORD, cleanup, seedLeaderboard } from "./seed";

/** Fresh fixtures, then a signed-in viewer whose cookie every test reuses. */
export default async function globalSetup(config: FullConfig): Promise<void> {
  // The suite writes and deletes rows: never let it near a shared database.
  const host = new URL(process.env.DATABASE_URL ?? "postgres://missing").hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(`refusing to seed e2e fixtures into non-local database host "${host}"`);
  }
  const baseURL = config.projects[0]!.use.baseURL!;
  await cleanup();
  await seedLeaderboard();

  const api = await request.newContext({ baseURL });
  const res = await api.post("/api/auth/register", {
    data: { name: "E2E Viewer", email: VIEWER_EMAIL, password: VIEWER_PASSWORD },
  });
  if (!res.ok()) throw new Error(`register failed: ${res.status()} ${await res.text()}`);
  mkdirSync("e2e/.auth", { recursive: true });
  await api.storageState({ path: "e2e/.auth/viewer.json" });
  await api.dispose();
  await prisma.$disconnect();
}
