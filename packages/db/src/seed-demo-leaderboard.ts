import { prisma } from "./client";
import { seedDemoLeaderboardProfiles } from "./repositories/demo-leaderboard";

try {
  if (process.env.LEADERBOARD_MODE === "demo") {
    await seedDemoLeaderboardProfiles();
    console.log("Seeded 10 fictional leaderboard profiles with DEMO accounts.");
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
