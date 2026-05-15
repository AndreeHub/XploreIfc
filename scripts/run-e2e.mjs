import { spawn, spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";
const npm = "npm";
const npx = "npx";
const url = "http://127.0.0.1:4177";

const server = spawnCommand(npm, ["run", "dev", "--", "--port", "4177"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, BROWSER: "none" }
});

server.stdout.on("data", (chunk) => process.stdout.write(chunk));
server.stderr.on("data", (chunk) => process.stderr.write(chunk));

try {
  await waitForServer(url);
  const code = await runPlaywright();
  await stopServer(server.pid);
  process.exit(code);
} catch (error) {
  console.error(error);
  await stopServer(server.pid);
  process.exit(1);
}

function runPlaywright() {
  return new Promise((resolve) => {
    const child = spawnCommand(npx, ["playwright", "test", "--reporter=list"], {
      stdio: "inherit",
      env: { ...process.env, PW_XPLOREIFC_EXTERNAL_SERVER: "1" }
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

function spawnCommand(command, args, options) {
  if (!isWindows) return spawn(command, args, options);
  return spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", [command, ...args].map(quoteWindowsArg).join(" ")], options);
}

function quoteWindowsArg(value) {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

async function waitForServer(targetUrl) {
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    try {
      const response = await fetch(targetUrl);
      if (response.ok) return;
    } catch {
      await delay(500);
    }
  }
  throw new Error(`Timed out waiting for ${targetUrl}`);
}

async function stopServer(pid) {
  if (!pid) return;
  if (isWindows) {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    process.kill(pid, "SIGTERM");
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
