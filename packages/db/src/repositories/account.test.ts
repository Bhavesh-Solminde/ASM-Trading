import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../client.js";
import {
  createAccountsForUser,
  getAccountForActor,
  listAccountsForActor,
} from "./account.js";

let alice = "";
let bob = "";
let aliceLiveId = "";

beforeAll(async () => {
  const a = await prisma.user.create({
    data: { email: `alice-${Date.now()}@test.local`, passwordHash: "x" },
  });
  const b = await prisma.user.create({
    data: { email: `bob-${Date.now()}@test.local`, passwordHash: "x" },
  });
  alice = a.id;
  bob = b.id;
  const accounts = await createAccountsForUser(alice, 1_000_000);
  await createAccountsForUser(bob, 1_000_000);
  aliceLiveId = accounts.find((x) => x.type === "LIVE")!.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [alice, bob] } } });
  await prisma.$disconnect();
});

describe("account repository", () => {
  it("creates exactly one live and one demo account", async () => {
    const accounts = await listAccountsForActor(alice);
    expect(accounts).toHaveLength(2);
    expect(accounts.map((a) => a.type).sort()).toEqual(["DEMO", "LIVE"]);
  });

  it("funds the demo account and leaves live at zero", async () => {
    const accounts = await listAccountsForActor(alice);
    expect(accounts.find((a) => a.type === "DEMO")!.realBalance).toBe(1_000_000);
    expect(accounts.find((a) => a.type === "LIVE")!.realBalance).toBe(0);
  });

  it("returns an owned account to its owner", async () => {
    const account = await getAccountForActor(alice, aliceLiveId);
    expect(account).not.toBeNull();
    expect(account!.userId).toBe(alice);
  });

  it("returns null when another user requests it by id", async () => {
    const account = await getAccountForActor(bob, aliceLiveId);
    expect(account).toBeNull();
  });

  it("never leaks another user's accounts in a list", async () => {
    const accounts = await listAccountsForActor(bob);
    expect(accounts.every((a) => a.userId === bob)).toBe(true);
  });
});
