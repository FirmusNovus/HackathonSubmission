import { execSync } from "node:child_process";

export default async function globalSetup() {
  console.log("[playwright] re-seeding database…");
  execSync("npx tsx prisma/seed.ts", { stdio: "inherit" });
}
