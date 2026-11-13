export const ICON_NAMES = [
  // Identity & Social
  "user",
  "users",
  "rank",
  "back",
  "logout",
  "settings",
  "search",
  "copy",
  "check",
  "close",
  "plus",
  "minus",
  "expand",
  "minimize",
  "eye",
  "eye-off",
  "lock",

  // Navigation & Directional Glyphs (Replacing text arrows and RST)
  "chevron-up",
  "chevron-down",
  "chevron-right",
  "chevron-left",
  "arrow-right",
  "reset",
  "chevrons",
  "grip",

  // Turn Phases (HEGEM-63 Semantically Distinct Phase Icons)
  "phase-deploy",
  "phase-attack",
  "phase-maneuver",

  // Economic Resources (HEGEM-63 Distinct 12-24px Silhouettes)
  "coins",
  "money",
  "gold",
  "steel",
  "oil",

  // Military Units & Doctrines
  "infantry",
  "tank",
  "artillery",
  "aircraft",
  "airfield",
  "navy",
  "port",
  "anchor",

  // Territorial Buildings & Fortifications
  "market",
  "industry",
  "fortification",
  "fortress",
  "fortification-l2",
  "military_factory",
  "civilian_factory",
  "steel_mine",
  "oil_well",
  "refinery",
  "wonder",

  // Logistics, Tactical Status & Combat Missions (Replacing System Emojis)
  "supply-cut",
  "fuel-empty",
  "blitzkrieg",
  "blockade",
  "capital",
  "capital-fallen",
  "infamy",
  "alert",
  "bombardment",
  "recon-plane",

  // Command, Diplomacy & Communications
  "shield",
  "swords",
  "crown",
  "star",
  "laurel",
  "globe",
  "cards",
  "target",
  "radio",
  "clock",
  "log",
  "chat",
  "bot",
  "volume",
  "mute",
  "microphone",
  "send",
  "compass",
  "dice",
  "flag",
  "handshake",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

export interface IconShape {
  tag: "path" | "circle" | "rect" | "line" | "polyline" | "polygon";
  attrs: Record<string, string | number>;
}

/**
 * Unified 24x24 vector icon catalog with consistent 1.85 stroke weight,
 * round caps/joins, and 2px optical padding for crisp rendering from 11px to 36px.
 */
export const ICON_CATALOG: Record<IconName, readonly IconShape[]> = {
  // --- Identity & Social ---
  user: [
    { tag: "circle", attrs: { cx: 12, cy: 8, r: 4 } },
    { tag: "path", attrs: { d: "M4 21a8 8 0 0 1 16 0" } },
  ],
  users: [
    { tag: "path", attrs: { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" } },
    { tag: "circle", attrs: { cx: 9, cy: 7, r: 4 } },
    { tag: "path", attrs: { d: "M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" } },
  ],
  rank: [
    { tag: "path", attrs: { d: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H3v2a4 4 0 0 0 4 4M17 6h4v2a4 4 0 0 1-4 4" } },
  ],
  back: [
    { tag: "path", attrs: { d: "m15 18-6-6 6-6" } },
  ],
  logout: [
    { tag: "path", attrs: { d: "M10 17l5-5-5-5M15 12H3M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" } },
  ],
  settings: [
    { tag: "circle", attrs: { cx: 12, cy: 12, r: 3 } },
    {
      tag: "path",
      attrs: {
        d: "M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.16.38.37.72.6 1 .3.3.7.45 1.1.4h.09v4h-.09a1.7 1.7 0 0 0-1.7.6z",
      },
    },
  ],
  search: [
    { tag: "circle", attrs: { cx: 11, cy: 11, r: 8 } },
    { tag: "line", attrs: { x1: 21, y1: 21, x2: 16.65, y2: 16.65 } },
  ],
  copy: [
    { tag: "rect", attrs: { x: 9, y: 9, width: 13, height: 13, rx: 2, ry: 2 } },
    { tag: "path", attrs: { d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" } },
  ],
  check: [
    { tag: "polyline", attrs: { points: "20 6 9 17 4 12" } },
  ],
  close: [
    { tag: "line", attrs: { x1: 18, y1: 6, x2: 6, y2: 18 } },
    { tag: "line", attrs: { x1: 6, y1: 6, x2: 18, y2: 18 } },
  ],
  plus: [
    { tag: "line", attrs: { x1: 12, y1: 5, x2: 12, y2: 19 } },
    { tag: "line", attrs: { x1: 5, y1: 12, x2: 19, y2: 12 } },
  ],
  minus: [
    { tag: "line", attrs: { x1: 5, y1: 12, x2: 19, y2: 12 } },
  ],
  expand: [
    { tag: "polyline", attrs: { points: "15 3 21 3 21 9" } },
    { tag: "polyline", attrs: { points: "9 21 3 21 3 15" } },
    { tag: "line", attrs: { x1: 21, y1: 3, x2: 14, y2: 10 } },
    { tag: "line", attrs: { x1: 3, y1: 21, x2: 10, y2: 14 } },
  ],
  minimize: [
    { tag: "polyline", attrs: { points: "4 14 10 14 10 20" } },
    { tag: "polyline", attrs: { points: "20 10 14 10 14 4" } },
    { tag: "line", attrs: { x1: 14, y1: 10, x2: 21, y2: 3 } },
    { tag: "line", attrs: { x1: 3, y1: 21, x2: 10, y2: 14 } },
  ],
  eye: [
    { tag: "path", attrs: { d: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" } },
    { tag: "circle", attrs: { cx: 12, cy: 12, r: 3 } },
  ],
  "eye-off": [
    {
      tag: "path",
      attrs: {
        d: "M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24",
      },
    },
    { tag: "line", attrs: { x1: 1, y1: 1, x2: 23, y2: 23 } },
  ],
  lock: [
    { tag: "rect", attrs: { x: 3, y: 11, width: 18, height: 11, rx: 2, ry: 2 } },
    { tag: "path", attrs: { d: "M7 11V7a5 5 0 0 1 10 0v4" } },
  ],

  // --- Navigation & Directional Glyphs ---
  "chevron-up": [
    { tag: "polyline", attrs: { points: "18 15 12 9 6 15" } },
  ],
  "chevron-down": [
    { tag: "polyline", attrs: { points: "6 9 12 15 18 9" } },
  ],
  "chevron-right": [
    { tag: "polyline", attrs: { points: "9 18 15 12 9 6" } },
  ],
  "chevron-left": [
    { tag: "polyline", attrs: { points: "15 18 9 12 15 6" } },
  ],
  "arrow-right": [
    { tag: "line", attrs: { x1: 5, y1: 12, x2: 19, y2: 12 } },
    { tag: "polyline", attrs: { points: "13 6 19 12 13 18" } },
  ],
  reset: [
    { tag: "path", attrs: { d: "M3 12a9 9 0 1 0 3-6.7L3 8" } },
    { tag: "polyline", attrs: { points: "3 3 3 8 8 8" } },
  ],
  chevrons: [
    { tag: "path", attrs: { d: "m6 9 6 6 6-6M6 3l6 6 6-6" } },
  ],
  grip: [
    { tag: "circle", attrs: { cx: 9, cy: 6, r: 1.5 } },
    { tag: "circle", attrs: { cx: 9, cy: 12, r: 1.5 } },
    { tag: "circle", attrs: { cx: 9, cy: 18, r: 1.5 } },
    { tag: "circle", attrs: { cx: 15, cy: 6, r: 1.5 } },
    { tag: "circle", attrs: { cx: 15, cy: 12, r: 1.5 } },
    { tag: "circle", attrs: { cx: 15, cy: 18, r: 1.5 } },
  ],

  // --- Turn Phases (Deploy, Attack, Maneuver) ---
  // Deploy: Tactical drop-zone bracket + downward reinforcement arrow
  "phase-deploy": [
    { tag: "path", attrs: { d: "M12 3v11" } },
    { tag: "polyline", attrs: { points: "8 10 12 14 16 10" } },
    { tag: "path", attrs: { d: "M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" } },
    { tag: "line", attrs: { x1: 8, y1: 17, x2: 16, y2: 17 } },
  ],
  // Attack: Crossed combat blades
  "phase-attack": [
    { tag: "path", attrs: { d: "m14.5 17.5-11-11V3h3l11 11M13 19l6-6M16 16l4 4M9.5 17.5l11-11V3h-3l-11 11M5 13l6 6M4 20l4-4" } },
  ],
  // Maneuver: Dual tactical flanking/redeployment route arrows
  "phase-maneuver": [
    { tag: "path", attrs: { d: "M4 8h11a4 4 0 0 1 4 4v1" } },
    { tag: "polyline", attrs: { points: "15 5 19 8 15 11" } },
    { tag: "path", attrs: { d: "M20 16H9a4 4 0 0 1-4-4v-1" } },
    { tag: "polyline", attrs: { points: "9 19 5 16 9 13" } },
  ],

  // --- Economic Resources (HEGEM-63 Distinct Silhouettes) ---
  // Money / Coins: Banknote frame with central currency emblem (distinct from Gold bullion)
  coins: [
    { tag: "rect", attrs: { x: 2.5, y: 5.5, width: 19, height: 13, rx: 2 } },
    { tag: "circle", attrs: { cx: 12, cy: 12, r: 2.8 } },
    { tag: "path", attrs: { d: "M6 8.5v.01M18 15.5v.01" } },
  ],
  money: [
    { tag: "rect", attrs: { x: 2.5, y: 5.5, width: 19, height: 13, rx: 2 } },
    { tag: "circle", attrs: { cx: 12, cy: 12, r: 2.8 } },
    { tag: "path", attrs: { d: "M6 8.5v.01M18 15.5v.01" } },
  ],
  // Gold: Stacked trapezoidal bullion bars
  gold: [
    { tag: "polygon", attrs: { points: "6.5 13 9 7.5 15 7.5 17.5 13 6.5 13" } },
    { tag: "polygon", attrs: { points: "2.5 19.5 5 14 11 14 13.5 19.5 2.5 19.5" } },
    { tag: "polygon", attrs: { points: "10.5 19.5 13 14 19 14 21.5 19.5 10.5 19.5" } },
  ],
  // Steel: Industrial structural I-beam / girder profile (unmistakable at 12px)
  steel: [
    { tag: "path", attrs: { d: "M4 5h16v3.5h-5.5v7H20V19H4v-3.5h5.5v-7H4V5z" } },
  ],
  // Oil: High-contrast petroleum droplet with internal reflection arc
  oil: [
    { tag: "path", attrs: { d: "M12 2.5l5.5 6.2a7.5 7.5 0 1 1-11 0L12 2.5z" } },
    { tag: "path", attrs: { d: "M9.2 14.2a3.2 3.2 0 0 0 2.8 2.6" } },
  ],

  // --- Military Units & Doctrines ---
  // Helmet: Pure combat helmet silhouette for Classic / Standard Command doctrine
  helmet: [
    { tag: "path", attrs: { d: "M3.5 14.5c0-5 3.8-9 8.5-9s8.5 4 8.5 9c0 .6-.4 1-1 1h-1a3 3 0 0 1-2.5-1.3C16 12.8 14.2 12 12 12s-4 .8-5.5 2.2A3 3 0 0 1 4 15.5H3.5c-.6 0-1-.4-1-1z" } },
    { tag: "path", attrs: { d: "M2.5 14.5h19" } },
    { tag: "path", attrs: { d: "M8.5 15.5l1.5 3h4l1.5-3" } },
  ],
  // Infantry: Combat helmet dome with rim + tactical division chevron badge
  infantry: [
    { tag: "path", attrs: { d: "M4 13a8 8 0 0 1 16 0c0 1.2-.8 2-2 2H6c-1.2 0-2-.8-2-2z" } },
    { tag: "path", attrs: { d: "M2.5 13h19" } },
    { tag: "path", attrs: { d: "M7 15l2 4.5h6L17 15" } },
    { tag: "polyline", attrs: { points: "9.5 10 12 7.5 14.5 10" } },
  ],
  // Tank: Armored battle tank with sloped hull, road wheels inside track, turret & heavy barrel
  tank: [
    { tag: "rect", attrs: { x: 2.5, y: 14, width: 19, height: 5.5, rx: 2.75 } },
    { tag: "path", attrs: { d: "M5.5 14l2-4.5h8l2.5 4.5" } },
    { tag: "path", attrs: { d: "M8.5 9.5V7h4.5v2.5" } },
    { tag: "line", attrs: { x1: 13, y1: 8.2, x2: 22, y2: 8.2 } },
    { tag: "circle", attrs: { cx: 6.5, cy: 16.75, r: 1.1 } },
    { tag: "circle", attrs: { cx: 12, cy: 16.75, r: 1.1 } },
    { tag: "circle", attrs: { cx: 17.5, cy: 16.75, r: 1.1 } },
  ],
  // Artillery: Field howitzer cannon with gun shield, elevated barrel, recoil cradle & carriage wheel
  artillery: [
    { tag: "circle", attrs: { cx: 8.5, cy: 17, r: 3.5 } },
    { tag: "circle", attrs: { cx: 8.5, cy: 17, r: 1 } },
    { tag: "path", attrs: { d: "M2 20.5h6.5" } },
    { tag: "path", attrs: { d: "M10.5 14.5 20.5 6.5l1.5 2-9.5 8" } },
    { tag: "path", attrs: { d: "M7 13.5l3-4.5 2.5 1.5" } },
    { tag: "line", attrs: { x1: 2, y1: 20.5, x2: 22, y2: 20.5 } },
  ],
  // Aircraft: Supersonic swept-wing tactical fighter jet silhouette
  aircraft: [
    {
      tag: "path",
      attrs: {
        d: "M12 2.5 14 8l7.5 4.5v2L14 12.5l-.5 5 3 2v1.5L12 19.5 7.5 21v-1.5l3-2-.5-5L2.5 14.5v-2L10 8 12 2.5z",
      },
    },
  ],
  // Airfield: Military airbase runway perspective with control tower & radar beacon
  airfield: [
    { tag: "path", attrs: { d: "M3 20 7.5 9h9L21 20" } },
    { tag: "line", attrs: { x1: 12, y1: 11, x2: 12, y2: 13.5 } },
    { tag: "line", attrs: { x1: 12, y1: 16, x2: 12, y2: 19 } },
    { tag: "path", attrs: { d: "M9 9V5.5h6V9" } },
    { tag: "line", attrs: { x1: 8, y1: 5.5, x2: 16, y2: 5.5 } },
    { tag: "line", attrs: { x1: 12, y1: 3, x2: 12, y2: 5.5 } },
  ],
  // Navy: Armored naval destroyer / battleship profile with hull, bridge mast & gun turret
  navy: [
    { tag: "path", attrs: { d: "M2 15h20l-2.5 4.5H4.5L2 15z" } },
    { tag: "path", attrs: { d: "M6 15v-3.5h8V15" } },
    { tag: "path", attrs: { d: "M9 11.5V8h3v3.5" } },
    { tag: "line", attrs: { x1: 10.5, y1: 5.5, x2: 10.5, y2: 8 } },
    { tag: "line", attrs: { x1: 14, y1: 13, x2: 18.5, y2: 11.5 } },
  ],
  // Port: Naval dockyard with harbor pier, gantry crane & maritime wave
  port: [
    { tag: "path", attrs: { d: "M3 19c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0" } },
    { tag: "path", attrs: { d: "M5 16V5h11l-3 4H5" } },
    { tag: "line", attrs: { x1: 14, y1: 5, x2: 14, y2: 12 } },
    { tag: "rect", attrs: { x: 11.5, y: 12, width: 5, height: 3.5, rx: 0.8 } },
    { tag: "line", attrs: { x1: 3, y1: 16, x2: 10, y2: 16 } },
  ],
  // Anchor: Classic naval maritime anchor
  anchor: [
    { tag: "circle", attrs: { cx: 12, cy: 5, r: 2.5 } },
    { tag: "line", attrs: { x1: 12, y1: 21, x2: 12, y2: 7.5 } },
    { tag: "line", attrs: { x1: 8.5, y1: 10.5, x2: 15.5, y2: 10.5 } },
    { tag: "path", attrs: { d: "M5 14H3a9 9 0 0 0 18 0h-2" } },
  ],

  // --- Territorial Buildings & Fortifications ---
  // Market: Classical financial exchange facade with pediment & columns
  market: [
    { tag: "polygon", attrs: { points: "12 3 21 8 3 8 12 3" } },
    { tag: "line", attrs: { x1: 3, y1: 20, x2: 21, y2: 20 } },
    { tag: "line", attrs: { x1: 6, y1: 8, x2: 6, y2: 17 } },
    { tag: "line", attrs: { x1: 10, y1: 8, x2: 10, y2: 17 } },
    { tag: "line", attrs: { x1: 14, y1: 8, x2: 14, y2: 17 } },
    { tag: "line", attrs: { x1: 18, y1: 8, x2: 18, y2: 17 } },
    { tag: "line", attrs: { x1: 4, y1: 17, x2: 20, y2: 17 } },
  ],
  // Industry: Heavy military-industrial factory with twin smokestacks & sawtooth roof
  industry: [
    { tag: "path", attrs: { d: "M2 20h20" } },
    { tag: "path", attrs: { d: "M3 20V11l4.5 3V11l4.5 3V9h9v11" } },
    { tag: "path", attrs: { d: "M14.5 9V4.5h2.5V9M18.5 9V6h2V9" } },
    { tag: "rect", attrs: { x: 6, y: 16, width: 3, height: 4 } },
    { tag: "line", attrs: { x1: 14.5, y1: 13.5, x2: 18.5, y2: 13.5 } },
    { tag: "line", attrs: { x1: 14.5, y1: 16.5, x2: 18.5, y2: 16.5 } },
  ],
  // Fortification (Nv. 1 Casamata): Reinforced concrete military bunker with firing embrasure
  fortification: [
    { tag: "path", attrs: { d: "M2 19h20" } },
    { tag: "path", attrs: { d: "M3.5 19v-6.5L7 8h10l3.5 4.5V19" } },
    { tag: "rect", attrs: { x: 7.5, y: 12, width: 9, height: 2.8, rx: 0.8 } },
    { tag: "path", attrs: { d: "M6 8V6h3v2M15 8V6h3v2" } },
  ],
  fortress: [
    { tag: "path", attrs: { d: "M3 20h18v-8l-3-2V5h-3v3h-2V5h-2v3H9V5H6v5l-3 2z" } },
    { tag: "path", attrs: { d: "M10 20v-4a2 2 0 0 1 4 0v4" } },
  ],
  // Fortification L2 (Nv. 2 Fortaleza): Bastion citadel with crenellated twin towers & defense shield
  "fortification-l2": [
    { tag: "path", attrs: { d: "M2.5 20h19v-8.5l-2.5-2V4.5h-3.5v3h-2v-3h-3v3h-2v-3H5v5l-2.5 2z" } },
    { tag: "path", attrs: { d: "M12 11.5l3.5 1.5v2.5c0 2.2-3.5 3.5-3.5 3.5s-3.5-1.3-3.5-3.5V13l3.5-1.5z" } },
  ],
  military_factory: [
    { tag: "path", attrs: { d: "M2 20h20" } },
    { tag: "path", attrs: { d: "M4 20V10l5 3V10l5 3V6h5v14" } },
    { tag: "line", attrs: { x1: 14.5, y1: 10, x2: 17.5, y2: 10 } },
    { tag: "line", attrs: { x1: 16, y1: 8.5, x2: 16, y2: 11.5 } },
  ],
  civilian_factory: [
    { tag: "path", attrs: { d: "M2 20h20" } },
    { tag: "path", attrs: { d: "M4 20V11l4 2.5V11l4 2.5V8h8v12" } },
    { tag: "circle", attrs: { cx: 16, cy: 13, r: 2 } },
  ],
  steel_mine: [
    { tag: "path", attrs: { d: "M3 21h18L12 4 3 21z" } },
    { tag: "path", attrs: { d: "M9 21v-4a3 3 0 0 1 6 0v4" } },
    { tag: "line", attrs: { x1: 12, y1: 8, x2: 12, y2: 13 } },
  ],
  oil_well: [
    { tag: "path", attrs: { d: "M6 21l6-17 6 17" } },
    { tag: "line", attrs: { x1: 8, y1: 15, x2: 16, y2: 15 } },
    { tag: "line", attrs: { x1: 9.5, y1: 10, x2: 14.5, y2: 10 } },
    { tag: "circle", attrs: { cx: 12, cy: 3, r: 1.5 } },
  ],
  refinery: [
    { tag: "rect", attrs: { x: 5, y: 7, width: 6, height: 14, rx: 1 } },
    { tag: "rect", attrs: { x: 13, y: 11, width: 6, height: 10, rx: 1 } },
    { tag: "path", attrs: { d: "M8 7V3h8v8" } },
  ],
  // Wonder: Sovereign Bastion Monument / Citadel Spire with triumphant star beacon
  wonder: [
    { tag: "path", attrs: { d: "M12 2l2.2 4.8L19.5 7.5l-3.5 3.8.9 5.2-4.9-2.7-4.9 2.7.9-5.2-3.5-3.8 5.3-.7L12 2z" } },
    { tag: "path", attrs: { d: "M4 22h16" } },
    { tag: "path", attrs: { d: "M6 22v-3.5h12V22" } },
    { tag: "line", attrs: { x1: 9.5, y1: 18.5, x2: 9.5, y2: 22 } },
    { tag: "line", attrs: { x1: 14.5, y1: 18.5, x2: 14.5, y2: 22 } },
  ],

  // --- Logistics, Tactical Status & Combat Missions ---
  // Supply Cut / Encirclement: Broken supply crate with diagonal sever line
  "supply-cut": [
    { tag: "path", attrs: { d: "M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" } },
    { tag: "path", attrs: { d: "m3.3 7 8.7 5 8.7-5M12 22V12" } },
    { tag: "line", attrs: { x1: 3, y1: 3, x2: 21, y2: 21 } },
  ],
  // Fuel Empty: Jerrycan / fuel canister with warning slash
  "fuel-empty": [
    { tag: "rect", attrs: { x: 5, y: 6, width: 12, height: 15, rx: 2 } },
    { tag: "path", attrs: { d: "M8 6V4h5l3 2M17 9l3-2v5l-3-1" } },
    { tag: "line", attrs: { x1: 8, y1: 11, x2: 14, y2: 17 } },
    { tag: "line", attrs: { x1: 14, y1: 11, x2: 8, y2: 17 } },
  ],
  // Blitzkrieg: High-voltage armored spearhead lightning bolt
  blitzkrieg: [
    { tag: "polygon", attrs: { points: "13 2 4 14 11 14 10 22 20 10 13 10 13 2" } },
  ],
  // Blockade: Naval prohibition / interdiction sign
  blockade: [
    { tag: "circle", attrs: { cx: 12, cy: 12, r: 9 } },
    { tag: "line", attrs: { x1: 5.6, y1: 5.6, x2: 18.4, y2: 18.4 } },
  ],
  // Capital: Five-pointed command star inside a crest ring
  capital: [
    { tag: "polygon", attrs: { points: "12 2.5 14.9 8.4 21.4 9.3 16.7 13.9 17.8 20.4 12 17.3 6.2 20.4 7.3 13.9 2.6 9.3 9.1 8.4 12 2.5" } },
  ],
  // Fallen Capital: Breached command star with diagonal strike
  "capital-fallen": [
    { tag: "polygon", attrs: { points: "12 2.5 14.9 8.4 21.4 9.3 16.7 13.9 17.8 20.4 12 17.3 6.2 20.4 7.3 13.9 2.6 9.3 9.1 8.4 12 2.5" } },
    { tag: "line", attrs: { x1: 4, y1: 4, x2: 20, y2: 20 } },
  ],
  // Infamy: Threat flame silhouette
  infamy: [
    {
      tag: "path",
      attrs: {
        d: "M12 22c4.97 0 8-3.58 8-8 0-3.5-2.5-6.5-4-8-.5 2-2 3-3 3-1.5 0-2-2-1-5-3.5 2-6 5.5-6 10 0 4.42 3.03 8 6 8z",
      },
    },
  ],
  // Alert: Tactical warning triangle
  alert: [
    { tag: "path", attrs: { d: "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" } },
    { tag: "line", attrs: { x1: 12, y1: 9, x2: 12, y2: 13 } },
    { tag: "line", attrs: { x1: 12, y1: 17, x2: 12.01, y2: 17 } },
  ],
  // Bombardment: Aerial ordnance / strategic bomb
  bombardment: [
    { tag: "circle", attrs: { cx: 11, cy: 13, r: 6 } },
    { tag: "path", attrs: { d: "M15.5 8.5 19 5M18 3l3 3M20 8l2-1M16 4l1-2" } },
  ],
  // Recon Plane: Binoculars / aerial intelligence optics
  "recon-plane": [
    { tag: "circle", attrs: { cx: 7, cy: 15, r: 4 } },
    { tag: "circle", attrs: { cx: 17, cy: 15, r: 4 } },
    { tag: "path", attrs: { d: "M5 11 7 5h3l1 6M19 11l-2-6h-3l-1 6M10 14h4" } },
  ],

  // --- Command, Diplomacy & Communications ---
  shield: [
    { tag: "path", attrs: { d: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" } },
  ],
  swords: [
    { tag: "path", attrs: { d: "m14.5 17.5-11-11V3h3l11 11M13 19l6-6M16 16l4 4M9.5 17.5l11-11V3h-3l-11 11M5 13l6 6M4 20l4-4" } },
  ],
  crown: [
    { tag: "path", attrs: { d: "m2 18 3-11 4.5 5L12 5l2.5 7L19 7l3 11zM4 22h16" } },
  ],
  star: [
    { tag: "path", attrs: { d: "m12 2 3 6 7 .9-5 4.8 1.2 7-6.2-3.3-6.2 3.3 1.2-7-5-4.8L9 8z" } },
  ],
  laurel: [
    { tag: "path", attrs: { d: "M8 21c-5-3-6-9-3-15 4 2 6 6 5 10M16 21c5-3 6-9 3-15-4 2-6 6-5 10M8 21h8" } },
  ],
  globe: [
    { tag: "circle", attrs: { cx: 12, cy: 12, r: 10 } },
    { tag: "line", attrs: { x1: 2, y1: 12, x2: 22, y2: 12 } },
    { tag: "path", attrs: { d: "M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" } },
  ],
  cards: [
    { tag: "rect", attrs: { x: 3, y: 4, width: 13, height: 17, rx: 2 } },
    { tag: "path", attrs: { d: "M16 7h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-1" } },
  ],
  target: [
    { tag: "circle", attrs: { cx: 12, cy: 12, r: 10 } },
    { tag: "circle", attrs: { cx: 12, cy: 12, r: 6 } },
    { tag: "circle", attrs: { cx: 12, cy: 12, r: 2 } },
  ],
  radio: [
    { tag: "path", attrs: { d: "M4.9 19.1C1 15.2 1 8.8 4.9 4.9" } },
    { tag: "path", attrs: { d: "M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" } },
    { tag: "circle", attrs: { cx: 12, cy: 12, r: 2 } },
    { tag: "path", attrs: { d: "M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" } },
    { tag: "path", attrs: { d: "M19.1 4.9C23 8.8 23 15.2 19.1 19.1" } },
  ],
  clock: [
    { tag: "circle", attrs: { cx: 12, cy: 12, r: 10 } },
    { tag: "polyline", attrs: { points: "12 6 12 12 16 14" } },
  ],
  log: [
    { tag: "path", attrs: { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" } },
    { tag: "polyline", attrs: { points: "14 2 14 8 20 8" } },
    { tag: "line", attrs: { x1: 8, y1: 13, x2: 16, y2: 13 } },
    { tag: "line", attrs: { x1: 8, y1: 17, x2: 16, y2: 17 } },
  ],
  chat: [
    { tag: "path", attrs: { d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" } },
  ],
  bot: [
    { tag: "rect", attrs: { x: 3, y: 8, width: 18, height: 12, rx: 2 } },
    { tag: "path", attrs: { d: "M12 2v6" } },
    { tag: "line", attrs: { x1: 8, y1: 14, x2: 8, y2: 14.01 } },
    { tag: "line", attrs: { x1: 16, y1: 14, x2: 16, y2: 14.01 } },
  ],
  volume: [
    { tag: "polygon", attrs: { points: "11 5 6 9 2 9 2 15 6 15 11 19 11 5" } },
    { tag: "path", attrs: { d: "M15.54 8.46a5 5 0 0 1 0 7.07" } },
    { tag: "path", attrs: { d: "M19.07 4.93a10 10 0 0 1 0 14.14" } },
  ],
  mute: [
    { tag: "polygon", attrs: { points: "11 5 6 9 2 9 2 15 6 15 11 19 11 5" } },
    { tag: "line", attrs: { x1: 23, y1: 9, x2: 17, y2: 15 } },
    { tag: "line", attrs: { x1: 17, y1: 9, x2: 23, y2: 15 } },
  ],
  microphone: [
    { tag: "rect", attrs: { x: 9, y: 2, width: 6, height: 12, rx: 3 } },
    { tag: "path", attrs: { d: "M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" } },
  ],
  send: [
    { tag: "path", attrs: { d: "m22 2-7 20-4-9-9-4Z" } },
    { tag: "path", attrs: { d: "M22 2 11 13" } },
  ],
  compass: [
    { tag: "circle", attrs: { cx: 12, cy: 12, r: 10 } },
    { tag: "polygon", attrs: { points: "16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" } },
  ],
  dice: [
    { tag: "rect", attrs: { x: 3, y: 3, width: 18, height: 18, rx: 3 } },
    { tag: "circle", attrs: { cx: 8.5, cy: 8.5, r: 1.2, fill: "currentColor" } },
    { tag: "circle", attrs: { cx: 15.5, cy: 8.5, r: 1.2, fill: "currentColor" } },
    { tag: "circle", attrs: { cx: 12, cy: 12, r: 1.2, fill: "currentColor" } },
    { tag: "circle", attrs: { cx: 8.5, cy: 15.5, r: 1.2, fill: "currentColor" } },
    { tag: "circle", attrs: { cx: 15.5, cy: 15.5, r: 1.2, fill: "currentColor" } },
  ],
  flag: [
    { tag: "path", attrs: { d: "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" } },
    { tag: "line", attrs: { x1: 4, y1: 22, x2: 4, y2: 15 } },
  ],
  handshake: [
    { tag: "path", attrs: { d: "m11 17 2 2a1 1 0 0 0 1.4 0l4.3-4.3a1 1 0 0 0 0-1.4l-2.6-2.6a1 1 0 0 0-1.4 0L13 12" } },
    { tag: "path", attrs: { d: "m18 10 3.3-3.3a1 1 0 0 0 0-1.4l-2.6-2.6a1 1 0 0 0-1.4 0L14 6" } },
    { tag: "path", attrs: { d: "m2 14 3.3 3.3a1 1 0 0 0 1.4 0l4.3-4.3" } },
    { tag: "path", attrs: { d: "m7 9 4.3 4.3" } },
    { tag: "path", attrs: { d: "m15 5-8.3 8.3a1 1 0 0 0 0 1.4l2.6 2.6a1 1 0 0 0 1.4 0L19 9" } },
  ],
};

export function isKnownIconName(name: string): name is IconName {
  return Object.prototype.hasOwnProperty.call(ICON_CATALOG, name);
}

export function resolveIconShapes(name: IconName): readonly IconShape[] {
  const shapes = ICON_CATALOG[name];
  if (!shapes) {
    throw new Error(`[Hegemonia Icon System] Unknown icon name: "${name}"`);
  }
  return shapes;
}
