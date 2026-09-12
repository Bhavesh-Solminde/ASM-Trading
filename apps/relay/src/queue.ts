import * as SQLite from "expo-sqlite";
import type { QueuedMessage } from "./types";

let db: SQLite.SQLiteDatabase | null = null;

export async function openQueue(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;

  db = await SQLite.openDatabaseAsync("relay-outbox.db");
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS outbox (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      sender        TEXT    NOT NULL,
      body          TEXT    NOT NULL,
      receivedAt    INTEGER NOT NULL,
      attempts      INTEGER NOT NULL DEFAULT 0,
      nextAttemptAt INTEGER NOT NULL DEFAULT 0,
      sentAt        INTEGER
    );
    CREATE INDEX IF NOT EXISTS outbox_due
      ON outbox (sentAt, nextAttemptAt);
  `);
  return db;
}

export async function enqueue(
  sender: string,
  body: string,
  receivedAt: number,
): Promise<void> {
  const database = await openQueue();
  await database.runAsync(
    "INSERT INTO outbox (sender, body, receivedAt, nextAttemptAt) VALUES (?, ?, ?, ?)",
    sender,
    body,
    receivedAt,
    Date.now(),
  );
}

export async function dueMessages(limit: number): Promise<QueuedMessage[]> {
  const database = await openQueue();
  return database.getAllAsync<QueuedMessage>(
    `SELECT id, sender, body, receivedAt, attempts, nextAttemptAt
       FROM outbox
      WHERE sentAt IS NULL AND nextAttemptAt <= ?
      ORDER BY receivedAt ASC
      LIMIT ?`,
    Date.now(),
    limit,
  );
}

export async function markSent(id: number): Promise<void> {
  const database = await openQueue();
  await database.runAsync("UPDATE outbox SET sentAt = ? WHERE id = ?", Date.now(), id);
}

/** Exponential backoff, capped at five minutes. */
export async function markFailed(id: number, attempts: number): Promise<void> {
  const database = await openQueue();
  const delayMs = Math.min(300_000, 2_000 * 2 ** attempts);
  await database.runAsync(
    "UPDATE outbox SET attempts = ?, nextAttemptAt = ? WHERE id = ?",
    attempts + 1,
    Date.now() + delayMs,
    id,
  );
}

export async function queueStats(): Promise<{ pending: number; sent: number }> {
  const database = await openQueue();
  const row = await database.getFirstAsync<{ pending: number; sent: number }>(
    `SELECT
       SUM(CASE WHEN sentAt IS NULL THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN sentAt IS NOT NULL THEN 1 ELSE 0 END) AS sent
     FROM outbox`,
  );
  return { pending: row?.pending ?? 0, sent: row?.sent ?? 0 };
}
