export interface HostMember {
  isHost: boolean;
  isBot: boolean;
  connected: boolean;
}

export function synchronizeHumanHost<T extends HostMember>(players: T[]): void {
  if (players.some((player) => player.isHost && player.connected && !player.isBot)) return;

  for (const player of players) player.isHost = false;
  const nextHost = players.find((player) => player.connected && !player.isBot);
  if (nextHost) nextHost.isHost = true;
}
