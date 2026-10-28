import type { LocaleCatalog } from "../../types";
import { enCommon } from "./common";
import { enGame } from "./game";
import { enMap } from "./map";
import { enSocial } from "./social";
import { enComms } from "./comms";
import { enErrors } from "./errors";

export const en: LocaleCatalog = {
  common: enCommon,
  game: enGame,
  map: enMap,
  social: enSocial,
  comms: enComms,
  errors: enErrors,
};
