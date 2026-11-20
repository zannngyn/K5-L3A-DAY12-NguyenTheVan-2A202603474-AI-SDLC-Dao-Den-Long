#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { addLeaderboardEntry, exportLeaderboard, readLeaderboard } from "./leaderboard.mjs";

const LAUNCHER_START_MS = Date.now();
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
const DIST_DIR = join(PROJECT_ROOT, "dist");
const DEFAULT_PORT = 5174;
const MAX_PORT_TRIES = 100;
const MAX_BODY_BYTES = 64 * 1024;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function parseIntFlag(flag, raw) {
  if (raw === undefined || !/^-?\d+$/.test(raw)) {
    throw new Error(`Invalid integer for ${flag}: ${raw ?? "<missing>"}`);
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`Integer out of range for ${flag}: ${raw}`);
  }
  return n;
}

function parseCliArgs(argv) {
  const opts = {
    exportLeaderboardPath: null,
    dataDir: process.env.DDL_DATA_DIR || join(PROJECT_ROOT, "data"),
    bench: false,
    seed: 42,
    duration: 30,
    outPath: "bench.json",
    noOpen: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--export-leaderboard":
        opts.exportLeaderboardPath = argv[++i];
        if (!opts.exportLeaderboardPath) {
          throw new Error("Missing file path for --export-leaderboard");
        }
        break;
      case "--data-dir":
        opts.dataDir = argv[++i];
        if (!opts.dataDir) {
          throw new Error("Missing directory for --data-dir");
        }
        break;
      case "--bench":
        opts.bench = true;
        break;
      case "--seed":
        opts.seed = parseIntFlag("--seed", argv[++i]);
        break;
      case "--duration":
        opts.duration = parseIntFlag("--duration", argv[++i]);
        break;
      case "--out":
        opts.outPath = argv[++i];
        if (!opts.outPath) {
          throw new Error("Missing file path for --out");
        }
        break;
      case "--no-open":
        opts.noOpen = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (opts.duration < 1) {
    throw new Error(`--duration must be >= 1, got ${opts.duration}`);
  }

  return opts;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        rejectBody(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolveBody({});
        return;
      }
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        rejectBody(new Error("Invalid JSON body"));
      }
    });
    req.on("error", rejectBody);
  });
}

function serveStatic(reqUrl, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(reqUrl.pathname);
  } catch {
    res.writeHead(400);
    res.end("Bad Request");
    return;
  }

  const relPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const fullPath = resolve(DIST_DIR, relPath);
  if (fullPath !== DIST_DIR && !fullPath.startsWith(`${DIST_DIR}/`) && !fullPath.startsWith(`${DIST_DIR}\\`)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  let filePath = fullPath;
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, "index.html");
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  const ext = extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || "application/octet-stream";
  const content = readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": mime,
    "Content-Length": content.length,
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
  });
  res.end(content);
}

function listenOnFreePort(server, startPort = DEFAULT_PORT) {
  return new Promise((resolvePort, rejectPort) => {
    let port = startPort;
    const maxPort = startPort + MAX_PORT_TRIES;

    const onError = (err) => {
      if (err && err.code === "EADDRINUSE" && port < maxPort) {
        port += 1;
        server.listen(port, "127.0.0.1");
        return;
      }
      server.off("error", onError);
      rejectPort(err);
    };

    server.on("error", onError);
    server.once("listening", () => {
      server.off("error", onError);
      const addr = server.address();
      resolvePort(typeof addr === "object" && addr ? addr.port : port);
    });

    server.listen(port, "127.0.0.1");
  });
}

function findChromeBinary() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  const candidates = [];
  if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    );
  } else if (process.platform === "linux") {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
    );
  }

  for (const path of candidates) {
    if (existsSync(path)) {
      return path;
    }
  }

  const binNames = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
  for (const name of binNames) {
    try {
      const found = execFileSync("which", [name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (found && existsSync(found)) {
        return found;
      }
    } catch {
      // not on PATH
    }
  }

  return null;
}

function sampleProcessTreeRssMb(rootPid, userDataDir) {
  try {
    const out = execFileSync("ps", ["-axo", "pid=,ppid=,rss=,args="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const rows = [];
    for (const line of out.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const m = /^(\d+)\s+(\d+)\s+(\d+)\s*(.*)$/.exec(trimmed);
      if (!m) continue;
      rows.push({
        pid: Number(m[1]),
        ppid: Number(m[2]),
        rssKb: Number(m[3]),
        args: m[4] || "",
      });
    }

    const matched = new Set([rootPid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const r of rows) {
        if (!matched.has(r.pid) && (matched.has(r.ppid) || (userDataDir && r.args.includes(userDataDir)))) {
          matched.add(r.pid);
          changed = true;
        }
      }
    }

    let totalKb = 0;
    for (const r of rows) {
      if (matched.has(r.pid)) {
        totalKb += r.rssKb;
      }
    }
    if (totalKb <= 0) return null;
    return Math.round((totalKb / 1024) * 10) / 10;
  } catch {
    return null;
  }
}

function describeOs() {
  const cpuModel = os.cpus()[0]?.model?.trim() || "unknown CPU";
  return `${os.type()} ${os.release()} (${os.arch()}) / ${cpuModel}`;
}

function openDefaultBrowser(url) {
  let cmd;
  let args;
  if (process.platform === "darwin") {
    cmd = "open";
    args = [url];
  } else if (process.platform === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", url];
  } else {
    cmd = "xdg-open";
    args = [url];
  }

  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.unref();
  } catch {
    // non-fatal if browser cannot be opened automatically
  }
}

function createAppServer(leaderboardFile, benchHandlers) {
  return createServer(async (req, res) => {
    const reqUrl = new URL(req.url || "/", "http://127.0.0.1");

    if (reqUrl.pathname === "/api/leaderboard") {
      if (req.method === "GET") {
        try {
          sendJson(res, 200, readLeaderboard(leaderboardFile));
        } catch (err) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }
      if (req.method === "POST") {
        try {
          const body = await readJsonBody(req);
          const result = addLeaderboardEntry(leaderboardFile, body);
          if (!result.ok) {
            sendJson(res, 400, { error: result.error });
            return;
          }
          sendJson(res, 200, { entries: result.entries });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }
      res.writeHead(405);
      res.end("Method Not Allowed");
      return;
    }

    if (benchHandlers && reqUrl.pathname === "/api/bench/first-frame" && req.method === "POST") {
      benchHandlers.onFirstFrame();
      sendJson(res, 200, { ok: true });
      return;
    }

    if (benchHandlers && reqUrl.pathname === "/api/bench/result" && req.method === "POST") {
      try {
        const body = await readJsonBody(req);
        sendJson(res, 200, { ok: true });
        benchHandlers.onResult(body);
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      serveStatic(reqUrl, res);
      return;
    }

    res.writeHead(405);
    res.end("Method Not Allowed");
  });
}

async function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  const leaderboardFile = join(opts.dataDir, "leaderboard.json");

  // 1. Export leaderboard mode (no server, no dist/ needed)
  if (opts.exportLeaderboardPath) {
    exportLeaderboard(leaderboardFile, opts.exportLeaderboardPath);
    process.exit(0);
  }

  // 2. Verify dist/ exists before starting server
  if (!existsSync(join(DIST_DIR, "index.html"))) {
    process.stderr.write("run npm run build first\n");
    process.exit(1);
  }

  // 3. Bench mode
  if (opts.bench) {
    const chromeBin = findChromeBinary();
    if (!chromeBin) {
      process.stderr.write(
        "Error: Chrome or Chromium not found. Please install Google Chrome or Chromium (or set CHROME_PATH) to run --bench.\n",
      );
      process.exit(1);
    }

    const userDataDir = mkdtempSync(join(tmpdirPath(), "ddl-bench-chrome-"));
    let chromeChild = null;
    let rssTimer = null;
    let timeoutTimer = null;
    let finished = false;
    let firstFrameMs = null;
    let peakMemMb = null;

    const cleanup = () => {
      if (rssTimer) {
        clearInterval(rssTimer);
        rssTimer = null;
      }
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      if (chromeChild && !chromeChild.killed) {
        try {
          chromeChild.kill("SIGTERM");
        } catch {
          // ignore
        }
      }
      try {
        rmSync(userDataDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    };

    const failBench = (message) => {
      if (finished) return;
      finished = true;
      process.stderr.write(`Bench error: ${message}\n`);
      cleanup();
      server.close(() => process.exit(1));
      setTimeout(() => process.exit(1), 1000).unref();
    };

    const startRssSampling = () => {
      if (rssTimer || !chromeChild || !chromeChild.pid) return;
      const sample = () => {
        if (!chromeChild || !chromeChild.pid) return;
        const mb = sampleProcessTreeRssMb(chromeChild.pid, userDataDir);
        if (mb !== null && (peakMemMb === null || mb > peakMemMb)) {
          peakMemMb = mb;
        }
      };
      sample();
      rssTimer = setInterval(sample, 250);
    };

    const server = createAppServer(leaderboardFile, {
      onFirstFrame() {
        if (firstFrameMs === null) {
          firstFrameMs = Date.now() - LAUNCHER_START_MS;
        }
        startRssSampling();
      },
      onResult(payload) {
        if (finished) return;
        finished = true;
        if (rssTimer) {
          clearInterval(rssTimer);
          rssTimer = null;
        }
        if (chromeChild && chromeChild.pid) {
          const finalSample = sampleProcessTreeRssMb(chromeChild.pid, userDataDir);
          if (finalSample !== null && (peakMemMb === null || finalSample > peakMemMb)) {
            peakMemMb = finalSample;
          }
        }

        const report = {
          contract_version: "1.3",
          avg_fps: payload.avg_fps,
          p1_low_fps: payload.p1_low_fps,
          frame_ms_p95: payload.frame_ms_p95,
          frames: payload.frames,
          load_ms: firstFrameMs !== null ? firstFrameMs : Date.now() - LAUNCHER_START_MS,
          peak_mem_mb: peakMemMb,
          vsync_off: typeof payload.vsync_off === "boolean" ? payload.vsync_off : true,
          renderer: payload.renderer ?? "Three.js WebGLRenderer",
          os: describeOs(),
        };

        mkdirSync(dirname(opts.outPath), { recursive: true });
        writeFileSync(opts.outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

        cleanup();
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 1000).unref();
      },
    });

    const port = await listenOnFreePort(server, DEFAULT_PORT);
    const benchUrl = `http://127.0.0.1:${port}/?bench=1&seed=${opts.seed}&duration=${opts.duration}`;

    chromeChild = spawn(
      chromeBin,
      [
        `--user-data-dir=${userDataDir}`,
        "--window-size=1280,720",
        `--app=${benchUrl}`,
        "--disable-gpu-vsync",
        "--disable-frame-rate-limit",
        "--no-first-run",
        "--no-default-browser-check",
      ],
      { stdio: "ignore" },
    );

    chromeChild.on("error", (err) => {
      failBench(`Failed to launch browser: ${err.message}`);
    });

    chromeChild.on("exit", (code, signal) => {
      if (!finished) {
        failBench(`Browser exited before posting /api/bench/result (code=${code}, signal=${signal})`);
      }
    });

    const timeoutMs = (opts.duration + 60) * 1000;
    timeoutTimer = setTimeout(() => {
      failBench(`Timed out waiting for /api/bench/result after ${opts.duration + 60}s`);
    }, timeoutMs);

    process.on("SIGINT", () => failBench("Interrupted by SIGINT"));
    process.on("SIGTERM", () => failBench("Terminated by SIGTERM"));
    return;
  }

  // 4. Normal play mode
  const server = createAppServer(leaderboardFile, null);
  const port = await listenOnFreePort(server, DEFAULT_PORT);
  const url = `http://127.0.0.1:${port}/`;
  process.stdout.write(`Đảo Đèn Lồng running at ${url}\nPress Ctrl+C to stop.\n`);
  if (!opts.noOpen) {
    openDefaultBrowser(url);
  }

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function tmpdirPath() {
  return os.tmpdir();
}

main().catch((err) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
