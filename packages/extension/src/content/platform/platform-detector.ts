import { detectPlatformByHostname } from '../../platform/hosts';

export type PlatformForStart = 'meet' | 'zoom' | 'teams' | 'pachca' | undefined;

/**
 * Which call platform this page belongs to. Hosts live in `platform/hosts.ts`, the same list
 * the manifest `matches` are generated from — so a page the extension runs on is always a page
 * it can identify.
 */
export function getPlatformForStartMessage(): PlatformForStart {
  return detectPlatformByHostname(window.location.hostname);
}
