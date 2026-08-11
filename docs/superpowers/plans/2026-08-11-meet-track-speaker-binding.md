# Привязка дорожки Meet к участнику — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** В per-track на Meet реплики всех участников подписаны их именами, включая записанные до того, как привязка подтвердилась.

**Architecture:** Сигнал — подсветка плитки (`getMeetActiveSpeaker`, LS-33). Чистый модуль `TrackSpeakerBinding` накапливает наблюдения «говорит один участник + энергия ровно на одной дорожке» и после трёх согласных закрепляет `trackId → имя`. Дальше имя берётся из памяти: `participantId` дорожки не меняется никогда (иначе бэкенд откроет второй поток распознавания), меняется только подпись. Реплики, записанные под технической подписью, переименовываются сообщением `rename_participant`.

**Tech Stack:** TypeScript, vitest (окружение `node`, DOM в тестах недоступен — вся логика чистая), Chrome MV3 (content script → service worker → offscreen → WS), Fastify + Prisma на бэкенде.

**Спека:** `docs/superpowers/specs/2026-08-11-meet-track-speaker-binding-design.md`

## Global Constraints

- Тесты — только на чистых функциях: `packages/extension/vitest.config.ts` задаёт `environment: 'node'`, никакого jsdom. DOM-чтение живёт в тонких обёртках без тестов.
- MAIN-world скрипты (`*-webrtc-tracks-main.ts`) не трогаем: им запрещены импорты.
- Pachca не трогаем — там детерминированная привязка работает.
- Миграций Prisma нет: `TranscriptSegment` не получает новых колонок.
- `participantId` дорожки после старта захвата неизменен.
- Доменные термины в коде и комментариях — английские; комментарии объясняют «почему», а не «что».
- STT — только Deepgram (ADR-0001), диаризация не включается.
- Порог энергии берётся из `packages/extension/src/content/per-track/core/vad.ts`, свой не вводим.

---

### Task 1: Модуль привязки

**Files:**
- Create: `packages/extension/src/content/platforms/meet/audio/per-track/speaker-binding.ts`
- Test: `packages/extension/src/content/platforms/meet/audio/per-track/speaker-binding.test.ts`

**Interfaces:**
- Consumes: ничего (чистый модуль).
- Produces: `TrackSpeakerBinding` с методами `observe(observation: BindingObservation): BindingChange[]`, `speakerFor(trackId: string): string | null`, `reset(): void`; типы `TrackEnergy { trackId: string; rms: number }`, `BindingObservation { tracks: readonly TrackEnergy[]; localTrackIds?: readonly string[]; domSpeaker: { participantId: string; speaker: string | null } | null; mutedParticipantIds?: readonly string[] }`, `BindingChange { trackId: string; participantId: string; speaker: string }`; константы `CONFIRM_HITS = 3`, `RESET_MISSES = 3`.

- [ ] **Step 1: Написать падающий тест**

```ts
import { describe, expect, it } from 'vitest';
import { TrackSpeakerBinding } from './speaker-binding';

const SERGEY = { participantId: 'spaces/Z2eZuCUpKwIB/devices/555', speaker: 'Сергей Чумеров' };
const DANIIL = { participantId: 'spaces/Z2eZuCUpKwIB/devices/556', speaker: 'Даниил Никишкин' };
const ANNA = { participantId: 'spaces/Z2eZuCUpKwIB/devices/558', speaker: 'Анна Петрова' };
const TRACK_A = '33f1a44f-0d1e-4af0-a9c6-bba5b1d58b73';
const TRACK_B = 'd5c1572e-9cfa-43eb-ae4c-b9c23b398f88';
const LOCAL = 'a1b2c3d4-0000-4000-8000-000000000000';

/** RMS 0.09 — уровень говорящего участника из снимка живого звонка; 0.0000 — пустой слот Meet. */
const LOUD = 0.09;
const SILENT = 0;

describe('TrackSpeakerBinding', () => {
  it('связывает дорожку с участником после трёх согласных наблюдений', () => {
    const binding = new TrackSpeakerBinding();
    const observation = {
      tracks: [
        { trackId: TRACK_A, rms: LOUD },
        { trackId: TRACK_B, rms: SILENT },
      ],
      domSpeaker: SERGEY,
    };

    expect(binding.observe(observation)).toEqual([]);
    expect(binding.observe(observation)).toEqual([]);
    expect(binding.observe(observation)).toEqual([
      { trackId: TRACK_A, participantId: SERGEY.participantId, speaker: SERGEY.speaker },
    ]);
    expect(binding.speakerFor(TRACK_A)).toBe(SERGEY.speaker);
  });

  it('сообщает о привязке один раз, а не на каждом такте', () => {
    const binding = new TrackSpeakerBinding();
    const observation = { tracks: [{ trackId: TRACK_A, rms: LOUD }], domSpeaker: SERGEY };

    binding.observe(observation);
    binding.observe(observation);
    binding.observe(observation);
    expect(binding.observe(observation)).toEqual([]);
  });

  it('не связывает, когда звучат две дорожки сразу', () => {
    // Момент перебивания: подсветка укажет одного, а дорожек с речью две — из такого наблюдения
    // нельзя понять, какая из них его. Это и есть класс дефекта LS-28, который память чинит.
    const binding = new TrackSpeakerBinding();
    const observation = {
      tracks: [
        { trackId: TRACK_A, rms: LOUD },
        { trackId: TRACK_B, rms: LOUD },
      ],
      domSpeaker: SERGEY,
    };

    binding.observe(observation);
    binding.observe(observation);
    binding.observe(observation);
    expect(binding.speakerFor(TRACK_A)).toBeNull();
  });

  it('не связывает, когда подсветка молчит или имя не прочитано', () => {
    const binding = new TrackSpeakerBinding();
    const tracks = [{ trackId: TRACK_A, rms: LOUD }];

    binding.observe({ tracks, domSpeaker: null });
    binding.observe({ tracks, domSpeaker: { participantId: SERGEY.participantId, speaker: null } });
    binding.observe({ tracks, domSpeaker: null });
    expect(binding.speakerFor(TRACK_A)).toBeNull();
  });

  it('не считает локальную дорожку конкурентом', () => {
    // Своя речь звучит одновременно с чужой постоянно. Если её учитывать, наблюдение перестаёт
    // быть «чистым» и привязка остальных не набирается никогда.
    const binding = new TrackSpeakerBinding();
    const observation = {
      tracks: [
        { trackId: TRACK_A, rms: LOUD },
        { trackId: LOCAL, rms: LOUD },
      ],
      localTrackIds: [LOCAL],
      domSpeaker: SERGEY,
    };

    binding.observe(observation);
    binding.observe(observation);
    expect(binding.observe(observation)).toEqual([
      { trackId: TRACK_A, participantId: SERGEY.participantId, speaker: SERGEY.speaker },
    ]);
  });

  it('исключает замьюченного участника из кандидатов', () => {
    const binding = new TrackSpeakerBinding();
    const observation = {
      tracks: [{ trackId: TRACK_A, rms: LOUD }],
      domSpeaker: SERGEY,
      mutedParticipantIds: [SERGEY.participantId],
    };

    binding.observe(observation);
    binding.observe(observation);
    binding.observe(observation);
    expect(binding.speakerFor(TRACK_A)).toBeNull();
  });

  it('обнуляет счётчик согласий при несогласном наблюдении', () => {
    const binding = new TrackSpeakerBinding();
    const withSergey = { tracks: [{ trackId: TRACK_A, rms: LOUD }], domSpeaker: SERGEY };
    const withDaniil = { tracks: [{ trackId: TRACK_A, rms: LOUD }], domSpeaker: DANIIL };

    binding.observe(withSergey);
    binding.observe(withSergey);
    binding.observe(withDaniil);
    binding.observe(withSergey);
    expect(binding.speakerFor(TRACK_A)).toBeNull();
  });

  it('перевязывает дорожку, когда Meet отдал слот другому участнику', () => {
    // Слотов больше, чем участников (наблюдали 4 на 3), и Meet их переиспользует. Сброс не
    // подтверждает нового участника сам: имя он получает обычными тремя согласными наблюдениями.
    const binding = new TrackSpeakerBinding();
    const withSergey = { tracks: [{ trackId: TRACK_A, rms: LOUD }], domSpeaker: SERGEY };
    const withDaniil = { tracks: [{ trackId: TRACK_A, rms: LOUD }], domSpeaker: DANIIL };

    binding.observe(withSergey);
    binding.observe(withSergey);
    binding.observe(withSergey);

    expect(binding.observe(withDaniil)).toEqual([]);
    expect(binding.observe(withDaniil)).toEqual([]);
    expect(binding.observe(withDaniil)).toEqual([]);
    expect(binding.speakerFor(TRACK_A)).toBeNull();

    binding.observe(withDaniil);
    binding.observe(withDaniil);
    expect(binding.observe(withDaniil)).toEqual([
      { trackId: TRACK_A, participantId: DANIIL.participantId, speaker: DANIIL.speaker },
    ]);
    expect(binding.speakerFor(TRACK_A)).toBe(DANIIL.speaker);
  });

  it('не сбрасывает привязку от шумных чтений про разных участников', () => {
    // Несогласия считаются по конкретному участнику: три подряд промаха, назвавшие троих разных
    // людей, не складываются в сброс — иначе шум подписал бы реплику чужим именем.
    const binding = new TrackSpeakerBinding();
    const withSergey = { tracks: [{ trackId: TRACK_A, rms: LOUD }], domSpeaker: SERGEY };

    binding.observe(withSergey);
    binding.observe(withSergey);
    binding.observe(withSergey);

    binding.observe({ tracks: [{ trackId: TRACK_A, rms: LOUD }], domSpeaker: DANIIL });
    binding.observe({ tracks: [{ trackId: TRACK_A, rms: LOUD }], domSpeaker: ANNA });
    binding.observe({ tracks: [{ trackId: TRACK_A, rms: LOUD }], domSpeaker: DANIIL });

    expect(binding.speakerFor(TRACK_A)).toBe(SERGEY.speaker);
  });

  it('держит одного участника ровно на одной дорожке', () => {
    const binding = new TrackSpeakerBinding();
    const onA = { tracks: [{ trackId: TRACK_A, rms: LOUD }], domSpeaker: SERGEY };
    const onB = { tracks: [{ trackId: TRACK_B, rms: LOUD }], domSpeaker: SERGEY };

    binding.observe(onA);
    binding.observe(onA);
    binding.observe(onA);

    binding.observe(onB);
    binding.observe(onB);
    binding.observe(onB);

    expect(binding.speakerFor(TRACK_B)).toBe(SERGEY.speaker);
    expect(binding.speakerFor(TRACK_A)).toBeNull();
  });

  it('reset забывает всё — новый звонок начинается с чистого листа', () => {
    const binding = new TrackSpeakerBinding();
    const observation = { tracks: [{ trackId: TRACK_A, rms: LOUD }], domSpeaker: SERGEY };

    binding.observe(observation);
    binding.observe(observation);
    binding.observe(observation);
    binding.reset();

    expect(binding.speakerFor(TRACK_A)).toBeNull();
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd packages/extension && npx vitest run src/content/platforms/meet/audio/per-track/speaker-binding.test.ts`
Expected: FAIL — `Failed to resolve import "./speaker-binding"`.

- [ ] **Step 3: Реализовать модуль**

```ts
import { VAD_DEFAULTS } from '../../../../per-track/core/vad';

export interface TrackEnergy {
  trackId: string;
  rms: number;
}

export interface BindingObservation {
  tracks: readonly TrackEnergy[];
  /** Own microphone: it talks over everyone and must not spoil an otherwise clean observation. */
  localTrackIds?: readonly string[];
  domSpeaker: { participantId: string; speaker: string | null } | null;
  mutedParticipantIds?: readonly string[];
}

export interface BindingChange {
  trackId: string;
  participantId: string;
  speaker: string;
}

/** Agreeing observations needed before a name is trusted. */
export const CONFIRM_HITS = 3;
/** Disagreeing observations before a confirmed binding is dropped — Meet reuses audio slots. */
export const RESET_MISSES = 3;

interface Candidate {
  participantId: string;
  speaker: string;
  hits: number;
}

interface Confirmed {
  participantId: string;
  speaker: string;
  /**
   * Disagreements counted per participant, not as one number. Three noisy reads naming three
   * different people are not evidence that any one of them owns the slot.
   */
  missesByParticipantId: Map<string, number>;
}

export class TrackSpeakerBinding {
  private candidateByTrackId = new Map<string, Candidate>();
  private confirmedByTrackId = new Map<string, Confirmed>();

  observe(observation: BindingObservation): BindingChange[] {
    const speaker = observation.domSpeaker;
    if (!speaker?.speaker) return [];
    if (observation.mutedParticipantIds?.includes(speaker.participantId)) return [];

    const localTrackIds = observation.localTrackIds ?? [];
    const active = observation.tracks.filter(
      (track) => !localTrackIds.includes(track.trackId) && track.rms >= VAD_DEFAULTS.rmsOn,
    );
    if (active.length !== 1) return [];

    const trackId = active[0].trackId;
    const confirmed = this.confirmedByTrackId.get(trackId);

    if (confirmed && confirmed.participantId === speaker.participantId) {
      confirmed.missesByParticipantId.clear();
      return [];
    }

    if (confirmed) {
      const misses = (confirmed.missesByParticipantId.get(speaker.participantId) ?? 0) + 1;
      confirmed.missesByParticipantId.set(speaker.participantId, misses);
      if (misses < RESET_MISSES) return [];

      // Slot moved: drop the stale name and let the new one be earned from scratch. The misses
      // themselves are not evidence for the newcomer — they may have named different people.
      this.confirmedByTrackId.delete(trackId);
      this.candidateByTrackId.delete(trackId);
      return [];
    }

    const candidate = this.candidateByTrackId.get(trackId);
    if (!candidate || candidate.participantId !== speaker.participantId) {
      this.candidateByTrackId.set(trackId, {
        participantId: speaker.participantId,
        speaker: speaker.speaker,
        hits: 1,
      });
      return [];
    }

    candidate.hits += 1;
    candidate.speaker = speaker.speaker;
    if (candidate.hits < CONFIRM_HITS) return [];

    this.candidateByTrackId.delete(trackId);
    this.dropOtherTracksOf(speaker.participantId, trackId);
    this.confirmedByTrackId.set(trackId, {
      participantId: speaker.participantId,
      speaker: speaker.speaker,
      missesByParticipantId: new Map(),
    });

    return [{ trackId, participantId: speaker.participantId, speaker: speaker.speaker }];
  }

  speakerFor(trackId: string): string | null {
    return this.confirmedByTrackId.get(trackId)?.speaker ?? null;
  }

  reset(): void {
    this.candidateByTrackId.clear();
    this.confirmedByTrackId.clear();
  }

  /** One participant speaks on one slot at a time: an older binding for them is stale. */
  private dropOtherTracksOf(participantId: string, keepTrackId: string): void {
    for (const [trackId, entry] of this.confirmedByTrackId) {
      if (trackId !== keepTrackId && entry.participantId === participantId) {
        this.confirmedByTrackId.delete(trackId);
      }
    }
  }
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `cd packages/extension && npx vitest run src/content/platforms/meet/audio/per-track/speaker-binding.test.ts`
Expected: PASS, 11 тестов.

- [ ] **Step 5: Коммит**

```bash
git add packages/extension/src/content/platforms/meet/audio/per-track/speaker-binding.ts packages/extension/src/content/platforms/meet/audio/per-track/speaker-binding.test.ts
git commit -m "feat(extension): bind a Meet track to a participant by tile highlight (LS-35)"
```

---

### Task 2: Наблюдения из транскрайбера

**Files:**
- Create: `packages/extension/src/content/platforms/meet/audio/per-track/track-energy.ts`
- Test: `packages/extension/src/content/platforms/meet/audio/per-track/track-energy.test.ts`
- Modify: `packages/extension/src/content/platforms/meet/audio/per-track/track-transcriber.ts`

**Interfaces:**
- Consumes: `TrackSpeakerBinding`, `BindingObservation`, `TrackEnergy` из Task 1; `getMeetActiveSpeaker` из `../../speaker/active-speaker-dom`.
- Produces: `recordTrackEnergy(store: Map<string, TrackEnergySample>, trackId: string, rms: number, now: number): void` и `collectTrackEnergies(store: Map<string, TrackEnergySample>, trackIds: readonly string[], now: number): TrackEnergy[]`, тип `TrackEnergySample { rms: number; at: number }`, константа `ENERGY_FRESH_MS = 400`.

- [ ] **Step 1: Написать падающий тест**

```ts
import { describe, expect, it } from 'vitest';
import { collectTrackEnergies, ENERGY_FRESH_MS, recordTrackEnergy } from './track-energy';

const TRACK_A = 'track-a';
const TRACK_B = 'track-b';
const NOW = 1_786_474_658_000;

describe('collectTrackEnergies', () => {
  it('отдаёт свежий уровень дорожки', () => {
    const store = new Map();
    recordTrackEnergy(store, TRACK_A, 0.09, NOW);

    expect(collectTrackEnergies(store, [TRACK_A], NOW + 100)).toEqual([
      { trackId: TRACK_A, rms: 0.09 },
    ]);
  });

  it('считает устаревший уровень тишиной', () => {
    // Молчащая дорожка чанков не присылает: без этого правила её последний громкий уровень
    // остался бы «активным» навсегда и наблюдение никогда не было бы чистым.
    const store = new Map();
    recordTrackEnergy(store, TRACK_A, 0.09, NOW);

    expect(collectTrackEnergies(store, [TRACK_A], NOW + ENERGY_FRESH_MS + 1)).toEqual([
      { trackId: TRACK_A, rms: 0 },
    ]);
  });

  it('отдаёт нуль для дорожки, по которой уровня ещё не было', () => {
    expect(collectTrackEnergies(new Map(), [TRACK_B], NOW)).toEqual([{ trackId: TRACK_B, rms: 0 }]);
  });

  it('перезаписывает уровень новым замером', () => {
    const store = new Map();
    recordTrackEnergy(store, TRACK_A, 0.09, NOW);
    recordTrackEnergy(store, TRACK_A, 0.01, NOW + 50);

    expect(collectTrackEnergies(store, [TRACK_A], NOW + 60)).toEqual([
      { trackId: TRACK_A, rms: 0.01 },
    ]);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd packages/extension && npx vitest run src/content/platforms/meet/audio/per-track/track-energy.test.ts`
Expected: FAIL — `Failed to resolve import "./track-energy"`.

- [ ] **Step 3: Реализовать модуль**

```ts
import type { TrackEnergy } from './speaker-binding';

export interface TrackEnergySample {
  rms: number;
  at: number;
}

/**
 * How long a level stays meaningful. A track that stopped sending chunks is silent, not loud
 * forever — VAD gates sending, so silence arrives as absence of data.
 */
export const ENERGY_FRESH_MS = 400;

export function recordTrackEnergy(
  store: Map<string, TrackEnergySample>,
  trackId: string,
  rms: number,
  now: number,
): void {
  store.set(trackId, { rms, at: now });
}

export function collectTrackEnergies(
  store: Map<string, TrackEnergySample>,
  trackIds: readonly string[],
  now: number,
): TrackEnergy[] {
  return trackIds.map((trackId) => {
    const sample = store.get(trackId);
    const fresh = sample && now - sample.at <= ENERGY_FRESH_MS;
    return { trackId, rms: fresh ? sample.rms : 0 };
  });
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `cd packages/extension && npx vitest run src/content/platforms/meet/audio/per-track/track-energy.test.ts`
Expected: PASS, 4 теста.

- [ ] **Step 5: Подключить к транскрайберу**

В `track-transcriber.ts`:

1. Импорты рядом с существующими:

```ts
import { TrackSpeakerBinding } from './speaker-binding';
import { collectTrackEnergies, recordTrackEnergy, type TrackEnergySample } from './track-energy';
import { getMeetActiveSpeaker } from '../../speaker/active-speaker-dom';
```

2. Поля класса рядом с `private readonly preRoll = new PreRollBuffer();`:

```ts
private readonly binding = new TrackSpeakerBinding();
private readonly energyByTrackId = new Map<string, TrackEnergySample>();
private bindingTimerId: number | null = null;
```

3. В `sendChunkToOffscreen`, сразу после `const signal = analyzeChunkSignal(chunk);` и `const now = Date.now();`:

```ts
recordTrackEnergy(this.energyByTrackId, trackId, signal.rms, now);
```

4. В том же методе имя для отправки берётся из памяти привязки. Заменить использование параметра `speaker` при отправке чанка на:

```ts
const boundSpeaker = this.binding.speakerFor(trackId) ?? speaker;
```

и передавать `boundSpeaker` во все вызовы `sendPcmChunkToOffscreen` и в сообщение `TRACK_AUDIO_LEVEL` внутри этого метода. `participantId` не менять — он ключ потока распознавания на бэкенде, и его смена открыла бы второй поток.

5. В `start()`, после запуска `chunkStatsTimerId`:

```ts
    // Один такт в 250 мс — тот же ритм, что у опроса DOM-детектора в content.ts.
    this.bindingTimerId = window.setInterval(() => {
      if (!this.running || this.capturesByTrackId.size === 0) return;

      const now = Date.now();
      const trackIds = [...this.capturesByTrackId.keys()];
      const localTrackIds = trackIds.filter(
        (trackId) => this.capturesByTrackId.get(trackId)?.participantId === SELF_OWNER.participantId,
      );

      const changes = this.binding.observe({
        tracks: collectTrackEnergies(this.energyByTrackId, trackIds, now),
        localTrackIds,
        domSpeaker: getMeetActiveSpeaker(),
      });

      for (const change of changes) {
        const capture = this.capturesByTrackId.get(change.trackId);
        if (!capture) continue;

        debugLog('speaker bound', {
          trackId: change.trackId,
          participantId: capture.participantId,
          speaker: change.speaker,
        });
        capture.speaker = change.speaker;
      }
    }, 250);
```

6. В `stop()`, рядом с очисткой остальных таймеров и структур:

```ts
    if (this.bindingTimerId !== null) {
      clearInterval(this.bindingTimerId);
      this.bindingTimerId = null;
    }
```

и рядом с `this.preRoll.clear();`:

```ts
    this.binding.reset();
    this.energyByTrackId.clear();
```

- [ ] **Step 6: Проверить типы и сборку**

Run: `cd /home/aleksander/code/livescribe && npm run type-check && npm run build:extension`
Expected: обе команды без ошибок.

- [ ] **Step 7: Коммит**

```bash
git add packages/extension/src/content/platforms/meet/audio/per-track/track-energy.ts packages/extension/src/content/platforms/meet/audio/per-track/track-energy.test.ts packages/extension/src/content/platforms/meet/audio/per-track/track-transcriber.ts
git commit -m "feat(extension): feed Meet per-track energy into speaker binding (LS-35)"
```

---

### Task 3: Сообщения переименования в протоколе

**Files:**
- Modify: `packages/shared/src/websocket-protocol.ts`

**Interfaces:**
- Produces: `RenameParticipantMessage { type: 'rename_participant'; sessionId: string; participantId: string; speaker: string }` в `ClientMessage`; `ParticipantRenamedMessage { type: 'participant_renamed'; participantId: string; speaker: string; previousSpeaker: string }` в `ServerMessage`.

- [ ] **Step 1: Добавить типы**

После `SpeakerUpdateMessage`:

```ts
/**
 * A per-track speaker was identified after the fact. Everything already recorded under the
 * placeholder label belongs to this participant too, so the server relabels it — otherwise the
 * opening minute of every call stays anonymous.
 */
export interface RenameParticipantMessage {
  type: 'rename_participant';
  sessionId: string;
  participantId: string;
  speaker: string;
}
```

В `ClientMessage` добавить `| RenameParticipantMessage`.

Перед `ServerMessage`:

```ts
/** Relabelling done: the client rewrites the replicas it already displayed. */
export interface ParticipantRenamedMessage {
  type: 'participant_renamed';
  participantId: string;
  speaker: string;
  previousSpeaker: string;
}
```

В `ServerMessage` добавить `| ParticipantRenamedMessage`.

- [ ] **Step 2: Проверить типы**

Run: `cd /home/aleksander/code/livescribe && npm run type-check`
Expected: без ошибок.

- [ ] **Step 3: Коммит**

```bash
git add packages/shared/src/websocket-protocol.ts
git commit -m "feat(shared): rename_participant / participant_renamed messages (LS-35)"
```

---

### Task 4: Переименование на бэкенде

**Files:**
- Modify: `packages/backend/src/websocket/handler.ts`
- Test: `packages/backend/src/websocket/handler-rename.test.ts`

**Interfaces:**
- Consumes: `RenameParticipantMessage` из Task 3.
- Produces: экспортируемая чистая функция `buildParticipantRenamePlan(input: { meetingId: string | null | undefined; previousSpeaker: string | undefined; nextSpeaker: string }): { meetingId: string; previousSpeaker: string; nextSpeaker: string } | null`.

- [ ] **Step 1: Написать падающий тест**

```ts
import { describe, expect, it } from 'vitest';
import { buildParticipantRenamePlan } from './handler.js';

describe('buildParticipantRenamePlan', () => {
  it('переименовывает сегменты, записанные под технической подписью', () => {
    expect(
      buildParticipantRenamePlan({
        meetingId: 'meeting_1',
        previousSpeaker: 'Participant 33f1a44f',
        nextSpeaker: 'Сергей Чумеров',
      }),
    ).toEqual({
      meetingId: 'meeting_1',
      previousSpeaker: 'Participant 33f1a44f',
      nextSpeaker: 'Сергей Чумеров',
    });
  });

  it('ничего не делает без встречи — анонимная сессия в базу не пишет', () => {
    expect(
      buildParticipantRenamePlan({
        meetingId: null,
        previousSpeaker: 'Participant 33f1a44f',
        nextSpeaker: 'Сергей Чумеров',
      }),
    ).toBeNull();
  });

  it('ничего не делает, когда прежняя подпись неизвестна', () => {
    // Без прежней подписи невозможно выбрать сегменты: колонки participantId в схеме нет.
    expect(
      buildParticipantRenamePlan({
        meetingId: 'meeting_1',
        previousSpeaker: undefined,
        nextSpeaker: 'Сергей Чумеров',
      }),
    ).toBeNull();
  });

  it('ничего не делает, когда имя не изменилось', () => {
    expect(
      buildParticipantRenamePlan({
        meetingId: 'meeting_1',
        previousSpeaker: 'Сергей Чумеров',
        nextSpeaker: 'Сергей Чумеров',
      }),
    ).toBeNull();
  });

  it('ничего не делает на пустом имени', () => {
    expect(
      buildParticipantRenamePlan({
        meetingId: 'meeting_1',
        previousSpeaker: 'Participant 33f1a44f',
        nextSpeaker: '   ',
      }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd packages/backend && npx vitest run src/websocket/handler-rename.test.ts`
Expected: FAIL — `buildParticipantRenamePlan is not a function`.

- [ ] **Step 3: Реализовать чистую функцию**

Рядом с `buildTranscriptSegmentRecord` в `handler.ts`:

```ts
/**
 * Which stored segments a late-arriving speaker name applies to. Segments carry only the label,
 * not the participant id, and the placeholder label is unique per track inside a meeting — so the
 * old label is the selector.
 */
export function buildParticipantRenamePlan(input: {
  meetingId: string | null | undefined;
  previousSpeaker: string | undefined;
  nextSpeaker: string;
}): { meetingId: string; previousSpeaker: string; nextSpeaker: string } | null {
  const meetingId = input.meetingId;
  const previousSpeaker = input.previousSpeaker?.trim();
  const nextSpeaker = input.nextSpeaker.trim();

  if (!meetingId || !previousSpeaker || !nextSpeaker) return null;
  if (previousSpeaker === nextSpeaker) return null;

  return { meetingId, previousSpeaker, nextSpeaker };
}
```

- [ ] **Step 4: Прогнать тест**

Run: `cd packages/backend && npx vitest run src/websocket/handler-rename.test.ts`
Expected: PASS, 5 тестов.

- [ ] **Step 5: Обработать сообщение**

В `switch (message.type)`, после `case 'speaker': { … }`:

```ts
          case 'rename_participant': {
            if (!sessionId) return;

            const session = sessionManager.getSession(sessionId);
            if (!session) return;

            const participantId = message.participantId;
            const participantEntry = participantProviders.get(participantId);
            const previousSpeaker =
              participantEntry?.speaker ?? formatParticipantFallback(participantId);
            const nextSpeaker = normalizeSpeakerLabel(message.speaker);
            if (!nextSpeaker) return;

            if (participantEntry) {
              participantEntry.speaker = nextSpeaker;
            }

            const plan = buildParticipantRenamePlan({
              meetingId: session.meetingId,
              previousSpeaker,
              nextSpeaker,
            });

            if (plan) {
              await prisma.transcriptSegment
                .updateMany({
                  where: { meetingId: plan.meetingId, speaker: plan.previousSpeaker },
                  data: { speaker: plan.nextSpeaker },
                })
                .catch((err: Error) =>
                  server.log.warn(
                    { conn, sessionId, error: err.message },
                    'Failed to rename transcript segments',
                  ),
                );
            }

            const renamed: ServerMessage = {
              type: 'participant_renamed',
              participantId,
              speaker: nextSpeaker,
              previousSpeaker,
            };
            connection.send(JSON.stringify(renamed));

            server.log.info(
              { conn, sessionId, participantId, previousSpeaker, speaker: nextSpeaker },
              'Participant renamed',
            );
            break;
          }
```

- [ ] **Step 6: Прогнать бэкенд-тесты и типы**

Run: `cd packages/backend && npx vitest run && cd /home/aleksander/code/livescribe && npm run type-check`
Expected: все тесты проходят, типы чистые.

- [ ] **Step 7: Коммит**

```bash
git add packages/backend/src/websocket/handler.ts packages/backend/src/websocket/handler-rename.test.ts
git commit -m "feat(backend): relabel stored segments when a per-track speaker is identified late (LS-35)"
```

---

### Task 5: Доставка переименования из расширения

**Files:**
- Modify: `packages/extension/src/content/platforms/meet/audio/per-track/track-transcriber.ts`
- Modify: `packages/extension/src/background/service-worker.ts`
- Modify: `packages/extension/src/offscreen/offscreen.ts`

**Interfaces:**
- Consumes: `BindingChange` из Task 1, `RenameParticipantMessage` из Task 3.
- Produces: внутренние сообщения расширения `PARTICIPANT_RENAME { type, sessionId, participantId, speaker }` (content → service worker) и `OFFSCREEN_PARTICIPANT_RENAME { type, sessionId, participantId, speaker }` (service worker → offscreen).

- [ ] **Step 1: Отправлять из транскрайбера при подтверждении**

В блоке обработки `changes` из Task 2, после `capture.speaker = change.speaker;`:

```ts
        chrome.runtime
          .sendMessage({
            type: 'PARTICIPANT_RENAME',
            sessionId: this.sessionId,
            participantId: capture.participantId,
            speaker: change.speaker,
          })
          .catch(() => {
            // service worker may be inactive momentarily
          });
```

- [ ] **Step 2: Пробросить в service worker**

Рядом с обработчиком `SPEAKER_UPDATE`:

```ts
  if (message.type === 'PARTICIPANT_RENAME') {
    sendToOffscreen({
      type: 'OFFSCREEN_PARTICIPANT_RENAME',
      sessionId: message.sessionId,
      participantId: message.participantId,
      speaker: message.speaker,
    }).catch(() => {
      // ignore
    });
    return false;
  }
```

- [ ] **Step 3: Отправить в WebSocket из offscreen**

Рядом с `case 'OFFSCREEN_SPEAKER_UPDATE':`:

```ts
    case 'OFFSCREEN_PARTICIPANT_RENAME':
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        sendResponse({ error: 'WebSocket is not connected. Please connect first.' });
        return true;
      }
      if (!message.sessionId || !message.participantId || !message.speaker) {
        sendResponse({ error: 'Invalid participant rename payload' });
        return true;
      }

      sendMessage({
        type: 'rename_participant',
        sessionId: message.sessionId,
        participantId: message.participantId,
        speaker: message.speaker,
      } as any);

      sendResponse({ success: true });
      return true;
```

- [ ] **Step 4: Проверить типы и сборку**

Run: `cd /home/aleksander/code/livescribe && npm run type-check && npm run build:extension`
Expected: без ошибок.

- [ ] **Step 5: Коммит**

```bash
git add packages/extension/src/content/platforms/meet/audio/per-track/track-transcriber.ts packages/extension/src/background/service-worker.ts packages/extension/src/offscreen/offscreen.ts
git commit -m "feat(extension): report a confirmed per-track speaker to the backend (LS-35)"
```

---

### Task 6: Виджет переписывает показанные подписи

**Files:**
- Create: `packages/extension/src/content/transcript-rename.ts`
- Test: `packages/extension/src/content/transcript-rename.test.ts`
- Modify: `packages/extension/src/content/content.ts`

**Interfaces:**
- Consumes: `ParticipantRenamedMessage` из Task 3.
- Produces: `renameReplicaSpeaker<T extends { speaker: string }>(replicas: readonly T[], previousSpeaker: string, nextSpeaker: string): T[]`.

- [ ] **Step 1: Написать падающий тест**

```ts
import { describe, expect, it } from 'vitest';
import { renameReplicaSpeaker } from './transcript-rename';

describe('renameReplicaSpeaker', () => {
  it('переименовывает реплики прежней подписи', () => {
    const replicas = [
      { speaker: 'Participant 33f1a44f', text: 'мне нужно найти Ubisoft' },
      { speaker: 'Вы', text: 'скажи что-нибудь' },
      { speaker: 'Participant 33f1a44f', text: 'логин свой' },
    ];

    expect(renameReplicaSpeaker(replicas, 'Participant 33f1a44f', 'Сергей Чумеров')).toEqual([
      { speaker: 'Сергей Чумеров', text: 'мне нужно найти Ubisoft' },
      { speaker: 'Вы', text: 'скажи что-нибудь' },
      { speaker: 'Сергей Чумеров', text: 'логин свой' },
    ]);
  });

  it('сохраняет остальные поля реплики', () => {
    const replicas = [{ speaker: 'Participant 33f1a44f', text: 'алло', highlighted: true }];

    expect(renameReplicaSpeaker(replicas, 'Participant 33f1a44f', 'Сергей Чумеров')).toEqual([
      { speaker: 'Сергей Чумеров', text: 'алло', highlighted: true },
    ]);
  });

  it('возвращает тот же массив, когда переименовывать нечего', () => {
    const replicas = [{ speaker: 'Вы', text: 'алло' }];
    expect(renameReplicaSpeaker(replicas, 'Participant 33f1a44f', 'Сергей')).toBe(replicas);
  });

  it('ничего не делает на пустых подписях', () => {
    const replicas = [{ speaker: 'Participant 33f1a44f', text: 'алло' }];
    expect(renameReplicaSpeaker(replicas, '', 'Сергей')).toBe(replicas);
    expect(renameReplicaSpeaker(replicas, 'Participant 33f1a44f', '  ')).toBe(replicas);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd packages/extension && npx vitest run src/content/transcript-rename.test.ts`
Expected: FAIL — `Failed to resolve import "./transcript-rename"`.

- [ ] **Step 3: Реализовать модуль**

```ts
/**
 * Rewrite the label of replicas already shown. Returns the input array untouched when nothing
 * matches, so callers can skip a re-render.
 */
export function renameReplicaSpeaker<T extends { speaker: string }>(
  replicas: readonly T[],
  previousSpeaker: string,
  nextSpeaker: string,
): T[] {
  const from = previousSpeaker.trim();
  const to = nextSpeaker.trim();
  if (!from || !to || from === to) return replicas as T[];
  if (!replicas.some((replica) => replica.speaker === from)) return replicas as T[];

  return replicas.map((replica) =>
    replica.speaker === from ? { ...replica, speaker: to } : replica,
  );
}
```

- [ ] **Step 4: Прогнать тест**

Run: `cd packages/extension && npx vitest run src/content/transcript-rename.test.ts`
Expected: PASS, 4 теста.

- [ ] **Step 5: Подключить в content.ts**

Импорт рядом с остальными импортами content-скрипта:

```ts
import { renameReplicaSpeaker } from './transcript-rename';
```

В обработчике `WS_MESSAGE`, рядом с ветками `stt_status` и `status`:

```ts
    } else if (wsMessage.type === 'participant_renamed') {
      const previous = String((wsMessage as any).previousSpeaker ?? '');
      const next = String((wsMessage as any).speaker ?? '');

      transcriptReplicas = renameReplicaSpeaker(transcriptReplicas, previous, next);
      if (partialReplica) {
        partialReplica = renameReplicaSpeaker([partialReplica], previous, next)[0];
      }
      if (currentSpeaker === previous) {
        currentSpeaker = next;
      }
      updateTranscript();
```

- [ ] **Step 6: Прогнать все тесты, типы и сборку**

Run: `cd packages/extension && npx vitest run && cd /home/aleksander/code/livescribe && npm run type-check && npm run build:extension`
Expected: тесты зелёные, типы чистые, три варианта собраны.

- [ ] **Step 7: Коммит**

```bash
git add packages/extension/src/content/transcript-rename.ts packages/extension/src/content/transcript-rename.test.ts packages/extension/src/content/content.ts
git commit -m "feat(extension): relabel displayed replicas when a speaker is identified late (LS-35)"
```

---

### Task 7: Фильтр замьюченных участников

**Files:**
- Modify: `packages/extension/src/content/platforms/meet/speaker/active-speaker-dom.ts`
- Modify: `packages/extension/src/content/platforms/meet/speaker/active-speaker-dom.test.ts`
- Modify: `packages/extension/src/content/platforms/meet/audio/per-track/track-transcriber.ts`

**Interfaces:**
- Consumes: `BindingObservation.mutedParticipantIds` из Task 1.
- Produces: `isMutedMicIcon(iconText: string | null | undefined): boolean` и `collectMutedMeetParticipantIds(): string[]`.

- [ ] **Step 1: Дописать падающий тест**

В `active-speaker-dom.test.ts` добавить:

```ts
import { isMutedMicIcon } from './active-speaker-dom';

describe('isMutedMicIcon', () => {
  it('распознаёт выключенный микрофон', () => {
    // Иконка внутри кнопки микрофона плитки: material-имя приходит текстом.
    expect(isMutedMicIcon('mic_off')).toBe(true);
  });

  it('живой микрофон замьюченным не считает', () => {
    expect(isMutedMicIcon('mic_none')).toBe(false);
    expect(isMutedMicIcon('mic')).toBe(false);
  });

  it('на неизвестном значении не фильтрует', () => {
    // Фильтр необязательный: сомнение не должно исключать участника из кандидатов.
    expect(isMutedMicIcon(null)).toBe(false);
    expect(isMutedMicIcon('')).toBe(false);
    expect(isMutedMicIcon('keep_outline')).toBe(false);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd packages/extension && npx vitest run src/content/platforms/meet/speaker/active-speaker-dom.test.ts`
Expected: FAIL — `isMutedMicIcon is not a function`.

- [ ] **Step 3: Реализовать**

В `active-speaker-dom.ts`:

```ts
/** Meet renders the tile mic state as a material icon name inside the button. */
export function isMutedMicIcon(iconText: string | null | undefined): boolean {
  return iconText?.trim() === 'mic_off';
}

/**
 * Participants whose microphone is off. They cannot be the source of any audio, so binding must
 * not consider them candidates even if the highlight momentarily points at them.
 */
export function collectMutedMeetParticipantIds(): string[] {
  const muted: string[] = [];

  document.querySelectorAll<HTMLElement>('[data-participant-id]').forEach((tile) => {
    const participantId = tile.getAttribute('data-participant-id');
    if (!participantId) return;

    const icons = tile.querySelectorAll<HTMLElement>('i.google-symbols');
    for (const icon of icons) {
      if (isMutedMicIcon(icon.textContent)) {
        muted.push(participantId);
        return;
      }
    }
  });

  return muted;
}
```

- [ ] **Step 4: Передать в наблюдение**

В такте привязки из Task 2 добавить импорт `collectMutedMeetParticipantIds` и поле:

```ts
        mutedParticipantIds: collectMutedMeetParticipantIds(),
```

- [ ] **Step 5: Прогнать тесты, типы и сборку**

Run: `cd packages/extension && npx vitest run && cd /home/aleksander/code/livescribe && npm run type-check && npm run build:extension`
Expected: всё зелёное.

- [ ] **Step 6: Коммит**

```bash
git add packages/extension/src/content/platforms/meet/speaker/active-speaker-dom.ts packages/extension/src/content/platforms/meet/speaker/active-speaker-dom.test.ts packages/extension/src/content/platforms/meet/audio/per-track/track-transcriber.ts
git commit -m "feat(extension): keep muted participants out of speaker binding (LS-35)"
```

---

### Task 8: Документация и доска

**Files:**
- Modify: `docs/backlog.md`
- Modify: `docs/PROGRESS.md`
- Modify: `docs/KNOWLEDGE.md`

- [ ] **Step 1: Обновить бэклог**

В записи LS-35 пометить пункт 2 сделанным, перечислив, что именно: правило привязки, пороги, переименование задним числом. Сохранить пометку о том, что браузерная проверка — за владельцем.

- [ ] **Step 2: Обновить PROGRESS.md**

Добавить абзац в «Сделано (последнее)»: LS-35 закрыт полностью, с номерами коммитов и указанием, что per-track на Meet теперь пишет всех участников с именами.

- [ ] **Step 3: Дописать KNOWLEDGE.md**

Зафиксировать грабли, чтобы не переисследовать: у Meet в DOM нет `data-ssrc`; id потока Meet — это ssrc, а не идентификатор участника (в отличие от Pachca); Meet держит пул приёмных слотов (наблюдали 4 на 3 участников) и переиспользует их, поэтому привязка обязана уметь сбрасываться.

- [ ] **Step 4: Коммит**

```bash
git add docs/backlog.md docs/PROGRESS.md docs/KNOWLEDGE.md
git commit -m "docs: LS-35 закрыт — привязка per-track спикеров на Meet"
```

- [ ] **Step 5: Двинуть карточку**

Перевести карточку #58 в «На проверке» с комментарием простым языком: имена участников в per-track теперь подставляются, ранние реплики переименовываются; от владельца нужна проверка на живом звонке с выключенными камерами.

---

## Проверка владельцем (после всех задач)

Среда агента не грузит unpacked-расширение, поэтому финальная проверка — на живом звонке:

1. Обновить расширение в `chrome://extensions`, перезагрузить вкладку Meet.
2. Режим **Per-track**, «Reset», «Start». Камеры выключены — это рабочий режим.
3. Ожидание: через несколько секунд речи каждого участника его реплики подписаны именем, а реплики, записанные до этого под `Participant …`, переименованы задним числом.
4. Проверить карточку встречи в кабинете: в сохранённом транскрипте тоже имена, а не технические подписи.
5. Если чья-то подпись не появилась — прислать логи: строка `speaker bound` показывает, какие привязки набрались.
