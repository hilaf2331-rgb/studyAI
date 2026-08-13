// Cross-platform preinstall guard: cleans up stray lockfiles from other
// package managers, and refuses to run under anything but pnpm. Plain
// Node instead of a POSIX `sh -c` one-liner so `pnpm install` also works
// from Windows PowerShell/cmd.exe (no `sh` there), not just Unix shells.
import { rmSync } from "node:fs";

for (const file of ["package-lock.json", "yarn.lock"]) {
  rmSync(file, { force: true });
}

const userAgent = process.env.npm_config_user_agent ?? "";
if (!userAgent.startsWith("pnpm/")) {
  console.error("Use pnpm instead");
  process.exit(1);
}
