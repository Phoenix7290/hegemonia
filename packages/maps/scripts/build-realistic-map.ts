import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "hegemonia-build" } }, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve(d));
      })
      .on("error", reject);
  });
}

function extractPath(jsCode: string): string {
  let coordsStr = "";
  const coordsMatch = jsCode.match(/(?:coords|setCoords)[^\[]*\[\s*(\[\[[\s\S]*?\]\])\s*\]/);
  if (coordsMatch) {
    try {
      const parsed = JSON.parse(coordsMatch[1].replace(/'/g, '"'));
      coordsStr = parsed.map((p: any) => p.join(",")).join(" ");
    } catch {}
  }
  if (!coordsStr) {
    const directCoordsMatch = jsCode.match(/useState\(\s*(\[\[[\s\S]*?\]\])\s*\)/);
    if (directCoordsMatch) {
      try {
        const parsed = JSON.parse(directCoordsMatch[1].replace(/'/g, '"'));
        coordsStr = parsed.map((p: any) => p.join(",")).join(" ");
      } catch {}
    }
  }

  let marksStr = "";
  const marksMatch = jsCode.match(/marks\s*=\s*\[\s*\[(\d+),\s*(\d+)\]\s*\]/);
  if (marksMatch) {
    marksStr = `${marksMatch[1]} ${marksMatch[2]}`;
  }

  const start = jsCode.indexOf("d={`");
  if (start === -1) return "";
  const end = jsCode.indexOf("`}", start);
  let d = jsCode.slice(start + 4, end).trim();

  if (marksStr) {
    d = d.replace("${marks[0].join(' ')}", marksStr);
  }
  if (coordsStr) {
    d = d.replace("${coords.join(' ')}", coordsStr);
    d = d.replace("${c}", coordsStr);
  }
  return d;
}

function computeBBox(d: string): { minX: number; maxX: number; minY: number; maxY: number; cx: number; cy: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let currX = 0, currY = 0;
  const tokens = d.match(/([a-df-z]|[-+]?\d*\.?\d+(?:e[-+]?\d+)?)/gi);
  if (!tokens) return { minX: 0, maxX: 0, minY: 0, maxY: 0, cx: 0, cy: 0 };
  
  let cmd = "";
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[a-df-z]$/i.test(t)) {
      cmd = t;
      i++;
      continue;
    }
    if (cmd === "M") {
      currX = parseFloat(tokens[i++]);
      currY = parseFloat(tokens[i++]);
      minX = Math.min(minX, currX); maxX = Math.max(maxX, currX);
      minY = Math.min(minY, currY); maxY = Math.max(maxY, currY);
    } else if (cmd === "m") {
      currX += parseFloat(tokens[i++]);
      currY += parseFloat(tokens[i++]);
      minX = Math.min(minX, currX); maxX = Math.max(maxX, currX);
      minY = Math.min(minY, currY); maxY = Math.max(maxY, currY);
    } else if (cmd === "c") {
      i++; i++; i++; i++; // control points dx1, dy1, dx2, dy2
      const dx = parseFloat(tokens[i++]);
      const dy = parseFloat(tokens[i++]);
      currX += dx;
      currY += dy;
      minX = Math.min(minX, currX); maxX = Math.max(maxX, currX);
      minY = Math.min(minY, currY); maxY = Math.max(maxY, currY);
    } else if (cmd === "C") {
      i++; i++; i++; i++;
      currX = parseFloat(tokens[i++]);
      currY = parseFloat(tokens[i++]);
      minX = Math.min(minX, currX); maxX = Math.max(maxX, currX);
      minY = Math.min(minY, currY); maxY = Math.max(maxY, currY);
    } else {
      i++;
    }
  }
  return {
    minX, maxX, minY, maxY,
    cx: Math.round((minX + maxX) / 2),
    cy: Math.round((minY + maxY) / 2)
  };
}

const TERRITORY_SPECS: Record<string, { files: string[]; name: string; namePt: string; continent: string; symbol: "circle"|"square"|"triangle"; neighbors: string[] }> = {
  // SOUTH AMERICA (4)
  brasil: {
    files: ["sa/brazil.js"],
    name: "Brazil", namePt: "Brasil",
    continent: "south_america", symbol: "circle",
    neighbors: ["venezuela", "peru", "argentina", "argelia"],
  },
  argentina: {
    files: ["sa/argentina.js"],
    name: "Argentina", namePt: "Argentina",
    continent: "south_america", symbol: "square",
    neighbors: ["brasil", "peru"],
  },
  peru: {
    files: ["sa/peru.js"],
    name: "Peru", namePt: "Peru",
    continent: "south_america", symbol: "triangle",
    neighbors: ["venezuela", "brasil", "argentina"],
  },
  venezuela: {
    files: ["sa/venezuela.js"],
    name: "Venezuela", namePt: "Venezuela",
    continent: "south_america", symbol: "triangle",
    neighbors: ["mexico", "brasil", "peru"],
  },

  // NORTH AMERICA (9)
  mexico: {
    files: ["na/central.js"],
    name: "Mexico", namePt: "México",
    continent: "north_america", symbol: "square",
    neighbors: ["california", "nova_york", "venezuela"],
  },
  california: {
    files: ["na/west.js"],
    name: "California", namePt: "Califórnia",
    continent: "north_america", symbol: "square",
    neighbors: ["vancouver", "ottawa", "nova_york", "mexico"],
  },
  nova_york: {
    files: ["na/east.js"],
    name: "New York", namePt: "Nova York",
    continent: "north_america", symbol: "triangle",
    neighbors: ["california", "ottawa", "labrador", "mexico"],
  },
  labrador: {
    files: ["na/quebec.js"],
    name: "Labrador", namePt: "Labrador",
    continent: "north_america", symbol: "circle",
    neighbors: ["ottawa", "nova_york", "groenlandia"],
  },
  ottawa: {
    files: ["na/ontario.js"],
    name: "Ottawa", namePt: "Ottawa",
    continent: "north_america", symbol: "circle",
    neighbors: ["mackenzie", "vancouver", "california", "nova_york", "labrador", "groenlandia"],
  },
  vancouver: {
    files: ["na/alberta.js"],
    name: "Vancouver", namePt: "Vancouver",
    continent: "north_america", symbol: "triangle",
    neighbors: ["alasca", "mackenzie", "ottawa", "california"],
  },
  mackenzie: {
    files: ["na/northwest.js"],
    name: "Mackenzie", namePt: "Mackenzie",
    continent: "north_america", symbol: "circle",
    neighbors: ["alasca", "vancouver", "ottawa", "groenlandia"],
  },
  alasca: {
    files: ["na/alaska.js"],
    name: "Alaska", namePt: "Alasca",
    continent: "north_america", symbol: "triangle",
    neighbors: ["mackenzie", "vancouver", "vladivostok"],
  },
  groenlandia: {
    files: ["na/greenland.js"],
    name: "Greenland", namePt: "Groenlândia",
    continent: "north_america", symbol: "circle",
    neighbors: ["mackenzie", "ottawa", "labrador", "islandia"],
  },

  // EUROPE (7)
  islandia: {
    files: ["eu/iceland.js"],
    name: "Iceland", namePt: "Islândia",
    continent: "europe", symbol: "triangle",
    neighbors: ["groenlandia", "inglaterra"],
  },
  inglaterra: {
    files: ["eu/britian.js"],
    name: "Great Britain", namePt: "Inglaterra",
    continent: "europe", symbol: "circle",
    neighbors: ["islandia", "suecia", "franca", "alemanha"],
  },
  suecia: {
    files: ["eu/scandinavia.js"],
    name: "Sweden", namePt: "Suécia",
    continent: "europe", symbol: "square",
    neighbors: ["inglaterra", "moscou"],
  },
  alemanha: {
    files: ["eu/north.js"],
    name: "Germany", namePt: "Alemanha",
    continent: "europe", symbol: "circle",
    neighbors: ["inglaterra", "franca", "polonia"],
  },
  franca: {
    files: ["eu/west.js"],
    name: "France", namePt: "França",
    continent: "europe", symbol: "square",
    neighbors: ["inglaterra", "alemanha", "polonia", "argelia", "egito"],
  },
  polonia: {
    files: ["eu/south.js"],
    name: "Poland", namePt: "Polônia",
    continent: "europe", symbol: "triangle",
    neighbors: ["alemanha", "franca", "moscou", "oriente_medio", "egito"],
  },
  moscou: {
    files: ["eu/ukraine.js"],
    name: "Moscow", namePt: "Moscou",
    continent: "europe", symbol: "triangle",
    neighbors: ["suecia", "polonia", "omsk", "aral", "oriente_medio"],
  },

  // AFRICA (6)
  argelia: {
    files: ["af/north.js"],
    name: "Algeria", namePt: "Argélia",
    continent: "africa", symbol: "circle",
    neighbors: ["brasil", "franca", "egito", "sudao", "congo"],
  },
  egito: {
    files: ["af/egypt.js"],
    name: "Egypt", namePt: "Egito",
    continent: "africa", symbol: "triangle",
    neighbors: ["franca", "polonia", "oriente_medio", "argelia", "sudao"],
  },
  sudao: {
    files: ["af/east.js"],
    name: "Sudan", namePt: "Sudão",
    continent: "africa", symbol: "square",
    neighbors: ["argelia", "egito", "congo", "africa_do_sul", "madagascar"],
  },
  congo: {
    files: ["af/congo.js"],
    name: "Congo", namePt: "Congo",
    continent: "africa", symbol: "square",
    neighbors: ["argelia", "sudao", "africa_do_sul"],
  },
  africa_do_sul: {
    files: ["af/south.js"],
    name: "South Africa", namePt: "África do Sul",
    continent: "africa", symbol: "triangle",
    neighbors: ["congo", "sudao", "madagascar"],
  },
  madagascar: {
    files: ["af/madagascar.js"],
    name: "Madagascar", namePt: "Madagascar",
    continent: "africa", symbol: "circle",
    neighbors: ["sudao", "africa_do_sul"],
  },

  // ASIA (12)
  oriente_medio: {
    files: ["as/middle.js"],
    name: "Middle East", namePt: "Oriente Médio",
    continent: "asia", symbol: "square",
    neighbors: ["polonia", "moscou", "aral", "india", "egito"],
  },
  aral: {
    files: ["as/afganistan.js"],
    name: "Aral", namePt: "Aral",
    continent: "asia", symbol: "triangle",
    neighbors: ["moscou", "omsk", "china", "india", "oriente_medio"],
  },
  omsk: {
    files: ["as/ural.js"],
    name: "Omsk", namePt: "Omsk",
    continent: "asia", symbol: "square",
    neighbors: ["moscou", "dudinka", "mongolia", "china", "aral"],
  },
  dudinka: {
    files: ["as/yakutsk.js"],
    name: "Dudinka", namePt: "Dudinka",
    continent: "asia", symbol: "circle",
    neighbors: ["omsk", "siberia", "tchita", "mongolia"],
  },
  siberia: {
    files: ["as/siberia.js"],
    name: "Siberia", namePt: "Sibéria",
    continent: "asia", symbol: "triangle",
    neighbors: ["dudinka", "tchita", "vladivostok"],
  },
  vladivostok: {
    files: ["as/kamchatka.js"],
    name: "Vladivostok", namePt: "Vladivostok",
    continent: "asia", symbol: "circle",
    neighbors: ["siberia", "tchita", "china", "japao", "alasca"],
  },
  tchita: {
    files: ["as/irkutsk.js"],
    name: "Tchita", namePt: "Tchita",
    continent: "asia", symbol: "triangle",
    neighbors: ["dudinka", "siberia", "vladivostok", "china", "mongolia"],
  },
  mongolia: {
    files: ["as/mongolia.js"],
    name: "Mongolia", namePt: "Mongólia",
    continent: "asia", symbol: "circle",
    neighbors: ["omsk", "dudinka", "tchita", "china"],
  },
  china: {
    files: ["as/china.js"],
    name: "China", namePt: "China",
    continent: "asia", symbol: "square",
    neighbors: ["aral", "omsk", "mongolia", "tchita", "vladivostok", "japao", "vietna", "india"],
  },
  japao: {
    files: ["as/japan.js"],
    name: "Japan", namePt: "Japão",
    continent: "asia", symbol: "square",
    neighbors: ["vladivostok", "china"],
  },
  india: {
    files: ["as/india.js"],
    name: "India", namePt: "Índia",
    continent: "asia", symbol: "triangle",
    neighbors: ["oriente_medio", "aral", "china", "vietna", "sumatra"],
  },
  vietna: {
    files: ["as/siam.js"],
    name: "Vietnam", namePt: "Vietnã",
    continent: "asia", symbol: "triangle",
    neighbors: ["china", "india", "borneu"],
  },

  // OCEANIA (4)
  sumatra: {
    files: ["au/indonesia.js:sumatra"],
    name: "Sumatra", namePt: "Sumatra",
    continent: "oceania", symbol: "square",
    neighbors: ["india", "australia"],
  },
  borneu: {
    files: ["au/indonesia.js:borneo"],
    name: "Borneo", namePt: "Bornéu",
    continent: "oceania", symbol: "square",
    neighbors: ["vietna", "nova_guine", "australia"],
  },
  nova_guine: {
    files: ["au/guinea.js"],
    name: "New Guinea", namePt: "Nova Guiné",
    continent: "oceania", symbol: "circle",
    neighbors: ["borneu", "australia"],
  },
  australia: {
    files: ["au/west.js", "au/east.js"],
    name: "Australia", namePt: "Austrália",
    continent: "oceania", symbol: "triangle",
    neighbors: ["sumatra", "borneu", "nova_guine"],
  },
};

const BASE_URL = "https://raw.githubusercontent.com/raddrick/risk-map-svg/master/src/countries/";

async function main() {
  console.log("Fetching realistic geopolitical paths from risk-map-svg...");
  const cache: Record<string, string> = {};

  async function getFile(rel: string): Promise<string> {
    if (cache[rel]) return cache[rel];
    const text = await fetchText(BASE_URL + rel);
    cache[rel] = extractPath(text);
    return cache[rel];
  }

  const outputTerritories = [];

  for (const [id, spec] of Object.entries(TERRITORY_SPECS)) {
    let combinedSvg = "";
    for (const f of spec.files) {
      if (f === "au/indonesia.js:sumatra") {
        const full = await getFile("au/indonesia.js");
        // Split subpaths and keep Sumatra/Java (y >= 430)
        const parts = full.split(/(?=[M|m])/);
        combinedSvg = parts
          .filter((p) => {
            const m = p.match(/[M|m](\d+)\s+(\d+)/);
            if (!m) return false;
            return parseInt(m[2], 10) >= 430;
          })
          .join(" ");
      } else if (f === "au/indonesia.js:borneo") {
        const full = await getFile("au/indonesia.js");
        // Keep Borneo (y < 430)
        const parts = full.split(/(?=[M|m])/);
        combinedSvg = parts
          .filter((p) => {
            const m = p.match(/[M|m](\d+)\s+(\d+)/);
            if (!m) return false;
            return parseInt(m[2], 10) < 430;
          })
          .join(" ");
      } else {
        const p = await getFile(f);
        combinedSvg += (combinedSvg ? " " : "") + p;
      }
    }

    const bbox = computeBBox(combinedSvg);

    outputTerritories.push({
      id,
      name: spec.name,
      namePt: spec.namePt,
      continent: spec.continent,
      symbol: spec.symbol,
      neighbors: spec.neighbors,
      center: [bbox.cx, bbox.cy],
      svgPath: combinedSvg,
    });
  }

  console.log(`Processed ${outputTerritories.length} realistic territories.`);

  // Load existing objectives from packages/maps/src/index.ts
  const currentSrc = fs.readFileSync(path.join(__dirname, "../src/index.ts"), "utf-8");
  const objIndex = currentSrc.indexOf("export const CLASSIC_OBJECTIVES");
  const objectivesCode = currentSrc.slice(objIndex);

  const fileContent = `import type { GameMapDef, ObjectiveCard } from "@hegemonia/shared";

export const CLASSIC_MAP: GameMapDef = {
  id: "classic_42",
  name: "Mundo Clássico Geopolítico (42 Territórios)",
  continents: [
    { id: "south_america", name: "South America", namePt: "América do Sul", bonus: 2, color: "#10b981" },
    { id: "north_america", name: "North America", namePt: "América do Norte", bonus: 5, color: "#f59e0b" },
    { id: "europe", name: "Europe", namePt: "Europa", bonus: 5, color: "#3b82f6" },
    { id: "africa", name: "Africa", namePt: "África", bonus: 3, color: "#eab308" },
    { id: "asia", name: "Asia", namePt: "Ásia", bonus: 7, color: "#ef4444" },
    { id: "oceania", name: "Oceania", namePt: "Oceania", bonus: 2, color: "#a855f7" },
  ],
  territories: ${JSON.stringify(outputTerritories, null, 2)} as any,
};

${objectivesCode}
`;

  fs.writeFileSync(path.join(__dirname, "../src/index.ts"), fileContent, "utf-8");
  console.log("Successfully wrote packages/maps/src/index.ts with realistic geopolitical curves!");
}

main().catch(console.error);
