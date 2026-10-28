# Hegemonia — Pre-Roadmap Polish & Critical Tasks (v0.1.x)

Este documento centraliza as correções de estabilidade, verificações manuais e melhorias de usabilidade essenciais que devem ser validadas antes de avançar para os épicos maiores do Roadmap (Economia, Frotas Navais e Aviação).

---

## Checklist de Itens Críticos

| # | Item / Tarefa | Escopo | Status |
|---|---|---|---|
| **1** | **Inspeção Visual da Ponta de Vladivostok** | Cartografia / TopoJSON | 🔍 Pronto para Validação Visual |
| **2** | **Botão de Retorno ao Lobby pós-Vitória** | Frontend (`apps/web`) & Server | ✅ Concluído |
| **3** | **Elegibilidade Estrita de Core nos 10 Objetivos** | Engine (`packages/engine`) | ✅ Concluído |
| **4** | **Equalização e Controle de Áudio (SFX vs Música)** | Frontend (`apps/web`) | ⏳ Pendente |
| **5** | **Trilhas Sonoras Locais Protegidas do Git** | Configuração (`.gitignore`) | ✅ Concluído |
| **6** | **Clareza e Formatação do Feed de Logs de Combate** | Frontend & Engine | ⏳ Pendente |
| **7** | **Polimento de UI e Responsividade Widescreen/Laptop** | Frontend (`apps/web`) | ⏳ Pendente |
| **8** | **Revisão Textual & Eliminação de Typos (PT-BR/EN)** | Shared / Maps / Engine | ✅ Concluído (v0.1.0-alpha) |
| **9** | **Stress Test de Estabilidade & Concorrência** | Engine & Server | ⏳ Pendente |
| **10** | **Compatibilidade Cross-Browser (Chromium / Firefox)** | Frontend (`apps/web`) | ⏳ Pendente |
| **11** | **Multiplayer Local (LAN) e Suporte IPv6** | Server (`apps/server`) | ⏳ Pendente |

---

## Detalhamento Técnico das Tarefas

### 1. Inspeção Visual de Vladivostok (Península de Chukotka)
- **Objetivo**: Garantir que o deslocamento de coordenadas longitudinais no antimeridiano (180°) tenha soldado a extremidade de Chukotka ao restante do continente russo sem artefatos visuais.
- **Critério de Aceite**: Abrir o jogo na visão Cartográfica e Geopolítica; verificar se a ponta oriental de Vladivostok forma uma fronteira litorânea contínua com as ilhas ao norte e sem nenhuma fresta branca contra o estreito de Bering / Alasca.

### 2. Retorno ao Lobby pós-Término de Jogo
- **Status**: ✅ Concluído.
- **Implementação**:
  - Modal imersivo de consagração de vitória com estatísticas completas (rodadas jogadas, ranking de territórios e divisões por jogador, facção e verificação de semente criptográfica).
  - Ação do Anfitrião `return_to_lobby`: reinicia o estado da sala no Colyseus e redireciona todos os clientes conectados de volta para a tela de Lobby simultaneamente.
  - Ação individual de saída: botão "Sair para o Menu Principal" desconecta da sala e volta à tela inicial sem necessidade de recarregar a página (`F5`).
  - Botão "Inspecionar Mapa Final": permite recolher o modal para inspecionar o tabuleiro com dock de controle flutuante para reabrir o relatório.

### 3. Elegibilidade Estrita de Territórios Core nos 10 Objetivos
- **Status**: ✅ Concluído.
- **Implementação**:
  - Motor de regras (`packages/engine/src/index.ts`) atualizado para que objetivos de Ambição Nacional sejam atribuídos estritamente aos generais que possuem ao menos um de seus territórios-chave no sorteio inicial da rodada 1.
  - Jogadores inelegíveis recebem objetivos clássicos, garantindo coerência temática e ausência de frustração competitiva.
  - Testado via Vitest com simulação de 20 partidas estocásticas.

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

### 10. Multiplayer Local e Suporte IPv6
- **Objetivo**: Permitir que amigos na mesma rede local ou via IPv6 entrem na sala digitando o IP/hostname do servidor.
- **Critério de Aceite**:
  - Configurar o servidor Express / Colyseus para escutar em `0.0.0.0` e `::` (Dual Stack).
  - Testar conexão do cliente web apontando para o endereço IP local do host.
