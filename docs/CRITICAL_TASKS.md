# Hegemonia — Pre-Roadmap Polish & Critical Tasks (v0.1.x)

Este documento centraliza as correções de estabilidade, verificações manuais e melhorias de usabilidade essenciais que devem ser validadas antes de avançar para os épicos maiores do Roadmap (Economia, Frotas Navais e Aviação).

---

## Checklist de Itens Críticos

| # | Item / Tarefa | Escopo | Status |
|---|---|---|---|
| **1** | **Inspeção Visual da Ponta de Vladivostok** | Cartografia / TopoJSON | 🔍 Pronto para Validação Visual |
| **2** | **Botão de Retorno ao Lobby pós-Vitória** | Frontend (`apps/web`) & Server | ⏳ Pendente |
| **3** | **Equalização e Controle de Áudio (SFX vs Música)** | Frontend (`apps/web`) | ⏳ Pendente |
| **4** | **Trilhas Sonoras Locais Protegidas do Git** | Configuração (`.gitignore`) |  Concluído |
| **5** | **Clareza e Formatação do Feed de Logs de Combate** | Frontend & Engine | ⏳ Pendente |
| **6** | **Polimento de UI e Responsividade Widescreen/Laptop** | Frontend (`apps/web`) | ⏳ Pendente |
| **7** | **Revisão Textual & Eliminação de Typos (PT-BR/EN)** | Shared / Maps / Engine |  Concluído (v0.1.0-alpha) |
| **8** | **Stress Test de Estabilidade & Concorrência** | Engine & Server | ⏳ Pendente |
| **9** | **Compatibilidade Cross-Browser (Chromium / Firefox)** | Frontend (`apps/web`) | ⏳ Pendente |
| **10** | **Estabilidade e Reconexão do Multiplayer Online** | Frontend & Server | Concluído |

---

## Detalhamento Técnico das Tarefas

### 1. Inspeção Visual de Vladivostok (Península de Chukotka)
- **Objetivo**: Garantir que o deslocamento de coordenadas longitudinais no antimeridiano (180°) tenha soldado a extremidade de Chukotka ao restante do continente russo sem artefatos visuais.
- **Critério de Aceite**: Abrir o jogo na visão Cartográfica e Geopolítica; verificar se a ponta oriental de Vladivostok forma uma fronteira litorânea contínua com as ilhas ao norte e sem nenhuma fresta branca contra o estreito de Bering / Alasca.

### 2. Retorno ao Lobby pós-Término de Jogo
- **Objetivo**: Quando a partida atinge a fase `game_over` (um jogador cumpre seu objetivo secreto ou conquista o mundo), os jogadores precisam de uma saída limpa.
- **Critério de Aceite**:
  - Exibir modal ou painel de consagração de vitória com estatísticas da partida.
  - Disponibilizar um botão proeminente **"Voltar ao Lobby"** que desconecte a sala do Colyseus e retorne à tela inicial de criação/entrada de salas sem forçar recarregamento manual da página (`F5`).

### 3. Sistema de Controle de Áudio (Trilhas & SFX)
- **Objetivo**: Proporcionar controle sonoro granular para não incomodar jogadores em chamadas ou fones.
- **Critério de Aceite**:
  - Adicionar no menu superior dois sliders independentes: **Volume da Música** e **Volume dos Efeitos Sonoros (SFX)**.
  - Botão de atalho rápido para Mute geral.
  - Salvar as preferências no `localStorage` do navegador para persistir entre partidas.

### 4. Soundtracks Locais (Proteção no Git)
- **Objetivo**: Permitir que cada host adicione suas próprias músicas orquestrais/militares sem cometer violação de direitos autorais ou inflar o repositório git.
- **Critério de Aceite**:
  - Regra adicionada ao `.gitignore` ignorando `apps/web/public/music/*.mp3`, `*.ogg`, `*.wav`, `*.flac`.
  - O player de rádio lê automaticamente arquivos presentes na pasta `apps/web/public/music/` se disponíveis.

### 5. Legibilidade do Feed de Logs Táticos
- **Objetivo**: Tornar a janela de logs do rodapé informativa num relance visual.
- **Critério de Aceite**:
  - Adicionar tags ou cores representativas para o jogador ativo (ex: emblema colorido ao lado do nome).
  - Destacar em formato conciso os resultados de dados (ex: `Ataque: [6, 5] vs Defesa: [4, 4] -> Atacante perdeu 1 exército`).
  - Avisos de início de rodada ou regras ativas (ex: Rodada 1 Apenas Posicionamento) em destaque sutil.

### 6. Refinamento de UI / Layout
- **Objetivo**: Garantir que os menus flutuantes (Cartas, Objetivos Secretos, Teatros Regionais) não se sobreponham aos botões de controle de turno (Terminar Ataques, Passar Turno).
- **Critério de Aceite**: Layout testado em resoluções `1366x768`, `1920x1080` e monitores ultrawide `21:9`.

### 7. Revisão Textual e Ortografia
- **Objetivo**: Padronizar todos os termos do jogo (PT-BR prioritário na interface, EN no código).
- **Critério de Aceite**: Nomes de regiões corrigidos (Cazaquistão, Bálcãs, Vladivostok, Bornéu) e descrições dos 10 objetivos de Ambição Nacional claras e sem termos ambíguos.

### 8. Teste de Estabilidade e Concorrência
- **Objetivo**: Assegurar que partidas com 6 jogadores reais ou conexões simultâneas não gerem condições de corrida (`race conditions`).
- **Critério de Aceite**: Simulação de múltiplas ações simultâneas; validação de que o Colyseus enfileira as ações e que o timer de 120s com auto-passagem de turno opera pontualmente sem travar o loop de jogo.

### 9. Compatibilidade Cross-Browser
- **Objetivo**: Evitar discrepâncias de renderização do mapa SVG e filtros de elevação.
- **Critério de Aceite**:
  - Firefox: Verificar aceleração de renderização do SVG e suporte a zoom/pan.
  - Chromium (Chrome, Brave, Edge): Validar fluidez do mapa e manipulação do canvas.

### 10. Estabilidade e Reconexão do Multiplayer Online
- **Objetivo**: Tornar criação, entrada, saída e reconexão de salas online previsíveis, sem criar salas substitutas nem manter sessões duplicadas.
- **Critério de Aceite**:
  - Criar salas somente pela ação explícita de criação e entrar por código, link ou reconexão exclusivamente com `joinById`.
  - Validar códigos hexadecimais de 6 caracteres e apresentar erros localizados em PT-BR e EN.
  - Reconectar com backoff exponencial limitado, ignorando callbacks de conexões antigas e limpando completamente o estado ao sair.
  - Manter metadados da sala sincronizados, transferir o anfitrião para um humano conectado e substituir sessões duplicadas da mesma identidade.
  - Validar com testes automatizados, build completo e fluxo real entre dois clientes, incluindo início de partida e reconexão sem duplicação.
