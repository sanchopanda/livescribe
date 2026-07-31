// Single source of truth for the hosts of every supported call platform.
//
// The same list feeds three consumers that used to keep their own copies and drifted apart:
// the manifest `matches` (built in vite.config.ts), the runtime platform detector, and the
// store-build host_permissions. Adding a platform domain is a one-line change here.

export type CallPlatform = 'meet' | 'zoom' | 'teams' | 'pachca';

export interface PlatformHostConfig {
  /** Chrome match patterns for the manifest. */
  matches: string[];
  /** Substrings matched against `location.hostname` at runtime. */
  hostnames: string[];
}

export const PLATFORM_HOSTS: Record<CallPlatform, PlatformHostConfig> = {
  meet: {
    matches: ['https://meet.google.com/*'],
    hostnames: ['meet.google.com'],
  },
  zoom: {
    matches: ['https://zoom.us/*', 'https://*.zoom.us/*'],
    hostnames: ['zoom.us'],
  },
  teams: {
    matches: [
      'https://teams.microsoft.com/*',
      'https://*.teams.microsoft.com/*',
      // Teams is moving to Microsoft's unified *.cloud.microsoft domain. Only the exact
      // Teams host — the wildcard would also cover Outlook, Word and the rest of M365.
      'https://teams.cloud.microsoft/*',
      // Personal (consumer) accounts.
      'https://teams.live.com/*',
    ],
    hostnames: ['teams.microsoft.com', 'teams.cloud.microsoft', 'teams.live.com'],
  },
  pachca: {
    matches: ['https://*.pachca.com/*', 'https://app.pachca.com/*'],
    hostnames: ['pachca.com'],
  },
};

export const CALL_PLATFORMS = Object.keys(PLATFORM_HOSTS) as CallPlatform[];

/** Every supported call host — what the content script and the research probe run on. */
export const CALL_PLATFORM_MATCHES: string[] = CALL_PLATFORMS.flatMap(
  (platform) => PLATFORM_HOSTS[platform].matches,
);

/**
 * Hosts that are not call platforms but are useful while developing. Stripped from the store
 * build, where an unexplained YouTube permission is a review risk.
 */
export const DEV_ONLY_MATCHES: string[] = ['https://www.youtube.com/*', 'https://youtube.com/*'];

export function detectPlatformByHostname(hostname: string): CallPlatform | undefined {
  return CALL_PLATFORMS.find((platform) =>
    PLATFORM_HOSTS[platform].hostnames.some((candidate) => hostname.includes(candidate)),
  );
}
