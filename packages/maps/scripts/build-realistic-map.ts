import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as d3 from "d3-geo";
import * as topojson from "topojson-client";
import * as topojsonServer from "topojson-server";
import polygonClipping from "polygon-clipping";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const c110 = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../node_modules/world-atlas/countries-110m.json"),
    "utf-8"
  )
);

const c50 = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../node_modules/world-atlas/countries-50m.json"),
    "utf-8"
  )
);

async function loadAdmin1GeoJson(): Promise<any> {
  const tmpPath = "/tmp/ne_50m_admin_1.geojson";
  const localCachePath = path.join(__dirname, ".ne_50m_admin_1.geojson");

  if (fs.existsSync(tmpPath)) {
    return JSON.parse(fs.readFileSync(tmpPath, "utf-8"));
  }
  if (fs.existsSync(localCachePath)) {
    return JSON.parse(fs.readFileSync(localCachePath, "utf-8"));
  }

  console.log("⏬ Baixando ne_50m_admin_1_states_provinces.geojson do Natural Earth...");
  const res = await fetch(
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson"
  );
  if (!res.ok) {
    throw new Error(`Falha ao baixar Natural Earth Admin-1: ${res.status}`);
  }
  const text = await res.text();
  fs.writeFileSync(localCachePath, text, "utf-8");
  return JSON.parse(text);
}

const admin1Raw = await loadAdmin1GeoJson();

// Explode Russian MultiPolygons and shift negative longitudes (< 0) in Chukotka/Wrangel by +360
const expandedFeatures: any[] = [];
for (const f of admin1Raw.features) {
  if (f.properties.adm0_a3 === "RUS" && f.geometry.type === "MultiPolygon") {
    const shiftRing = (ring: number[][]) =>
      ring.map(([lon, lat]) => [
        Math.abs(Math.abs(lon) - 180) < 5e-4 ? 180 : lon < 0 ? lon + 360 : lon,
        lat,
      ]);
    for (const poly of f.geometry.coordinates) {
      expandedFeatures.push({
        type: "Feature",
        properties: f.properties,
        geometry: { type: "Polygon", coordinates: poly.map(shiftRing) },
      });
    }
  } else {
    expandedFeatures.push(f);
  }
}

const admin1Topo = topojsonServer.topology(
  { states: { type: "FeatureCollection", features: expandedFeatures } },
  1e5
) as any;
const admin1Geoms: any[] = admin1Topo.objects.states.geometries;

const MAP_WIDTH = 1200;
const BASE_PROJ = d3
  .geoEquirectangular()
  .scale(MAP_WIDTH / (2 * Math.PI))
  .translate([MAP_WIDTH / 2, 320]);

const UNCLIPPED_EQUIRECT_TRANSFORM = d3.geoTransform({
  point(lon: number, lat: number) {
    const x = 600 + (lon * 1200) / 360;
    const y = 320 - (lat * 600) / 180;
    this.stream.point(x, y);
  },
});

type BBox = [number, number, number, number];
const AREA_CHECK_PATH = d3.geoPath(UNCLIPPED_EQUIRECT_TRANSFORM);

function fixSphericalWinding(multiCoords: number[][][][]): number[][][][] {
  return multiCoords.map((poly) =>
    poly.map((ring, i) => {
      if (i > 0) return ring;
      const area = d3.geoArea({ type: "Polygon", coordinates: [ring] } as any);
      return area > 2 * Math.PI ? [...ring].reverse() : ring;
    })
  );
}

function cleanMultiPolygon(geojson: any, minAreaSqPx = 1.6): any {
  if (!geojson) return geojson;
  if (geojson.type === "Polygon") {
    const fixed = fixSphericalWinding([geojson.coordinates]);
    return {
      type: "Polygon",
      coordinates: [fixed[0][0]],
    };
  }
  if (geojson.type === "MultiPolygon") {
    const outerOnly = fixSphericalWinding(
      geojson.coordinates.map((coords: any[]) => [coords[0]])
    );
    const kept = outerOnly.filter((coords: any[]) => {
      const poly = { type: "Polygon", coordinates: coords };
      const area = AREA_CHECK_PATH.area(poly as any);
      if (area < minAreaSqPx || area >= 250000) return false;
      const ring = coords[0] as number[][];
      const lons = ring.map((p) => p[0]);
      const lats = ring.map((p) => p[1]);
      const spanLon = Math.max(...lons) - Math.min(...lons);
      const spanLat = Math.max(...lats) - Math.min(...lats);
      const long = Math.max(spanLon, spanLat);
      const thin = Math.min(spanLon, spanLat);
      if (long > 2 && thin < 0.35 && long / Math.max(thin, 1e-6) > 12) return false;
      return true;
    });
    return {
      type: "MultiPolygon",
      coordinates: kept.length > 0 ? kept : outerOnly.slice(0, 1),
    };
  }
  return geojson;
}

function mergeCountries(names: string[]) {
  const nameSet = new Set(names);
  const geoms = c110.objects.countries.geometries.filter((g: any) =>
    nameSet.has(g.properties.name)
  );
  if (geoms.length === 0) {
    throw new Error(`No country geometries found for: ${names.join(", ")}`);
  }
  return cleanMultiPolygon(topojson.merge(c110, geoms), 0.5);
}

function mergeAdmin1ByCodes(codes: string[], minAreaSqPx = 1.8) {
  const codeSet = new Set(codes);
  const geoms = admin1Geoms.filter((g: any) => codeSet.has(g.properties.adm1_code));
  if (geoms.length === 0) {
    throw new Error(`No Admin-1 geometries found for codes: ${codes.join(", ")}`);
  }
  return cleanMultiPolygon(topojson.merge(admin1Topo, geoms), minAreaSqPx);
}

function unionGeometries(geoms: any[], minAreaSqPx = 0.2): any {
  const polys = geoms.flatMap((g) =>
    (g.type === "Polygon" ? [g.coordinates] : g.coordinates).map((poly: number[][][]) => [poly])
  );
  const merged = polygonClipping.union(polys[0], ...polys.slice(1)) as number[][][][];
  return cleanMultiPolygon(
    { type: "MultiPolygon", coordinates: fixSphericalWinding(merged) },
    minAreaSqPx
  );
}

function differenceGeometries(baseGeom: any, subtractGeom: any, minAreaSqPx = 0.4): any {
  const baseMulti = baseGeom.type === "Polygon" ? [baseGeom.coordinates] : baseGeom.coordinates;
  const subMulti =
    subtractGeom.type === "Polygon" ? [subtractGeom.coordinates] : subtractGeom.coordinates;
  const diff = polygonClipping.difference(baseMulti as any, subMulti as any) as number[][][][];
  return cleanMultiPolygon(
    { type: "MultiPolygon", coordinates: fixSphericalWinding(diff) },
    minAreaSqPx
  );
}

function clipGeometryByPolygon(geojson: any, clipRing: [number, number][], minAreaSqPx = 0.4): any {
  const multi = geojson.type === "Polygon" ? [geojson.coordinates] : geojson.coordinates;
  const clipPoly = [[[...clipRing, clipRing[0]]]];
  const out = polygonClipping.intersection(clipPoly as any, multi as any) as number[][][][];
  return cleanMultiPolygon(
    { type: "MultiPolygon", coordinates: fixSphericalWinding(out) },
    minAreaSqPx
  );
}

function clipGeometryToBox(geojson: any, [w, s, e, n]: [number, number, number, number]): any {
  return clipGeometryByPolygon(geojson, [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
  ]);
}

function scaleGeometry(geojson: any, k: number): any {
  const [cx, cy] = d3.geoCentroid(geojson);
  const sc = (ring: number[][]) => ring.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
  if (geojson.type === "Polygon") return { type: "Polygon", coordinates: geojson.coordinates.map(sc) };
  return { type: "MultiPolygon", coordinates: geojson.coordinates.map((p: any[]) => p.map(sc)) };
}

function rectGeometry(lon0: number, lat0: number, lon1: number, lat1: number): any {
  return {
    type: "Polygon",
    coordinates: [[[lon0, lat0], [lon1, lat0], [lon1, lat1], [lon0, lat1], [lon0, lat0]]],
  };
}

function ringCenter(ring: number[][]): [number, number] {
  let w = Infinity, e = -Infinity, so = Infinity, n = -Infinity;
  for (const [x, y] of ring) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < so) so = y;
    if (y > n) n = y;
  }
  return [(w + e) / 2, (so + n) / 2];
}

function geomCenter(geom: any): [number, number] {
  const feat: any = topojson.feature(admin1Topo, geom);
  const ring =
    feat.geometry.type === "Polygon"
      ? feat.geometry.coordinates[0]
      : feat.geometry.coordinates[0][0];
  return ringCenter(ring);
}

function filterPolygons(geojson: any, keep: (ring: number[][]) => boolean): any {
  const polys: number[][][][] =
    geojson.type === "Polygon" ? [geojson.coordinates] : geojson.coordinates;
  return { type: "MultiPolygon", coordinates: polys.filter((poly) => keep(poly[0])) };
}

function ringSpan(ring: number[][]): number {
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

function mergeCountries50(
  parts: { name: string; box?: [number, number, number, number] }[],
  minAreaSqPx = 0.8
) {
  const geoms: any[] = [];
  for (const part of parts) {
    const g = c50.objects.countries.geometries.find((x: any) => x.properties.name === part.name);
    if (!g) throw new Error(`50m country not found: ${part.name}`);
    const polys: any[] = g.type === "Polygon" ? [g.arcs] : g.arcs;
    const kept = part.box
      ? polys.filter((arcs) => {
          const feat: any = topojson.feature(c50, { type: "Polygon", arcs } as any);
          const [cx, cy] = ringCenter(feat.geometry.coordinates[0]);
          return (
            cx >= part.box![0] &&
            cy >= part.box![1] &&
            cx <= part.box![2] &&
            cy <= part.box![3]
          );
        })
      : polys;
    if (kept.length > 0) geoms.push({ type: "MultiPolygon", arcs: kept });
  }
  return cleanMultiPolygon(topojson.merge(c50, geoms), minAreaSqPx);
}

function smoothPolygonsInBox(
  geojson: any,
  box: [number, number, number, number],
  tolerance = 0.03,
  iterations = 2
): any {
  const dp = (pts: number[][], tol: number): number[][] => {
    if (pts.length < 3) return pts;
    const [x1, y1] = pts[0];
    const [x2, y2] = pts[pts.length - 1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1e-12;
    let idx = 0;
    let max = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const dist = Math.abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / len;
      if (dist > max) {
        max = dist;
        idx = i;
      }
    }
    if (max <= tol) return [pts[0], pts[pts.length - 1]];
    return [...dp(pts.slice(0, idx + 1), tol).slice(0, -1), ...dp(pts.slice(idx), tol)];
  };
  const chaikin = (ring: number[][]): number[][] => {
    const open = ring.slice(0, -1);
    const out: number[][] = [];
    for (let i = 0; i < open.length; i++) {
      const a = open[i];
      const b = open[(i + 1) % open.length];
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      out.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    out.push(out[0]);
    return out;
  };
  const polys: number[][][][] =
    geojson.type === "Polygon" ? [geojson.coordinates] : geojson.coordinates;
  const result = polys.map((poly) => {
    const [cx, cy] = ringCenter(poly[0]);
    if (cx < box[0] || cy < box[1] || cx > box[2] || cy > box[3]) return poly;
    return poly.map((ring) => {
      const mid = Math.floor(ring.length / 2);
      let r = [
        ...dp(ring.slice(0, mid + 1), tolerance).slice(0, -1),
        ...dp(ring.slice(mid), tolerance),
      ];
      if (r.length < 4) return ring;
      for (let i = 0; i < iterations; i++) r = chaikin(r);
      return r;
    });
  });
  return { type: "MultiPolygon", coordinates: result };
}

function renderGeometry(
  geojson: any,
  boxes?: BBox[],
  allowCrossAntimeridian = false
): { d: string; center: [number, number] } {
  if (allowCrossAntimeridian) {
    const pathGen = d3.geoPath(UNCLIPPED_EQUIRECT_TRANSFORM).digits(1);
    const d = pathGen(geojson) || "";
    const c = pathGen.centroid(geojson);
    return { d, center: [Math.round(c[0]), Math.round(c[1])] };
  }

  if (!boxes || boxes.length === 0) {
    const pathGen = d3.geoPath(BASE_PROJ).digits(1);
    const d = pathGen(geojson) || "";
    const c = pathGen.centroid(geojson);
    return { d, center: [Math.round(c[0]), Math.round(c[1])] };
  }

  const paths: string[] = [];
  let bestArea = -1;
  let bestCentroid: [number, number] = [600, 300];

  for (const [lon0, lat0, lon1, lat1] of boxes) {
    const [x0, y1] = BASE_PROJ([lon0, lat0])!;
    const [x1, y0] = BASE_PROJ([lon1, lat1])!;
    const proj = d3
      .geoEquirectangular()
      .scale(MAP_WIDTH / (2 * Math.PI))
      .translate([MAP_WIDTH / 2, 320])
      .postclip(d3.geoClipRectangle(x0, y0, x1, y1));

    const pathGen = d3.geoPath(proj).digits(1);
    let subD = pathGen(geojson);
    if (subD) {
      subD = subD
        .split(/(?=M)/)
        .filter((sub) => {
          const nums = sub.match(/-?\d+\.?\d*/g)?.map(Number) ?? [];
          if (nums.length < 6) return true;
          const xs = nums.filter((_, idx) => idx % 2 === 0);
          const ys = nums.filter((_, idx) => idx % 2 === 1);
          const w = Math.max(...xs) - Math.min(...xs);
          const h = Math.max(...ys) - Math.min(...ys);
          const long = Math.max(w, h);
          const thin = Math.min(w, h);
          return !(long > 6 && thin < 1.3 && long / Math.max(thin, 1e-6) > 10);
        })
        .join("");
      paths.push(subD);
      const area = pathGen.area(geojson);
      if (area > bestArea) {
        bestArea = area;
        const c = pathGen.centroid(geojson);
        if (!Number.isNaN(c[0]) && !Number.isNaN(c[1])) {
          bestCentroid = [Math.round(c[0]), Math.round(c[1])];
        }
      }
    }
  }

  return { d: paths.join(" "), center: bestCentroid };
}

function combineGeometries(geoms: any[]): any {
  const coordinates: any[] = [];
  for (const g of geoms) {
    if (!g) continue;
    if (g.type === "Polygon") {
      coordinates.push(g.coordinates);
    } else if (g.type === "MultiPolygon") {
      coordinates.push(...g.coordinates);
    }
  }
  return { type: "MultiPolygon", coordinates };
}

// --- 1. Russian Admin-1 Subjects ---
const rusGeoms = admin1Geoms.filter((g) => g.properties.adm0_a3 === "RUS");
const RUS_SAKHALIN = ["RUS-2616"];
const RUS_KALININGRAD = ["RUS-2324"];
const RUS_OMSK = [
  "RUS-2379", "RUS-2380", "RUS-2386", "RUS-2398", "RUS-2396",
  "RUS-2397", "RUS-2167", "RUS-2403", "RUS-2401", "RUS-2399", "RUS-2400",
];
const RUS_DUDINKA = ["RUS-2382", "RUS-2603", "RUS-2402", "RUS-2605"];
const RUS_SIBERIA = ["RUS-2612", "RUS-2602"];
const RUS_TCHITA = ["RUS-2606", "RUS-2610", "RUS-2609", "RUS-2613"];
const RUS_VLADIVOSTOK = ["RUS-2611", "RUS-2614", "RUS-2615", "RUS-3468", "RUS-2321"];

const assignedRus = new Set([
  ...RUS_SAKHALIN, ...RUS_KALININGRAD, ...RUS_OMSK,
  ...RUS_DUDINKA, ...RUS_SIBERIA, ...RUS_TCHITA, ...RUS_VLADIVOSTOK,
]);

const RUS_MOSCOU = Array.from(
  new Set(
    rusGeoms
      .map((g) => g.properties.adm1_code as string)
      .filter((code) => !assignedRus.has(code))
  )
);

// --- 2. Canadian Admin-1 Provinces ---
const CAN_VANCOUVER = ["CAN-633", "CAN-632", "CAN-631"];
const CAN_MACKENZIE = ["CAN-636", "CAN-635", "CAN-634"];
const CAN_OTTAWA = ["CAN-630", "CAN-682"];
const CAN_LABRADOR = ["CAN-683", "CAN-686", "CAN-684", "CAN-685", "CAN-687"];

// --- 3. USA Admin-1 States (Califórnia = 7 estados a oeste da linha verde; Texas = Centro-Sul; Nova York = Leste) ---
const USA_ALASKA = ["USA-3563"];
const USA_HAWAII = ["USA-3517"];
const USA_CALIFORNIA_POSTALS = new Set([
  "WA", "OR", "ID", "CA", "NV", "UT", "AZ",
]);
const USA_TEXAS_POSTALS = new Set([
  "MT", "WY", "CO", "NM", "ND", "SD", "NE", "KS", "OK", "TX", "MN", "IA", "MO", "AR", "LA",
]);
const usaGeoms = admin1Geoms.filter((g) => g.properties.adm0_a3 === "USA");
const USA_CALIFORNIA = usaGeoms
  .filter((g) => USA_CALIFORNIA_POSTALS.has(g.properties.postal))
  .map((g) => g.properties.adm1_code as string);
const USA_TEXAS = usaGeoms
  .filter((g) => USA_TEXAS_POSTALS.has(g.properties.postal))
  .map((g) => g.properties.adm1_code as string);
const USA_NEW_YORK = usaGeoms
  .filter(
    (g) =>
      !USA_CALIFORNIA_POSTALS.has(g.properties.postal) &&
      !USA_TEXAS_POSTALS.has(g.properties.postal) &&
      g.properties.adm1_code !== "USA-3563" &&
      g.properties.adm1_code !== "USA-3517"
  )
  .map((g) => g.properties.adm1_code as string);

// --- 4. Brazilian Admin-1 States (Brasil Norte/Nordeste/Centro vs São Paulo Sul/Sudeste) ---
const braGeoms = admin1Geoms.filter((g) => g.properties.adm0_a3 === "BRA");
const BRA_SAO_PAULO_POSTALS = new Set([
  "SP", "RJ", "MG", "ES", "PR", "SC", "RS", "MS",
]);
const BRA_SAO_PAULO = Array.from(
  new Set(
    braGeoms
      .filter((g) => {
        const postal = String(g.properties.postal ?? "");
        const iso = String(g.properties.iso_3166_2 ?? "").replace("BR-", "");
        if (BRA_SAO_PAULO_POSTALS.has(postal) || BRA_SAO_PAULO_POSTALS.has(iso)) return true;
        const [, cy] = geomCenter(g);
        return cy < -18.0;
      })
      .map((g) => g.properties.adm1_code as string)
  )
);
const BRA_SAO_PAULO_SET = new Set(BRA_SAO_PAULO);
const BRA_NORTE_CENTRO = Array.from(
  new Set(
    braGeoms
      .map((g) => g.properties.adm1_code as string)
      .filter((code) => !BRA_SAO_PAULO_SET.has(code))
  )
);

// --- 5. Argentina & Patagônia (Linha verde exata entre Mendoza/La Pampa/BA e Neuquén/Río Negro) ---
const ARGENTINA_NORTH_CLIP_RING: [number, number][] = [
  [-76.0, -36.0],
  [-70.4, -36.0],
  [-69.8, -36.9],
  [-68.3, -37.5],
  [-66.5, -38.8],
  [-63.38, -38.8],
  [-63.38, -40.7],
  [-62.1, -41.05],
  [-50.0, -41.05],
  [-50.0, -18.0],
  [-76.0, -18.0],
];

const PATAGONIA_SOUTH_CLIP_RING: [number, number][] = [
  [-76.0, -58.0],
  [-50.0, -58.0],
  [-50.0, -41.0],
  [-62.1, -41.0],
  [-63.38, -40.65],
  [-63.38, -38.75],
  [-66.5, -38.75],
  [-68.3, -37.45],
  [-69.8, -36.85],
  [-70.4, -35.95],
  [-76.0, -35.95],
];

// --- 6. Chinese Admin-1 Provinces (Casca externa c110 sem frestas com Mongólia/Cazaquistão + divisão Admin-1) ---
const chnGeoms = admin1Geoms.filter(
  (g) =>
    g.properties.adm0_a3 === "CHN" ||
    g.properties.adm0_a3 === "HKG" ||
    g.properties.adm0_a3 === "MAC"
);
const CHN_XINJIANG = Array.from(
  new Set(
    chnGeoms
      .filter((g) => {
        const name = String(g.properties.name ?? "");
        if (/Xinjiang|Xizang|Tibet|Qinghai|Gansu/i.test(name)) return true;
        const [cx] = geomCenter(g);
        return cx < 97.5;
      })
      .map((g) => g.properties.adm1_code as string)
  )
);
const CHN_XINJIANG_SET = new Set(CHN_XINJIANG);

const CHN_PEQUIM = Array.from(
  new Set(
    chnGeoms
      .filter((g) => {
        const code = g.properties.adm1_code as string;
        if (CHN_XINJIANG_SET.has(code)) return false;
        const name = String(g.properties.name ?? "");
        if (
          /Heilongjiang|Jilin|Liaoning|Mongol|Beijing|Tianjin|Hebei|Shanxi|Shandong|Henan|Shaanxi|Ningxia/i.test(
            name
          )
        ) {
          return true;
        }
        const [, cy] = geomCenter(g);
        return cy >= 34.0;
      })
      .map((g) => g.properties.adm1_code as string)
  )
);
const assignedChn = new Set([...CHN_XINJIANG, ...CHN_PEQUIM]);
const CHN_SOUTH_EAST = Array.from(
  new Set(
    chnGeoms
      .map((g) => g.properties.adm1_code as string)
      .filter((code) => !assignedChn.has(code))
  )
);

// --- 7. Indonesian Admin-1 Provinces ---
const idnGeoms = admin1Geoms.filter((g) => g.properties.adm0_a3 === "IDN");
const IDN_NEW_GUINEA_NAMES = new Set([
  "Papua", "Papua Barat", "Maluku", "Maluku Utara", "Sulawesi Utara",
  "Gorontalo", "Sulawesi Tengah", "Sulawesi Barat", "Sulawesi Selatan", "Sulawesi Tenggara",
]);
const IDN_NEW_GUINEA = idnGeoms
  .filter((g) => IDN_NEW_GUINEA_NAMES.has(g.properties.name))
  .map((g) => g.properties.adm1_code as string);
const IDN_SUMATRA = idnGeoms
  .filter(
    (g) =>
      !(g.properties.name as string).startsWith("Kalimantan") &&
      !IDN_NEW_GUINEA_NAMES.has(g.properties.name)
  )
  .map((g) => g.properties.adm1_code as string);

interface TerritorySpec {
  id: string;
  name: string;
  namePt: string;
  continent: string;
  subRegion?: string;
  symbol: "circle" | "square" | "triangle";
  buildGeo: () => { d: string; center: [number, number] };
  centerOverride?: [number, number];
  neighbors: string[];
}

const SPECS: TerritorySpec[] = [
  // ================= SOUTH AMERICA (6 — Brasil + São Paulo, Argentina + Patagônia) =================
  {
    id: "brasil",
    name: "Brazil",
    namePt: "Brasil",
    continent: "south_america",
    symbol: "circle",
    buildGeo: () => {
      // Une a casca c110 do Brasil (encaixe 100% sem frestas com Peru e Venezuela) e subtrai São Paulo Admin-1
      const c110Bra = mergeCountries(["Brazil"]);
      const spAdmin1 = mergeAdmin1ByCodes(BRA_SAO_PAULO, 0.8);
      const northCentro = differenceGeometries(
        unionGeometries([c110Bra, mergeAdmin1ByCodes(BRA_NORTE_CENTRO, 0.8)], 0.5),
        spAdmin1,
        0.5
      );
      const patch = clipGeometryToBox(
        mergeCountries50([{ name: "Brazil" }], 0.2),
        [-50.0, 0.6, -49.0, 1.8]
      );
      return renderGeometry(unionGeometries([northCentro, scaleGeometry(patch, 1.15)], 0.5));
    },
    centerOverride: [418, 340],
    neighbors: ["venezuela", "peru", "sao_paulo", "nigeria"],
  },
  {
    id: "sao_paulo",
    name: "São Paulo",
    namePt: "São Paulo",
    continent: "south_america",
    symbol: "square",
    buildGeo: () => {
      const spAdmin1 = mergeAdmin1ByCodes(BRA_SAO_PAULO, 0.8);
      const c110BraSouth = clipGeometryToBox(mergeCountries(["Brazil"]), [-60, -35, -38, -19.5]);
      const northAdmin1 = mergeAdmin1ByCodes(BRA_NORTE_CENTRO, 0.8);
      return renderGeometry(
        differenceGeometries(unionGeometries([spAdmin1, c110BraSouth], 0.5), northAdmin1, 0.5)
      );
    },
    centerOverride: [436, 392],
    neighbors: ["brasil", "peru", "argentina"],
  },
  {
    id: "argentina",
    name: "Argentina",
    namePt: "Argentina",
    continent: "south_america",
    symbol: "square",
    buildGeo: () => {
      const southCone = mergeCountries(["Argentina", "Uruguay", "Paraguay", "Chile"]);
      return renderGeometry(clipGeometryByPolygon(southCone, ARGENTINA_NORTH_CLIP_RING));
    },
    centerOverride: [392, 424],
    neighbors: ["sao_paulo", "peru", "patagonia"],
  },
  {
    id: "patagonia",
    name: "Patagonia",
    namePt: "Patagônia",
    continent: "south_america",
    symbol: "circle",
    buildGeo: () => {
      const southCone = mergeCountries(["Argentina", "Chile", "Falkland Is."]);
      return renderGeometry(clipGeometryByPolygon(southCone, PATAGONIA_SOUTH_CLIP_RING));
    },
    centerOverride: [368, 476],
    neighbors: ["peru", "argentina", "australia", "africa_do_sul"],
  },
  {
    id: "peru",
    name: "Peru",
    namePt: "Peru",
    continent: "south_america",
    symbol: "triangle",
    buildGeo: () => renderGeometry(mergeCountries(["Peru", "Bolivia", "Ecuador"])),
    centerOverride: [364, 358],
    neighbors: ["venezuela", "brasil", "sao_paulo", "argentina", "patagonia"],
  },
  {
    id: "venezuela",
    name: "Venezuela",
    namePt: "Venezuela",
    continent: "south_america",
    symbol: "triangle",
    buildGeo: () =>
      renderGeometry(
        mergeCountries(["Venezuela", "Colombia", "Guyana", "Suriname", "France"]),
        [[-85, -10, -50, 15]]
      ),
    centerOverride: [374, 302],
    neighbors: ["mexico", "brasil", "peru"],
  },

  // ================= NORTH AMERICA (11 — Califórnia com os 7 estados da Imagem 2) =================
  {
    id: "mexico",
    name: "Mexico",
    namePt: "México",
    continent: "north_america",
    symbol: "square",
    buildGeo: () =>
      renderGeometry(
        mergeCountries([
          "Mexico", "Guatemala", "Belize", "Honduras", "El Salvador",
          "Nicaragua", "Costa Rica", "Panama", "Cuba", "Haiti",
          "Dominican Rep.", "Jamaica", "Bahamas", "Puerto Rico",
        ])
      ),
    centerOverride: [272, 246],
    neighbors: ["california", "texas", "nova_york", "venezuela"],
  },
  {
    id: "california",
    name: "California",
    namePt: "Califórnia",
    continent: "north_america",
    symbol: "square",
    buildGeo: () => renderGeometry(mergeAdmin1ByCodes(USA_CALIFORNIA), [[-128, 30, -108, 49.5]]),
    centerOverride: [204, 190],
    neighbors: ["vancouver", "texas", "mexico", "havai"],
  },
  {
    id: "texas",
    name: "Texas",
    namePt: "Texas",
    continent: "north_america",
    symbol: "circle",
    buildGeo: () => renderGeometry(mergeAdmin1ByCodes(USA_TEXAS), [[-117, 25, -88, 49.5]]),
    centerOverride: [258, 198],
    neighbors: ["california", "vancouver", "ottawa", "nova_york", "mexico"],
  },
  {
    id: "nova_york",
    name: "New York",
    namePt: "Nova York",
    continent: "north_america",
    symbol: "triangle",
    buildGeo: () => renderGeometry(mergeAdmin1ByCodes(USA_NEW_YORK), [[-93, 24, -65, 49.5]]),
    centerOverride: [318, 196],
    neighbors: ["texas", "ottawa", "labrador", "mexico"],
  },
  {
    id: "labrador",
    name: "Labrador",
    namePt: "Labrador",
    continent: "north_america",
    symbol: "circle",
    buildGeo: () => renderGeometry(mergeAdmin1ByCodes(CAN_LABRADOR), [[-80, 43, -50, 63]]),
    centerOverride: [368, 152],
    neighbors: ["ottawa", "nova_york", "groenlandia"],
  },
  {
      id: "ottawa",
      name: "Ottawa",
      namePt: "Ottawa",
      continent: "north_america",
      symbol: "circle",
      buildGeo: () => renderGeometry(mergeAdmin1ByCodes(CAN_OTTAWA), [[-102, 41, -74, 60.5]]),
      centerOverride: [298, 154],
      neighbors: ["mackenzie", "vancouver", "texas", "nova_york", "labrador"],
    },
  {
    id: "vancouver",
    name: "Vancouver",
    namePt: "Vancouver",
    continent: "north_america",
    symbol: "triangle",
    buildGeo: () => renderGeometry(mergeAdmin1ByCodes(CAN_VANCOUVER), [[-140, 48, -101, 60.5]]),
    centerOverride: [222, 148],
    neighbors: ["alasca", "mackenzie", "ottawa", "california", "texas"],
  },
  {
    id: "mackenzie",
    name: "Mackenzie",
    namePt: "Mackenzie",
    continent: "north_america",
    symbol: "circle",
    buildGeo: () => {
      const main = renderGeometry(mergeAdmin1ByCodes(CAN_MACKENZIE, 3.0), [[-141, 60, -61, 84]]);
      const bays = renderGeometry(
        filterPolygons(mergeAdmin1ByCodes(CAN_MACKENZIE, 0.25), (ring) => {
          const [cx, cy] = ringCenter(ring);
          return ringSpan(ring) < 4 && cx >= -95 && cx <= -72 && cy >= 50 && cy <= 62;
        })
      );
      return { d: `${main.d} ${bays.d}`.trim(), center: main.center };
    },
    centerOverride: [242, 98],
    neighbors: ["alasca", "vancouver", "ottawa", "groenlandia"],
  },
  {
    id: "alasca",
    name: "Alaska",
    namePt: "Alasca",
    continent: "north_america",
    symbol: "triangle",
    buildGeo: () =>
      renderGeometry(mergeAdmin1ByCodes(USA_ALASKA, 2.5), [[-179.9, 51, -129, 73]]),
    centerOverride: [92, 108],
    neighbors: ["mackenzie", "vancouver", "vladivostok"],
  },
  {
      id: "groenlandia",
      name: "Greenland",
      namePt: "Groenlândia",
      continent: "north_america",
      symbol: "circle",
      buildGeo: () => renderGeometry(mergeCountries(["Greenland"])),
      centerOverride: [462, 72],
      neighbors: ["mackenzie", "labrador", "islandia"],
    },
  {
    id: "havai",
    name: "Hawaii",
    namePt: "Havaí",
    continent: "north_america",
    symbol: "circle",
    buildGeo: () => {
      const realHi = renderGeometry(mergeAdmin1ByCodes(USA_HAWAII, 0.2));
      const [hx, hy] = BASE_PROJ([-157.5, 20.8])!;
      const cx = Math.round(hx);
      const cy = Math.round(hy);
      const islandChainSvg = `M${cx - 16},${cy - 7} L${cx - 9},${cy - 10} L${cx - 3},${cy - 4} L${cx - 10},${cy - 1} Z M${cx - 1},${cy - 2} L${cx + 6},${cy - 4} L${cx + 9},${cy + 2} L${cx + 1},${cy + 4} Z M${cx + 8},${cy + 4} L${cx + 17},${cy + 2} L${cx + 20},${cy + 10} L${cx + 10},${cy + 12} Z`;
      return {
        d: `${realHi.d} ${islandChainSvg}`.trim(),
        center: [cx + 2, cy + 2],
      };
    },
    neighbors: ["california", "japao", "nova_guine"],
  },

  // ================= EUROPE (10 — Argélia ligada à Espanha; Egito ligado à Itália) =================
  {
    id: "islandia",
    name: "Iceland",
    namePt: "Islândia",
    continent: "europe",
    symbol: "triangle",
    buildGeo: () => renderGeometry(mergeCountries(["Iceland"])),
    centerOverride: [537, 102],
    neighbors: ["groenlandia", "inglaterra"],
  },
  {
    id: "inglaterra",
    name: "Great Britain",
    namePt: "Inglaterra",
    continent: "europe",
    symbol: "circle",
    buildGeo: () => renderGeometry(mergeCountries(["United Kingdom", "Ireland"])),
    centerOverride: [589, 138],
    neighbors: ["islandia", "suecia", "franca", "espanha", "alemanha"],
  },
  {
    id: "suecia",
    name: "Sweden",
    namePt: "Suécia",
    continent: "europe",
    symbol: "square",
    buildGeo: () =>
      renderGeometry(mergeCountries(["Norway", "Sweden", "Finland"]), [
        [4, 54, 32, 72],
        [8, 74, 36, 81.5],
      ]),
    centerOverride: [652, 106],
    neighbors: ["inglaterra", "moscou"],
  },
  {
    id: "alemanha",
    name: "Germany",
    namePt: "Alemanha",
    continent: "europe",
    symbol: "circle",
    buildGeo: () =>
      renderGeometry(
        mergeCountries([
          "Denmark", "Germany", "Netherlands", "Belgium",
          "Luxembourg", "Switzerland", "Austria", "Czechia",
        ]),
        [[2, 45, 18, 58]]
      ),
    centerOverride: [635, 146],
    neighbors: ["inglaterra", "franca", "italia", "polonia", "balcas"],
  },
  {
    id: "franca",
    name: "France",
    namePt: "França",
    continent: "europe",
    symbol: "square",
    buildGeo: () =>
      renderGeometry(mergeCountries(["France"]), [[-6, 41, 10, 51.5]]),
    centerOverride: [604, 162],
    neighbors: ["inglaterra", "alemanha", "espanha", "italia"],
  },
  {
    id: "espanha",
    name: "Spain",
    namePt: "Espanha",
    continent: "europe",
    symbol: "circle",
    buildGeo: () =>
      renderGeometry(mergeCountries(["Spain", "Portugal"]), [[-11, 35, 4.5, 44.5]]),
    centerOverride: [584, 184],
    neighbors: ["inglaterra", "franca", "italia", "argelia"],
  },
  {
    id: "italia",
    name: "Italy",
    namePt: "Itália",
    continent: "europe",
    symbol: "triangle",
    buildGeo: () =>
      renderGeometry(mergeCountries(["Italy"]), [[6, 36, 19, 47.5]]),
    centerOverride: [642, 178],
    neighbors: ["franca", "espanha", "alemanha", "balcas", "egito"],
  },
  {
    id: "polonia",
    name: "Poland",
    namePt: "Polônia",
    continent: "europe",
    symbol: "triangle",
    buildGeo: () => {
      const centralEast = mergeCountries([
        "Poland", "Slovakia", "Hungary", "Ukraine",
        "Belarus", "Lithuania", "Latvia", "Estonia",
      ]);
      const kaliningrad = mergeAdmin1ByCodes(RUS_KALININGRAD, 0.2);
      return renderGeometry(unionGeometries([centralEast, scaleGeometry(kaliningrad, 1.18)]));
    },
    centerOverride: [688, 142],
    neighbors: ["alemanha", "balcas", "moscou"],
  },
  {
    id: "balcas",
    name: "Balkans",
    namePt: "Bálcãs",
    continent: "europe",
    symbol: "square",
    buildGeo: () =>
      renderGeometry(
        mergeCountries([
          "Greece", "Romania", "Moldova", "Bulgaria", "Serbia",
          "Croatia", "Bosnia and Herz.", "Montenegro", "Kosovo",
          "Albania", "Macedonia", "Slovenia",
        ])
      ),
    centerOverride: [676, 176],
    neighbors: ["alemanha", "italia", "polonia", "moscou", "oriente_medio", "egito"],
  },
  {
    id: "moscou",
    name: "Moscow",
    namePt: "Moscou",
    continent: "europe",
    symbol: "triangle",
    buildGeo: () =>
      renderGeometry(
        smoothPolygonsInBox(mergeAdmin1ByCodes(RUS_MOSCOU), [50, 70, 70, 78], 0.1, 3),
        [[26, 40, 72, 83]]
      ),
    centerOverride: [742, 126],
    neighbors: ["suecia", "polonia", "balcas", "omsk", "aral", "oriente_medio"],
  },

  // ================= AFRICA (8 — Argélia ↔ Espanha, Egito ↔ Itália, Nigéria ↔ Brasil, Madagascar ↔ Índia) =================
  {
    id: "argelia",
    name: "Algeria",
    namePt: "Argélia",
    continent: "africa",
    symbol: "circle",
    buildGeo: () =>
      renderGeometry(
        mergeCountries(["Morocco", "W. Sahara", "Algeria", "Tunisia"])
      ),
    centerOverride: [596, 224],
    neighbors: ["espanha", "egito", "nigeria"],
  },
  {
    id: "nigeria",
    name: "Nigeria",
    namePt: "Nigéria",
    continent: "africa",
    symbol: "square",
    buildGeo: () =>
      renderGeometry(
        mergeCountries([
          "Mauritania", "Mali", "Niger", "Senegal", "Gambia",
          "Guinea-Bissau", "Guinea", "Sierra Leone", "Liberia",
          "Côte d'Ivoire", "Burkina Faso", "Ghana", "Togo", "Benin", "Nigeria",
        ])
      ),
    centerOverride: [598, 278],
    neighbors: ["brasil", "argelia", "egito", "sudao", "congo"],
  },
  {
    id: "egito",
    name: "Egypt",
    namePt: "Egito",
    continent: "africa",
    symbol: "triangle",
    buildGeo: () => renderGeometry(mergeCountries(["Egypt", "Libya"])),
    centerOverride: [668, 228],
    neighbors: ["italia", "balcas", "oriente_medio", "argelia", "nigeria", "sudao"],
  },
  {
    id: "sudao",
    name: "Sudan",
    namePt: "Sudão",
    continent: "africa",
    symbol: "square",
    buildGeo: () =>
      renderGeometry(
        mergeCountries([
          "Sudan", "S. Sudan", "Chad", "Ethiopia", "Eritrea",
          "Djibouti", "Somalia", "Somaliland", "Kenya", "Uganda",
        ])
      ),
    centerOverride: [706, 282],
    neighbors: ["nigeria", "egito", "congo", "mocambique", "madagascar"],
  },
  {
    id: "congo",
    name: "Congo",
    namePt: "Congo",
    continent: "africa",
    symbol: "square",
    buildGeo: () =>
      renderGeometry(
        mergeCountries([
          "Dem. Rep. Congo", "Congo", "Central African Rep.",
          "Cameroon", "Gabon", "Eq. Guinea", "Angola",
        ])
      ),
    centerOverride: [662, 336],
    neighbors: ["nigeria", "sudao", "mocambique", "africa_do_sul"],
  },
  {
    id: "mocambique",
    name: "Mozambique",
    namePt: "Moçambique",
    continent: "africa",
    symbol: "circle",
    buildGeo: () =>
      renderGeometry(
        mergeCountries([
          "Tanzania", "Rwanda", "Burundi", "Zambia", "Malawi", "Mozambique",
        ])
      ),
    centerOverride: [708, 356],
    neighbors: ["sudao", "congo", "africa_do_sul", "madagascar"],
  },
  {
    id: "africa_do_sul",
    name: "South Africa",
    namePt: "África do Sul",
    continent: "africa",
    symbol: "triangle",
    buildGeo: () =>
      renderGeometry(
        mergeCountries([
          "South Africa", "Namibia", "Botswana", "Zimbabwe", "Lesotho", "eSwatini",
        ])
      ),
    centerOverride: [678, 408],
    neighbors: ["congo", "mocambique", "madagascar", "patagonia"],
  },
  {
    id: "madagascar",
    name: "Madagascar",
    namePt: "Madagascar",
    continent: "africa",
    symbol: "circle",
    buildGeo: () => renderGeometry(mergeCountries(["Madagascar"])),
    centerOverride: [756, 385],
    neighbors: ["sudao", "mocambique", "africa_do_sul", "india"],
  },

  // ================= ASIA (14 — Xinjiang sem frestas com Mongólia/Cazaquistão/Índia) =================
  {
    id: "oriente_medio",
    name: "Middle East",
    namePt: "Oriente Médio",
    continent: "asia",
    subRegion: "asia_indo_arabia",
    symbol: "square",
    buildGeo: () =>
      renderGeometry(
        mergeCountries([
          "Turkey", "Syria", "Lebanon", "Israel", "Palestine", "Jordan",
          "Iraq", "Iran", "Saudi Arabia", "Yemen", "Oman",
          "United Arab Emirates", "Qatar", "Kuwait", "Georgia",
          "Armenia", "Azerbaijan", "Cyprus", "N. Cyprus",
        ])
      ),
    centerOverride: [754, 218],
    neighbors: ["balcas", "moscou", "aral", "india", "egito"],
  },
  {
    id: "aral",
    name: "Kazakhstan",
    namePt: "Cazaquistão",
    continent: "asia",
    subRegion: "asia_indo_arabia",
    symbol: "triangle",
    buildGeo: () =>
      renderGeometry(
        mergeCountries([
          "Kazakhstan", "Uzbekistan", "Turkmenistan",
          "Kyrgyzstan", "Tajikistan", "Afghanistan",
        ])
      ),
    centerOverride: [818, 170],
    neighbors: ["moscou", "omsk", "xinjiang", "india", "oriente_medio"],
  },
  {
    id: "india",
    name: "India",
    namePt: "Índia",
    continent: "asia",
    subRegion: "asia_indo_arabia",
    symbol: "triangle",
    buildGeo: () =>
      renderGeometry(
        mergeCountries(["India", "Pakistan", "Bangladesh", "Sri Lanka", "Nepal", "Bhutan"])
      ),
    centerOverride: [860, 238],
    neighbors: ["oriente_medio", "aral", "xinjiang", "china", "vietna", "sumatra", "madagascar"],
  },
  {
    id: "vietna",
    name: "Vietnam",
    namePt: "Vietnã",
    continent: "asia",
    subRegion: "asia_indo_arabia",
    symbol: "triangle",
    buildGeo: () =>
      renderGeometry(
        mergeCountries(["Vietnam", "Thailand", "Myanmar", "Laos", "Cambodia", "Malaysia"]),
        [[92, 1, 109.55, 29]]
      ),
    centerOverride: [936, 262],
    neighbors: ["china", "india", "borneu"],
  },
  {
    id: "omsk",
    name: "Omsk",
    namePt: "Omsk",
    continent: "asia",
    subRegion: "asia_steppes",
    symbol: "square",
    buildGeo: () => renderGeometry(mergeAdmin1ByCodes(RUS_OMSK), [[56, 48, 92, 76]]),
    centerOverride: [840, 122],
    neighbors: ["moscou", "dudinka", "mongolia", "xinjiang", "aral"],
  },
  {
    id: "dudinka",
    name: "Dudinka",
    namePt: "Dudinka",
    continent: "asia",
    subRegion: "asia_steppes",
    symbol: "circle",
    buildGeo: () => renderGeometry(mergeAdmin1ByCodes(RUS_DUDINKA), [[62, 49, 116, 82]]),
    centerOverride: [912, 96],
    neighbors: ["omsk", "siberia", "tchita", "mongolia"],
  },
  {
    id: "siberia",
    name: "Siberia",
    namePt: "Sibéria",
    continent: "asia",
    subRegion: "asia_steppes",
    symbol: "triangle",
    buildGeo: () => renderGeometry(mergeAdmin1ByCodes(RUS_SIBERIA), [[95, 51, 165, 78]]),
    centerOverride: [1015, 96],
    neighbors: ["dudinka", "tchita", "vladivostok"],
  },
  {
    id: "tchita",
    name: "Tchita",
    namePt: "Tchita",
    continent: "asia",
    subRegion: "asia_steppes",
    symbol: "triangle",
    buildGeo: () => renderGeometry(mergeAdmin1ByCodes(RUS_TCHITA), [[98, 48, 136, 60]]),
    centerOverride: [988, 135],
    neighbors: ["dudinka", "siberia", "vladivostok", "pequim", "mongolia"],
  },
  {
    id: "vladivostok",
    name: "Vladivostok",
    namePt: "Vladivostok",
    continent: "asia",
    subRegion: "asia_east",
    symbol: "circle",
    buildGeo: () =>
      renderGeometry(unionGeometries([mergeAdmin1ByCodes(RUS_VLADIVOSTOK)], 1.8), undefined, true),
    centerOverride: [1124, 110],
    neighbors: ["siberia", "tchita", "pequim", "japao", "alasca"],
  },
  {
    id: "mongolia",
    name: "Mongolia",
    namePt: "Mongólia",
    continent: "asia",
    subRegion: "asia_east",
    symbol: "circle",
    buildGeo: () => renderGeometry(mergeCountries(["Mongolia"])),
    centerOverride: [944, 164],
    neighbors: ["omsk", "dudinka", "tchita", "pequim", "xinjiang"],
  },
  {
    id: "xinjiang",
    name: "Xinjiang",
    namePt: "Xinjiang",
    continent: "asia",
    subRegion: "asia_east",
    symbol: "triangle",
    buildGeo: () => {
      // Usa a casca externa c110 da China a oeste para colar 100% sem frestas na Mongólia, Cazaquistão e Índia!
      const c110WestChn = clipGeometryToBox(mergeCountries(["China"]), [73, 26, 102, 50]);
      const xinjiangAdmin1 = mergeAdmin1ByCodes(CHN_XINJIANG, 1.0);
      const eastChnAdmin1 = mergeAdmin1ByCodes([...CHN_PEQUIM, ...CHN_SOUTH_EAST], 0.8);
      return renderGeometry(
        differenceGeometries(
          unionGeometries([c110WestChn, xinjiangAdmin1], 0.8),
          eastChnAdmin1,
          0.8
        )
      );
    },
    centerOverride: [892, 198],
    neighbors: ["aral", "omsk", "mongolia", "pequim", "china", "india"],
  },
  {
    id: "pequim",
    name: "Beijing",
    namePt: "Pequim",
    continent: "asia",
    subRegion: "asia_east",
    symbol: "circle",
    buildGeo: () => {
      const c110NorthChn = clipGeometryToBox(
        mergeCountries(["China", "North Korea", "South Korea"]),
        [96, 33, 135, 54]
      );
      const northChn = mergeAdmin1ByCodes(CHN_PEQUIM, 1.0);
      const koreas = mergeCountries(["North Korea", "South Korea"]);
      const otherChn = mergeAdmin1ByCodes([...CHN_XINJIANG, ...CHN_SOUTH_EAST], 0.8);
      return renderGeometry(
        differenceGeometries(
          unionGeometries([c110NorthChn, northChn, scaleGeometry(koreas, 1.05)], 0.8),
          otherChn,
          0.8
        )
      );
    },
    centerOverride: [994, 182],
    neighbors: ["mongolia", "tchita", "vladivostok", "japao", "china", "xinjiang"],
  },
  {
    id: "china",
    name: "China",
    namePt: "China",
    continent: "asia",
    subRegion: "asia_east",
    symbol: "square",
    buildGeo: () => {
      const c110SouthChn = clipGeometryToBox(mergeCountries(["China"]), [96, 18, 124, 35]);
      const southEastAdmin1 = mergeAdmin1ByCodes(CHN_SOUTH_EAST, 0.8);
      const otherChn = mergeAdmin1ByCodes([...CHN_XINJIANG, ...CHN_PEQUIM], 0.8);
      return renderGeometry(
        differenceGeometries(
          unionGeometries([c110SouthChn, southEastAdmin1], 0.8),
          otherChn,
          0.8
        )
      );
    },
    centerOverride: [972, 224],
    neighbors: ["xinjiang", "pequim", "japao", "vietna", "india"],
  },
  {
    id: "japao",
    name: "Japan",
    namePt: "Japão",
    continent: "asia",
    subRegion: "asia_east",
    symbol: "square",
    buildGeo: () => {
      const jpTw = mergeCountries(["Japan", "Taiwan"]);
      const sakhalin = mergeAdmin1ByCodes(RUS_SAKHALIN, 0.4);
      return renderGeometry(combineGeometries([jpTw, sakhalin]), [[119, 21, 156, 56]]);
    },
    centerOverride: [1062, 198],
    neighbors: ["vladivostok", "pequim", "china", "havai"],
  },

  // ================= OCEANIA (4) =================
  {
    id: "sumatra",
    name: "Sumatra",
    namePt: "Sumatra",
    continent: "oceania",
    symbol: "square",
    buildGeo: () => {
      const idnSumatraJava = mergeAdmin1ByCodes(IDN_SUMATRA, 0.8);
      const timor = mergeCountries(["Timor-Leste"]);
      return renderGeometry(combineGeometries([idnSumatraJava, timor]), [[94, -12, 128, 7]]);
    },
    centerOverride: [942, 336],
    neighbors: ["india", "australia"],
  },
  {
    id: "borneu",
    name: "Borneo",
    namePt: "Bornéu",
    continent: "oceania",
    symbol: "square",
    buildGeo: () =>
      renderGeometry(
        mergeCountries50([
          { name: "Indonesia", box: [108.5, -4.6, 119.5, 7.5] },
          { name: "Malaysia", box: [108.5, 0.5, 120, 8] },
          { name: "Brunei" },
          { name: "Philippines" },
        ]),
        [[108, -5, 128, 21]]
      ),
    centerOverride: [986, 306],
    neighbors: ["vietna", "nova_guine", "australia"],
  },
  {
    id: "nova_guine",
    name: "New Guinea",
    namePt: "Nova Guiné",
    continent: "oceania",
    symbol: "circle",
    buildGeo: () => {
      const idnEast = mergeAdmin1ByCodes(IDN_NEW_GUINEA, 0.8);
      const pngIslands = mergeCountries([
        "Papua New Guinea", "Solomon Is.", "Vanuatu", "Fiji",
      ]);
      const border = rectGeometry(140.6, -9.3, 141.5, -2.5);
      return renderGeometry(unionGeometries([idnEast, pngIslands, border], 0.8), [[118, -22, 179.9, 5]]);
    },
    centerOverride: [1054, 335],
    neighbors: ["borneu", "australia", "havai"],
  },
  {
    id: "australia",
    name: "Australia",
    namePt: "Austrália",
    continent: "oceania",
    symbol: "triangle",
    buildGeo: () =>
      renderGeometry(mergeCountries(["Australia", "New Zealand", "New Caledonia"])),
    centerOverride: [1048, 412],
    neighbors: ["sumatra", "borneu", "nova_guine", "patagonia"],
  },
];

const landFeature = topojson.feature(c110, c110.objects.land);
const basePathGen = d3.geoPath(BASE_PROJ).digits(1);
const globalLandSvgPath = basePathGen(landFeature) || "";
const graticuleSvgPath = basePathGen(d3.geoGraticule10()) || "";

const COASTLINE_PATCHES: Record<string, number[][][]> = {
  siberia: [
    [[152.025, 73.95], [149.025, 73.95], [148.8, 74.175], [149.025, 74.4], [150.675, 74.55], [151.125, 75.0], [151.425, 74.85], [152.175, 75.15], [153.075, 75.15], [153.6, 74.775], [152.925, 74.1], [152.175, 74.1], [152.025, 73.95]],
    [[146.175, 73.8], [145.725, 73.8], [145.2, 74.475], [145.425, 74.7], [146.025, 74.7], [146.175, 74.85], [146.4, 74.625], [146.4, 74.025], [146.175, 73.8]],
    [[145.275, 73.05], [145.125, 73.2], [144.075, 73.2], [143.7, 73.575], [143.925, 73.8], [145.275, 73.65], [145.5, 73.425], [145.275, 73.05]],
    [[129.825, 71.7], [129.6, 71.925], [129.75, 72.375], [129.15, 73.275], [129.375, 73.5], [129.675, 73.2], [130.275, 73.2], [130.65, 72.825], [130.05, 72.225], [130.05, 71.925], [129.825, 71.7]],
    [[148.125, 72.6], [146.775, 72.6], [146.625, 72.75], [146.325, 72.6], [145.8, 72.975], [146.025, 73.2], [146.475, 73.2], [146.625, 73.35], [147.975, 73.35], [148.5, 72.975], [148.125, 72.6]],
    [[152.775, 71.1], [152.175, 71.25], [151.875, 71.55], [151.575, 71.55], [151.425, 71.7], [150.675, 71.7], [149.7, 72.525], [149.925, 72.75], [151.125, 72.75], [151.425, 72.45], [152.775, 71.85], [153.15, 71.475], [152.775, 71.1]],
    [[161.775, 69.75], [161.625, 69.9], [161.175, 69.9], [161.025, 69.75], [160.575, 70.05], [159.9, 70.875], [160.125, 71.1], [160.725, 71.1], [161.325, 70.8], [161.775, 70.8], [162.15, 70.425], [161.775, 69.75]],
  ],
  dudinka: [
    [[76.575, 72.3], [76.2, 72.525], [76.05, 72.975], [75.75, 73.275], [75.975, 73.5], [76.125, 73.35], [76.275, 73.5], [76.425, 73.35], [76.725, 73.5], [77.4, 72.975], [76.575, 72.3]],
    [[73.275, 69.0], [72.9, 69.225], [72.9, 69.525], [73.05, 69.675], [72.9, 70.275], [73.2, 70.875], [73.575, 70.95], [73.95, 70.575], [73.2, 69.825], [73.5, 69.375], [73.275, 69.0]],
    [[73.125, 67.05], [72.9, 67.275], [73.5, 67.875], [73.5, 68.025], [74.025, 68.4], [74.4, 68.025], [73.575, 67.2], [73.275, 67.2], [73.125, 67.05]],
  ],
  suecia: [[[15.525, 68.4], [15.225, 68.4], [15.0, 68.625], [15.225, 68.85], [15.525, 68.85], [15.75, 68.625], [15.525, 68.4]]],
  aral: [
    [[52.575, 45.75], [52.275, 45.75], [52.05, 45.975], [52.425, 46.5], [52.8, 46.275], [52.8, 45.975], [52.575, 45.75]],
    [[53.775, 40.95], [53.1, 41.325], [53.475, 41.7], [54.0, 41.175], [53.775, 40.95]],
  ],
  moscou: [[[49.425, 45.6], [49.05, 45.825], [49.575, 46.2], [49.8, 45.975], [49.425, 45.6]]],
  pequim: [
    [[119.025, 38.1], [118.875, 38.25], [118.125, 38.4], [117.9, 38.625], [118.125, 38.85], [118.725, 38.85], [119.25, 38.325], [119.025, 38.1]],
  ],
  china: [
    [[122.025, 31.95], [121.2, 32.925], [120.6, 34.125], [120.825, 34.5], [121.575, 34.35], [122.1, 33.675], [121.95, 33.525], [122.1, 33.225], [121.95, 32.775], [122.25, 32.175], [122.025, 31.95]],
    [[122.175, 30.0], [121.8, 30.525], [122.325, 31.05], [122.55, 30.825], [122.55, 30.375], [122.175, 30.0]],
  ],
  india: [
    [[91.125, 21.45], [90.675, 21.45], [90.45, 21.675], [91.125, 22.5], [91.65, 21.975], [91.65, 21.825], [91.125, 21.45]],
    [[72.075, 20.25], [71.775, 20.25], [71.55, 20.475], [72.225, 20.85], [72.45, 20.625], [72.075, 20.25]],
  ],
  vietna: [[[96.975, 15.9], [96.6, 16.125], [96.975, 16.5], [97.2, 16.275], [96.975, 15.9]]],
  brasil: [[[-48.375, -0.15], [-48.675, 0.15], [-50.025, 0.15], [-50.25, 0.375], [-49.65, 0.975], [-49.65, 1.725], [-50.4, 2.475], [-50.175, 2.85], [-49.575, 2.55], [-48.9, 1.875], [-48.15, 0.375], [-48.15, 0.075], [-48.375, -0.15]]],
  australia: [[[131.025, -11.85], [130.575, -11.85], [130.2, -11.475], [130.425, -11.25], [130.575, -11.4], [131.025, -11.4], [131.175, -11.25], [131.4, -11.475], [131.025, -11.85]]],
};

function appendCoastlinePatches(id: string, built: { d: string; center: [number, number] }) {
  const rings = COASTLINE_PATCHES[id];
  if (!rings || rings.length === 0) return built;
  const proj = d3.geoEquirectangular().scale(MAP_WIDTH / (2 * Math.PI)).translate([MAP_WIDTH / 2, 320]);
  const pathGen = d3.geoPath(proj).digits(1);
  const extra = rings
    .map((ring) => pathGen({ type: "Polygon", coordinates: [ring] } as any))
    .filter(Boolean)
    .join(" ");
  return { d: `${built.d} ${extra}`.trim(), center: built.center };
}

const builtTerritories = SPECS.map((spec) => {
  const built = appendCoastlinePatches(spec.id, spec.buildGeo());
  const { d, center } = built;
  return {
    id: spec.id,
    name: spec.name,
    namePt: spec.namePt,
    continent: spec.continent,
    subRegion: spec.subRegion,
    symbol: spec.symbol,
    neighbors: spec.neighbors,
    center: spec.centerOverride ?? center,
    svgPath: d,
  };
});

for (const t of builtTerritories) {
  if (!t.svgPath || Number.isNaN(t.center[0])) {
    throw new Error(`Invalid geometry for ${t.id}`);
  }
  const nums = [...t.svgPath.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)];
  const xs = nums.map((n) => parseFloat(n[1]));
  const ys = nums.map((n) => parseFloat(n[2]));
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  if (w > 450 || h > 300) {
    throw new Error(
      `Territory ${t.id} has an inverted or world-spanning bounding box (${w.toFixed(1)}x${h.toFixed(1)})!`
    );
  }
  console.log(
    `${t.id.padEnd(15)} center=[${t.center[0]}, ${t.center[1]}] bbox=${w.toFixed(0)}x${h.toFixed(0)} pathLen=${t.svgPath.length}`
  );
}

const byId = new Map(builtTerritories.map((t) => [t.id, t]));
for (const t of builtTerritories) {
  for (const n of t.neighbors) {
    const nb = byId.get(n);
    if (!nb) throw new Error(`Missing neighbor ${n} referenced by ${t.id}`);
    if (!nb.neighbors.includes(t.id)) {
      throw new Error(`Asymmetric neighbor: ${t.id} -> ${n}, but ${n} does not list ${t.id}`);
    }
  }
}

const outputTs = `import type { GameMapDef, ObjectiveCard, ResourceType, TerritoryDef } from "@hegemonia/shared";

export const MAP_WIDTH = ${MAP_WIDTH};
export const MAP_HEIGHT = 620;
export const GLOBAL_LAND_SVG_PATH = ${JSON.stringify(globalLandSvgPath)};
export const GRATICULE_SVG_PATH = ${JSON.stringify(graticuleSvgPath)};

export interface AsiaSubRegionDef {
  id: string;
  namePt: string;
  bonus: number;
  color: string;
  territoryIds: string[];
}

export const ASIA_SUBREGIONS: AsiaSubRegionDef[] = [
  {
    id: "asia_indo_arabia",
    namePt: "Ásia: Indo-Arábia",
    bonus: 2,
    color: "#f97316",
    territoryIds: ["oriente_medio", "aral", "india", "vietna"],
  },
  {
    id: "asia_steppes",
    namePt: "Ásia: Estepes & Sibéria",
    bonus: 2,
    color: "#dc2626",
    territoryIds: ["omsk", "dudinka", "siberia", "tchita"],
  },
  {
    id: "asia_east",
    namePt: "Ásia: Leste Asiático",
    bonus: 4,
    color: "#e11d48",
    territoryIds: ["vladivostok", "mongolia", "xinjiang", "pequim", "china", "japao"],
  },
];

export interface CountrySovereigntyDef {
  id: string;
  namePt: string;
  nameEn: string;
  territoryIds: string[];
}

export const COUNTRY_SOVEREIGNTIES: CountrySovereigntyDef[] = [
  { id: "brazil", namePt: "Brasil", nameEn: "Brazil", territoryIds: ["brasil", "sao_paulo"] },
  { id: "argentina", namePt: "Argentina", nameEn: "Argentina", territoryIds: ["argentina", "patagonia"] },
  { id: "usa", namePt: "Estados Unidos", nameEn: "United States", territoryIds: ["california", "texas", "nova_york", "alasca", "havai"] },
  { id: "canada", namePt: "Canadá", nameEn: "Canada", territoryIds: ["vancouver", "mackenzie", "ottawa", "labrador"] },
  { id: "russia", namePt: "Rússia", nameEn: "Russia", territoryIds: ["moscou", "omsk", "dudinka", "siberia", "tchita", "vladivostok"] },
  { id: "china", namePt: "China", nameEn: "China", territoryIds: ["pequim", "china", "xinjiang"] },
  { id: "indonesia", namePt: "Indonésia & Insulíndia", nameEn: "Indonesia", territoryIds: ["sumatra", "borneu", "nova_guine"] },
];

export function ownsFullCountry(
  territories: Record<string, { ownerId: string | null }>,
  playerId: string,
  countryId: string
): boolean {
  const country = COUNTRY_SOVEREIGNTIES.find((c) => c.id === countryId);
  if (!country) return false;
  return country.territoryIds.every((tid) => territories[tid]?.ownerId === playerId);
}

export interface TerritoryGeoEconomyDef {
  resource?: ResourceType;
  tradeBonus?: number;
  isCoastal: boolean;
}

export const TERRITORY_GEO_ECONOMY: Record<string, TerritoryGeoEconomyDef> = {
  // 1. South America (6 territories)
  brasil: { resource: "gold", isCoastal: true },
  sao_paulo: { resource: "steel", tradeBonus: 1, isCoastal: true },
  venezuela: { resource: "oil", isCoastal: true },
  peru: { resource: "gold", isCoastal: true },
  argentina: { resource: "steel", tradeBonus: 1, isCoastal: true },
  patagonia: { resource: "oil", isCoastal: true },

  // 2. Oceania (4 territories)
  sumatra: { resource: "oil", tradeBonus: 2, isCoastal: true },
  borneu: { resource: "oil", isCoastal: true },
  nova_guine: { resource: "gold", isCoastal: true },
  australia: { resource: "steel", isCoastal: true },

  // 3. Africa (8 territories)
  argelia: { resource: "oil", isCoastal: true },
  nigeria: { resource: "oil", tradeBonus: 1, isCoastal: true },
  egito: { resource: "oil", tradeBonus: 2, isCoastal: true },
  sudao: { resource: "gold", isCoastal: true },
  congo: { resource: "gold", isCoastal: true },
  mocambique: { resource: "steel", tradeBonus: 1, isCoastal: true },
  africa_do_sul: { resource: "gold", tradeBonus: 1, isCoastal: true },
  madagascar: { resource: "oil", isCoastal: true },

  // 4. Europe (10 territories)
  inglaterra: { tradeBonus: 2, isCoastal: true },
  franca: { resource: "steel", tradeBonus: 1, isCoastal: true },
  espanha: { resource: "gold", tradeBonus: 1, isCoastal: true },
  italia: { resource: "steel", tradeBonus: 1, isCoastal: true },
  alemanha: { resource: "steel", isCoastal: true },
  suecia: { resource: "steel", isCoastal: true },
  polonia: { resource: "steel", isCoastal: true },
  moscou: { resource: "steel", isCoastal: false },
  balcas: { isCoastal: true },
  islandia: { isCoastal: true },

  // 5. North America (11 territories)
  nova_york: { resource: "steel", tradeBonus: 1, isCoastal: true },
  texas: { resource: "oil", isCoastal: true },
  california: { resource: "gold", tradeBonus: 1, isCoastal: true },
  ottawa: { resource: "steel", isCoastal: false },
  labrador: { resource: "steel", isCoastal: true },
  mexico: { resource: "oil", tradeBonus: 2, isCoastal: true },
  alasca: { resource: "oil", isCoastal: true },
  mackenzie: { resource: "gold", isCoastal: true },
  havai: { tradeBonus: 1, isCoastal: true },
  vancouver: { isCoastal: true },
  groenlandia: { isCoastal: true },

  // 6. Asia — Indo-Arabia (4 territories)
  oriente_medio: { resource: "oil", tradeBonus: 2, isCoastal: true },
  aral: { resource: "oil", isCoastal: false },
  india: { resource: "steel", tradeBonus: 1, isCoastal: true },
  vietna: { isCoastal: true },

  // 7. Asia — Steppes & Siberia (4 territories)
  omsk: { resource: "steel", isCoastal: false },
  siberia: { resource: "steel", isCoastal: false },
  dudinka: { resource: "oil", isCoastal: true },
  tchita: { resource: "gold", isCoastal: false },

  // 8. Asia — East Asia (6 territories)
  pequim: { resource: "steel", isCoastal: true },
  china: { resource: "gold", tradeBonus: 1, isCoastal: true },
  xinjiang: { resource: "oil", isCoastal: false },
  vladivostok: { resource: "steel", isCoastal: true },
  japao: { tradeBonus: 1, isCoastal: true },
  mongolia: { isCoastal: false },
};

export const CLASSIC_MAP: GameMapDef = {
  id: "classic_44",
  name: "Mundo Geopolítico Natural Earth (53 Territórios Admin-1)",
  continents: [
    { id: "south_america", name: "South America", namePt: "América do Sul", bonus: 3, color: "#10b981" },
    { id: "north_america", name: "North America", namePt: "América do Norte", bonus: 6, color: "#f59e0b" },
    { id: "europe", name: "Europe", namePt: "Europa", bonus: 6, color: "#3b82f6" },
    { id: "africa", name: "Africa", namePt: "África", bonus: 4, color: "#eab308" },
    { id: "asia", name: "Asia", namePt: "Ásia", bonus: 8, color: "#ef4444" },
    { id: "oceania", name: "Oceania", namePt: "Oceania", bonus: 2, color: "#a855f7" },
  ],
  territories: (${JSON.stringify(builtTerritories, null, 2)} as TerritoryDef[]).map((t) => ({
    ...t,
    ...(TERRITORY_GEO_ECONOMY[t.id] ?? { isCoastal: true }),
  })),
};

export const CLASSIC_OBJECTIVES: ObjectiveCard[] = [
  {
    id: "obj_eu_oc_plus1",
    descriptionPt: "Conquistar na totalidade a EUROPA, a OCEANIA e mais um terceiro continente à sua escolha.",
    descriptionEn: "Conquer EUROPE, OCEANIA and one additional continent of your choice.",
    rule: { type: "continents", continents: ["europe", "oceania"], extraAnyContinent: true },
  },
  {
    id: "obj_as_sa",
    descriptionPt: "Conquistar na totalidade a ÁSIA e a AMÉRICA DO SUL.",
    descriptionEn: "Conquer ASIA and SOUTH AMERICA.",
    rule: { type: "continents", continents: ["asia", "south_america"] },
  },
  {
    id: "obj_eu_sa_plus1",
    descriptionPt: "Conquistar na totalidade a EUROPA, a AMÉRICA DO SUL e mais um terceiro continente à sua escolha.",
    descriptionEn: "Conquer EUROPE, SOUTH AMERICA and one additional continent of your choice.",
    rule: { type: "continents", continents: ["europe", "south_america"], extraAnyContinent: true },
  },
  {
    id: "obj_18_two_armies",
    descriptionPt: "Conquistar 20 TERRITÓRIOS e ocupar cada um deles com pelo menos dois exércitos.",
    descriptionEn: "Conquer 20 TERRITORIES with at least 2 armies in each.",
    rule: { type: "territories", count: 20, minArmiesPerTerritory: 2 },
  },
  {
    id: "obj_as_af",
    descriptionPt: "Conquistar na totalidade a ÁSIA e a ÁFRICA.",
    descriptionEn: "Conquer ASIA and AFRICA.",
    rule: { type: "continents", continents: ["asia", "africa"] },
  },
  {
    id: "obj_na_af",
    descriptionPt: "Conquistar na totalidade a AMÉRICA DO NORTE e a ÁFRICA.",
    descriptionEn: "Conquer NORTH AMERICA and AFRICA.",
    rule: { type: "continents", continents: ["north_america", "africa"] },
  },
  {
    id: "obj_24_any",
    descriptionPt: "Conquistar 28 TERRITÓRIOS à sua escolha.",
    descriptionEn: "Conquer 28 TERRITORIES of your choice.",
    rule: { type: "territories", count: 28, minArmiesPerTerritory: 1 },
  },
  {
    id: "obj_na_oc",
    descriptionPt: "Conquistar na totalidade a AMÉRICA DO NORTE e a OCEANIA.",
    descriptionEn: "Conquer NORTH AMERICA and OCEANIA.",
    rule: { type: "continents", continents: ["north_america", "oceania"] },
  },
  {
    id: "obj_destroy_blue",
    descriptionPt: "Destruir totalmente os exércitos AZUIS (se for você ou ausente/eliminado por outro: 28 territórios).",
    descriptionEn: "Destroy all BLUE armies (or 28 territories fallback).",
    rule: { type: "destroy_color", targetColor: "blue", fallbackTerritories: 28 },
  },
  {
    id: "obj_destroy_red",
    descriptionPt: "Destruir totalmente os exércitos VERMELHOS (se for você ou ausente/eliminado por outro: 28 territórios).",
    descriptionEn: "Destroy all RED armies (or 28 territories fallback).",
    rule: { type: "destroy_color", targetColor: "red", fallbackTerritories: 28 },
  },
  {
    id: "obj_destroy_green",
    descriptionPt: "Destruir totalmente os exércitos VERDES (se for você ou ausente/eliminado por outro: 28 territórios).",
    descriptionEn: "Destroy all GREEN armies (or 28 territories fallback).",
    rule: { type: "destroy_color", targetColor: "green", fallbackTerritories: 28 },
  },
  {
    id: "obj_destroy_yellow",
    descriptionPt: "Destruir totalmente os exércitos AMARELOS (se for você ou ausente/eliminado por outro: 28 territórios).",
    descriptionEn: "Destroy all YELLOW armies (or 28 territories fallback).",
    rule: { type: "destroy_color", targetColor: "yellow", fallbackTerritories: 28 },
  },
  {
    id: "obj_destroy_black",
    descriptionPt: "Destruir totalmente os exércitos PRETOS (se for você ou ausente/eliminado por outro: 28 territórios).",
    descriptionEn: "Destroy all BLACK armies (or 28 territories fallback).",
    rule: { type: "destroy_color", targetColor: "black", fallbackTerritories: 28 },
  },
  {
    id: "obj_destroy_white",
    descriptionPt: "Destruir totalmente os exércitos BRANCOS (se for você ou ausente/eliminado por outro: 28 territórios).",
    descriptionEn: "Destroy all WHITE armies (or 28 territories fallback).",
    rule: { type: "destroy_color", targetColor: "white", fallbackTerritories: 28 },
  },
];

export const ROLEPLAY_OBJECTIVES: ObjectiveCard[] = [
  {
    id: "obj_rp_japan_rising_sun",
    descriptionPt: "Japão Imperial (Sol Nascente): Controlar o Leste Asiático (Japão, Pequim, China, Xinjiang, Mongólia, Vladivostok), a Oceania (Sumatra, Bornéu, Nova Guiné, Austrália) e o Arco do Pacífico (Havaí, Alasca, Califórnia, Vancouver, Mackenzie).",
    descriptionEn: "Imperial Japan (Rising Sun): Conquer East Asia (Japan, Beijing, China, Xinjiang, Mongolia, Vladivostok), Oceania (Sumatra, Borneo, New Guinea, Australia) and the Pacific Rim (Hawaii, Alaska, California, Vancouver, Mackenzie).",
    rule: {
      type: "specific_territories",
      territoryIds: [
        "japao", "pequim", "china", "xinjiang", "mongolia", "vladivostok",
        "sumatra", "borneu", "nova_guine", "australia",
        "havai", "alasca", "california", "vancouver", "mackenzie"
      ],
    },
    coreTerritoryIds: ["japao"],
  },
  {
    id: "obj_rp_usa_manifest_destiny",
    descriptionPt: "Estados Unidos (Destino Manifesto): Controlar a totalidade das Américas (incluindo todos os estados dos EUA, Canadá, Brasil/São Paulo e Argentina/Patagônia) e mais (China, Pequim e Mongólia) OU Moscou.",
    descriptionEn: "United States (Manifest Destiny): Conquer all of the Americas (North and South America) plus (China, Beijing and Mongolia) OR Moscow.",
    rule: {
      type: "specific_territories",
      territoryIds: [
        "brasil", "sao_paulo", "argentina", "patagonia", "peru", "venezuela",
        "mexico", "california", "texas", "nova_york", "labrador", "ottawa", "vancouver", "mackenzie", "alasca", "groenlandia", "havai"
      ],
      extraAnyOf: [["china", "pequim", "mongolia"], ["moscou"]],
    },
    coreTerritoryIds: ["nova_york", "texas", "california", "alasca", "havai"],
  },
  {
    id: "obj_rp_lusitania_three_oceans",
    descriptionPt: "Império Lusitano (Três Oceanos): Controlar toda a América do Sul (Brasil, São Paulo, Argentina, Patagônia, Peru, Venezuela) e os entrepostos dos Três Oceanos (Espanha, França, Argélia, Nigéria, Congo, Moçambique, África do Sul, Índia e Sumatra).",
    descriptionEn: "Lusitanian Empire (Three Oceans): Conquer South America (Brazil, São Paulo, Argentina, Patagonia, Peru, Venezuela) and the Three Oceans trade posts (Spain, France, Algeria, Nigeria, Congo, Mozambique, South Africa, India and Sumatra).",
    rule: {
      type: "specific_territories",
      territoryIds: [
        "brasil", "sao_paulo", "argentina", "patagonia", "peru", "venezuela",
        "espanha", "franca", "argelia", "nigeria", "congo", "mocambique", "africa_do_sul", "india", "sumatra"
      ],
    },
    coreTerritoryIds: ["brasil", "sao_paulo"],
  },
  {
    id: "obj_rp_russia_third_rome",
    descriptionPt: "Império Russo (Terceira Roma): Controlar todas as 6 províncias russas (Moscou, Omsk, Dudinka, Sibéria, Tchita, Vladivostok), Cazaquistão, Japão, Alasca e toda a Europa.",
    descriptionEn: "Russian Empire (Third Rome): Conquer all 6 Russian regions (Moscow, Omsk, Dudinka, Siberia, Tchita, Vladivostok), Kazakhstan, Japan, Alaska and all of Europe.",
    rule: {
      type: "specific_territories",
      territoryIds: [
        "moscou", "omsk", "dudinka", "siberia", "tchita", "vladivostok",
        "aral", "japao", "alasca",
        "islandia", "inglaterra", "suecia", "alemanha", "franca", "espanha", "italia", "polonia", "balcas"
      ],
    },
    coreTerritoryIds: ["moscou", "omsk"],
  },
  {
    id: "obj_rp_golden_crescent",
    descriptionPt: "Crescente Dourado (União & Al-Andalus): Controlar as regiões do Crescente (Oriente Médio, Egito, Argélia, Nigéria, Sudão, Cazaquistão, Índia, Sumatra e Bornéu) e toda a Europa.",
    descriptionEn: "Golden Crescent (Union & Al-Andalus): Conquer the Crescent regions (Middle East, Egypt, Algeria, Nigeria, Sudan, Kazakhstan, India, Sumatra and Borneo) and all of Europe.",
    rule: {
      type: "specific_territories",
      territoryIds: [
        "oriente_medio", "egito", "argelia", "nigeria", "sudao", "aral", "india", "sumatra", "borneu",
        "islandia", "inglaterra", "suecia", "alemanha", "franca", "espanha", "italia", "polonia", "balcas", "moscou"
      ],
    },
    coreTerritoryIds: ["oriente_medio", "egito", "argelia", "sudao", "aral", "sumatra"],
  },
  {
    id: "obj_rp_pacto_austral",
    descriptionPt: "Pacto Austral (Aliança dos Três Oceanos): Controlar na totalidade os três continentes do Hemisfério Sul: América do Sul, África e Oceania.",
    descriptionEn: "Southern Pact (Alliance of Three Oceans): Conquer the three Southern Continents in their entirety: South America, Africa and Oceania.",
    rule: {
      type: "specific_territories",
      territoryIds: [
        "brasil", "sao_paulo", "argentina", "patagonia", "peru", "venezuela",
        "argelia", "nigeria", "egito", "sudao", "congo", "mocambique", "africa_do_sul", "madagascar",
        "sumatra", "borneu", "nova_guine", "australia"
      ],
    },
    coreTerritoryIds: ["argentina", "patagonia", "africa_do_sul", "australia"],
  },
  {
    id: "obj_rp_mitteleuropa_atlantic",
    descriptionPt: "Ordem Central Germânica (Mitteleuropa & Atlântico): Controlar toda a Europa, além de Oriente Médio, Omsk, Cazaquistão e o Corredor do Atlântico Norte (Groenlândia, Labrador, Ottawa e Nova York).",
    descriptionEn: "Germanic Central Order (Mitteleuropa & Atlantic): Conquer all of Europe, plus Middle East, Omsk, Kazakhstan and the North Atlantic Corridor (Greenland, Labrador, Ottawa and New York).",
    rule: {
      type: "specific_territories",
      territoryIds: [
        "islandia", "inglaterra", "suecia", "alemanha", "franca", "espanha", "italia", "polonia", "balcas", "moscou",
        "oriente_medio", "omsk", "aral",
        "groenlandia", "labrador", "ottawa", "nova_york"
      ],
    },
    coreTerritoryIds: ["alemanha"],
  },
  {
    id: "obj_rp_island_empire",
    descriptionPt: "Império das Ilhas (Talassocracia Global): Controlar a totalidade dos 10 territórios insulares e arquipélagos do planeta (Groenlândia, Islândia, Inglaterra, Madagascar, Sumatra, Bornéu, Nova Guiné, Austrália, Japão e Havaí).",
    descriptionEn: "Island Empire (Global Thalassocracy): Conquer all 10 planetary islands and archipelagos (Greenland, Iceland, Great Britain, Madagascar, Sumatra, Borneo, New Guinea, Australia, Japan and Hawaii).",
    rule: {
      type: "specific_territories",
      territoryIds: [
        "groenlandia", "islandia", "inglaterra", "madagascar", "sumatra", "borneu", "nova_guine", "australia", "japao", "havai"
      ],
    },
    coreTerritoryIds: ["inglaterra", "japao", "islandia", "madagascar", "havai", "borneu", "sumatra"],
  },
  {
    id: "obj_rp_pax_britannica",
    descriptionPt: "Pax Britannica (O Império Onde o Sol Nunca se Põe): Controlar Inglaterra, Ottawa, Labrador, Vancouver, Nova York, Egito, Sudão, Moçambique, África do Sul, Oriente Médio, Índia, Bornéu e Austrália.",
    descriptionEn: "Pax Britannica (The Empire On Which the Sun Never Sets): Conquer Great Britain, Ottawa, Labrador, Vancouver, New York, Egypt, Sudan, Mozambique, South Africa, Middle East, India, Borneo and Australia.",
    rule: {
      type: "specific_territories",
      territoryIds: [
        "inglaterra", "ottawa", "labrador", "vancouver", "nova_york",
        "egito", "sudao", "mocambique", "africa_do_sul", "oriente_medio", "india", "borneu", "australia"
      ],
    },
    coreTerritoryIds: ["inglaterra"],
  },
  {
    id: "obj_rp_middle_kingdom_silk_road",
    descriptionPt: "Império do Meio (Mandato do Céu & Rota da Seda): Controlar toda a China (Pequim, China, Xinjiang), Mongólia, a Indo-Arábia (Oriente Médio, Cazaquistão, Índia, Vietnã), a Oceania (4 territórios) e a Europa Oriental/Central (Moscou, Polônia, Bálcãs, Alemanha).",
    descriptionEn: "Middle Kingdom (Mandate of Heaven & Silk Road): Conquer all of China (Beijing, China, Xinjiang), Mongolia, Indo-Arabia (Middle East, Kazakhstan, India, Vietnam), Oceania (4 territories) and Eastern/Central Europe (Moscow, Poland, Balkans, Germany).",
    rule: {
      type: "specific_territories",
      territoryIds: [
        "pequim", "china", "xinjiang", "mongolia",
        "oriente_medio", "aral", "india", "vietna",
        "sumatra", "borneu", "nova_guine", "australia",
        "moscou", "polonia", "balcas", "alemanha"
      ],
    },
    coreTerritoryIds: ["pequim", "china", "xinjiang"],
  },
];

export const ALL_OBJECTIVES: ObjectiveCard[] = [
  ...CLASSIC_OBJECTIVES,
  ...ROLEPLAY_OBJECTIVES,
];
`;

fs.writeFileSync(path.join(__dirname, "../src/index.ts"), outputTs, "utf-8");

// --- Sincronização Infalível (Windows CRLF / LF) de Traduções em pt-BR/map.ts e en/map.ts ---
function forceUpdateLocaleMapFile(localeRelPath: string, entries: Record<string, string>) {
  const fullPath = path.join(__dirname, localeRelPath);
  if (!fs.existsSync(fullPath)) return;
  let content = fs.readFileSync(fullPath, "utf-8");
  const missingLines: string[] = [];

  for (const [rawKey, val] of Object.entries(entries)) {
    for (const prefix of ["", "territory_", "terr_"]) {
      const k = `${prefix}${rawKey}`;
      const existingRegex = new RegExp(`(^|[\\s,{])${k}\\s*:\\s*["'][^"']*["']`, "gm");
      if (existingRegex.test(content)) {
        content = content.replace(existingRegex, `$1${k}: ${JSON.stringify(val)}`);
      } else if (prefix === "" || prefix === "territory_") {
        missingLines.push(`  ${k}: ${JSON.stringify(val)},`);
      }
    }
  }

  if (missingLines.length > 0) {
    const lastCloseIdx = content.lastIndexOf("};");
    if (lastCloseIdx !== -1) {
      content =
        content.slice(0, lastCloseIdx) +
        missingLines.join("\n") +
        "\n" +
        content.slice(lastCloseIdx);
    }
  }

  fs.writeFileSync(fullPath, content, "utf-8");
}

const ptEntries: Record<string, string> = {};
const enEntries: Record<string, string> = {};
for (const spec of SPECS) {
  ptEntries[spec.id] = spec.namePt;
  enEntries[spec.id] = spec.name;
}

forceUpdateLocaleMapFile("../../../apps/web/src/i18n/locales/pt-BR/map.ts", ptEntries);
forceUpdateLocaleMapFile("../../../apps/web/src/i18n/locales/en/map.ts", enEntries);

// --- Atualiza automaticamente as linhas tracejadas marítimas em apps/web/src/App.svelte ---
const appSveltePath = path.join(__dirname, "../../../apps/web/src/App.svelte");
if (fs.existsSync(appSveltePath)) {
  let appContent = fs.readFileSync(appSveltePath, "utf-8");

  // 1. Brasil ↔ Nigéria (em vez de Argélia)
  appContent = appContent
    .replace(/(\[\s*["'])brasil(["']\s*,\s*["'])argelia(["']\s*\])/g, "$1brasil$2nigeria$3")
    .replace(/(\[\s*["'])argelia(["']\s*,\s*["'])brasil(["']\s*\])/g, "$1nigeria$2brasil$3");

  // 2. Espanha ↔ Argélia (em vez de França ↔ Argélia)
  appContent = appContent
    .replace(/(\[\s*["'])franca(["']\s*,\s*["'])argelia(["']\s*\])/g, "$1espanha$2argelia$3")
    .replace(/(\[\s*["'])argelia(["']\s*,\s*["'])franca(["']\s*\])/g, "$1argelia$2espanha$3");

  // 3. Itália ↔ Egito (em vez de França ↔ Egito)
  appContent = appContent
    .replace(/(\[\s*["'])franca(["']\s*,\s*["'])egito(["']\s*\])/g, "$1italia$2egito$3")
    .replace(/(\[\s*["'])egito(["']\s*,\s*["'])franca(["']\s*\])/g, "$1egito$2italia$3");

  // 4. Patagônia ↔ África do Sul e Austrália (em vez de Argentina)
  appContent = appContent
    .replace(/(\[\s*["'])argentina(["']\s*,\s*["'])africa_do_sul(["']\s*\])/g, "$1patagonia$2africa_do_sul$3")
    .replace(/(\[\s*["'])africa_do_sul(["']\s*,\s*["'])argentina(["']\s*\])/g, "$1africa_do_sul$2patagonia$3")
    .replace(/(\[\s*["'])argentina(["']\s*,\s*["'])australia(["']\s*\])/g, "$1patagonia$2australia$3")
    .replace(/(\[\s*["'])australia(["']\s*,\s*["'])argentina(["']\s*\])/g, "$1australia$2patagonia$3");

  // 5. Madagascar ↔ Índia e Madagascar ↔ Moçambique
  if (!/["']madagascar["']\s*,\s*["']india["']|["']india["']\s*,\s*["']madagascar["']/.test(appContent)) {
    appContent = appContent.replace(
      /(\[\s*["'](?:madagascar|africa_do_sul)["']\s*,\s*["'](?:madagascar|africa_do_sul)["']\s*\])/,
      `$1, ["madagascar", "mocambique"], ["madagascar", "india"]`
    );
  }

  fs.writeFileSync(appSveltePath, appContent, "utf-8");
  console.log("✅ Rotas marítimas tracejadas sincronizadas em apps/web/src/App.svelte!");
}

console.log(`✅ Mapa gerado com sucesso em packages/maps/src/index.ts (${builtTerritories.length} territórios)!`);