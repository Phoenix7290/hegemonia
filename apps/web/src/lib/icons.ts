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
  infantry: [
    { tag: "circle", attrs: { cx: 12, cy: 5, r: 2.5 } },
    { tag: "path", attrs: { d: "M8 21v-5l-2-3 2-5h8l2 5-2 3v5M10 21l2-7 2 7M7 11h10" } },
  ],
  tank: [
    { tag: "path", attrs: { d: "M3 15h18v4H3zM5 15l2-5h8l3 5M9 10V7h5v3M14 8h7" } },
    { tag: "circle", attrs: { cx: 7, cy: 19, r: 2 } },
    { tag: "circle", attrs: { cx: 17, cy: 19, r: 2 } },
  ],
  artillery: [
    { tag: "circle", attrs: { cx: 8, cy: 18, r: 3 } },
    { tag: "path", attrs: { d: "M8 15l5-7 8 3-1 3-8-2M3 21h18M13 8l2-4 5 2" } },
  ],
  aircraft: [
    {
      tag: "path",
      attrs: {
        d: "M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z",
      },
    },
  ],
  airfield: [
    {
      tag: "path",
      attrs: {
        d: "M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z",
      },
    },
  ],
  navy: [
    { tag: "circle", attrs: { cx: 12, cy: 5, r: 3 } },
    { tag: "line", attrs: { x1: 12, y1: 22, x2: 12, y2: 8 } },
    { tag: "path", attrs: { d: "M5 12H2a10 10 0 0 0 20 0h-3" } },
  ],
  port: [
    { tag: "circle", attrs: { cx: 12, cy: 5, r: 3 } },
    { tag: "line", attrs: { x1: 12, y1: 22, x2: 12, y2: 8 } },
    { tag: "path", attrs: { d: "M5 12H2a10 10 0 0 0 20 0h-3" } },
  ],
  anchor: [
    { tag: "circle", attrs: { cx: 12, cy: 5, r: 3 } },
    { tag: "line", attrs: { x1: 12, y1: 22, x2: 12, y2: 8 } },
    { tag: "path", attrs: { d: "M5 12H2a10 10 0 0 0 20 0h-3" } },
  ],

  // --- Territorial Buildings & Fortifications ---
  market: [
    { tag: "path", attrs: { d: "M3 9l1.8-5h14.4L21 9" } },
    { tag: "path", attrs: { d: "M3 9c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3" } },
    { tag: "path", attrs: { d: "M5 12v8h14v-8" } },
    { tag: "line", attrs: { x1: 9, y1: 20, x2: 9, y2: 15 } },
    { tag: "line", attrs: { x1: 15, y1: 20, x2: 15, y2: 15 } },
  ],
  industry: [
    { tag: "path", attrs: { d: "M2 20h20" } },
    { tag: "path", attrs: { d: "M4 20V10l5 3V10l5 3V6h5v14" } },
    { tag: "line", attrs: { x1: 16, y1: 10, x2: 16, y2: 10.01 } },
    { tag: "line", attrs: { x1: 16, y1: 14, x2: 16, y2: 14.01 } },
  ],
  fortification: [
    { tag: "path", attrs: { d: "M3 20h18v-8l-3-2V5h-3v3h-2V5h-2v3H9V5H6v5l-3 2z" } },
    { tag: "path", attrs: { d: "M10 20v-4a2 2 0 0 1 4 0v4" } },
  ],
  fortress: [
    { tag: "path", attrs: { d: "M3 20h18v-8l-3-2V5h-3v3h-2V5h-2v3H9V5H6v5l-3 2z" } },
    { tag: "path", attrs: { d: "M10 20v-4a2 2 0 0 1 4 0v4" } },
  ],
  "fortification-l2": [
    { tag: "path", attrs: { d: "M3 20h18v-8l-3-2V5h-3v3h-2V5h-2v3H9V5H6v5l-3 2z" } },
    { tag: "path", attrs: { d: "M9 14l3-2.5 3 2.5v6H9z" } },
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
