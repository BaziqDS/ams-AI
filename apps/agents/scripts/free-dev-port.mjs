import { execFileSync } from "node:child_process";
import process from "node:process";

const port = process.argv[2] ?? "2024";

function run(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

function getPids() {
  if (process.platform === "win32") {
    const output = run("netstat", ["-ano", "-p", "tcp"]);
    return output
      .split(/\r?\n/)
      .filter(line => line.includes(`:${port}`) && /\bLISTENING\b/i.test(line))
      .map(line => line.trim().split(/\s+/).at(-1))
      .filter(Boolean);
  }

  return run("lsof", ["-ti", `tcp:${port}`])
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

const pids = [...new Set(getPids())].filter(pid => pid !== String(process.pid));

for (const pid of pids) {
  if (process.platform === "win32") {
    run("taskkill", ["/PID", pid, "/F"]);
  } else {
    run("kill", ["-TERM", pid]);
  }
}

if (pids.length > 0) {
  console.log(`Freed port ${port} by stopping process ${pids.join(", ")}`);
}
