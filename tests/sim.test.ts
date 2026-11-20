import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getGroundHeight, makeBenchScenario, nightConfig, PALETTE, Sim, TUNING } from "../src/sim/index.js";

describe("Contract v1.3 & Purity", () => {
  it("game.contract.json tuning equals src/sim/tuning.ts TUNING and exposes v1.3 commands", () => {
    const raw = readFileSync(join(process.cwd(), "game.contract.json"), "utf8");
    const contract = JSON.parse(raw);
    expect(contract.contract_version).toBe("1.3");
    expect(contract.team).toBe("2A202603474-nguyen-the-van");
    expect(contract.build_cmd).toBe("npm install && npm run build");
    expect(contract.run_cmd).toBe("node scripts/play.mjs");
    expect(contract.headless_cmd).toBe("npx tsx src/headless/cli.ts");
    expect(contract.bench_cmd).toBe("node scripts/play.mjs --bench");
    expect(contract.soak_cmd).toBe("npx tsx src/headless/soak.ts");
    expect(contract.tuning).toEqual(TUNING);
    expect(PALETTE.nightSky).toBe("#0E1430");
  });

  it("src/sim has zero DOM, three, audio, Date.now, or Math.random usage", () => {
    const simDir = join(process.cwd(), "src/sim");
    const files = readdirSync(simDir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);

    const forbidden = [
      /\bwindow\b/,
      /\bdocument\b/,
      /\bthree\b/i,
      /\bAudioContext\b/,
      /\bDate\.now\b/,
      /\bMath\.random\b/,
      /\bperformance\.now\b/,
    ];

    for (const file of files) {
      const content = readFileSync(join(simDir, file), "utf8");
      for (const pattern of forbidden) {
        expect(content, `${file} matched forbidden pattern ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});

describe("Determinism, Nights & Scenario Setup", () => {
  it("produces identical snapshots and events across two runs for Nights 1, 2, and 3", () => {
    for (const night of [1, 2, 3] as const) {
      const run = (seed: number) => {
        const sim = new Sim({ seed, night });
        const snaps = [sim.getState()];
        const events = [];
        for (let t = 0; t < 360; t++) {
          const input =
            t === 0
              ? { move: [0.6, 0.8] as [number, number], cam_yaw_deg: 30 }
              : t === 60
                ? { dash: true }
                : t === 61
                  ? { dash: false }
                  : t === 120
                    ? { move: [-1, 0] as [number, number], jump: true }
                    : t === 121
                      ? { jump: false }
                      : {};
          sim.step(input);
          events.push(...sim.drainEvents());
          if ((t + 1) % 60 === 0) snaps.push(sim.getState());
        }
        return { snaps, events };
      };

      expect(run(42)).toEqual(run(42));
    }
  });

  it("loads each Night with correct lanterns, initial 20 distinct motes, charms, and v1.2 duration", () => {
    const s1 = new Sim({ seed: 1, night: 1 }).getState();
    expect(s1.night).toBe(1);
    expect(s1.time_left_s).toBe(240);
    expect(s1.lanterns).toHaveLength(5);
    expect(s1.motes).toHaveLength(20);
    expect(s1.charms).toHaveLength(0);
    expect(s1.player.pos).toEqual([0, 0, 0]);
    expect(s1.player.capacity).toBe(10);

    const s2 = new Sim({ seed: 1, night: 2 }).getState();
    expect(s2.night).toBe(2);
    expect(s2.time_left_s).toBe(270);
    expect(s2.lanterns).toHaveLength(6);
    expect(s2.motes).toHaveLength(20);
    expect(s2.charms).toHaveLength(1);
    expect(s2.charms[0].id).toBe("C1");

    const s3 = new Sim({ seed: 1, night: 3 }).getState();
    expect(s3.night).toBe(3);
    expect(s3.time_left_s).toBe(300);
    expect(s3.lanterns).toHaveLength(7);
    expect(s3.motes).toHaveLength(20);
    expect(s3.charms).toHaveLength(2);
    expect(s3.player.pos).toEqual([0, 0, -12]);
  });

  it("emits no events and awards no score during scenario setup, emits night_start on sim_tick 1", () => {
    const sim = new Sim({
      seed: 1,
      night: 2,
      scenario: {
        player: {
          pos: [0, 0, 0],
          carried: 4,
          flames: 3,
          invuln_ticks: 30,
          dash_cd_ticks: 60,
          pulse_cd_ticks: 120,
          charm_ticks: 300,
        },
        random_motes: false,
        random_shades: false,
        random_drifters: false,
        motes: [{ id: "M1", pos: [0, 0, 10], kind: "dropped", ttl_ticks: 180 }],
        shades: [{ id: "S1", pos: [20, 1, 0], state: "stunned", state_ticks_left: 60 }],
        drifters: [{ id: "D1", pos: [10, 1.2, 0], state: "idle" }],
        charms: [{ id: "C1", pos: [5, 0, 5], available: false, respawn_ticks: 600 }],
        lanterns: [
          { id: "L1", lit: true, deposited: 10 },
          { id: "L2", lit: true, deposited: 10 },
        ],
        time_left_s: 150,
      },
    });

    expect(sim.drainEvents()).toEqual([]);
    const snap = sim.getState();
    expect(snap.tick).toBe(0);
    expect(snap.sim_tick).toBe(0);
    expect(snap.score).toBe(0);
    expect(snap.time_left_s).toBe(150);
    expect(snap.player.invuln).toBe(true);
    expect(snap.player.dash_cd_s).toBe(1);
    expect(snap.player.pulse_cd_s).toBe(2);
    expect(snap.player.charm_s).toBe(5);
    expect(snap.motes[0]).toEqual({ id: "M1", pos: [0, 0, 10], kind: "dropped", ttl_s: 3 });
    expect(snap.shades[0].state).toBe("stunned");
    expect(snap.drifters).toHaveLength(1);
    expect(snap.charms[0]).toEqual({ id: "C1", pos: [5, 0, 5], available: false, respawn_s: 10 });

    sim.step({});
    expect(sim.drainEvents()).toEqual([
      { type: "event", tick: 1, name: "night_start", data: { night: 2 } },
    ]);
  });
});

describe("Movement: acceleration, yaw, jump, dash", () => {
  it("accelerates linearly to 6.0 m/s in 6 ticks (0.1 s), stops in 6 ticks, and rotates by yaw", () => {
    const sim = new Sim({
      seed: 1,
      scenario: { random_motes: false, random_shades: false },
    });

    for (let i = 0; i < 6; i++) {
      sim.step(i === 0 ? { move: [0, 1], cam_yaw_deg: 0 } : {});
    }
    const s6 = sim.getState();
    expect(s6.player.vel[2]).toBeCloseTo(6.0, 6);
    expect(s6.player.pos[2]).toBeCloseTo(21 / 60, 6);

    // Stop in 6 ticks
    for (let i = 0; i < 6; i++) {
      sim.step(i === 0 ? { move: [0, 0] } : {});
    }
    expect(sim.getState().player.vel[2]).toBeCloseTo(0, 6);

    // Yaw 90 deg with move [0, 1] -> +X
    const simYaw = new Sim({
      seed: 1,
      scenario: { random_motes: false, random_shades: false },
    });
    for (let i = 0; i < 6; i++) {
      simYaw.step(i === 0 ? { move: [0, 1], cam_yaw_deg: 90 } : {});
    }
    expect(simYaw.getState().player.vel[0]).toBeCloseTo(6.0, 6);
    expect(simYaw.getState().player.vel[2]).toBeCloseTo(0, 6);
  });

  it("jumps at 7.0 m/s with -20 m/s^2 gravity only when grounded", () => {
    const sim = new Sim({
      seed: 1,
      scenario: { random_motes: false, random_shades: false },
    });
    sim.step({ jump: true });
    const s1 = sim.getState();
    expect(s1.player.grounded).toBe(false);
    expect(s1.player.vel[1]).toBeCloseTo(7.0 - 20 / 60, 5);
    expect(s1.player.pos[1]).toBeGreaterThan(0);

    // Cannot double-jump in air
    sim.step({ jump: false });
    const beforeY = sim.getState().player.vel[1];
    sim.step({ jump: true });
    expect(sim.getState().player.vel[1]).toBeLessThan(beforeY);
  });

  it("dashes at 14 m/s for 12 ticks (2.8 m), enforces 1.5 s cooldown, and keeps height in air", () => {
    const sim = new Sim({
      seed: 1,
      scenario: { random_motes: false, random_shades: false },
    });
    // Jump then air-dash
    sim.step({ jump: true });
    sim.step({ jump: false });
    const airY = sim.getState().player.pos[1];
    expect(airY).toBeGreaterThan(0);

    sim.step({ dash: true });
    const evs = sim.drainEvents();
    expect(evs.some((e) => e.name === "dash")).toBe(true);
    expect(sim.getState().player.dash_cd_s).toBeCloseTo(1.5, 5);
    expect(sim.getState().player.pos[1]).toBeCloseTo(airY, 6);

    for (let i = 0; i < 11; i++) {
      sim.step({ dash: false });
    }
    const afterDash = sim.getState();
    // 12 ticks * 14 m/s / 60 = 2.8 m along facing +Z
    expect(afterDash.player.pos[2]).toBeCloseTo(2.8, 5);
    expect(afterDash.player.pos[1]).toBeCloseTo(airY, 6);

    // Cooldown prevents immediate re-dash
    sim.step({ dash: true });
    expect(sim.drainEvents().filter((e) => e.name === "dash")).toEqual([]);
  });
});

describe("Terrain, Jump Pads, Fall & Wind", () => {
  it("computes Night 1, 2, 3 terrain heights accurately including bridge, tiers, ramps, and bell tower", () => {
    expect(getGroundHeight(1, 0, 0)).toBe(0);
    expect(getGroundHeight(1, 40.1, 0)).toBeNull();

    expect(getGroundHeight(2, 0, 0)).toBe(0);
    expect(getGroundHeight(2, 35, 0)).toBe(0); // bamboo bridge
    expect(getGroundHeight(2, 35, 3)).toBeNull(); // off bridge
    expect(getGroundHeight(2, 70, 0)).toBe(0); // island B

    expect(getGroundHeight(3, 0, -12)).toBe(0); // tier 0
    expect(getGroundHeight(3, 0, 18)).toBe(3); // tier 1 (z > 0, r in [12,24])
    expect(getGroundHeight(3, 0, -18)).toBe(0); // z < 0 is tier 0
    expect(getGroundHeight(3, 5, 0)).toBe(6); // tier 2 (r <= 8)
    // Ramp at 30 deg: midpoint s = 27 -> Y = 1.5
    const r30 = (30 * Math.PI) / 180;
    expect(getGroundHeight(3, 27 * Math.cos(r30), 27 * Math.sin(r30))).toBeCloseTo(1.5, 5);
    expect(getGroundHeight(3, 46, 0)).toBeNull();

    // Bell Tower blocks player at r < 2 on Tier 2
    const sim = new Sim({
      seed: 1,
      night: 3,
      scenario: {
        player: { pos: [2.2, 6, 0] },
        random_motes: false,
        random_shades: false,
        random_drifters: false,
        wind_enabled: false,
      },
    });
    for (let i = 0; i < 20; i++) {
      sim.step(i === 0 ? { move: [-1, 0] } : {});
    }
    const p = sim.getState().player.pos;
    expect(Math.hypot(p[0], p[2])).toBeGreaterThanOrEqual(2.0);
  });

  it("launches player on Night 2 and Night 3 jump pads and locks move until landing", () => {
    // Night 2 JP1 -> lands on Island B
    const sim2 = new Sim({
      seed: 1,
      night: 2,
      scenario: {
        player: { pos: [20, 0, 18] },
        random_motes: false,
        random_shades: false,
        random_drifters: false,
      },
    });
    sim2.step({ move: [-1, 0] }); // opposite input should not override launch
    expect(sim2.getState().player.grounded).toBe(false);
    expect(sim2.getState().player.vel[1]).toBeGreaterThan(10);

    for (let i = 0; i < 100; i++) {
      sim2.step({});
      if (sim2.getState().player.grounded) break;
    }
    const p2 = sim2.getState().player;
    expect(p2.grounded).toBe(true);
    expect(Math.hypot(p2.pos[0] - 70, p2.pos[2])).toBeLessThanOrEqual(28);

    // Night 3 JP1 -> lands on Tier 2 (Y = 6)
    const sim3 = new Sim({
      seed: 1,
      night: 3,
      scenario: {
        player: { pos: [0, 3, 13] },
        random_motes: false,
        random_shades: false,
        random_drifters: false,
        wind_enabled: false,
      },
    });
    sim3.step({});
    for (let i = 0; i < 80; i++) {
      sim3.step({});
      if (sim3.getState().player.grounded) break;
    }
    const p3 = sim3.getState().player;
    expect(p3.grounded).toBe(true);
    expect(p3.pos[1]).toBeCloseTo(6.0, 5);
    expect(Math.hypot(p3.pos[0], p3.pos[2])).toBeLessThanOrEqual(8.0);
  });

  it("handles fall (Y < -10): ignores invuln, loses 1 flame and all motes, waits 60 ticks, respawns with invuln", () => {
    const sim = new Sim({
      seed: 1,
      night: 1,
      scenario: {
        player: { pos: [0, 0, 39.5], carried: 4, flames: 2, invuln_ticks: 180 },
        random_motes: false,
        random_shades: false,
      },
    });

    let fallTick = -1;
    let fallEvent: unknown = null;
    for (let i = 0; i < 120; i++) {
      sim.step(i < 15 ? { move: [0, 1] } : { move: [0, 0] });
      for (const ev of sim.drainEvents()) {
        if (ev.name === "player_hit" && ev.data.by === "fall") {
          fallTick = ev.tick;
          fallEvent = ev;
        }
      }
      if (fallTick !== -1) break;
    }
    expect(fallEvent).toEqual({
      type: "event",
      tick: fallTick,
      name: "player_hit",
      data: { by: "fall", flames: 1, dropped: 0, lost: 4 },
    });
    expect(sim.getState().player.carried).toBe(0);

    // Wait 59 ticks: still waiting
    for (let i = 0; i < 59; i++) sim.step({});
    expect(sim.getState().player.pos[1]).toBeLessThan(-10);

    // 60th tick: respawn at start with invuln
    sim.step({});
    const respawned = sim.getState().player;
    expect(respawned.pos).toEqual([0, 0, 0]);
    expect(respawned.vel).toEqual([0, 0, 0]);
    expect(respawned.grounded).toBe(true);
    expect(respawned.invuln).toBe(true);
  });

  it("activates Night 3 wind gust at sim_tick 1800 and pushes player at 2 m/s", () => {
    const sim = new Sim({
      seed: 7,
      night: 3,
      scenario: {
        player: { pos: [0, 0, -12] },
        random_motes: false,
        random_shades: false,
        random_drifters: false,
        wind_enabled: true,
      },
    });

    for (let i = 0; i < 1799; i++) sim.step({});
    expect(sim.getState().wind.active).toBe(false);
    const posBefore = [...sim.getState().player.pos];

    sim.step({}); // sim_tick = 1800
    const sGust = sim.getState();
    expect(sGust.wind.active).toBe(true);
    const disp = Math.hypot(sGust.player.pos[0] - posBefore[0], sGust.player.pos[2] - posBefore[2]);
    expect(disp).toBeCloseTo(2.0 / 60, 5);
  });
});

describe("Pickup, Deposit, Safe Zone Push-Out, Pulse, Hit, Drifters, Charms, Pause", () => {
  it("picks up mote at exact XZ <= 1.0 and Y diff <= 1.5, awards 0 score on pickup; mote-pickup at tick 43", () => {
    const sim = new Sim({
      seed: 1,
      scenario: {
        player: { pos: [0, 0, 0], carried: 0 },
        random_motes: false,
        random_shades: false,
        motes: [[0, 0, 5]],
      },
    });
    let pickedTick = -1;
    for (let k = 0; k < 60; k++) {
      sim.step(k === 0 ? { move: [0, 1], cam_yaw_deg: 0 } : {});
      for (const ev of sim.drainEvents()) {
        if (ev.name === "mote_picked") pickedTick = ev.tick;
      }
    }
    expect(pickedTick).toBe(43);
    expect(sim.getState().score).toBe(0);

    // Y diff > 1.5 does not pick up
    const simHigh = new Sim({
      seed: 1,
      scenario: {
        player: { pos: [0, 0, 0], carried: 0 },
        random_motes: false,
        random_shades: false,
        motes: [[0, 1.6, 0]],
      },
    });
    simHigh.step({});
    expect(simHigh.getState().player.carried).toBe(0);
  });

  it("deposits motes (+5/mote), lights lantern (+100, relight:false, fuel:100), and pushes shade out of safe zone within <= 30 ticks with no damage", () => {
    const sim = new Sim({
      seed: 1,
      scenario: {
        player: { pos: [0, 0, 0], carried: 2, flames: 3 },
        random_motes: false,
        random_shades: false,
        shades: [{ id: "S1", pos: [0, 1, 0.5] }],
        lanterns: [{ id: "L1", pos: [0, 0, 1.5], lit: false, deposited: 9 }],
      },
    });

    sim.step({ interact: true });
    const evs = sim.drainEvents();
    expect(evs.some((e) => e.name === "deposit" && e.data.amount === 1)).toBe(true);
    expect(
      evs.some(
        (e) => e.name === "lantern_lit" && e.data.lantern_id === "L1" && e.data.relight === false,
      ),
    ).toBe(true);
    expect(evs.some((e) => e.name === "player_hit")).toBe(false);
    expect(sim.getState().score).toBe(105); // 5 deposit + 100 first light
    expect(sim.getState().player.carried).toBe(1);
    expect(sim.getState().lanterns[0].fuel).toBe(100);
    expect(sim.getState().lanterns[0].ever_lit).toBe(true);
    expect(sim.getState().lanterns[0].relit_count).toBe(0);

    for (let i = 0; i < 30; i++) {
      sim.step({ interact: false });
      expect(sim.drainEvents().some((e) => e.name === "player_hit")).toBe(false);
    }
    const s = sim.getState();
    const dist = Math.hypot(s.shades[0].pos[0] - 0, s.shades[0].pos[2] - 1.5);
    expect(dist).toBeGreaterThanOrEqual(6.0);
    expect(s.player.flames).toBe(3);
  });

  it("pulse uses 3D targeting from feet+0.8, costs 3, pushes 4m over 15 ticks, stuns 120 ticks, +5 score", () => {
    const sim = new Sim({
      seed: 1,
      scenario: {
        player: { pos: [0, 0, 0], carried: 3 },
        random_motes: false,
        random_shades: false,
        shades: [
          { id: "S1", pos: [0, 1, 4.9] }, // dist3D from (0,0.8,0) = sqrt(0.04+24.01)=4.904 <= 5
          { id: "S2", pos: [0, 5.9, 0] }, // dist3D = 5.1 > 5
        ],
      },
    });

    sim.step({ pulse: true });
    const evs = sim.drainEvents();
    expect(evs.find((e) => e.name === "pulse")).toEqual({
      type: "event",
      tick: 1,
      name: "pulse",
      data: { stunned_ids: ["S1"] },
    });
    expect(sim.getState().score).toBe(5);
    expect(sim.getState().player.carried).toBe(0);
    expect(sim.getState().shades[0].state).toBe("stunned");
    expect(sim.getState().shades[1].state).not.toBe("stunned");

    // 14 more ticks to finish 15-tick push (1 tick already happened in Step 8 of tick 1)
    for (let i = 0; i < 14; i++) sim.step({ pulse: false });
    expect(sim.getState().shades[0].pos[2]).toBeCloseTo(8.9, 4);
  });

  it("shade hit drops floor(carried/2) physical motes with 480 TTL pickable next tick, recoils 2m/60t, invuln 90t", () => {
    const sim = new Sim({
      seed: 1,
      scenario: {
        player: { pos: [0, 0, 0], carried: 5, flames: 3 },
        random_motes: false,
        random_shades: false,
        shades: [{ id: "S1", pos: [0, 1, 0.8] }],
      },
    });

    sim.step({});
    const evs = sim.drainEvents();
    expect(evs.find((e) => e.name === "player_hit")).toEqual({
      type: "event",
      tick: 1,
      name: "player_hit",
      data: { by: "shade", flames: 2, dropped: 2 },
    });
    const s1 = sim.getState();
    expect(s1.player.carried).toBe(3);
    expect(s1.player.invuln).toBe(true);
    expect(s1.shades[0].state).toBe("recoil");
    expect(s1.motes).toHaveLength(2);
    expect(s1.motes[0].kind).toBe("dropped");
    expect(s1.motes[0].ttl_s).toBeCloseTo(8.0, 5);
  });

  it("Drifter chases at carried >= 5, steals min(3, carried) ignoring invuln, flees, and drops on Pulse", () => {
    const sim = new Sim({
      seed: 1,
      night: 2,
      scenario: {
        player: { pos: [0, 0, 0], carried: 6, flames: 3, invuln_ticks: 60 },
        random_motes: false,
        random_shades: false,
        random_drifters: false,
        drifters: [{ id: "D1", pos: [0, 1.2, 1.0], state: "idle" }],
      },
    });

    sim.step({});
    const evs1 = sim.drainEvents();
    expect(evs1.find((e) => e.name === "drifter_steal")).toEqual({
      type: "event",
      tick: 1,
      name: "drifter_steal",
      data: { drifter_id: "D1", amount: 3, carried: 3 },
    });
    expect(sim.getState().drifters[0].state).toBe("flee");
    expect(sim.getState().drifters[0].stolen).toBe(3);

    // Pulse while D1 is still within 5m
    sim.step({ pulse: true });
    const evs2 = sim.drainEvents();
    expect(evs2.find((e) => e.name === "drifter_drop")).toEqual({
      type: "event",
      tick: 2,
      name: "drifter_drop",
      data: { drifter_id: "D1", amount: 3 },
    });
    expect(sim.getState().motes).toHaveLength(3);
    expect(sim.getState().drifters[0].stolen).toBe(0);

    // Vanishes after 120 ticks
    for (let i = 0; i < 120; i++) sim.step({ pulse: false });
    expect(sim.getState().drifters).toHaveLength(0);
  });

  it("Wind Charm gives 7.2 m/s run, 0 dash cooldown, lasts 600 ticks, respawns after 2700 ticks", () => {
    const sim = new Sim({
      seed: 1,
      night: 2,
      scenario: {
        player: { pos: [35, 0, 0] },
        random_motes: false,
        random_shades: false,
        random_drifters: false,
      },
    });

    sim.step({ move: [1, 0] });
    expect(sim.drainEvents().find((e) => e.name === "charm_picked")).toEqual({
      type: "event",
      tick: 1,
      name: "charm_picked",
      data: { charm_id: "C1", charm_ticks: 600 },
    });
    expect(sim.getState().charms[0].available).toBe(false);
    expect(sim.getState().charms[0].respawn_s).toBeCloseTo(45.0, 5);

    // Dash has 0 cooldown while charm active
    sim.step({ dash: true });
    expect(sim.getState().player.dash_cd_s).toBe(0);
    for (let i = 0; i < 12; i++) sim.step({ dash: false });

    // Accelerate to 7.2 m/s
    for (let i = 0; i < 6; i++) sim.step({ move: [1, 0] });
    expect(sim.getState().player.vel[0]).toBeCloseTo(7.2, 5);

    // Advance remaining ticks until charm respawns at 2700 ticks after pickup
    const ticksElapsed = 1 + 12 + 6;
    for (let i = 0; i < 2700 - ticksElapsed; i++) sim.step({ move: [0, 0] });
    expect(sim.getState().charms[0].available).toBe(true);
  });

  it("pauses and resumes cleanly, freezing sim_tick and timers while paused", () => {
    const sim = new Sim({
      seed: 1,
      scenario: { random_motes: false, random_shades: false, time_left_s: 300 },
    });

    for (let i = 0; i < 5; i++) sim.step({});
    sim.drainEvents();

    sim.step({ pause: true });
    expect(sim.drainEvents()).toEqual([{ type: "event", tick: 6, name: "paused", data: {} }]);
    expect(sim.getState().state).toBe("paused");
    expect(sim.getState().tick).toBe(6);
    expect(sim.getState().sim_tick).toBe(5);
    const frozenTime = sim.getState().time_left_s;

    for (let i = 0; i < 10; i++) sim.step({ pause: false });
    expect(sim.getState().tick).toBe(16);
    expect(sim.getState().sim_tick).toBe(5);
    expect(sim.getState().time_left_s).toBe(frozenTime);

    sim.step({ pause: true });
    expect(sim.drainEvents()).toEqual([{ type: "event", tick: 17, name: "resumed", data: {} }]);
    expect(sim.getState().state).toBe("playing");
    expect(sim.getState().sim_tick).toBe(6);
    expect(sim.getState().time_left_s).toBeLessThan(frozenTime);
  });

  it("prioritizes no_flames on the dawn tick over dawn_survived, and awards dawn_survived score on win", () => {
    // Simultaneous no_flames + dawn with >= 3/5 lit -> no_flames loses first
    const simLose = new Sim({
      seed: 1,
      scenario: {
        player: { pos: [0, 0, 0], carried: 0, flames: 1 },
        random_motes: false,
        random_shades: false,
        shades: [{ id: "S1", pos: [0, 1, 0.5], state: "chase" }],
        lanterns: [
          { id: "L1", lit: true, fuel: 80 },
          { id: "L2", lit: true, fuel: 80 },
          { id: "L3", lit: true, fuel: 80 },
        ],
        time_left_s: 1 / 60,
      },
    });
    simLose.step({});
    expect(simLose.drainEvents().find((e) => e.name === "game_over")).toEqual({
      type: "event",
      tick: 1,
      name: "game_over",
      data: { result: "lost", reason: "no_flames" },
    });
    expect(simLose.getState().score).toBe(0);

    // Alive + 3/5 lit on dawn tick -> won with dawn_survived
    const simWin = new Sim({
      seed: 1,
      scenario: {
        player: { pos: [0, 0, 0], carried: 1, flames: 2 },
        random_motes: false,
        random_shades: false,
        lanterns: [
          { id: "L1", lit: true, fuel: 50 },
          { id: "L2", lit: true, fuel: 50 },
          { id: "L5", pos: [0, 0, 1.5], lit: false, deposited: 9 },
        ],
        time_left_s: 1 / 60,
      },
    });
    simWin.step({ interact: true });
    expect(simWin.drainEvents().find((e) => e.name === "game_over")).toEqual({
      type: "event",
      tick: 1,
      name: "game_over",
      data: { result: "won", reason: "dawn_survived" },
    });
    // L1, L2 decay 1 tick -> 49.983 -> floor(fuel) = 49 each (+50+49 = 99 each)
    // L5 lit on tick 1 -> fuel 100 (+50+100 = 150); deposit +5; first light +100; 2 flames +100
    expect(simWin.getState().score).toBe(5 + 100 + 99 + 99 + 150 + 100);
  });

  it("spawns shades on Night 1 schedule (2 at tick 300, then 1 every 480 ticks, cap 6) in spawning state", () => {
    const sim = new Sim({
      seed: 42,
      night: 1,
      scenario: { random_motes: false, random_shades: true },
    });
    for (let i = 0; i < 300; i++) sim.step({});
    const evs = sim.drainEvents().filter((e) => e.name === "shade_spawned");
    expect(evs.map((e) => e.data.id)).toEqual(["S1", "S2"]);
    expect(sim.getState().shades.every((s) => s.state === "spawning")).toBe(true);
    expect(nightConfig(1).shade_cap).toBe(6);
  });
});

describe("Ticket-03 (Contract v1.2): Fuel, Draining Shades, Dawn Win, Capacity, Score, Defaults", () => {
  it("1. fuel decay: decays lit lantern at exact 1.0/s using integer 1/60 units", () => {
    const scenario = JSON.parse(
      readFileSync(join(process.cwd(), "docs/proof/scenarios/fuel-decay.json"), "utf8"),
    );
    const sim = new Sim({ seed: 1, night: 1, scenario });
    expect(sim.getState().lanterns[0].fuel).toBe(100);
    for (let i = 0; i < 60; i++) sim.step({});
    expect(sim.getState().lanterns[0].fuel).toBe(99);
    for (let i = 0; i < 540; i++) sim.step({});
    expect(sim.getState().lanterns[0].fuel).toBe(90);
    expect(sim.getState().lanterns[1].fuel).toBe(0);
  });

  it("2. refuel math: ceil((100-fuel)/10), cap 100, full lantern ignored (not selected, no event, no score)", () => {
    const scenario = JSON.parse(
      readFileSync(join(process.cwd(), "docs/proof/scenarios/refuel-math.json"), "utf8"),
    );
    const sim = new Sim({ seed: 1, night: 1, scenario });
    // L1 at 1.0m is full (100), L2 at 1.5m is at 85 -> L1 skipped, L2 refueled with ceil((100-84.983)/10)=2 motes -> capped 100
    sim.step({ interact: true });
    const evs1 = sim.drainEvents();
    expect(evs1.find((e) => e.name === "refuel")).toEqual({
      type: "event",
      tick: 1,
      name: "refuel",
      data: { lantern_id: "L2", amount: 2, fuel: 100 },
    });
    expect(sim.getState().player.carried).toBe(3);
    expect(sim.getState().score).toBe(10); // 2 * 5

    // Next interact when both L1 and L2 are full -> emits nothing, no score, carried unchanged
    sim.step({ interact: false });
    sim.drainEvents();
    sim.step({ interact: true });
    expect(sim.drainEvents().filter((e) => e.name === "refuel")).toEqual([]);
    expect(sim.getState().player.carried).toBe(3);
    expect(sim.getState().score).toBe(10);
  });

  it("3. lantern_out resets deposited to 0, keeps ever_lit=true, and relight costs 5 motes (+40 bonus)", () => {
    const scenario = JSON.parse(
      readFileSync(join(process.cwd(), "docs/proof/scenarios/lantern-out-relight.json"), "utf8"),
    );
    const sim = new Sim({ seed: 1, night: 1, scenario });
    let outEvent: unknown = null;
    for (let i = 0; i < 30; i++) {
      sim.step({});
      for (const ev of sim.drainEvents()) {
        if (ev.name === "lantern_out") outEvent = ev;
      }
    }
    expect(outEvent).toEqual({
      type: "event",
      tick: 30,
      name: "lantern_out",
      data: { lantern_id: "L1" },
    });
    const afterOut = sim.getState().lanterns[0];
    expect(afterOut.lit).toBe(false);
    expect(afterOut.fuel).toBe(0);
    expect(afterOut.deposited).toBe(0);
    expect(afterOut.ever_lit).toBe(true);

    // Relight with 5 motes
    sim.step({ interact: true });
    const evs = sim.drainEvents();
    expect(evs.find((e) => e.name === "deposit")).toEqual({
      type: "event",
      tick: 31,
      name: "deposit",
      data: { lantern_id: "L1", amount: 5, deposited: 5 },
    });
    expect(evs.find((e) => e.name === "lantern_lit")).toEqual({
      type: "event",
      tick: 31,
      name: "lantern_lit",
      data: { lantern_id: "L1", relight: true },
    });
    const relit = sim.getState().lanterns[0];
    expect(relit.lit).toBe(true);
    expect(relit.fuel).toBe(100);
    expect(relit.relit_count).toBe(1);
    expect(sim.getState().score).toBe(5 * 5 + 40);
  });

  it("4. safe zone exists at fuel === 30 and disappears at fuel === 29.9", () => {
    const scenario = JSON.parse(
      readFileSync(join(process.cwd(), "docs/proof/scenarios/safe-zone-threshold.json"), "utf8"),
    );
    const sim = new Sim({ seed: 1, night: 1, scenario });
    // Tick 1: L1 decays 1801 -> 1800 (exact 30.0 -> keeps safe zone, S1 pushed outside >= 6.0m)
    // L2 decays 1794 -> 1793 (29.88 < 30 -> loses safe zone, S2 moves closer to L2 inside 6.0m)
    sim.step({});
    const s = sim.getState();
    const d1 = Math.hypot(s.shades[0].pos[0] - s.lanterns[0].pos[0], s.shades[0].pos[2] - s.lanterns[0].pos[2]);
    const d2 = Math.hypot(s.shades[1].pos[0] - s.lanterns[1].pos[0], s.shades[1].pos[2] - s.lanterns[1].pos[2]);
    expect(s.lanterns[0].fuel).toBe(30);
    expect(s.lanterns[1].fuel).toBe(29.9);
    expect(d1).toBeGreaterThanOrEqual(6.0);
    expect(d2).toBeLessThan(5.8);
  });

  it("5. shade wander targets nearest weak lantern (<30), enters drain within 2m, stacks 5/s each, emits fuel_drain every 60 ticks", () => {
    const scenario = JSON.parse(
      readFileSync(join(process.cwd(), "docs/proof/scenarios/shade-drain-stacking.json"), "utf8"),
    );
    const sim = new Sim({ seed: 1, night: 1, scenario });
    // Tick 1: S1 is 1m from L1 -> enters drain immediately; S2 is 3.5m -> walks toward L1 at 2m/s (1.5m / 2m/s = 45 ticks)
    sim.step({});
    expect(sim.getState().shades[0].state).toBe("drain");
    expect(sim.getState().shades[1].state).toBe("wander");

    const drainEvents: Array<{ tick: number; shade_id: string; fuel: number }> = [];
    for (let i = 0; i < 120; i++) {
      sim.step({});
      for (const ev of sim.drainEvents()) {
        if (ev.name === "fuel_drain") {
          drainEvents.push({ tick: ev.tick, shade_id: ev.data.shade_id, fuel: ev.data.fuel });
        }
      }
    }
    expect(sim.getState().shades[0].state).toBe("drain");
    expect(sim.getState().shades[1].state).toBe("drain");
    // S1 entered drain at tick 1 -> starts draining tick 2 -> 60th drain tick is tick 61
    expect(drainEvents.some((e) => e.shade_id === "S1" && e.tick === 61)).toBe(true);
    // S2 entered drain around tick 46 -> emits fuel_drain 60 ticks later (~106)
    expect(drainEvents.some((e) => e.shade_id === "S2")).toBe(true);
    // Fuel dropped much faster than 1/s + 5/s alone due to stacking (1 + 5 + 5 = 11/s)
    expect(sim.getState().lanterns[0].fuel).toBeLessThan(10);
  });

  it("6. drain transitions: -> stunned on pulse (+15) -> wander on stun end; -> chase if May within 6m; -> wander if lantern out", () => {
    const scenario = JSON.parse(
      readFileSync(join(process.cwd(), "docs/proof/scenarios/drain-transitions.json"), "utf8"),
    );
    const sim = new Sim({ seed: 1, night: 1, scenario });
    // Tick 1: pulse hits S2 (draining L2 at 3.5m) -> stunned (+15 score); S1 is 9m away -> still drain
    sim.step({ pulse: true });
    expect(sim.getState().shades[0].state).toBe("drain");
    expect(sim.getState().shades[1].state).toBe("stunned");
    expect(sim.getState().score).toBe(15);

    // Move toward S1 until within 6m -> S1 transitions drain -> chase
    let s1Chased = false;
    for (let i = 0; i < 45; i++) {
      sim.step({ pulse: false, move: [0, 1] });
      if (sim.getState().shades[0].state === "chase") {
        s1Chased = true;
        break;
      }
    }
    expect(s1Chased).toBe(true);

    // After 120 ticks of stun, S2 transitions stunned -> wander (or chase/drain if near)
    const simStun = new Sim({
      seed: 1,
      night: 1,
      scenario: {
        player: { pos: [0, 0, -30], carried: 0, flames: 3 },
        random_motes: false,
        random_shades: false,
        lanterns: [{ id: "L1", lit: true, fuel: 80 }],
        shades: [{ id: "S1", pos: [0, 1, 0], state: "stunned", state_ticks_left: 2 }],
      },
    });
    simStun.step({});
    expect(simStun.getState().shades[0].state).toBe("stunned");
    simStun.step({});
    expect(simStun.getState().shades[0].state).toBe("wander");
  });

  it("7. refuel to >= 30 triggers safe-zone push-out (<= 30 ticks, no damage) and stops drain", () => {
    const scenario = JSON.parse(
      readFileSync(join(process.cwd(), "docs/proof/scenarios/refuel-pushout.json"), "utf8"),
    );
    const sim = new Sim({ seed: 1, night: 1, scenario });
    sim.step({ interact: true });
    const evs = sim.drainEvents();
    expect(evs.some((e) => e.name === "refuel" && e.data.lantern_id === "L1")).toBe(true);
    expect(sim.getState().lanterns[0].fuel).toBeGreaterThanOrEqual(30);
    expect(sim.getState().shades[0].state).toBe("wander");

    for (let i = 0; i < 30; i++) {
      sim.step({ interact: false });
      expect(sim.drainEvents().some((e) => e.name === "player_hit")).toBe(false);
    }
    const s = sim.getState();
    const d = Math.hypot(s.shades[0].pos[0] - s.lanterns[0].pos[0], s.shades[0].pos[2] - s.lanterns[0].pos[2]);
    expect(d).toBeGreaterThanOrEqual(6.0);
    expect(s.player.flames).toBe(3);
  });

  it("8. dawn win threshold per Night: 3/5 (N1), 4/6 (N2), 5/7 (N3) win; one fewer loses with reason dawn", () => {
    const cases = [
      { night: 1 as const, file: "dawn-win-n1.json", litWin: 3 },
      { night: 2 as const, file: "dawn-win-n2.json", litWin: 4 },
      { night: 3 as const, file: "dawn-win-n3.json", litWin: 5 },
    ];
    for (const c of cases) {
      const winScenario = JSON.parse(
        readFileSync(join(process.cwd(), "docs/proof/scenarios", c.file), "utf8"),
      );
      const simWin = new Sim({ seed: 1, night: c.night, scenario: winScenario });
      for (let i = 0; i < 60; i++) simWin.step({});
      expect(simWin.getState().state).toBe("won");
      expect(simWin.drainEvents().find((e) => e.name === "game_over")).toEqual({
        type: "event",
        tick: 60,
        name: "game_over",
        data: { result: "won", reason: "dawn_survived" },
      });

      // One fewer lit lantern -> loses with reason "dawn"
      const loseScenario = {
        ...winScenario,
        lanterns: winScenario.lanterns.slice(0, c.litWin - 1),
      };
      const simLose = new Sim({ seed: 1, night: c.night, scenario: loseScenario });
      for (let i = 0; i < 60; i++) simLose.step({});
      expect(simLose.getState().state).toBe("lost");
      expect(simLose.drainEvents().find((e) => e.name === "game_over")).toEqual({
        type: "event",
        tick: 60,
        name: "game_over",
        data: { result: "lost", reason: "dawn" },
      });
    }
  });

  it("9. no early win: lighting all lanterns does not end Night; all_lit is never emitted", () => {
    const scenario = JSON.parse(
      readFileSync(join(process.cwd(), "docs/proof/scenarios/no-early-win.json"), "utf8"),
    );
    const sim = new Sim({ seed: 1, night: 1, scenario });
    sim.step({ interact: true });
    const evs = sim.drainEvents();
    expect(evs.some((e) => e.name === "lantern_lit" && e.data.lantern_id === "L5")).toBe(true);
    expect(evs.some((e) => e.name === "game_over")).toBe(false);
    expect(sim.getState().lanterns.every((l) => l.lit)).toBe(true);
    expect(sim.getState().state).toBe("playing");
  });

  it("10. capacity growth: min(20, 10 + 2*successful_lights), respects pickup cap, resets per Night", () => {
    const scenario = JSON.parse(
      readFileSync(join(process.cwd(), "docs/proof/scenarios/capacity-growth.json"), "utf8"),
    );
    const sim = new Sim({ seed: 1, night: 1, scenario });
    expect(sim.getState().player.capacity).toBe(18); // 10 + 2*4

    // Tick 1: pickup 1 mote (carried 17 -> 18 = capacity), then interact lights L1 (carried 18 -> 17, capacity 18 -> 20)
    sim.step({ interact: true });
    expect(sim.getState().player.capacity).toBe(20);
    expect(sim.getState().player.carried).toBe(17);

    // Tick 2: picks up 3 more motes up to capacity 20 (leaving 2 motes on ground)
    sim.step({ interact: false });
    expect(sim.getState().player.carried).toBe(20);
    expect(sim.getState().motes).toHaveLength(2);

    // Tick 3: light L2 -> capacity stays capped at 20
    sim.step({ interact: true });
    expect(sim.getState().player.capacity).toBe(20);

    // Fresh Night resets capacity to 10
    const fresh = new Sim({ seed: 1, night: 2 });
    expect(fresh.getState().player.capacity).toBe(10);
  });

  it("11. v1.2 score formula: +5/mote, +100 first light, +40 relight, +15 draining pulse, +5 normal pulse, dawn bonuses on win only", () => {
    const scenario = JSON.parse(
      readFileSync(join(process.cwd(), "docs/proof/scenarios/score-v12.json"), "utf8"),
    );
    const inputs = JSON.parse(
      readFileSync(join(process.cwd(), "docs/proof/scenarios/score-v12-inputs.json"), "utf8"),
    );
    const frameMap = new Map<number, Record<string, unknown>>(
      inputs.frames.map((f: { tick: number }) => [f.tick, f]),
    );
    const sim = new Sim({ seed: 1, night: 1, scenario });
    for (let t = 0; t < 60; t++) {
      sim.step((frameMap.get(t) ?? {}) as never);
    }
    const snap = sim.getState();
    expect(snap.state).toBe("won");
    // Pulse: +15 (S1 draining) + 5 (S2 wander) = 20
    // First light L1: +5 (1 mote) + 100 = 105 (total 125)
    // Relight L2: +25 (5 motes) + 40 = 65 (total 190)
    // Refuel L1: +5 (1 mote) = 5 (total 195)
    // Dawn bonus: L1 (+50 + 99 = 149) + L2 (+50 + 99 = 149) + L3 (+50 + 23 = 73) + 2 flames (+100) = 471
    // Total = 195 + 471 = 666
    expect(snap.score).toBe(666);
  });

  it("12. scenario defaults: lit:true without fuel defaults to 100, ever_lit:true, relit_count:0, 0 events, 0 score", () => {
    const scenario = JSON.parse(
      readFileSync(join(process.cwd(), "docs/proof/scenarios/scenario-defaults.json"), "utf8"),
    );
    const sim = new Sim({ seed: 1, night: 1, scenario });
    expect(sim.drainEvents()).toEqual([]);
    const snap = sim.getState();
    expect(snap.score).toBe(0);
    expect(snap.player.capacity).toBe(10);
    expect(snap.lanterns[0]).toMatchObject({
      id: "L1",
      lit: true,
      fuel: 100,
      ever_lit: true,
      relit_count: 0,
    });
    expect(snap.lanterns[1]).toMatchObject({
      id: "L2",
      lit: false,
      fuel: 0,
      ever_lit: false,
      relit_count: 0,
    });
  });
});

describe("Ticket-04 (Contract v1.3): Bench Scenario & SimOptions.bench", () => {
  it("makeBenchScenario(42) deterministically builds 200 wander shades, 100 motes, L1-L3 lit fuel 100, player at origin", () => {
    const sc1 = makeBenchScenario(42);
    const sc2 = makeBenchScenario(42);
    expect(sc1).toEqual(sc2);
    expect(sc1.player?.pos).toEqual([0, 0, 0]);
    expect(sc1.random_motes).toBe(false);
    expect(sc1.random_shades).toBe(false);
    expect(sc1.shades).toHaveLength(200);
    expect(sc1.shades?.every((s) => s.state === "wander")).toBe(true);
    expect(sc1.motes).toHaveLength(100);
    expect(sc1.lanterns).toEqual([
      { id: "L1", lit: true, fuel: 100 },
      { id: "L2", lit: true, fuel: 100 },
      { id: "L3", lit: true, fuel: 100 },
    ]);
  });

  it("SimOptions.bench disables spawns, damage, mote pickup, fuel decay, and Night end while keeping wander movement", () => {
    const sc = makeBenchScenario(42);
    // Force a short time_left_s and a mote right on the player to prove bench disables pickup & Night end
    sc.time_left_s = 1;
    sc.motes![0] = { id: "M1", pos: [0, 0, 0], kind: "random" };
    sc.shades![0] = { id: "S1", pos: [0, 1, 0.5], state: "wander" };

    const sim = new Sim({ seed: 42, night: 1, scenario: sc, bench: true });
    const startSnap = sim.getState();
    const startShadePos = startSnap.shades.map((s) => [...s.pos]);

    for (let i = 0; i < 180; i++) {
      sim.step({});
      sim.drainEvents();
    }

    const endSnap = sim.getState();
    expect(endSnap.state).toBe("playing");
    expect(endSnap.shades).toHaveLength(200);
    expect(endSnap.shades.every((s) => s.state === "wander")).toBe(true);
    expect(endSnap.motes).toHaveLength(100);
    expect(endSnap.player.pos).toEqual([0, 0, 0]);
    expect(endSnap.player.flames).toBe(3);
    expect(endSnap.player.carried).toBe(0);
    expect(endSnap.lanterns.slice(0, 3).every((l) => l.lit && l.fuel === 100)).toBe(true);

    // Shades actually moved via normal wander rules
    const movedCount = endSnap.shades.filter(
      (s, idx) =>
        Math.hypot(s.pos[0] - startShadePos[idx][0], s.pos[2] - startShadePos[idx][2]) > 0.1,
    ).length;
    expect(movedCount).toBeGreaterThan(150);
  });

  it("bench support does not alter normal Sim determinism or outputs", () => {
    const a = new Sim({ seed: 99, night: 1 });
    const b = new Sim({ seed: 99, night: 1, bench: false });
    for (let t = 0; t < 240; t++) {
      const inp = t === 0 ? { move: [0.5, 0.5] as [number, number] } : {};
      a.step(inp);
      b.step(inp);
    }
    expect(a.getState()).toEqual(b.getState());
    expect(a.drainEvents()).toEqual(b.drainEvents());
  });
});
