import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as d3 from "d3-geo";
import * as topojson from "topojson-client";
import * as topojsonServer from "topojson-server";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const c110 = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../node_modules/world-atlas/countries-110m.json"),
    "utf-8"
  )
);

const admin1Raw = JSON.parse(
  fs.readFileSync("/tmp/ne_50m_admin_1.geojson", "utf-8")
);

// Convert Admin-1 FeatureCollection into a quantized Topology (3600) so topojson.merge dissolves internal state lines and keeps SVG paths lightweight!
const admin1Topo = topojsonServer.topology({ states: admin1Raw }, 3600) as any;
const admin1Geoms: any[] = admin1Topo.objects.states.geometries;

// Map dimensions: width = 1200, height = 620
// Equirectangular projection with translate([600, 320]) maps [-180..180, -90..90] to x=[0..1200], y=[20..620] (exact 1200x600 2:1 aspect ratio!)
const MAP_WIDTH = 1200;
const BASE_PROJ = d3
  .geoEquirectangular()
  .scale(MAP_WIDTH / (2 * Math.PI))
  .translate([MAP_WIDTH / 2, 320]);

const AREA_CHECK_PATH = d3.geoPath(BASE_PROJ);
function filterMicroPolygons(geojson: any, minAreaSqPx = 1.8): any {
  if (!geojson) return geojson;
  if (geojson.type === "Polygon") return geojson;
  if (geojson.type === "MultiPolygon") {
    const kept = geojson.coordinates.filter((coords: any) => {
      const poly = { type: "Polygon", coordinates: coords };
      return AREA_CHECK_PATH.area(poly as any) >= minAreaSqPx;
    });
    return {
      type: "MultiPolygon",
      coordinates: kept.length > 0 ? kept : geojson.coordinates.slice(0, 1),
    };
  }
  return geojson;
}

type BBox = [number, number, number, number]; // [lonMin, latMin, lonMax, latMax]

function mergeCountries(names: string[]) {
  const nameSet = new Set(names);
  const geoms = c110.objects.countries.geometries.filter((g: any) =>
    nameSet.has(g.properties.name)
  );
  if (geoms.length === 0) {
    throw new Error(`No country geometries found for: ${names.join(", ")}`);
  }
  return topojson.merge(c110, geoms);
}

function mergeAdmin1ByCodes(codes: string[], minAreaSqPx = 1.8) {
  const codeSet = new Set(codes);
  const geoms = admin1Geoms.filter((g: any) => codeSet.has(g.properties.adm1_code));
  if (geoms.length === 0) {
    throw new Error(`No Admin-1 geometries found for codes: ${codes.join(", ")}`);
  }
  return filterMicroPolygons(topojson.merge(admin1Topo, geoms), minAreaSqPx);
}

function renderGeometry(geojson: any, boxes?: BBox[]): { d: string; center: [number, number] } {
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
    const subD = pathGen(geojson);
    if (subD) {
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
const RUS_MOSCOU = rusGeoms
  .map((g) => g.properties.adm1_code as string)
  .filter((code) => !assignedRus.has(code));

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

// --- Grouping Indonesian Admin-1 Provinces (Zero Overlap on Borneo, Sumatra, New Guinea!) ---
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
    buildGeo: () => renderGeometry(mergeCountries(["Brazil"])),
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
    neighbors: ["brasil", "peru", "australia", "africa_do_sul"],
  },
  {
    id: "peru",
    name: "Peru",
    namePt: "Peru",
    continent: "south_america",
    symbol: "triangle",
    buildGeo: () => renderGeometry(mergeCountries(["Peru", "Bolivia", "Ecuador"])),
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
    neighbors: ["california", "nova_york", "venezuela"],
  },
  {
    id: "california",
    name: "California",
    namePt: "Califórnia",
    continent: "north_america",
    symbol: "square",
    buildGeo: () => renderGeometry(mergeAdmin1ByCodes(USA_CALIFORNIA)),
    centerOverride: [226, 200],
    neighbors: ["vancouver", "ottawa", "nova_york", "mexico", "havai"],
  },
  {
    id: "nova_york",
    name: "New York",
    namePt: "Nova York",
    continent: "north_america",
    symbol: "triangle",
    buildGeo: () => renderGeometry(mergeAdmin1ByCodes(USA_NEW_YORK)),
    centerOverride: [314, 198],
    neighbors: ["california", "ottawa", "labrador", "mexico"],
  },
  {
    id: "labrador",
    name: "Labrador",
    namePt: "Labrador",
    continent: "north_america",
    symbol: "circle",
    buildGeo: () => renderGeometry(mergeAdmin1ByCodes(CAN_LABRADOR)),
    centerOverride: [370, 150],
    neighbors: ["ottawa", "nova_york", "groenlandia"],
  },
  {
    id: "ottawa",
    name: "Ottawa",
    namePt: "Ottawa",
    continent: "north_america",
    symbol: "circle",
    buildGeo: () => renderGeometry(mergeAdmin1ByCodes(CAN_OTTAWA)),
    centerOverride: [298, 156],
    neighbors: ["mackenzie", "vancouver", "california", "nova_york", "labrador", "groenlandia"],
  },
  {
    id: "vancouver",
    name: "Vancouver",
    namePt: "Vancouver",
    continent: "north_america",
    symbol: "triangle",
    buildGeo: () => renderGeometry(mergeAdmin1ByCodes(CAN_VANCOUVER)),
    centerOverride: [222, 148],
    neighbors: ["alasca", "mackenzie", "ottawa", "california"],
  },
  {
    id: "mackenzie",
    name: "Mackenzie",
    namePt: "Mackenzie",
    continent: "north_america",
    symbol: "circle",
    buildGeo: () =>
      // Clip out tiny southern Hudson Bay / Ungava islands below 60N so they don't overlap Ottawa/Labrador
      renderGeometry(mergeAdmin1ByCodes(CAN_MACKENZIE), [[-141, 60, -61, 84]]),
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
      renderGeometry(mergeAdmin1ByCodes(USA_ALASKA), [[-179.9, 51, -129, 73]]),
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
    neighbors: ["mackenzie", "ottawa", "labrador", "islandia"],
  },
  {
    id: "havai",
    name: "Hawaii",
    namePt: "Havaí",
    continent: "north_america",
    symbol: "circle",
    buildGeo: () => {
      const realHi = renderGeometry(mergeAdmin1ByCodes(USA_HAWAII));
      // Add a crisp clickable naval archipelago chain polygon around Hawaii (x=75, y=250) so it's easy to click & see!
      const [hx, hy] = BASE_PROJ([-157.5, 20.8])!;
      const cx = Math.round(hx);
      const cy = Math.round(hy);
      const islandChainSvg = `M${cx - 18},${cy - 8} L${cx - 10},${cy - 11} L${cx - 4},${cy - 5} L${cx - 12},${cy - 2} Z M${cx - 2},${cy - 3} L${cx + 7},${cy - 5} L${cx + 10},${cy + 2} L${cx + 1},${cy + 4} Z M${cx + 9},${cy + 4} L${cx + 19},${cy + 2} L${cx + 22},${cy + 11} L${cx + 11},${cy + 13} Z`;
      return {
        d: `${realHi.d} ${islandChainSvg}`.trim(),
        center: [cx + 2, cy + 2],
      };
    },
    neighbors: ["california", "japao", "nova_guine"],
  },

  // ================= EUROPE (8 — Denmark in Alemanha, Polonia split into Polonia + Balcas!) =================
  {
    id: "islandia",
    name: "Iceland",
    namePt: "Islândia",
    continent: "europe",
    symbol: "triangle",
    buildGeo: () => renderGeometry(mergeCountries(["Iceland"])),
    neighbors: ["groenlandia", "inglaterra"],
  },
  {
    id: "inglaterra",
    name: "Great Britain",
    namePt: "Inglaterra",
    continent: "europe",
    symbol: "circle",
    buildGeo: () => renderGeometry(mergeCountries(["United Kingdom", "Ireland"])),
    centerOverride: [586, 146],
    neighbors: ["islandia", "suecia", "franca", "alemanha"],
  },
  {
    id: "suecia",
    name: "Sweden",
    namePt: "Suécia",
    continent: "europe",
    symbol: "square",
    buildGeo: () =>
      // Denmark removed from Sweden and added to Germany!
      renderGeometry(mergeCountries(["Norway", "Sweden", "Finland"]), [[4, 54, 32, 72]]),
    centerOverride: [652, 108],
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
    centerOverride: [634, 152],
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
    centerOverride: [604, 178],
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
      const kaliningrad = mergeAdmin1ByCodes(RUS_KALININGRAD);
      return renderGeometry(combineGeometries([centralEast, kaliningrad]));
    },
    centerOverride: [684, 148],
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
    centerOverride: [674, 182],
    neighbors: ["alemanha", "franca", "polonia", "moscou", "oriente_medio", "egito"],
  },
  {
    id: "moscou",
    name: "Moscow",
    namePt: "Moscou",
    continent: "europe",
    symbol: "triangle",
    buildGeo: () => renderGeometry(mergeAdmin1ByCodes(RUS_MOSCOU)),
    centerOverride: [736, 126],
    neighbors: ["suecia", "polonia", "balcas", "omsk", "aral", "oriente_medio"],
  },

  // ================= AFRICA (6) =================
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
    neighbors: ["brasil", "franca", "egito", "sudao", "congo"],
  },
  {
    id: "egito",
    name: "Egypt",
    namePt: "Egito",
    continent: "africa",
    symbol: "triangle",
    buildGeo: () => renderGeometry(mergeCountries(["Egypt", "Libya"])),
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
    neighbors: ["argelia", "egito", "congo", "africa_do_sul", "madagascar"],
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
    neighbors: ["congo", "sudao", "madagascar", "argentina"],
  },
  {
    id: "madagascar",
    name: "Madagascar",
    namePt: "Madagascar",
    continent: "africa",
    symbol: "circle",
    buildGeo: () => renderGeometry(mergeCountries(["Madagascar"])),
    neighbors: ["sudao", "africa_do_sul"],
  },

  // ================= ASIA (12) — 3 Sub-Regions =================
  // Sub-Region 1: Indo-Arábia (4)
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
    neighbors: ["balcas", "moscou", "aral", "india", "egito"],
  },
  {
    id: "aral",
    name: "Aral",
    namePt: "Aral",
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
      // Peninsular Malaysia (lon < 105) included here; East Malaysia on Borneo (lon > 108) excluded!
      renderGeometry(
        mergeCountries(["Vietnam", "Thailand", "Myanmar", "Laos", "Cambodia", "Malaysia"]),
        [[92, 1, 108, 29]]
      ),
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
    buildGeo: () => renderGeometry(mergeAdmin1ByCodes(RUS_OMSK)),
    centerOverride: [842, 122],
    neighbors: ["moscou", "dudinka", "mongolia", "china", "aral"],
  },
  {
    id: "dudinka",
    name: "Dudinka",
    namePt: "Dudinka",
    continent: "asia",
    subRegion: "asia_steppes",
    symbol: "circle",
    buildGeo: () => renderGeometry(mergeAdmin1ByCodes(RUS_DUDINKA)),
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
    buildGeo: () => renderGeometry(mergeAdmin1ByCodes(RUS_SIBERIA)),
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
    buildGeo: () => renderGeometry(mergeAdmin1ByCodes(RUS_TCHITA)),
    centerOverride: [1002, 146],
    neighbors: ["dudinka", "siberia", "vladivostok", "china", "mongolia"],
  },

  // Sub-Region 3: Leste Asiático (4 — Sakhalin + Taiwan added to Japan!)
  {
    id: "vladivostok",
    name: "Vladivostok",
    namePt: "Vladivostok",
    continent: "asia",
    subRegion: "asia_east",
    symbol: "circle",
    buildGeo: () =>
      renderGeometry(mergeAdmin1ByCodes(RUS_VLADIVOSTOK), [[125, 41, 179.9, 75]]),
    centerOverride: [1095, 126],
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
    centerOverride: [946, 162],
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
    centerOverride: [968, 208],
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
      const sakhalin = mergeAdmin1ByCodes(RUS_SAKHALIN);
      return renderGeometry(combineGeometries([jpTw, sakhalin]));
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
      const idnSumatraJava = mergeAdmin1ByCodes(IDN_SUMATRA);
      const timor = mergeCountries(["Timor-Leste"]);
      return renderGeometry(combineGeometries([idnSumatraJava, timor]));
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
    buildGeo: () => {
      // 100% of Kalimantan (Indonesian Borneo) + East Malaysia (Sabah/Sarawak) + Brunei + Philippines
      const idnKalimantan = renderGeometry(mergeAdmin1ByCodes(IDN_BORNEO));
      const myBrPh = renderGeometry(
        mergeCountries(["Malaysia", "Brunei", "Philippines"]),
        [[108.5, 0.5, 128, 21]]
      );
      return {
        d: `${idnKalimantan.d} ${myBrPh.d}`.trim(),
        center: [986, 308],
      };
    },
    centerOverride: [986, 308],
    neighbors: ["vietna", "nova_guine", "australia"],
  },
  {
    id: "nova_guine",
    name: "New Guinea",
    namePt: "Nova Guiné",
    continent: "oceania",
    symbol: "circle",
    buildGeo: () => {
      const idnEast = mergeAdmin1ByCodes(IDN_NEW_GUINEA);
      const pngIslands = mergeCountries([
        "Papua New Guinea",
        "Solomon Is.",
        "Vanuatu",
        "Fiji",
      ]);
      return renderGeometry(combineGeometries([idnEast, pngIslands]), [[118, -22, 179.9, 5]]);
    },
    centerOverride: [1072, 344],
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

// Generate global coastline land outline and graticules
const landFeature = topojson.feature(c110, c110.objects.land);
const basePathGen = d3.geoPath(BASE_PROJ).digits(1);
const globalLandSvgPath = basePathGen(landFeature) || "";
const graticuleSvgPath = basePathGen(d3.geoGraticule10()) || "";

const builtTerritories = SPECS.map((spec) => {
  const { d, center } = spec.buildGeo();
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
  console.log(`${t.id.padEnd(15)} center=[${t.center[0]}, ${t.center[1]}] pathLen=${t.svgPath.length}`);
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
