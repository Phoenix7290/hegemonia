# Hegemonia — Collaborative Expansion Roadmap

This document outlines the architectural roadmap and upcoming milestone features for **Hegemonia**. Contributors (both human developers and AI pair programmers) can pick tasks from this list.

---

## Milestone Release Overview

- **v0.1.0-alpha (Current Base Engine)**:
  - Authoritative functional rules engine with seeded Mulberry32 PRNG.
  - 44-territory Natural Earth vector map with continuous zoom/pan and WASD.
  - Asia 3-theater division (+2 Indo-Arábia, +2 Estepes & Sibéria, +3 Leste Asiático).
  - Strategic maritime connections (Argentina-Australia, Argentina-South Africa, Hawaii Pacific Hub).
  - 14 Classic Objectives + 10 Roleplay / Alt-History National Ambitions.
  - Strict 120s turn timers with automated fallback resolution.
  - Colyseus WebSocket server with SQLite session persistence.

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

### Epic XII — International Coalitions & Global Tension
- High conquest speed raises World Tension. At 75% tension, weaker nations can form an automatic mutual-defense alliance.

---

## Machine-Readable Roadmap Spec (`roadmap.json`)

To enable automated CI tools, AI agents, and dashboard visualizers to track these epics programmatically, a companion `roadmap.json` is maintained in the project root.
