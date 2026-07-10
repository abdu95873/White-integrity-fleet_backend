import { spawnSync } from "node:child_process";

if (!process.env.DIRECT_URL && process.env.DATABASE_URL?.includes("-pooler.")) {
  process.env.DIRECT_URL = process.env.DATABASE_URL.replace("-pooler.", ".");
}

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npmCmd, ["run", "build"], {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
