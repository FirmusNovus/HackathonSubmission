import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Minimal `.env` loader — just enough to surface `ADMIN_API_KEY` (and any
 * other keys the test runner reads from `process.env`) without taking a
 * dependency on `dotenv`. Skips lines that don't look like KEY=VALUE.
 */
function loadDotEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf8");
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export default async function globalSetup() {
  loadDotEnv();
  console.log("[playwright] re-seeding database…");
  execSync("npx tsx prisma/seed.ts", { stdio: "inherit" });
}
