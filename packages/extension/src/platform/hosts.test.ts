import { describe, expect, it } from 'vitest';
import {
  CALL_PLATFORMS,
  CALL_PLATFORM_MATCHES,
  DEV_ONLY_MATCHES,
  PLATFORM_HOSTS,
  detectPlatformByHostname,
} from './hosts';

/** `https://*.teams.microsoft.com/*` → `sub.teams.microsoft.com` */
function hostnameFromMatchPattern(pattern: string): string {
  const host = pattern.replace(/^https:\/\//, '').replace(/\/\*$/, '');
  return host.startsWith('*.') ? `sub.${host.slice(2)}` : host;
}

describe('detectPlatformByHostname', () => {
  it('recognises every Teams domain, including the new and the personal one', () => {
    expect(detectPlatformByHostname('teams.microsoft.com')).toBe('teams');
    expect(detectPlatformByHostname('teams.cloud.microsoft')).toBe('teams');
    expect(detectPlatformByHostname('teams.live.com')).toBe('teams');
  });

  it('recognises the other platforms', () => {
    expect(detectPlatformByHostname('meet.google.com')).toBe('meet');
    expect(detectPlatformByHostname('app.zoom.us')).toBe('zoom');
    expect(detectPlatformByHostname('app.pachca.com')).toBe('pachca');
  });

  it('returns undefined for unrelated hosts', () => {
    expect(detectPlatformByHostname('www.youtube.com')).toBeUndefined();
    expect(detectPlatformByHostname('outlook.cloud.microsoft')).toBeUndefined();
    expect(detectPlatformByHostname('example.com')).toBeUndefined();
  });
});

describe('manifest matches and the detector stay in sync', () => {
  // This is the drift that broke Teams: the detector knew a domain the manifest did not.
  it.each(CALL_PLATFORMS)('every %s match pattern is detected as that platform', (platform) => {
    for (const pattern of PLATFORM_HOSTS[platform].matches) {
      expect(detectPlatformByHostname(hostnameFromMatchPattern(pattern))).toBe(platform);
    }
  });

  it('every detector hostname is covered by a match pattern', () => {
    for (const platform of CALL_PLATFORMS) {
      for (const hostname of PLATFORM_HOSTS[platform].hostnames) {
        const covered = PLATFORM_HOSTS[platform].matches.some((pattern) =>
          hostnameFromMatchPattern(pattern).includes(hostname),
        );
        expect(covered, `${hostname} has no match pattern`).toBe(true);
      }
    }
  });
});

describe('match pattern hygiene', () => {
  it('uses valid https match patterns', () => {
    for (const pattern of [...CALL_PLATFORM_MATCHES, ...DEV_ONLY_MATCHES]) {
      expect(pattern).toMatch(/^https:\/\/(\*\.)?[a-z0-9.-]+\/\*$/);
    }
  });

  it('never wildcards the shared cloud.microsoft domain', () => {
    // `*.cloud.microsoft` would pull in Outlook, Word and the rest of Microsoft 365.
    for (const pattern of CALL_PLATFORM_MATCHES) {
      expect(pattern).not.toBe('https://*.cloud.microsoft/*');
    }
  });

  it('keeps dev-only hosts out of the call platform list', () => {
    for (const pattern of DEV_ONLY_MATCHES) {
      expect(CALL_PLATFORM_MATCHES).not.toContain(pattern);
    }
  });
});
