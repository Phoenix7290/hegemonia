export type TacticalScenarioId =
  | "standard"
  | "fortress_europe"
  | "pacific_theater"
  | "oil_crisis"
  | "iron_curtain"
  | "defcon1_armageddon";

export interface TacticalScenarioDef {
  id: TacticalScenarioId;
  name: string;
  codename: string;
  badge: string;
  difficulty: "Normal" | "Desafiador" | "Extremo";
  description: string;
  strategicBriefing: string;
  playerRole: string;
  aiOpposition: string;
  initialTension: number;
}

export const TACTICAL_SCENARIOS: TacticalScenarioDef[] = [
  {
    id: "standard",
    name: "Distribuição Clássica",
    codename: "OPERAÇÃO TABULEIRO GLOBAL",
    badge: "Balanceado",
    difficulty: "Normal",
    description: "Distribuição territorial tradicional e simétrica, com divisões base e equilíbrio geopolítico entre todas as potências.",
    strategicBriefing: "Todas as províncias são distribuídas de maneira equitativa entre os generais presentes. Recursos iniciais zerados e tensão mundial neutra.",
    playerRole: "Comando padrão com objetivo estratégico secreto e alocação clássica.",
    aiOpposition: "Facções rivais competindo por expansão territorial e controle de continentes.",
    initialTension: 0,
  },
  {
    id: "fortress_europe",
    name: "Cerco da Fortaleza Europa",
    codename: "OPERAÇÃO REDUTO CONTINENTAL",
    badge: "Cerco Assimétrico",
    difficulty: "Extremo",
    description: "O jogador controla um reduto fortificado na Europa Ocidental e Central, sitiado por divisões mecanizadas inimigas que cortaram linhas de suprimento.",
    strategicBriefing: "Suas províncias contam com fortificações de concreto e obuseiros pesados, mas a retaguarda está ameaçada e a superioridade numérica inimiga é esmagadora. Rompa o cerco antes do colapso.",
    playerRole: "Guarnição da Europa Ocidental fortificada com bunkers e baterias de artilharia.",
    aiOpposition: "Exércitos blindados da IA concentrados no Leste Europeu e Norte da África.",
    initialTension: 25,
  },
  {
    id: "pacific_theater",
    name: "Invasão Anfíbia no Pacífico",
    codename: "TEMPESTADE NO OCEANO",
    badge: "Guerra Naval & Aérea",
    difficulty: "Desafiador",
    description: "Conflito naval e aeronaval através de estreitos e arquipélagos estratégicos sob severo bloqueio marítimo adversário.",
    strategicBriefing: "Frotas inimigas bloqueiam passagens anfíbias essenciais. Combine salvas de artilharia naval, caças de apoio aproximado (CAS) e pontes aéreas para projetar forças sobre ilhas-chave.",
    playerRole: "Força-tarefa aeronaval expedicionária com aeródromos e navios de escolta.",
    aiOpposition: "Esquadras da IA bloqueando travessias marítimas com domínio litorâneo.",
    initialTension: 35,
  },
  {
    id: "oil_crisis",
    name: "Guerra do Petróleo no Golfo",
    codename: "CRISE ENERGÉTICA GLOBAL",
    badge: "Escassez Crítica",
    difficulty: "Desafiador",
    description: "O jogador possui complexos industriais e tanques, mas inicia com reserva zero de petróleo. Blindados imobilizados até a captura de refinarias vitais.",
    strategicBriefing: "A falta de combustível paralisa a capacidade de manobra de blindados e missões aéreas. Conquiste poços petrolíferos defendidos por tropas de elite da IA para reabastecer sua frota mecânica.",
    playerRole: "Corpo mecanizado em choque energético (0 petróleo). Deve abrir corredores até os poços.",
    aiOpposition: "Facções do Oriente Médio e Cáucaso fortemente guarnecidas com refinarias ativas.",
    initialTension: 40,
  },
  {
    id: "iron_curtain",
    name: "Guerra Fria na Cortina de Ferro",
    codename: "OPERAÇÃO CORTINA DE FERRO",
    badge: "Guerra Fria Ativa",
    difficulty: "Desafiador",
    description: "Frente militarizada na Eurásia com duas superpotências em guerra fria ativa. A tensão mundial de 50% libera tratados de aliança militar desde a primeira rodada.",
    strategicBriefing: "As fronteiras da Europa e Ásia estão divididas por zonas fortificadas e arsenais bélicos. A tensão mundial de 50% permite a formalização de tratados de aliança militar desde o turno 1. Estabeleça alianças estratégicas antes que os adversários cerquem seu território.",
    playerRole: "Comando da Europa Ocidental com fortificações de fronteira e capacidade diplomática de selar alianças imediatas.",
    aiOpposition: "Superpotência oriental fortemente guarnecida com fábricas militares e divisões mecanizadas.",
    initialTension: 50,
  },
  {
    id: "defcon1_armageddon",
    name: "Confronto Nuclear DEFCON 1",
    codename: "GUERRA TOTAL // COLAPSO GLOBAL",
    badge: "Crise Pré-Apocalipse",
    difficulty: "Extremo",
    description: "A Guerra Fria atinge o limite crítico com 75% de tensão mundial. Todas as fronteiras estão hiper-militarizadas e qualquer ofensiva pode ultrapassar 90% e detonar o protocolo DEFCON 1.",
    strategicBriefing: "Mobilização máxima em todos os continentes: 4 a 6 divisões por província, fábricas e bases aéreas ativas. Com 75% de tensão, o mundo está a um passo da guerra total.",
    playerRole: "Comando Supremo em alerta nuclear máximo com forças combinadas prontas para ataque.",
    aiOpposition: "Superpotências vizinhas com postos avançados armados e tratados à beira do rompimento.",
    initialTension: 75,
  },
];

export const SCENARIO_BY_ID: Record<TacticalScenarioId, TacticalScenarioDef> =
  TACTICAL_SCENARIOS.reduce((acc, sc) => {
    acc[sc.id] = sc;
    return acc;
  }, {} as Record<TacticalScenarioId, TacticalScenarioDef>);

