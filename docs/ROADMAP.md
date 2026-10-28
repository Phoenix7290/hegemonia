# Hegemonia — Collaborative Expansion Roadmap

This document outlines the architectural roadmap and upcoming milestone features for **Hegemonia**. Contributors (both human developers and AI pair programmers) can pick tasks from this list.

---

## Milestone Release Overview

- **v0.1.0-alpha (Current Base Engine)**:
  - Authoritative functional rules engine with seeded Mulberry32 PRNG.
  - 44-territory Natural Earth vector map with continuous zoom/pan and WASD.
  - Asia 3-theater division (+2 Indo-Arábia, +2 Estepes & Sibéria, +3 Leste Asiático).
  - Strategic maritime connections (Argentina-Australia, Argentina-South Africa, Hawaii Pacific Hub).
  - 14 Classic Objectives + 10 Roleplay / Alt-History National Ambitions:
    1. *Japão Imperial (Sol Nascente)*: 13 territórios (Leste Asiático + Oceania + Arco do Pacífico).
    2. *Estados Unidos (Destino Manifesto)*: 15–16 territórios (Todas as Américas + [China & Mongólia] OU Moscou).
    3. *Império Lusitano (Três Oceanos)*: 10 territórios (América do Sul + entrepostos em França, Argélia, Congo, África do Sul, Índia e Sumatra).
    4. *Império Russo (Terceira Roma)*: 16 territórios (6 províncias russas + Aral + Japão + Alasca + toda a Europa).
    5. *Crescente Dourado (União & Al-Andalus)*: 14 territórios (6 regiões islâmicas + toda a Europa).
    6. *Pacto Austral (Aliança dos Três Oceanos)*: 14 territórios (América do Sul + África + Oceania).
    7. *Ordem Central Germânica (Mitteleuropa & Atlântico)*: 15 territórios (Toda a Europa + Oriente Médio, Omsk, Cazaquistão + Corredor do Atlântico Norte).
    8. *Império das Ilhas (Talassocracia Global)*: 10 territórios (Todos os 10 territórios insulares/arquipélagos do planeta).
    9. *Pax Britannica (O Império Onde o Sol Nunca se Põe)*: 12 territórios da Commonwealth global.
    10. *Império do Meio (Mandato do Céu & Rota da Seda)*: 14 territórios (China, Mongólia, Indo-Arábia, Oceania e Europa Oriental/Central).
  - **Filtro Estrito de Elegibilidade de Objetivos**: O jogador só recebe um objetivo Roleplay / Alt-History se possuir pelo menos 1 território nuclear da facção na rodada inicial.
  - **Guia Visual Interativo de Objetivos no Mapa**:
    - Iluminação em tempo real dos alvos ao clicar no card de objetivo secreto (Verde neon nos já conquistados, Vermelho pulsante nos pendentes, opacidade reduzida nos territórios neutros).
    - Barra de progresso com porcentagem dinâmica e contagem fracionária `(X / Y Territórios)`.
  - **Mesa de Som Tática (Equalizador SFX vs Música)**:
    - Sliders independentes com percentual exibido para trilha sonora e efeitos sonoros militares.
    - Botão de Silenciador Geral (Mute) com persistência automática no `localStorage`.
  - **Fluxo de Encerramento & Retorno ao Lobby**:
    - Modal de vitória com estatísticas consolidadas e botão de reset para reiniciar o lobby sem derrubar a sala.
  - Strict 120s turn timers with automated fallback resolution.
  - Colyseus WebSocket server with transactional PostgreSQL match persistence.
  - Versioned database schema for accounts, authentication, seasons, rankings, and player statistics.

---

## Collaborative Expansion Epics

```
  ┌─────────────────────────┐      ┌─────────────────────────┐
  │   II. War Economy       │ ───> │  IV. Capitals & HQs     │
  │   (Treasury & Straits)  │      │  (Supreme Command)      │
  └─────────────────────────┘      └─────────────────────────┘
               │                                │
               ▼                                ▼
  ┌─────────────────────────┐      ┌─────────────────────────┐
  │  III. Diplo Treaties    │      │   V. 3-Tier Combat      │
  │  (NAPs & Lend-Lease)    │      │  (Infantry/Armor/Art.)  │
  └─────────────────────────┘      └─────────────────────────┘
               │                                │
               ▼                                ▼
  ┌─────────────────────────┐      ┌─────────────────────────┐
  │  VI. Naval & Sea Zones  │ ───> │  VII. Air Superiority   │
  └─────────────────────────┘      └─────────────────────────┘
```

---

### Epic II — War Economy & Global Maritime Straits
- **Concept**: Control of strategic choke points produces industrial revenue, creating incentives for dynamic diplomacy and targeted operations beyond raw landmass counting.
- **Mechanics**:
  - Base income: 3 gold per turn.
  - Choke point bonus (+2 gold/turn each):
    - *Egito* (Suez Canal)
    - *México / Venezuela* (Panama Canal)
    - *Oriente Médio* (Bosphorus & Strait of Hormuz)
    - *Sumatra* (Strait of Malacca)
    - *Inglaterra* (English Channel & Gibraltar access)
    - *Havaí* (Trans-Pacific Strategic Hub)
  - Treasury actions:
    - **Emergency Conscription**: Spend 5 gold for +2 instant reserve divisions.
    - **Industrial Fortification**: Spend 4 gold to add a bunker (+1 defense roll).
    - **Strategic Airlift**: Spend 6 gold to maneuver divisions between any two non-adjacent friendly territories.

### Epic III — Diplomatic Treaties & Non-Aggression Pacts (NAPs)
- **Concept**: Formal in-engine diplomacy that removes ambiguity while punishing backstabbing.
- **Mechanics**:
  - **Non-Aggression Pact (NAP)**: Players can propose a 2-round mutual non-aggression pact.
  - While active, borders between the signatories cannot be attacked.
  - **Betrayal & Infamy**: A player can unilaterally break a pact on their turn, but incurs:
    - Public `[TRAIÇÃO]` broadcast to all players.
    - Loss of 50% current treasury.
    - -1 attack die on their first offensive combat of that turn.
  - **Lend-Lease**: Transfer gold or reserve divisions to an ally to proxy-fight mutual rivals.

### Epic IV — Supreme HQ & Command Capitals (Capitais de Comando)
- **Concept**: Gives each general a core vital territory that must be defended at all costs.
- **Mechanics**:
  - In Round 1, each player chooses one starting territory as their **National Capital** (marked with a golden star on the badge).
  - Benefits:
    - Generates +1 division every turn.
    - Capital defense: Attacker loses dice ties without inflicting mutual losses.
  - Decapitation strike: Capturing an enemy Capital grants their current treasury and inflicts a -2 reinforcement penalty on the ousted general for 1 round.

### Epic V — 3-Tier Combat Units
- **Concept**: Expands combat from single unit counts into tactical combined-arms composition.
- **Unit Types**:
  - **Infantry**: 1 army cost. Standard d6 combat roll.
  - **Armor / Cavalry**: 2 army cost. Rolls d6 with re-roll on 1s. Can blitz 2 territories deep after winning combat.
  - **Artillery**: 3 army cost. Fires an offensive barrage before normal dice resolution.

### Epic VI — Naval Taskforces & Maritime Zones
- **Concept**: Naval dominance of sea tiles (North Atlantic, South Atlantic, Pacific, Indian Ocean).
- **Mechanics**:
  - Fleets block naval straits and prevent coastal redeployments.
  - Amphibious landings require naval superiority in the adjacent sea basin.

### Epic VII — Air Superiority & Tactical Bombers
- **Concept**: Project power across regional skies.
- **Mechanics**:
  - Airfields can be constructed in friendly territories.
  - Recon flights temporarily lift fog of war or reveal troop composition.
  - Strategic bombing to reduce enemy bunkers before an assault.

### Epic VIII — Fortifications & Defensive Redoubts
- **Mechanics**:
  - Level 1 Bunker: Adds +1 to highest defender die.
  - Level 2 Fortress: Reduces attacker's highest roll by 1.

### Epic IX — National Doctrine Cards
- Players pick 1 military doctrine per game:
  - *Blitzkrieg*: Armor units get +1 to attack on turn 1 of combat.
  - *Defense in Depth*: Infantry on home continent receives +1 defense.
  - *Fleet in Being*: Strategic Airlift cost halved.
  - *Partisan Warfare*: Conquered territories spawn 1 partisan if left with only 1 garrison army.

### Epic X — Strategic Resources (Oil, Steel, Rare Earths)
- Territories marked with resource icons (e.g., California/Venezuela/Middle East for Oil, Ural/Alemanha for Steel).
- Required to upgrade to Armor, Artillery, and Airfields.

### Epic XI — Supply Lines & Attrition
- Units isolated from friendly ports or capital suffer logistical attrition (-1 army if over garrison limit).

### Epic XII — Sistema de Tensão Mundial Global & Infâmia com Coalizões Dinâmicas
- **1. Medidor de Tensão Global (World Tension 0-100%)**:
  - Índice compartilhado por toda a mesa internacional.
  - Escala dinamicamente com declarações de guerra, grandes ofensivas, quebra de tratados diplomáticos e eliminação de jogadores.
  - Modifica a conjuntura global (desbloqueia sanções, embargos e eventos táticos).
- **2. Barra de Infâmia Individual do Jogador (Player Infamy %)**:
  - Cada general possui seu próprio termômetro de reputação internacional:
    - **Nível Baixo (0% – 33%)**: Nenhuma coalizão defensiva permitida contra o jogador.
    - **Nível Médio (34% – 66%)**: Jogador considerado agressor regional. Generais adjacentes ou ameaçados podem formar uma **Coalizão Bilateral (2 jogadores)** com pacto defensivo mútuo.
    - **Nível Alto (67% – 100%)**: Ameaça existencial à ordem mundial. Permite formar uma **Grande Coalizão (até 3 jogadores)** contra o warmonger, habilitando livre passagem e esforço militar conjunto.

### Epic XIII — Rádio Diplomático Clandestino & Intercepção de Sinais
- **Comunicações Bilaterais Secretas**:
  - Dois generais podem abrir um canal confidencial de texto e áudio de voz criptografado (WebRTC).
  - O conteúdo da conversa é estritamente privado entre os dois interlocutores.
- **Detecção de Inteligência & Intriga Geopolítica**:
  - Embora a mensagem/voz seja privada, os demais jogadores na mesa recebem um alerta de inteligência no feed global:
    - *\"Alerta: Frequência de rádio clandestina detectada entre [Facção A] e [Facção B]...\"*
  - Isso gera tensão tática, desconfiança e paranoia entre aliados sem violar o sigilo do plano.

---

## Machine-Readable Roadmap Spec (`roadmap.json`)

To enable automated CI tools, AI agents, and dashboard visualizers to track these epics programmatically, a companion `roadmap.json` is maintained in the project root.
