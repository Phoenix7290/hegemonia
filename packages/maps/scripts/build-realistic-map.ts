import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as d3 from "d3-geo";
import * as topojson from "topojson-client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const c110 = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../node_modules/world-atlas/countries-110m.json"),
    "utf-8"
  )
);

// Map dimensions: width = 1200, height = 620
// Equirectangular projection with width = 1200 guarantees exact horizontal wraparound at x=0 and x=1200!
const MAP_WIDTH = 1200;
const BASE_PROJ = d3
  .geoEquirectangular()
  .scale(MAP_WIDTH / (2 * Math.PI))
  .translate([MAP_WIDTH / 2, 330]);

type BBox = [number, number, number, number]; // [lonMin, latMin, lonMax, latMax]

function mergeCountries(names: string[]) {
  const nameSet = new Set(names);
  const geoms = c110.objects.countries.geometries.filter((g: any) =>
    nameSet.has(g.properties.name)
  );
  if (geoms.length === 0) {
    throw new Error(`No geometries found for: ${names.join(", ")}`);
  }
  return topojson.merge(c110, geoms);
}

function renderClipped(geojson: any, boxes?: BBox[]): { d: string; center: [number, number] } {
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
      .translate([MAP_WIDTH / 2, 330])
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

interface TerritorySpec {
  id: string;
  name: string;
  namePt: string;
  continent: string;
  subRegion?: string;
  symbol: "circle" | "square" | "triangle";
  countries: string[];
  boxes?: BBox[];
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
    countries: ["Brazil"],
    neighbors: ["venezuela", "peru", "argentina", "argelia"],
  },
  {
    id: "argentina",
    name: "Argentina",
    namePt: "Argentina",
    continent: "south_america",
    symbol: "square",
    countries: ["Argentina", "Chile", "Uruguay", "Paraguay", "Falkland Is."],
    neighbors: ["brasil", "peru", "australia", "africa_do_sul"],
  },
  {
    id: "peru",
    name: "Peru",
    namePt: "Peru",
    continent: "south_america",
    symbol: "triangle",
    countries: ["Peru", "Bolivia", "Ecuador"],
    neighbors: ["venezuela", "brasil", "argentina"],
  },
  {
    id: "venezuela",
    name: "Venezuela",
    namePt: "Venezuela",
    continent: "south_america",
    symbol: "triangle",
    countries: ["Venezuela", "Colombia", "Guyana", "Suriname", "France"],
    boxes: [[-85, -10, -50, 15]],
    neighbors: ["mexico", "brasil", "peru"],
  },

  // ================= NORTH AMERICA (9) =================
  {
    id: "mexico",
    name: "Mexico",
    namePt: "México",
    continent: "north_america",
    symbol: "square",
    countries: [
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
    ],
    neighbors: ["california", "nova_york", "venezuela"],
  },
  {
    id: "california",
    name: "California",
    namePt: "Califórnia",
    continent: "north_america",
    symbol: "square",
    countries: ["United States of America"],
    boxes: [[-128, 24, -96, 49.5]],
    neighbors: ["vancouver", "ottawa", "nova_york", "mexico", "japao"],
  },
  {
    id: "nova_york",
    name: "New York",
    namePt: "Nova York",
    continent: "north_america",
    symbol: "triangle",
    countries: ["United States of America"],
    boxes: [[-96, 24, -65, 49.5]],
    neighbors: ["california", "ottawa", "labrador", "mexico"],
  },
  {
    id: "labrador",
    name: "Labrador",
    namePt: "Labrador",
    continent: "north_america",
    symbol: "circle",
    countries: ["Canada"],
    boxes: [[-76, 42, -50, 64]],
    neighbors: ["ottawa", "nova_york", "groenlandia"],
  },
  {
    id: "ottawa",
    name: "Ottawa",
    namePt: "Ottawa",
    continent: "north_america",
    symbol: "circle",
    countries: ["Canada"],
    boxes: [[-98, 41, -76, 60]],
    neighbors: ["mackenzie", "vancouver", "california", "nova_york", "labrador", "groenlandia"],
  },
  {
    id: "vancouver",
    name: "Vancouver",
    namePt: "Vancouver",
    continent: "north_america",
    symbol: "triangle",
    countries: ["Canada"],
    boxes: [[-140, 48, -98, 60]],
    neighbors: ["alasca", "mackenzie", "ottawa", "california"],
  },
  {
    id: "mackenzie",
    name: "Mackenzie",
    namePt: "Mackenzie",
    continent: "north_america",
    symbol: "circle",
    countries: ["Canada"],
    boxes: [[-141, 60, -60, 84]],
    centerOverride: [245, 102],
    neighbors: ["alasca", "vancouver", "ottawa", "groenlandia"],
  },
  {
    id: "alasca",
    name: "Alaska",
    namePt: "Alasca",
    continent: "north_america",
    symbol: "triangle",
    countries: ["United States of America"],
    boxes: [[-179.9, 51, -130, 73]],
    neighbors: ["mackenzie", "vancouver", "vladivostok"],
  },
  {
    id: "groenlandia",
    name: "Greenland",
    namePt: "Groenlândia",
    continent: "north_america",
    symbol: "circle",
    countries: ["Greenland"],
    neighbors: ["mackenzie", "ottawa", "labrador", "islandia"],
  },

  // ================= EUROPE (7) =================
  {
    id: "islandia",
    name: "Iceland",
    namePt: "Islândia",
    continent: "europe",
    symbol: "triangle",
    countries: ["Iceland"],
    neighbors: ["groenlandia", "inglaterra"],
  },
  {
    id: "inglaterra",
    name: "Great Britain",
    namePt: "Inglaterra",
    continent: "europe",
    symbol: "circle",
    countries: ["United Kingdom", "Ireland"],
    neighbors: ["islandia", "suecia", "franca", "alemanha"],
  },
  {
    id: "suecia",
    name: "Sweden",
    namePt: "Suécia",
    continent: "europe",
    symbol: "square",
    countries: ["Norway", "Sweden", "Finland", "Denmark"],
    boxes: [[4, 54, 32, 72]],
    neighbors: ["inglaterra", "moscou"],
  },
  {
    id: "alemanha",
    name: "Germany",
    namePt: "Alemanha",
    continent: "europe",
    symbol: "circle",
    countries: ["Germany", "Netherlands", "Belgium", "Luxembourg", "Switzerland", "Austria", "Czechia"],
    neighbors: ["inglaterra", "franca", "polonia"],
  },
  {
    id: "franca",
    name: "France",
    namePt: "França",
    continent: "europe",
    symbol: "square",
    countries: ["France", "Spain", "Portugal", "Italy"],
    boxes: [[-11, 35, 19, 52]],
    neighbors: ["inglaterra", "alemanha", "polonia", "argelia", "egito"],
  },
  {
    id: "polonia",
    name: "Poland",
    namePt: "Polônia",
    continent: "europe",
    symbol: "triangle",
    countries: [
      "Poland",
      "Slovakia",
      "Hungary",
      "Romania",
      "Moldova",
      "Ukraine",
      "Belarus",
      "Lithuania",
      "Latvia",
      "Estonia",
      "Slovenia",
      "Croatia",
      "Bosnia and Herz.",
      "Serbia",
      "Montenegro",
      "Kosovo",
      "Albania",
      "Macedonia",
      "Bulgaria",
      "Greece",
    ],
    neighbors: ["alemanha", "franca", "moscou", "oriente_medio", "egito"],
  },
  {
    id: "moscou",
    name: "Moscow",
    namePt: "Moscou",
    continent: "europe",
    symbol: "triangle",
    countries: ["Russia"],
    boxes: [[27, 41, 58, 78]],
    neighbors: ["suecia", "polonia", "omsk", "aral", "oriente_medio"],
  },

  // ================= AFRICA (6) =================
  {
    id: "argelia",
    name: "Algeria",
    namePt: "Argélia",
    continent: "africa",
    symbol: "circle",
    countries: [
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
    ],
    neighbors: ["brasil", "franca", "egito", "sudao", "congo"],
  },
  {
    id: "egito",
    name: "Egypt",
    namePt: "Egito",
    continent: "africa",
    symbol: "triangle",
    countries: ["Egypt", "Libya"],
    neighbors: ["franca", "polonia", "oriente_medio", "argelia", "sudao"],
  },
  {
    id: "sudao",
    name: "Sudan",
    namePt: "Sudão",
    continent: "africa",
    symbol: "square",
    countries: [
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
    ],
    neighbors: ["argelia", "egito", "congo", "africa_do_sul", "madagascar"],
  },
  {
    id: "congo",
    name: "Congo",
    namePt: "Congo",
    continent: "africa",
    symbol: "square",
    countries: [
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
    ],
    neighbors: ["argelia", "sudao", "africa_do_sul"],
  },
  {
    id: "africa_do_sul",
    name: "South Africa",
    namePt: "África do Sul",
    continent: "africa",
    symbol: "triangle",
    countries: [
      "South Africa",
      "Namibia",
      "Botswana",
      "Zimbabwe",
      "Zambia",
      "Malawi",
      "Mozambique",
      "Lesotho",
      "eSwatini",
    ],
    neighbors: ["congo", "sudao", "madagascar", "argentina"],
  },
  {
    id: "madagascar",
    name: "Madagascar",
    namePt: "Madagascar",
    continent: "africa",
    symbol: "circle",
    countries: ["Madagascar"],
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
    countries: [
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
    ],
    neighbors: ["polonia", "moscou", "aral", "india", "egito"],
  },
  {
    id: "aral",
    name: "Aral",
    namePt: "Aral",
    continent: "asia",
    subRegion: "asia_indo_arabia",
    symbol: "triangle",
    countries: ["Kazakhstan", "Uzbekistan", "Turkmenistan", "Kyrgyzstan", "Tajikistan", "Afghanistan"],
    neighbors: ["moscou", "omsk", "china", "india", "oriente_medio"],
  },
  {
    id: "india",
    name: "India",
    namePt: "Índia",
    continent: "asia",
    subRegion: "asia_indo_arabia",
    symbol: "triangle",
    countries: ["India", "Pakistan", "Bangladesh", "Sri Lanka", "Nepal", "Bhutan"],
    neighbors: ["oriente_medio", "aral", "china", "vietna", "sumatra"],
  },
  {
    id: "vietna",
    name: "Vietnam",
    namePt: "Vietnã",
    continent: "asia",
    subRegion: "asia_indo_arabia",
    symbol: "triangle",
    countries: ["Vietnam", "Thailand", "Myanmar", "Laos", "Cambodia", "Malaysia"],
    boxes: [[92, 1, 110, 29]],
    neighbors: ["china", "india", "borneu"],
  },

  // Sub-Region 2: Estepes & Sibéria (4)
  {
    id: "omsk",
    name: "Omsk",
    namePt: "Omsk",
    continent: "asia",
    subRegion: "asia_steppes",
    symbol: "square",
    countries: ["Russia"],
    boxes: [[58, 50, 85, 78]],
    neighbors: ["moscou", "dudinka", "mongolia", "china", "aral"],
  },
  {
    id: "dudinka",
    name: "Dudinka",
    namePt: "Dudinka",
    continent: "asia",
    subRegion: "asia_steppes",
    symbol: "circle",
    countries: ["Russia"],
    boxes: [[85, 59, 116, 82]],
    neighbors: ["omsk", "siberia", "tchita", "mongolia"],
  },
  {
    id: "siberia",
    name: "Siberia",
    namePt: "Sibéria",
    continent: "asia",
    subRegion: "asia_steppes",
    symbol: "triangle",
    countries: ["Russia"],
    boxes: [[116, 59, 148, 80]],
    neighbors: ["dudinka", "tchita", "vladivostok"],
  },
  {
    id: "tchita",
    name: "Tchita",
    namePt: "Tchita",
    continent: "asia",
    subRegion: "asia_steppes",
    symbol: "triangle",
    countries: ["Russia"],
    boxes: [[85, 49, 126, 59]],
    centerOverride: [962, 140],
    neighbors: ["dudinka", "siberia", "vladivostok", "china", "mongolia"],
  },

  // Sub-Region 3: Leste Asiático (4)
  {
    id: "vladivostok",
    name: "Vladivostok",
    namePt: "Vladivostok",
    continent: "asia",
    subRegion: "asia_east",
    symbol: "circle",
    countries: ["Russia"],
    boxes: [
      [148, 50, 179.9, 75],
      [126, 42, 148, 59],
    ],
    centerOverride: [1085, 136],
    neighbors: ["siberia", "tchita", "china", "japao", "alasca"],
  },
  {
    id: "mongolia",
    name: "Mongolia",
    namePt: "Mongólia",
    continent: "asia",
    subRegion: "asia_east",
    symbol: "circle",
    countries: ["Mongolia"],
    neighbors: ["omsk", "dudinka", "tchita", "china"],
  },
  {
    id: "china",
    name: "China",
    namePt: "China",
    continent: "asia",
    subRegion: "asia_east",
    symbol: "square",
    countries: ["China", "Taiwan", "North Korea", "South Korea"],
    centerOverride: [968, 214],
    neighbors: ["aral", "omsk", "mongolia", "tchita", "vladivostok", "japao", "vietna", "india"],
  },
  {
    id: "japao",
    name: "Japan",
    namePt: "Japão",
    continent: "asia",
    subRegion: "asia_east",
    symbol: "square",
    countries: ["Japan"],
    neighbors: ["vladivostok", "china", "california"],
  },

  // ================= OCEANIA (4) =================
  {
    id: "sumatra",
    name: "Sumatra",
    namePt: "Sumatra",
    continent: "oceania",
    symbol: "square",
    countries: ["Indonesia", "Timor-Leste"],
    boxes: [
      [94, -11, 115, 6],
      [115, -11, 127, -6],
    ],
    centerOverride: [942, 342],
    neighbors: ["india", "australia"],
  },
  {
    id: "borneu",
    name: "Borneo",
    namePt: "Bornéu",
    continent: "oceania",
    symbol: "square",
    countries: ["Indonesia", "Malaysia", "Brunei", "Philippines"],
    boxes: [[108.5, -5.5, 128, 20]],
    centerOverride: [985, 315],
    neighbors: ["vietna", "nova_guine", "australia"],
  },
  {
    id: "nova_guine",
    name: "New Guinea",
    namePt: "Nova Guiné",
    continent: "oceania",
    symbol: "circle",
    countries: ["Indonesia", "Papua New Guinea", "Solomon Is.", "Vanuatu", "Fiji"],
    boxes: [[128, -20, 179.9, 2]],
    centerOverride: [1072, 352],
    neighbors: ["borneu", "australia"],
  },
  {
    id: "australia",
    name: "Australia",
    namePt: "Austrália",
    continent: "oceania",
    symbol: "triangle",
    countries: ["Australia", "New Zealand", "New Caledonia"],
    centerOverride: [1048, 418],
    neighbors: ["sumatra", "borneu", "nova_guine", "argentina"],
  },
];

// Generate global coastline land outline and graticules for Cartographic Mode
const landFeature = topojson.feature(c110, c110.objects.land);
const basePathGen = d3.geoPath(BASE_PROJ).digits(1);
const globalLandSvgPath = basePathGen(landFeature) || "";
const graticuleSvgPath = basePathGen(d3.geoGraticule10()) || "";

const builtTerritories = SPECS.map((spec) => {
  const merged = mergeCountries(spec.countries);
  const { d, center } = renderClipped(merged, spec.boxes);
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
  territoryIds: string[];
}

export const ASIA_SUBREGIONS: AsiaSubRegionDef[] = [
  {
    id: "asia_indo_arabia",
    namePt: "Ásia: Indo-Arábia",
    bonus: 2,
    territoryIds: ["oriente_medio", "aral", "india", "vietna"],
  },
  {
    id: "asia_steppes",
    namePt: "Ásia: Estepes & Sibéria",
    bonus: 2,
    territoryIds: ["omsk", "dudinka", "siberia", "tchita"],
  },
  {
    id: "asia_east",
    namePt: "Ásia: Leste Asiático",
    bonus: 3,
    territoryIds: ["vladivostok", "mongolia", "china", "japao"],
  },
];

export const CLASSIC_MAP: GameMapDef = {
  id: "classic_42",
  name: "Mundo Geopolítico Natural Earth (42 Territórios)",
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
console.log("✅ Successfully generated Natural Earth Geopolitical Map!");
