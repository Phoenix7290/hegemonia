// Hegemonia Battle Odds Probability Calculator

/**
 * Simulates 1,000 dice engagements to estimate attacker conquest probability
 * Attacker rolls min(3, att - 1), Defender rolls min(3, def), ties go to defender.
 */
export function estimateAttackWinOdds(attackerArmies: number, defenderArmies: number): number {
  if (attackerArmies < 2) return 0;
  if (defenderArmies <= 0) return 100;

  const TRIALS = 600;
  let wins = 0;

  for (let t = 0; t < TRIALS; t++) {
    let att = attackerArmies;
    let def = defenderArmies;

    while (att > 1 && def > 0) {
      const attDiceCount = Math.min(3, att - 1);
      const defDiceCount = Math.min(3, def);

      const attDice = [];
      for (let i = 0; i < attDiceCount; i++) attDice.push(Math.floor(Math.random() * 6) + 1);
      attDice.sort((a, b) => b - a);

      const defDice = [];
      for (let i = 0; i < defDiceCount; i++) defDice.push(Math.floor(Math.random() * 6) + 1);
      defDice.sort((a, b) => b - a);

      const comp = Math.min(attDiceCount, defDiceCount);
      for (let c = 0; c < comp; c++) {
        if (attDice[c] > defDice[c]) {
          def--;
        } else {
          att--;
        }
      }
    }

    if (def === 0) wins++;
  }

  return Math.round((wins / TRIALS) * 100);
}
