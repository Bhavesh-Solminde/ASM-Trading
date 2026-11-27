import { convertMinorBetween } from "./account";
import type { LeaderboardResult } from "./leaderboard";

const NAMES = [
  "Arjun Sharma", "Priya Mehta", "Rohit Verma", "Sneha Kapoor", "Vikas Agarwal",
  "Anjali Iyer", "Karan Malhotra", "Divya Nair", "Rahul Chowdhury", "Pooja Bhatt",
  "Aditya Rao", "Meera Kulkarni", "Nikhil Desai", "Riya Saxena", "Kabir Sethi",
  "Aditi Joshi", "Varun Bhat", "Sanya Gupta", "Dev Shah", "Ishita Sen",
  "Kunal Batra", "Neha Pandey", "Rohan Menon", "Asha Reddy", "Manav Patel",
  "Tanvi Sood", "Vivek Khanna", "Naina Roy", "Siddharth Jain", "Simran Kaur",
  "Ankit Yadav", "Kavya Mishra", "Akash Pillai", "Zoya Khan", "Harish Naidu",
  "Nandini Bose", "Sameer Ansari", "Maya Iyengar", "Pranav Hegde", "Lakshmi Das",
  "Rajat Arora", "Sakshi Patil", "Aryan Dhawan", "Shruti Ghosh", "Zain Ali",
  "Rekha Shetty", "Kartik Ahuja", "Tara Sinha", "Naveen Chawla", "Farah Qureshi",
  "Neil Fernandes", "Avni Parmar", "Om Prakash", "Jasleen Gill", "Deepak Thakur",
  "Fatima Sheikh", "Dhruv Luthra", "Ananya Dutta", "Ishan Trivedi", "Leela Thomas",
];

const MARKETS = ["BANKNIFTY", "NIFTY50", "NIFTYIT", "FINNIFTY", "SENSEX", "XAUUSD", "XAGUSD", "EURUSD", "GBPUSD", "USDJPY"];
const CYCLE_START = Date.parse("2026-11-27T00:00:00+05:30");
const CYCLE_DAYS = 60;
const DAY_MS = 86_400_000;

function hash(text: string): number {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}

/** Simulated standings keyed to the day in India, with a fixed repeat cycle. */
export function demoLeaderboard(input: {
  nowMs: number; displayCurrency: string;
}): LeaderboardResult & { source: "demo" } {
  const days = Math.floor((input.nowMs - CYCLE_START) / DAY_MS);
  const cycleDay = ((days % CYCLE_DAYS) + CYCLE_DAYS) % CYCLE_DAYS;
  const entries = NAMES.map((nickname, index) => {
    const seed = `${cycleDay}:${nickname}`;
    const pnlInrMinor = (hash(`pnl:${seed}`) % 2_800_001) - 1_000_000;
    const stakeInrMinor = 4_000_000 + (hash(`stake:${seed}`) % 12_000_001);
    const id = `demo-leaderboard-${index + 1}`;

    return {
      accountId: id, userId: id, nickname, country: "IN", currency: input.displayCurrency,
      pnlMinor: convertMinorBetween(pnlInrMinor, "INR", input.displayCurrency),
      market: MARKETS[(index + cycleDay) % MARKETS.length]!,
      returnPct: pnlInrMinor / stakeInrMinor * 100,
    };
  }).sort((a, b) => b.pnlMinor - a.pnlMinor || a.userId.localeCompare(b.userId));

  return { source: "demo", entries, you: { rank: null, entry: null } };
}
