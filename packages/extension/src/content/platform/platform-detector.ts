export type PlatformForStart = 'meet' | 'zoom' | 'teams' | 'pachca' | undefined;

export function getPlatformForStartMessage(): PlatformForStart {
  const host = window.location.hostname;
  if (host.includes('pachca.com')) return 'pachca';
  if (host.includes('meet.google.com')) return 'meet';
  if (host.includes('zoom.us')) return 'zoom';
  if (host.includes('teams.microsoft.com') || host.includes('teams.live.com')) return 'teams';
  return undefined;
}
