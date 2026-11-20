import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI_ARGS = ["tsx", "src/headless/cli.ts"];

describe("Headless CLI v1.1", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "ddl-cli-test-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("writes v1.1 snapshots (night, wind, player fields, motes/drifters/charms) and night_start event", () => {
    const outPath = join(workDir, "out.jsonl");
    const res = spawnSync(
      "npx",
      [...CLI_ARGS, "--seed", "7", "--night", "2", "--ticks", "25", "--snapshot-every", "10", "--out", outPath],
      { encoding: "utf8" },
    );
    expect(res.status).toBe(0);

    const lines = readFileSync(outPath, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));

    const snapshots = lines.filter((l) => l.type === "snapshot");
    expect(snapshots.map((s) => s.tick)).toEqual([0, 10, 20]);
    const s0 = snapshots[0];
    expect(s0.night).toBe(2);
    expect(s0.wind).toEqual({ active: false, dir_deg: 0 });
    expect(s0.player).toMatchObject({
      grounded: true,
      flames: 3,
      carried: 0,
      invuln: false,
      dash_cd_s: 0,
      pulse_cd_s: 0,
      charm_s: 0,
    });
    expect(Array.isArray(s0.player.vel)).toBe(true);
    expect(s0.motes).toHaveLength(20);
    expect(s0.motes[0].kind).toBe("random");
    expect(s0.motes[0].ttl_s).toBeNull();
    expect(s0.charms).toHaveLength(1);
    expect(s0.drifters).toEqual([]);

    expect(lines.some((l) => l.type === "event" && l.name === "night_start" && l.data.night === 2)).toBe(true);
    expect(lines[lines.length - 1]).toEqual({
      type: "end",
      ticks: 25,
      state: "playing",
      score: 0,
    });
  });

  it("stops early on win, writes final off-interval snapshot, and ends with v1.1 score", () => {
    const outPath = join(workDir, "win.jsonl");
    const res = spawnSync(
      "npx",
      [
        ...CLI_ARGS,
        "--seed",
        "1",
        "--night",
        "1",
        "--scenario",
        "docs/proof/scenarios/win-lantern.json",
        "--inputs",
        "docs/proof/scenarios/win-lantern-inputs.json",
        "--ticks",
        "100",
        "--snapshot-every",
        "10",
        "--out",
        outPath,
      ],
      { encoding: "utf8" },
    );
    expect(res.status).toBe(0);

    const lines = readFileSync(outPath, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));

    const snapshots = lines.filter((l) => l.type === "snapshot");
    expect(snapshots.map((s) => s.tick)).toEqual([0, 1]);
    expect(snapshots[1].state).toBe("won");
    expect(lines[lines.length - 1]).toEqual({
      type: "end",
      ticks: 1,
      state: "won",
      score: 458,
    });
  });

  it("continues stepping through paused state and emits paused/resumed events", () => {
    const outPath = join(workDir, "pause.jsonl");
    const res = spawnSync(
      "npx",
      [
        ...CLI_ARGS,
        "--seed",
        "1",
        "--night",
        "1",
        "--scenario",
        "docs/proof/scenarios/pause-resume.json",
        "--inputs",
        "docs/proof/scenarios/pause-resume-inputs.json",
        "--ticks",
        "25",
        "--snapshot-every",
        "10",
        "--out",
        outPath,
      ],
      { encoding: "utf8" },
    );
    expect(res.status).toBe(0);
    const lines = readFileSync(outPath, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));

    expect(lines.some((l) => l.type === "event" && l.name === "paused" && l.tick === 6)).toBe(true);
    expect(lines.some((l) => l.type === "event" && l.name === "resumed" && l.tick === 16)).toBe(true);
    const snap10 = lines.find((l) => l.type === "snapshot" && l.tick === 10);
    expect(snap10.state).toBe("paused");
    expect(snap10.sim_tick).toBe(5);
  });

  it("produces byte-identical output across runs for Nights 1, 2, and 3", () => {
    for (const night of ["1", "2", "3"]) {
      const out1 = join(workDir, `n${night}-1.jsonl`);
      const out2 = join(workDir, `n${night}-2.jsonl`);
      execFileSync("npx", [...CLI_ARGS, "--seed", "42", "--night", night, "--ticks", "200", "--out", out1]);
      execFileSync("npx", [...CLI_ARGS, "--seed", "42", "--night", night, "--ticks", "200", "--out", out2]);
      expect(readFileSync(out1, "utf8")).toBe(readFileSync(out2, "utf8"));
    }
  });

  it("exits with code 2 and stderr message on non-strictly-increasing inputs", () => {
    const badInputs = join(workDir, "bad-inputs.json");
    writeFileSync(
      badInputs,
      JSON.stringify({ frames: [{ tick: 10, move: [0, 1] }, { tick: 10, move: [0, 0] }] }),
      "utf8",
    );
    const outPath = join(workDir, "out.jsonl");

    const res = spawnSync(
      "npx",
      [...CLI_ARGS, "--seed", "1", "--night", "1", "--inputs", badInputs, "--ticks", "20", "--out", outPath],
      { encoding: "utf8" },
    );
    expect(res.status).toBe(2);
    expect(res.stderr.length).toBeGreaterThan(0);
  });

  it("exits with code 2 on malformed JSON or invalid v1.1 scenario/input fields", () => {
    const badScenario = join(workDir, "bad-scenario.json");
    writeFileSync(badScenario, JSON.stringify({ shades: [{ pos: [0, 0, 0], state: "invalid_state" }] }), "utf8");
    const outPath = join(workDir, "out.jsonl");

    const res1 = spawnSync(
      "npx",
      [...CLI_ARGS, "--seed", "1", "--night", "1", "--scenario", badScenario, "--ticks", "10", "--out", outPath],
      { encoding: "utf8" },
    );
    expect(res1.status).toBe(2);
    expect(res1.stderr.length).toBeGreaterThan(0);

    const badInputs = join(workDir, "bad-dash.json");
    writeFileSync(badInputs, JSON.stringify({ frames: [{ tick: 0, dash: "yes" }] }), "utf8");
    const res2 = spawnSync(
      "npx",
      [...CLI_ARGS, "--seed", "1", "--night", "1", "--inputs", badInputs, "--ticks", "10", "--out", outPath],
      { encoding: "utf8" },
    );
    expect(res2.status).toBe(2);
    expect(res2.stderr.length).toBeGreaterThan(0);
  });

  it("exits non-zero on unsupported --night or missing required CLI flags", () => {
    const res1 = spawnSync("npx", [...CLI_ARGS, "--seed", "1"], { encoding: "utf8" });
    expect(res1.status).not.toBe(0);
    expect(res1.stderr.length).toBeGreaterThan(0);

    const outPath = join(workDir, "out.jsonl");
    const res2 = spawnSync(
      "npx",
      [...CLI_ARGS, "--seed", "1", "--night", "4", "--ticks", "10", "--out", outPath],
      { encoding: "utf8" },
    );
    expect(res2.status).not.toBe(0);
    expect(res2.stderr.length).toBeGreaterThan(0);
  });
});
