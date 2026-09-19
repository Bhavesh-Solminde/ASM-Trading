import { prisma } from "../client";
import type { User } from "../../generated/prisma/client";

/**
 * Users are not user-owned rows in the same sense — a person looks up only
 * themselves, and login looks up by email before any session exists. Neither
 * function ever accepts or writes `role`.
 */

export async function findUserByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { email: email.toLowerCase() } });
}

export async function findUserById(id: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { id } });
}
