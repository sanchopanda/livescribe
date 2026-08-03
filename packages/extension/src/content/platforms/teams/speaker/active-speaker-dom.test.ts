import { describe, expect, it } from 'vitest';
import {
  isScreenSharingTile,
  parseTeamsSpeakerName,
  teamsParticipantId,
} from './active-speaker-dom';

describe('parseTeamsSpeakerName', () => {
  it('takes the name from a video tile label', () => {
    expect(parseTeamsSpeakerName('Gevorg Voskanyan, Доступно контекстное меню')).toBe(
      'Gevorg Voskanyan',
    );
  });

  it('takes the name from a screen-sharing tile label', () => {
    // Without this the whole phrase used to land in the transcript as the speaker name.
    expect(parseTeamsSpeakerName('Общий контент от пользователя Gevorg Voskanyan')).toBe(
      'Gevorg Voskanyan',
    );
    expect(parseTeamsSpeakerName('Content shared by Dmitriy Lobkov')).toBe('Dmitriy Lobkov');
  });

  it('handles a bare name', () => {
    expect(parseTeamsSpeakerName('Dmitriy Lobkov')).toBe('Dmitriy Lobkov');
  });

  it('returns null when there is no label', () => {
    expect(parseTeamsSpeakerName('')).toBeNull();
    expect(parseTeamsSpeakerName(null)).toBeNull();
    expect(parseTeamsSpeakerName('   ')).toBeNull();
  });
});

describe('teamsParticipantId', () => {
  it('prefers the UPN, which survives re-renders', () => {
    expect(teamsParticipantId('Gevorg@teams.icons8.com', '9405c5c1-5dfc')).toBe(
      'Gevorg@teams.icons8.com',
    );
  });

  it('falls back to the tile id, then to a placeholder', () => {
    expect(teamsParticipantId(null, '9405c5c1-5dfc')).toBe('9405c5c1-5dfc');
    expect(teamsParticipantId('  ', null)).toBe('teams-unknown');
    expect(teamsParticipantId(null, null)).toBe('teams-unknown');
  });
});

describe('isScreenSharingTile', () => {
  it('recognises the sharing tile', () => {
    expect(isScreenSharingTile('ScreenSharing')).toBe(true);
    expect(isScreenSharingTile('Video')).toBe(false);
    expect(isScreenSharingTile(null)).toBe(false);
  });
});
