import { prisma } from "@asm/db";
import { cleanup } from "./seed";

export default async function globalTeardown(): Promise<void> {
  await cleanup();
  await prisma.$disconnect();
}
