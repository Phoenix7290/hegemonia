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

const admin1Raw = JSON.parse(
  fs.readFileSync("/tmp/ne_50m_admin_1.geojson", "utf-8")
);

// Explode Russian MultiPolygons and shift negative longitudes (< 0) in Chukotka/Wrangel by +360
// so topojson.merge dissolves the 180° meridian line completely!
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

// High-precision quantization (1e5) prevents degenerate hole rings from inverting!
const admin1Topo = topojsonServer.topology(
  { states: { type: "FeatureCollection", features: expandedFeatures } },
  1e5
) as any;
const admin1Geoms: any[] = admin1Topo.objects.states.geometries;

// Map dimensions: width = 1200, height = 620
// Equirectangular projection with translate([600, 320]) maps [-180..180, -90..90] to x=[0..1200], y=[20..620]
const MAP_WIDTH = 1200;
const BASE_PROJ = d3
  .geoEquirectangular()
  .scale(MAP_WIDTH / (2 * Math.PI))
  .translate([MAP_WIDTH / 2, 320]);

// Pure linear equirectangular transform (identical math to BASE_PROJ, but allows Chukotka to extend past x=1200 without a 180° meridian cut!)
const UNCLIPPED_EQUIRECT_TRANSFORM = d3.geoTransform({
  point(lon: number, lat: number) {
    const x = 600 + (lon * 1200) / 360;
    const y = 320 - (lat * 600) / 180;
    this.stream.point(x, y);
  },
});

type BBox = [number, number, number, number]; // [lonMin, latMin, lonMax, latMax]

const AREA_CHECK_PATH = d3.geoPath(UNCLIPPED_EQUIRECT_TRANSFORM);

/**
 * Strips tiny micro-islands (< minAreaSqPx) and any interior hole rings that could cause winding artifacts.
 */
function cleanMultiPolygon(geojson: any, minAreaSqPx = 1.6): any {
  if (!geojson) return geojson;
  if (geojson.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: [geojson.coordinates[0]],
    };
  }
  if (geojson.type === "MultiPolygon") {
    const outerOnly = geojson.coordinates.map((coords: any[]) => [coords[0]]);
    const kept = outerOnly.filter((coords: any[]) => {
      const poly = { type: "Polygon", coordinates: coords };
      const area = AREA_CHECK_PATH.area(poly as any);
      if (area < minAreaSqPx || area >= 250000) return false;
      // Drop degenerate slivers (thin seam lines left by boolean union ops): bbox is long in one axis, near-zero in the other
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

/**
 * Dissolve geometries from different datasets (e.g. 110m countries + 50m admin-1) into ONE polygon,
 * so no internal border line is stroked between them. Rings are re-wound for d3's spherical convention.
 */
function unionGeometries(geoms: any[], minAreaSqPx = 0.2): any {
  // Every polygon goes in as its own geometry, so polygons that merely touch (e.g. along the 180° meridian) get dissolved too
  const polys = geoms.flatMap((g) =>
    (g.type === "Polygon" ? [g.coordinates] : g.coordinates).map((poly: number[][][]) => [poly])
  );
  const merged = polygonClipping.union(polys[0], ...polys.slice(1)) as number[][][][];
  const fixed = merged.map((poly) =>
    poly.map((ring, i) => {
      if (i > 0) return ring;
      const area = d3.geoArea({ type: "Polygon", coordinates: [ring] } as any);
      return area > 2 * Math.PI ? [...ring].reverse() : ring;
    })
  );
  return cleanMultiPolygon({ type: "MultiPolygon", coordinates: fixed }, minAreaSqPx);
}

/** Grows a geometry around its centroid so it overlaps its neighbours before a union (closes dataset-mismatch gaps). */
function scaleGeometry(geojson: any, k: number): any {
  const [cx, cy] = d3.geoCentroid(geojson);
  const sc = (ring: number[][]) => ring.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
  if (geojson.type === "Polygon") return { type: "Polygon", coordinates: geojson.coordinates.map(sc) };
  return { type: "MultiPolygon", coordinates: geojson.coordinates.map((p: any[]) => p.map(sc)) };
}

function rectGeometry(lon0: number, lat0: number, lon1: number, lat1: number): any {
  return { type: "Polygon", coordinates: [[[lon0, lat0], [lon1, lat0], [lon1, lat1], [lon0, lat1], [lon0, lat0]]] };
}

/** Planar bbox centre of a polygon's exterior ring (winding-independent, unlike d3.geoCentroid). */
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

/** Keeps only the polygons of a (Multi)Polygon whose exterior ring satisfies `keep` (rings are not altered, so winding is preserved). */
function filterPolygons(geojson: any, keep: (ring: number[][]) => boolean): any {
  const polys: number[][][][] = geojson.type === "Polygon" ? [geojson.coordinates] : geojson.coordinates;
  return { type: "MultiPolygon", coordinates: polys.filter((poly) => keep(poly[0])) };
}

/** Longest side (degrees) of a ring's bounding box. */
function ringSpan(ring: number[][]): number {
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

/**
 * Merges 50m country polygons (one shared topology => borders dissolve exactly, no internal seam).
 * `box` keeps only the polygons whose centroid falls inside [west, south, east, north].
 */
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
          return cx >= part.box![0] && cy >= part.box![1] && cx <= part.box![2] && cy <= part.box![3];
        })
      : polys;
    if (kept.length > 0) geoms.push({ type: "MultiPolygon", arcs: kept });
  }
  return cleanMultiPolygon(topojson.merge(c50, geoms), minAreaSqPx);
}

/** 50m polygon of one country, clipped to a lon/lat box, as plain GeoJSON (used to patch coarse 110m coastlines). */
function clipGeometryToBox(geojson: any, [w, s, e, n]: [number, number, number, number]): any {
  const multi = geojson.type === "Polygon" ? [geojson.coordinates] : geojson.coordinates;
  const box = [[[[w, s], [e, s], [e, n], [w, n], [w, s]]]];
  const out = polygonClipping.intersection(box as any, multi as any) as number[][][][];
  return { type: "MultiPolygon", coordinates: out };
}

/** Douglas-Peucker simplification + Chaikin corner cutting on polygons whose centroid is inside `box` (smooths jagged coasts). */
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
  const polys: number[][][][] = geojson.type === "Polygon" ? [geojson.coordinates] : geojson.coordinates;
  const result = polys.map((poly) => {
    const [cx, cy] = ringCenter(poly[0]);
    if (cx < box[0] || cy < box[1] || cx > box[2] || cy > box[3]) return poly;
    return poly.map((ring) => {
      // closed ring: split in two halves so Douglas-Peucker has a real baseline
      const mid = Math.floor(ring.length / 2);
      let r = [...dp(ring.slice(0, mid + 1), tolerance).slice(0, -1), ...dp(ring.slice(mid), tolerance)];
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
      // Strip degenerate sliver subpaths the post-clip rectangle can leave along its own edge
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

// --- Grouping Russian Admin-1 Subjects into 6 Authentic Regions + Sakhalin ---
const rusGeoms = admin1Geoms.filter((g) => g.properties.adm0_a3 === "RUS");

const RUS_SAKHALIN = ["RUS-2616"]; // Goes to Japan!
const RUS_KALININGRAD = ["RUS-2324"]; // Merges into Poland!

const RUS_OMSK = [
  "RUS-2379", // Chelyabinsk
  "RUS-2380", // Kurgan
  "RUS-2386", // Sverdlovsk
  "RUS-2398", // Tyumen'
  "RUS-2396", // Khanty-Mansiy
  "RUS-2397", // Omsk
  "RUS-2167", // Tomsk
  "RUS-2403", // Novosibirsk
  "RUS-2401", // Kemerovo
  "RUS-2399", // Altay
  "RUS-2400", // Gorno-Altay
];

const RUS_DUDINKA = [
  "RUS-2382", // Yamal-Nenets
  "RUS-2603", // Krasnoyarsk
  "RUS-2402", // Khakass
  "RUS-2605", // Tuva
];

const RUS_SIBERIA = [
  "RUS-2612", // Sakha (Yakutia)
  "RUS-2602", // Irkutsk
];

const RUS_TCHITA = [
  "RUS-2606", // Buryat
  "RUS-2610", // Chita (Zabaykalsky Krai)
  "RUS-2609", // Amur
  "RUS-2613", // Yevrey
];

const RUS_VLADIVOSTOK = [
  "RUS-2611", // Primor'ye
  "RUS-2614", // Khabarovsk
  "RUS-2615", // Magadan
  "RUS-3468", // Kamchatka
  "RUS-2321", // Chukotka
];

const assignedRus = new Set([
  ...RUS_SAKHALIN,
  ...RUS_KALININGRAD,
  ...RUS_OMSK,
  ...RUS_DUDINKA,
  ...RUS_SIBERIA,
  ...RUS_TCHITA,
  ...RUS_VLADIVOSTOK,
]);

// All remaining European Russian oblasts/republics belong to Moscou!
const RUS_MOSCOU = Array.from(
  new Set(
    rusGeoms
      .map((g) => g.properties.adm1_code as string)
      .filter((code) => !assignedRus.has(code))
  )
);

// --- Grouping Canadian Admin-1 Provinces ---
const CAN_VANCOUVER = ["CAN-633", "CAN-632", "CAN-631"]; // BC, Alberta, Saskatchewan
const CAN_MACKENZIE = ["CAN-636", "CAN-635", "CAN-634"]; // Yukon, NWT, Nunavut
const CAN_OTTAWA = ["CAN-630", "CAN-682"]; // Manitoba, Ontario
const CAN_LABRADOR = ["CAN-683", "CAN-686", "CAN-684", "CAN-685", "CAN-687"]; // Quebec, NL, NB, NS, PEI

// --- Grouping USA Admin-1 States ---
const USA_ALASKA = ["USA-3563"];
const USA_HAWAII = ["USA-3517"];
const USA_WEST_POSTALS = new Set([
  "WA", "OR", "CA", "NV", "ID", "MT", "WY", "UT", "AZ", "NM", "CO",
  "ND", "SD", "NE", "KS", "OK", "TX",
]);
const usaGeoms = admin1Geoms.filter((g) => g.properties.adm0_a3 === "USA");
const USA_CALIFORNIA = usaGeoms
  .filter((g) => USA_WEST_POSTALS.has(g.properties.postal))
  .map((g) => g.properties.adm1_code as string);
const USA_NEW_YORK = usaGeoms
  .filter(
    (g) =>
      !USA_WEST_POSTALS.has(g.properties.postal) &&
      g.properties.adm1_code !== "USA-3563" &&
      g.properties.adm1_code !== "USA-3517"
  )
  .map((g) => g.properties.adm1_code as string);

// --- Grouping Indonesian Admin-1 Provinces ---
const idnGeoms = admin1Geoms.filter((g) => g.properties.adm0_a3 === "IDN");
const IDN_BORNEO = idnGeoms
  .filter((g) => (g.properties.name as string).startsWith("Kalimantan"))
  .map((g) => g.properties.adm1_code as string);

const IDN_NEW_GUINEA_NAMES = new Set([
  "Papua",
  "Papua Barat",
  "Maluku",
  "Maluku Utara",
  "Sulawesi Utara",
  "Gorontalo",
  "Sulawesi Tengah",
  "Sulawesi Barat",
  "Sulawesi Selatan",
  "Sulawesi Tenggara",
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
  // ================= SOUTH AMERICA (4) =================
  {
    id: "brasil",
    name: "Brazil",
    namePt: "Brasil",
    continent: "south_america",
    symbol: "circle",
    buildGeo: () => {
      // 110m Brazil cuts a small peninsula on the Amapa coast (~49.5W, 1.2N): patch it with the 50m coastline
      const base = mergeCountries(["Brazil"]);
      const patch = clipGeometryToBox(mergeCountries50([{ name: "Brazil" }], 0.2), [-50.0, 0.6, -49.0, 1.8]);
      return renderGeometry(unionGeometries([base, scaleGeometry(patch, 1.15)], 0.5));
    },
    centerOverride: [425, 354],
    neighbors: ["venezuela", "peru", "argentina", "argelia"],
  },
  {
    id: "argentina",
    name: "Argentina",
    namePt: "Argentina",
    continent: "south_america",
    symbol: "square",
    buildGeo: () =>
      renderGeometry(
        mergeCountries(["Argentina", "Chile", "Uruguay", "Paraguay", "Falkland Is."])
      ),
    centerOverride: [382, 436],
    neighbors: ["brasil", "peru", "australia", "africa_do_sul"],
  },
  {
    id: "peru",
    name: "Peru",
    namePt: "Peru",
    continent: "south_america",
    symbol: "triangle",
    buildGeo: () => renderGeometry(mergeCountries(["Peru", "Bolivia", "Ecuador"])),
    centerOverride: [364, 358],
    neighbors: ["venezuela", "brasil", "argentina"],
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

  // ================= NORTH AMERICA (10 — includes Havaí!) =================
  {
    id: "mexico",
    name: "Mexico",
    namePt: "México",
    continent: "north_america",
    symbol: "square",
    buildGeo: () =>
      renderGeometry(
        mergeCountries([
          "Mexico",
          "Guatemala",
          "Belize",
          "Honduras",
          "El Salvador",
          "Nicaragua",
          "Costa Rica",
          "Panama",
          "Cuba",
          "Haiti",
          "Dominican Rep.",
          "Jamaica",
          "Bahamas",
          "Puerto Rico",
        ])
      ),
    centerOverride: [272, 246],
    neighbors: ["california", "nova_york", "venezuela"],
  },
  {
    id: "california",
    name: "California",
    namePt: "Califórnia",
    continent: "north_america",
    symbol: "square",
    buildGeo: () => renderGeometry(mergeAdmin1ByCodes(USA_CALIFORNIA), [[-128, 24, -93, 49.5]]),
    centerOverride: [226, 198],
    neighbors: ["vancouver", "ottawa", "nova_york", "mexico", "havai"],
  },
  {
    id: "nova_york",
    name: "New York",
    namePt: "Nova York",
    continent: "north_america",
    symbol: "triangle",
    buildGeo: () => renderGeometry(mergeAdmin1ByCodes(USA_NEW_YORK), [[-97, 24, -65, 49.5]]),
    centerOverride: [314, 198],
    neighbors: ["california", "ottawa", "labrador", "mexico"],
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
    neighbors: ["mackenzie", "vancouver", "california", "nova_york", "labrador", "groenlandia"],
  },
  {
    id: "vancouver",
    name: "Vancouver",
    namePt: "Vancouver",
    continent: "north_america",
    symbol: "triangle",
    buildGeo: () => renderGeometry(mergeAdmin1ByCodes(CAN_VANCOUVER), [[-140, 48, -101, 60.5]]),
    centerOverride: [222, 148],
    neighbors: ["alasca", "mackenzie", "ottawa", "california"],
  },
  {
    id: "mackenzie",
    name: "Mackenzie",
    namePt: "Mackenzie",
    continent: "north_america",
    symbol: "circle",
    buildGeo: () => {
      const main = renderGeometry(mergeAdmin1ByCodes(CAN_MACKENZIE, 3.0), [[-141, 60, -61, 84]]);
      // Small Nunavut islands in Hudson/James Bay (Belcher, Akimiski, Sleeper, Digges...) were dropped by the 3.0 area filter
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
    neighbors: ["mackenzie", "ottawa", "labrador", "islandia"],
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

  // ================= EUROPE (8) =================
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
    neighbors: ["islandia", "suecia", "franca", "alemanha"],
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
        [8, 74, 36, 81.5], // Svalbard
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
          "Denmark",
          "Germany",
          "Netherlands",
          "Belgium",
          "Luxembourg",
          "Switzerland",
          "Austria",
          "Czechia",
        ]),
        [[2, 45, 18, 58]]
      ),
    centerOverride: [635, 146],
    neighbors: ["inglaterra", "franca", "polonia", "balcas"],
  },
  {
    id: "franca",
    name: "France",
    namePt: "França",
    continent: "europe",
    symbol: "square",
    buildGeo: () =>
      renderGeometry(
        mergeCountries(["France", "Spain", "Portugal", "Italy"]),
        [[-11, 35, 19, 52]]
      ),
    centerOverride: [598, 174],
    neighbors: ["inglaterra", "alemanha", "balcas", "argelia", "egito"],
  },
  {
    id: "polonia",
    name: "Poland",
    namePt: "Polônia",
    continent: "europe",
    symbol: "triangle",
    buildGeo: () => {
      const centralEast = mergeCountries([
        "Poland",
        "Slovakia",
        "Hungary",
        "Ukraine",
        "Belarus",
        "Lithuania",
        "Latvia",
        "Estonia",
      ]);
      const kaliningrad = mergeAdmin1ByCodes(RUS_KALININGRAD, 0.2);
      // Kaliningrad (50m admin-1) is grown slightly so it overlaps Poland/Lithuania (110m) and dissolves into ONE polygon
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
          "Greece",
          "Romania",
          "Moldova",
          "Bulgaria",
          "Serbia",
          "Croatia",
          "Bosnia and Herz.",
          "Montenegro",
          "Kosovo",
          "Albania",
          "Macedonia",
          "Slovenia",
        ])
      ),
    centerOverride: [676, 176],
    neighbors: ["alemanha", "franca", "polonia", "moscou", "oriente_medio", "egito"],
  },
  {
    id: "moscou",
    name: "Moscow",
    namePt: "Moscou",
    continent: "europe",
    symbol: "triangle",
    buildGeo: () => renderGeometry(
        smoothPolygonsInBox(mergeAdmin1ByCodes(RUS_MOSCOU), [50, 70, 70, 78], 0.1, 3), // Nova Zembla/Vaygach polidas
        [[26, 40, 72, 83]]
      ),
    centerOverride: [742, 126],
    neighbors: ["suecia", "polonia", "balcas", "omsk", "aral", "oriente_medio"],
  },

  // ================= AFRICA (6 — Sudão no longer connects directly to África do Sul!) =================
  {
    id: "argelia",
    name: "Algeria",
    namePt: "Argélia",
    continent: "africa",
    symbol: "circle",
    buildGeo: () =>
      renderGeometry(
        mergeCountries([
          "Morocco",
          "W. Sahara",
          "Algeria",
          "Tunisia",
          "Mauritania",
          "Mali",
          "Niger",
          "Senegal",
          "Gambia",
          "Guinea-Bissau",
          "Guinea",
          "Sierra Leone",
          "Liberia",
          "Côte d'Ivoire",
          "Burkina Faso",
          "Ghana",
          "Togo",
          "Benin",
          "Nigeria",
        ])
      ),
    centerOverride: [596, 254],
    neighbors: ["brasil", "franca", "egito", "sudao", "congo"],
  },
  {
    id: "egito",
    name: "Egypt",
    namePt: "Egito",
    continent: "africa",
    symbol: "triangle",
    buildGeo: () => renderGeometry(mergeCountries(["Egypt", "Libya"])),
    centerOverride: [668, 228],
    neighbors: ["franca", "balcas", "oriente_medio", "argelia", "sudao"],
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
          "Sudan",
          "S. Sudan",
          "Chad",
          "Ethiopia",
          "Eritrea",
          "Djibouti",
          "Somalia",
          "Somaliland",
          "Kenya",
          "Uganda",
        ])
      ),
    centerOverride: [706, 282],
    neighbors: ["argelia", "egito", "congo", "madagascar"],
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
          "Dem. Rep. Congo",
          "Congo",
          "Central African Rep.",
          "Cameroon",
          "Gabon",
          "Eq. Guinea",
          "Rwanda",
          "Burundi",
          "Tanzania",
          "Angola",
        ])
      ),
    centerOverride: [672, 332],
    neighbors: ["argelia", "sudao", "africa_do_sul"],
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
          "South Africa",
          "Namibia",
          "Botswana",
          "Zimbabwe",
          "Zambia",
          "Malawi",
          "Mozambique",
          "Lesotho",
          "eSwatini",
        ])
      ),
    centerOverride: [686, 392],
    neighbors: ["congo", "madagascar", "argentina"],
  },
  {
    id: "madagascar",
    name: "Madagascar",
    namePt: "Madagascar",
    continent: "africa",
    symbol: "circle",
    buildGeo: () => renderGeometry(mergeCountries(["Madagascar"])),
    centerOverride: [756, 385],
    neighbors: ["sudao", "africa_do_sul"],
  },

  // ================= ASIA (12) — 3 Sub-Regions =================
  // Sub-Region 1: Indo-Arábia (4 — Aral renamed to Cazaquistão!)
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
          "Turkey",
          "Syria",
          "Lebanon",
          "Israel",
          "Palestine",
          "Jordan",
          "Iraq",
          "Iran",
          "Saudi Arabia",
          "Yemen",
          "Oman",
          "United Arab Emirates",
          "Qatar",
          "Kuwait",
          "Georgia",
          "Armenia",
          "Azerbaijan",
          "Cyprus",
          "N. Cyprus",
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
          "Kazakhstan",
          "Uzbekistan",
          "Turkmenistan",
          "Kyrgyzstan",
          "Tajikistan",
          "Afghanistan",
        ])
      ),
    centerOverride: [818, 170],
    neighbors: ["moscou", "omsk", "china", "india", "oriente_medio"],
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
    neighbors: ["oriente_medio", "aral", "china", "vietna", "sumatra"],
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
        [[92, 1, 109.55, 29]] // 109.55E: inclui a costa central do Vietna (Cabo Dai Lanh 109.46E) sem pegar Sarawak (109.6E)
      ),
    centerOverride: [936, 262],
    neighbors: ["china", "india", "borneu"],
  },

  // Sub-Region 2: Estepes & Sibéria (4 — Real Russian Admin-1 Oblasts/Krais!)
  {
    id: "omsk",
    name: "Omsk",
    namePt: "Omsk",
    continent: "asia",
    subRegion: "asia_steppes",
    symbol: "square",
    buildGeo: () => renderGeometry(mergeAdmin1ByCodes(RUS_OMSK), [[56, 48, 92, 76]]),
    centerOverride: [840, 122],
    neighbors: ["moscou", "dudinka", "mongolia", "china", "aral"],
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
    neighbors: ["dudinka", "siberia", "vladivostok", "china", "mongolia"],
  },

  // Sub-Region 3: Leste Asiático (4 — Vladivostok seamless across 180° meridian!)
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
    neighbors: ["siberia", "tchita", "china", "japao", "alasca"],
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
    neighbors: ["omsk", "dudinka", "tchita", "china"],
  },
  {
    id: "china",
    name: "China",
    namePt: "China",
    continent: "asia",
    subRegion: "asia_east",
    symbol: "square",
    buildGeo: () =>
      renderGeometry(mergeCountries(["China", "North Korea", "South Korea"])),
    centerOverride: [966, 208],
    neighbors: ["aral", "omsk", "mongolia", "tchita", "vladivostok", "japao", "vietna", "india"],
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
    neighbors: ["vladivostok", "china", "havai"],
  },

  // ================= OCEANIA (4 — Unified Borneo, Sumatra, New Guinea!) =================
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
          { name: "Indonesia", box: [108.5, -4.6, 119.5, 7.5] }, // Kalimantan
          { name: "Malaysia", box: [108.5, 0.5, 120, 8] }, // Sarawak + Sabah
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
        "Papua New Guinea",
        "Solomon Is.",
        "Vanuatu",
        "Fiji",
      ]);
      // A thin bridge over the 141°E border dissolves the Indonesia/PNG seam into one landmass
      const border = rectGeometry(140.6, -9.3, 141.5, -2.5); // wide margin so the union leaves no thin sliver seam
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
    neighbors: ["sumatra", "borneu", "nova_guine", "argentina"],
  },
];

// Generate global coastline land outline (clipped to x=[36..1199.5] in the Arctic so Chukotka doesn't draw a duplicate uncolored meridian box at x=0..35!)
const landFeature = topojson.feature(c110, c110.objects.land);
const basePathGen = d3.geoPath(BASE_PROJ).digits(1);
const globalLandSvgPath = basePathGen(landFeature) || "";
const graticuleSvgPath = basePathGen(d3.geoGraticule10()) || "";

/** Extra small-island coastline patches (lon/lat ring coords) for land visible in the relief JPG but missing from the Natural Earth source, keyed by territory id. */
const COASTLINE_PATCHES: Record<string, number[][][]> = {"siberia": [[[152.025, 73.95], [149.025, 73.95], [148.8, 74.175], [149.025, 74.4], [150.675, 74.55], [151.125, 75.0], [151.425, 74.85], [152.175, 75.15], [153.075, 75.15], [153.6, 74.775], [152.925, 74.1], [152.175, 74.1], [152.025, 73.95]], [[146.175, 73.8], [145.725, 73.8], [145.2, 74.475], [145.425, 74.7], [146.025, 74.7], [146.175, 74.85], [146.4, 74.625], [146.4, 74.025], [146.175, 73.8]], [[145.275, 73.05], [145.125, 73.2], [144.075, 73.2], [143.7, 73.575], [143.925, 73.8], [145.275, 73.65], [145.5, 73.425], [145.275, 73.05]], [[129.825, 71.7], [129.6, 71.925], [129.75, 72.375], [129.15, 73.275], [129.375, 73.5], [129.675, 73.2], [130.275, 73.2], [130.65, 72.825], [130.05, 72.225], [130.05, 71.925], [129.825, 71.7]], [[148.125, 72.6], [146.775, 72.6], [146.625, 72.75], [146.325, 72.6], [145.8, 72.975], [146.025, 73.2], [146.475, 73.2], [146.625, 73.35], [147.975, 73.35], [148.5, 72.975], [148.125, 72.6]], [[152.775, 71.1], [152.175, 71.25], [151.875, 71.55], [151.575, 71.55], [151.425, 71.7], [150.675, 71.7], [149.7, 72.525], [149.925, 72.75], [151.125, 72.75], [151.425, 72.45], [152.775, 71.85], [153.15, 71.475], [152.775, 71.1]], [[161.775, 69.75], [161.625, 69.9], [161.175, 69.9], [161.025, 69.75], [160.575, 70.05], [159.9, 70.875], [160.125, 71.1], [160.725, 71.1], [161.325, 70.8], [161.775, 70.8], [162.15, 70.425], [161.775, 69.75]]], "dudinka": [[[76.575, 72.3], [76.2, 72.525], [76.05, 72.975], [75.75, 73.275], [75.975, 73.5], [76.125, 73.35], [76.275, 73.5], [76.425, 73.35], [76.725, 73.5], [77.4, 72.975], [76.575, 72.3]], [[73.275, 69.0], [72.9, 69.225], [72.9, 69.525], [73.05, 69.675], [72.9, 70.275], [73.2, 70.875], [73.575, 70.95], [73.95, 70.575], [73.2, 69.825], [73.5, 69.375], [73.275, 69.0]], [[73.125, 67.05], [72.9, 67.275], [73.5, 67.875], [73.5, 68.025], [74.025, 68.4], [74.4, 68.025], [73.575, 67.2], [73.275, 67.2], [73.125, 67.05]]], "suecia": [[[15.525, 68.4], [15.225, 68.4], [15.0, 68.625], [15.225, 68.85], [15.525, 68.85], [15.75, 68.625], [15.525, 68.4]]], "aral": [[[52.575, 45.75], [52.275, 45.75], [52.05, 45.975], [52.425, 46.5], [52.8, 46.275], [52.8, 45.975], [52.575, 45.75]], [[53.775, 40.95], [53.1, 41.325], [53.475, 41.7], [54.0, 41.175], [53.775, 40.95]]], "moscou": [[[49.425, 45.6], [49.05, 45.825], [49.575, 46.2], [49.8, 45.975], [49.425, 45.6]]], "china": [[[119.025, 38.1], [118.875, 38.25], [118.125, 38.4], [117.9, 38.625], [118.125, 38.85], [118.725, 38.85], [119.25, 38.325], [119.025, 38.1]], [[122.025, 31.95], [121.2, 32.925], [120.6, 34.125], [120.825, 34.5], [121.575, 34.35], [122.1, 33.675], [121.95, 33.525], [122.1, 33.225], [121.95, 32.775], [122.25, 32.175], [122.025, 31.95]], [[122.175, 30.0], [121.8, 30.525], [122.325, 31.05], [122.55, 30.825], [122.55, 30.375], [122.175, 30.0]]], "india": [[[91.125, 21.45], [90.675, 21.45], [90.45, 21.675], [91.125, 22.5], [91.65, 21.975], [91.65, 21.825], [91.125, 21.45]], [[72.075, 20.25], [71.775, 20.25], [71.55, 20.475], [72.225, 20.85], [72.45, 20.625], [72.075, 20.25]]], "vietna": [[[96.975, 15.9], [96.6, 16.125], [96.975, 16.5], [97.2, 16.275], [96.975, 15.9]]], "brasil": [[[-48.375, -0.15], [-48.675, 0.15], [-50.025, 0.15], [-50.25, 0.375], [-49.65, 0.975], [-49.65, 1.725], [-50.4, 2.475], [-50.175, 2.85], [-49.575, 2.55], [-48.9, 1.875], [-48.15, 0.375], [-48.15, 0.075], [-48.375, -0.15]]], "australia": [[[131.025, -11.85], [130.575, -11.85], [130.2, -11.475], [130.425, -11.25], [130.575, -11.4], [131.025, -11.4], [131.175, -11.25], [131.4, -11.475], [131.025, -11.85]]]};

/** Renders COASTLINE_PATCHES[id] (if any) as extra SVG subpaths in the same projection as renderGeometry, appended to `d`. */
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

// Strict bounding-box verification so no territory EVER has an inverted ocean-filling polygon!
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

// Verify neighbor symmetry before writing!
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

const currentSrc = fs.readFileSync(path.join(__dirname, "../src/index.ts"), "utf-8");
const objIndex = currentSrc.indexOf("export const CLASSIC_OBJECTIVES");
const objectivesCode = currentSrc.slice(objIndex);

const outputTs = `import type { GameMapDef, ObjectiveCard } from "@hegemonia/shared";

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
    bonus: 3,
    color: "#e11d48",
    territoryIds: ["vladivostok", "mongolia", "china", "japao"],
  },
];

export const CLASSIC_MAP: GameMapDef = {
  id: "classic_44",
  name: "Mundo Geopolítico Natural Earth (44 Territórios)",
  continents: [
    { id: "south_america", name: "South America", namePt: "América do Sul", bonus: 2, color: "#10b981" },
    { id: "north_america", name: "North America", namePt: "América do Norte", bonus: 5, color: "#f59e0b" },
    { id: "europe", name: "Europe", namePt: "Europa", bonus: 5, color: "#3b82f6" },
    { id: "africa", name: "Africa", namePt: "África", bonus: 3, color: "#eab308" },
    { id: "asia", name: "Asia", namePt: "Ásia", bonus: 7, color: "#ef4444" },
    { id: "oceania", name: "Oceania", namePt: "Oceania", bonus: 2, color: "#a855f7" },
  ],
  territories: ${JSON.stringify(builtTerritories, null, 2)} as any,
};

${objectivesCode}
`;

fs.writeFileSync(path.join(__dirname, "../src/index.ts"), outputTs, "utf-8");
console.log("✅ Successfully generated 44-territory Natural Earth Admin-1 & Admin-0 Geopolitical Map!");