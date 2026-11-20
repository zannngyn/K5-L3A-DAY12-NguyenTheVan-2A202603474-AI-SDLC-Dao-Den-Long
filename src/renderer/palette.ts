/**
 * Standard Ticket-02 ("Ba hòn đảo") color palette tokens.
 * All hex values match .swarm/specs/ticket-02.md & design-phase2.md Section 4.8.
 */
export const PALETTE_HEX = {
  nightSky: "#0E1430",
  nightMist: "#1B2350",
  grass: "#2F5D50",
  sand: "#C9B48A",
  wood: "#6B4A2F",
  cloudSea: "#12384A",
  litLantern: "#FFB347",
  litLanternCore: "#FFE9B0",
  unlitLantern: "#5B5F6E",
  moteCore: "#FFF6C2",
  moteHalo: "#FFE58A",
  shadeBody: "#120A1A",
  shadeOutline: "#7A3CFF",
  shadeStunned: "#3A3450",
  mayShirt: "#E8E2D0",
  mayScarf: "#C8102E",
  windCharm: "#C8102E",
  gold: "#F2C14E",
  drifter: "#8FA3B8",
  dangerUi: "#FF5A5F",
  uiText: "#F5F1E6",
} as const;

export const PALETTE = {
  nightSky: 0x0e1430,
  nightMist: 0x1b2350,
  grass: 0x2f5d50,
  sand: 0xc9b48a,
  wood: 0x6b4a2f,
  cloudSea: 0x12384a,
  litLantern: 0xffb347,
  litLanternCore: 0xffe9b0,
  unlitLantern: 0x5b5f6e,
  moteCore: 0xfff6c2,
  moteHalo: 0xffe58a,
  shadeBody: 0x120a1a,
  shadeOutline: 0x7a3cff,
  shadeStunned: 0x3a3450,
  mayShirt: 0xe8e2d0,
  mayScarf: 0xc8102e,
  windCharm: 0xc8102e,
  gold: 0xf2c14e,
  drifter: 0x8fa3b8,
  dangerUi: 0xff5a5f,
  uiText: 0xf5f1e6,

  // Derived accents kept within palette harmony
  hatStraw: 0xc9b48a,
  stoneRim: 0x5b5f6e,
  litGroundWarmth: 0x5c4328,
} as const;
