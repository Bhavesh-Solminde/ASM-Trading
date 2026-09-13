import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env file into process.env for testing
const envPath = resolve(__dirname, "../../.env");
try {
  const envContent = readFileSync(envPath, "utf-8");
  const lines = envContent.split("\n");
  for (const line of lines) {
    if (line && !line.startsWith("#")) {
      const [key, ...valueParts] = line.split("=");
      let value = valueParts.join("=").trim();
      // Remove quotes if present
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      if (key.trim()) {
        process.env[key.trim()] = value;
      }
    }
  }
} catch (e) {
  // Ignore if .env file not found
}
