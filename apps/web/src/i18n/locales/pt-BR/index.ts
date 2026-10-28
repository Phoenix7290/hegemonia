import type { LocaleCatalog } from "../../types";
import { ptBRCommon } from "./common";
import { ptBRGame } from "./game";
import { ptBRMap } from "./map";
import { ptBRSocial } from "./social";
import { ptBRComms } from "./comms";
import { ptBRErrors } from "./errors";

export const ptBR: LocaleCatalog = {
  common: ptBRCommon,
  game: ptBRGame,
  map: ptBRMap,
  social: ptBRSocial,
  comms: ptBRComms,
  errors: ptBRErrors,
};
