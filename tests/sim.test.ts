import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getGroundHeight, nightConfig, PALETTE, Sim, TUNING } from "../src/sim/index.js";

describe("Contract v1.1 & Purity", () => {
  it("game.contract.json tuning equals src/sim/tuning.ts TUNING", () => {
    const raw = readFileSync(join(process.cwd(), "game.contract.json"), "utf8");
    const contract = JSON.parse(raw);
    expect(contract.contract_version).toBe("1.1");
    expect(contract.team).toBe("2A202603474-nguyen-the-van");
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

  it("loads each Night with correct lanterns, initial 20 distinct motes, charms, and duration", () => {
    const s1 = new Sim({ seed: 1, night: 1 }).getState();
    expect(s1.night).toBe(1);
    expect(s1.time_left_s).toBe(300);
    expect(s1.lanterns).toHaveLength(5);
    expect(s1.motes).toHaveLength(20);
    expect(s1.charms).toHaveLength(0);
    expect(s1.player.pos).toEqual([0, 0, 0]);

    const s2 = new Sim({ seed: 1, night: 2 }).getState();
    expect(s2.night).toBe(2);
    expect(s2.time_left_s).toBe(330);
    expect(s2.lanterns).toHaveLength(6);
    expect(s2.motes).toHaveLength(20);
    expect(s2.charms).toHaveLength(1);
    expect(s2.charms[0].id).toBe("C1");

    const s3 = new Sim({ seed: 1, night: 3 }).getState();
    expect(s3.night).toBe(3);
    expect(s3.time_left_s).toBe(360);
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

  it("deposits motes (+10/mote), lights lantern (+100), and pushes shade out of safe zone within <= 30 ticks with no damage", () => {
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
    expect(evs.some((e) => e.name === "lantern_lit" && e.data.lantern_id === "L1")).toBe(true);
    expect(evs.some((e) => e.name === "player_hit")).toBe(false);
    expect(sim.getState().score).toBe(110); // 10 deposit + 100 lantern
    expect(sim.getState().player.carried).toBe(1);

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

  it("prioritizes no_flames > all_lit > dawn, and allows winning on exact tick time runs out", () => {
    // Simultaneous all_lit and no_flames -> no_flames wins
    const simLose = new Sim({
      seed: 1,
      scenario: {
        player: { pos: [0, 0, 0], carried: 1, flames: 1 },
        random_motes: false,
        random_shades: false,
        shades: [{ id: "S1", pos: [0, 1, 0.5] }],
        lanterns: [
          { id: "L1", lit: true, deposited: 10 },
          { id: "L2", lit: true, deposited: 10 },
          { id: "L3", lit: true, deposited: 10 },
          { id: "L4", lit: true, deposited: 10 },
          { id: "L5", pos: [0, 0, 1.5], lit: false, deposited: 9 },
        ],
        time_left_s: 1 / 60,
      },
    });
    // Place L5 far enough that S1 isn't pushed out? Wait: L5 is at 1.5, S1 at 0.5 is < 6m so S1 gets safe_push!
    // To test simultaneous no_flames + all_lit, place L5 at [0,0,1.5] and S1 at [0,1,0.5] — wait: S1 is inside safe zone!
    // Instead test fall + all_lit? No, fall skips Step 5.
    // Test shade outside L5 safe zone? No, player is at L5 distance <= 2m, shade within 1m of player is <= 3m from L5!
    // So test player starting with flames: 0 and all lanterns lit:
    const simZeroFlames = new Sim({
      seed: 1,
      scenario: {
        player: { pos: [0, 0, 0], carried: 1, flames: 0 },
        random_motes: false,
        random_shades: false,
        lanterns: [
          { id: "L1", lit: true, deposited: 10 },
          { id: "L2", lit: true, deposited: 10 },
          { id: "L3", lit: true, deposited: 10 },
          { id: "L4", lit: true, deposited: 10 },
          { id: "L5", lit: true, deposited: 10 },
        ],
        time_left_s: 10,
      },
    });
    simZeroFlames.step({});
    expect(simZeroFlames.drainEvents().find((e) => e.name === "game_over")).toEqual({
      type: "event",
      tick: 1,
      name: "game_over",
      data: { result: "lost", reason: "no_flames" },
    });
    expect(simLose.getState().state).toBe("playing"); // sanity

    // Alive + all_lit on exact tick time runs out -> won
    const simWin = new Sim({
      seed: 1,
      scenario: {
        player: { pos: [0, 0, 0], carried: 1, flames: 2 },
        random_motes: false,
        random_shades: false,
        lanterns: [
          { id: "L1", lit: true, deposited: 10 },
          { id: "L2", lit: true, deposited: 10 },
          { id: "L3", lit: true, deposited: 10 },
          { id: "L4", lit: true, deposited: 10 },
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
      data: { result: "won", reason: "all_lit" },
    });
    // Score = 10 (deposit) + 100 (lantern) + 0 (time) + 2 * 50 (flames) = 210
    expect(simWin.getState().score).toBe(210);
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
