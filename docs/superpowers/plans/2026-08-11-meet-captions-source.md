# Meet Captions Transcript Source — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить третий источник транскрипта `meet-captions` — текст берётся из собственных субтитров Google Meet, аудио не захватывается, Deepgram не задействован, реплики с настоящими именами участников сохраняются в кабинете как обычная встреча.

**Architecture:** Чистое ядро (разбор блока субтитров, финализация фразы, буфер отправки) отделено от тонкого DOM-слоя (MutationObserver, клики по кнопке субтитров, скрытие региона). Финальные реплики идут по существующей цепочке `content script → service worker → offscreen (держит WebSocket) → бэкенд` новым сообщением `caption`, которое бэкенд пишет тем же кодом, что и финалы Deepgram.

**Tech Stack:** TypeScript, Chrome Extension MV3, Vite, Vitest (`environment: 'node'`), Fastify + `@fastify/websocket`, Prisma/PostgreSQL.

## Global Constraints

- Спека: `docs/superpowers/specs/2026-08-11-meet-captions-source-design.md`. Карточка на доске: `#59` (LS-36).
- Ворктри: `/home/aleksander/code/livescribe.worktrees/meet-captions`, ветка `feat/meet-captions-source`. Все команды — оттуда.
- **Перед первым прогоном тестов бэкенда** в свежем ворктри: `npm run build --workspace=@skribo/shared`, иначе `Failed to resolve entry for package "@skribo/shared"`.
- **Никаких обфусцированных классов Meet в коде** (`.nMcdL`, `.ygicle`, `.NWpY1d`, `.a4cQT` и подобных). Только структура и стабильные атрибуты: `role`, `aria-label`, `data-value`, наличие `img`.
- **`environment: 'node'`, `jsdom` не установлен и устанавливать его нельзя.** Чистые функции принимают простые структуры (числа, строки, объекты-представления), а не `Element` — как уже сделано в `pickActiveIndicatorIndex(classLists: readonly string[][])`.
- Скрытие региона субтитров — **только** смещением за вьюпорт (`position: fixed; left: -10000px`), никогда `display: none`.
- Скрываем/выключаем/переключаем язык **только то, что включили сами**. Субтитры, включённые пользователем до старта, не трогаем.
- **Молчаливого перехода на Deepgram нет.** Отказ субтитров — видимая ошибка в виджете.
- Термины домена — по-английски (`TranscriptSource`, `CaptionReplica`), комментарии — по-русски там, где объясняют «почему», как в остальном репозитории.
- Коммит после каждой задачи, прямо в ветку. Сообщение — на русском, в стиле репозитория (`feat(scope): …` / `feat(extension): …`), с телом-абзацем «почему», без списка изменённых файлов.

---

### Task 1: Протокол — сообщение `caption` и поле `transcriptSource`

**Files:**
- Modify: `packages/shared/src/websocket-protocol.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `TranscriptSource` (`'per-track' | 'mixed' | 'meet-captions'`), `CaptionMessage` (`{ type: 'caption'; sessionId: string; text: string; speaker: string | null; timestamp: number }`), поле `StartSessionMessage.transcriptSource?: TranscriptSource`, расширенный union `ClientMessage`.

Задача без юнит-тестов осознанно: файл содержит только типы, у него нет поведения, которое можно вызвать. Гейт — `tsc` в шаге 2 и компиляция всех потребителей в задачах 2–9.

- [ ] **Step 1: Добавить типы источника и сообщения субтитров**

В `packages/shared/src/websocket-protocol.ts` перед `export interface StartSessionMessage` вставить:

```ts
/**
 * Откуда берётся текст встречи.
 *
 * `per-track` и `mixed` — захват аудио с распознаванием на бэкенде (Deepgram). `meet-captions` —
 * готовый текст из собственных субтитров Google Meet: аудио не захватывается вообще, STT-провайдер
 * для такой сессии не создаётся, платить за минуты не нужно (LS-36).
 */
export type TranscriptSource = 'per-track' | 'mixed' | 'meet-captions';

/**
 * Финальная реплика, снятая с субтитров платформы.
 *
 * Партиалов здесь не бывает по устройству: Meet переписывает один и тот же узел, пока уточняет
 * фразу, и клиент рисует эти правки у себя, ничего не отправляя. В базу должна попасть одна
 * запись на фразу, а не по одной на каждую правку.
 *
 * `confidence` нет намеренно: Meet не сообщает уверенность, а выдумать 1.0 значило бы записать в
 * базу ложное «распознано наверняка».
 */
export interface CaptionMessage {
  type: 'caption';
  sessionId: string;
  text: string;
  speaker: string | null;
  /** Момент финализации фразы на клиенте (`Date.now()`). */
  timestamp: number;
}
```

- [ ] **Step 2: Добавить поле в `start` и расширить union**

В `StartSessionMessage` после поля `audioMode?: 'per-track' | 'mixed';` добавить:

```ts
  /**
   * Источник транскрипта (LS-36). Отдельное поле, а не расширение `audioMode`: расширение и
   * бэкенд деплоятся независимо, и старая сборка расширения продолжает присылать только
   * `audioMode` — бэкенд читает `transcriptSource ?? audioMode`.
   */
  transcriptSource?: TranscriptSource;
```

В union `ClientMessage` добавить `CaptionMessage`:

```ts
export type ClientMessage =
  | AudioChunkMessage
  | CaptionMessage
  | SpeakerUpdateMessage
  | RenameParticipantMessage
  | StartSessionMessage
  | StopSessionMessage;
```

`RenameParticipantMessage` пришёл из LS-35 (часть 2, поздняя привязка спикера к дорожке) — ветка перебазирована на него, его надо сохранить, а не потерять при правке union.

- [ ] **Step 3: Проверить сборку типов**

Run: `npm run build --workspace=@skribo/shared`
Expected: успешная сборка, без вывода ошибок `tsc`.

- [ ] **Step 4: Коммит**

```bash
git add packages/shared/src/websocket-protocol.ts
git commit -m "feat(shared): сообщение caption и поле transcriptSource в протоколе (LS-36)"
```

---

### Task 2: Бэкенд — приём `caption` и отказ от STT-провайдера

**Files:**
- Modify: `packages/backend/src/websocket/handler.ts`
- Test: `packages/backend/src/websocket/handler-caption.test.ts` (создать)

**Interfaces:**
- Consumes: `CaptionMessage`, `TranscriptSource` из Task 1; существующие `buildTranscriptSegmentRecord(session, result, speaker, nowMs)`, `TranscriptSegmentRecord`, `SessionLike`, `persistFinalSegment(result, speaker?)`.
- Produces: `buildCaptionSegmentRecord(session, message, nowMs): TranscriptSegmentRecord | null`, `shouldOpenSttStream(transcriptSource): boolean` — обе экспортируются для тестов.

- [ ] **Step 1: Написать падающий тест**

Создать `packages/backend/src/websocket/handler-caption.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildCaptionSegmentRecord, shouldOpenSttStream } from './handler.js';

const SESSION_START = 1_700_000_000_000;

function sessionWith(overrides: { meetingId?: string | undefined; startedAtMs?: number } = {}) {
  return {
    meetingId: 'meetingId' in overrides ? overrides.meetingId : 'meeting_1',
    startedAtMs: 'startedAtMs' in overrides ? overrides.startedAtMs : SESSION_START,
  } as any;
}

describe('buildCaptionSegmentRecord', () => {
  it('пишет реплику субтитров с именем участника', () => {
    const record = buildCaptionSegmentRecord(
      sessionWith(),
      { text: 'Хмм короче, никаких уведомлений об этом нет.', speaker: 'Сергей Чумеров' },
      SESSION_START + 9_000,
    );

    expect(record).toEqual({
      meetingId: 'meeting_1',
      speaker: 'Сергей Чумеров',
      text: 'Хмм короче, никаких уведомлений об этом нет.',
      tsMs: 9_000,
      confidence: null,
    });
  });

  it('оставляет confidence пустым, а не выдумывает единицу', () => {
    // Meet не сообщает уверенность распознавания. Записать 1.0 значило бы утверждать в базе
    // «распознано наверняка» про текст, который заметно грубее Deepgram.
    const record = buildCaptionSegmentRecord(
      sessionWith(),
      { text: 'Это время. сть', speaker: 'Вы' },
      SESSION_START + 1_000,
    );

    expect(record?.confidence).toBeNull();
  });

  it('допускает реплику без имени', () => {
    const record = buildCaptionSegmentRecord(
      sessionWith(),
      { text: 'кто-то говорит', speaker: null },
      SESSION_START + 2_000,
    );

    expect(record?.speaker).toBeNull();
  });

  it('отбрасывает пустой текст', () => {
    expect(
      buildCaptionSegmentRecord(sessionWith(), { text: '   ', speaker: 'Вы' }, SESSION_START),
    ).toBeNull();
  });

  it('ничего не пишет для анонимной сессии', () => {
    // Без Meeting сегмент некуда прикрепить — как и у финалов Deepgram.
    expect(
      buildCaptionSegmentRecord(
        sessionWith({ meetingId: undefined }),
        { text: 'привет', speaker: 'Вы' },
        SESSION_START,
      ),
    ).toBeNull();
  });
});

describe('shouldOpenSttStream', () => {
  it('не открывает поток распознавания для субтитров', () => {
    // Главный смысл режима: за встречу не платим. Открытый впустую стрим Deepgram
    // это и деньги, и лишний дребезг stt_status у клиента, которому он не нужен.
    expect(shouldOpenSttStream('meet-captions')).toBe(false);
  });

  it('открывает поток для аудио-режимов', () => {
    expect(shouldOpenSttStream('mixed')).toBe(true);
    expect(shouldOpenSttStream('per-track')).toBe(true);
  });

  it('открывает поток, когда источник не указан', () => {
    // Старая сборка расширения не присылает transcriptSource — прежнее поведение обязано выжить.
    expect(shouldOpenSttStream(undefined)).toBe(true);
    expect(shouldOpenSttStream(null)).toBe(true);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test --workspace=@skribo/backend -- handler-caption`
Expected: FAIL — `buildCaptionSegmentRecord`/`shouldOpenSttStream` не экспортируются из `./handler.js`.

- [ ] **Step 3: Добавить чистые функции**

В `packages/backend/src/websocket/handler.ts` после `buildTranscriptSegmentRecord` (сразу за закрывающей скобкой функции, перед `canResumeMeeting`) вставить:

```ts
/**
 * Реплика субтитров платформы, приведённая к строке транскрипта.
 *
 * Проходит через `buildTranscriptSegmentRecord`, чтобы обе дороги — распознавание аудио и
 * субтитры — писали сегменты одним и тем же кодом: правила «только финалы», «только для сессии с
 * Meeting», смещение `tsMs` от начала встречи не должны разъезжаться между источниками.
 *
 * Exported for tests.
 */
export function buildCaptionSegmentRecord(
  session: SessionLike,
  message: { text?: unknown; speaker?: unknown },
  nowMs: number,
): TranscriptSegmentRecord | null {
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  if (!text) return null;

  const rawSpeaker = typeof message.speaker === 'string' ? message.speaker.trim() : '';
  const speaker = rawSpeaker.length > 0 ? rawSpeaker : undefined;

  return buildTranscriptSegmentRecord(
    session,
    { isFinal: true, text, confidence: undefined },
    speaker,
    nowMs,
  );
}

/**
 * Нужно ли этой сессии соединение со STT-провайдером.
 *
 * Для `meet-captions` распознаёт сам Meet, аудио на бэкенд не приходит вообще — открытый стрим
 * Deepgram висел бы впустую, тратил минуты и заливал клиента статусами про распознавание,
 * которого в этом режиме нет.
 *
 * Exported for tests.
 */
export function shouldOpenSttStream(transcriptSource: string | null | undefined): boolean {
  return transcriptSource !== 'meet-captions';
}
```

- [ ] **Step 4: Прочитать источник в `start` и загейтить провайдера**

В `case 'start'` заменить строку

```ts
            const audioMode = (message as any).audioMode || null;
```

на

```ts
            const audioMode = (message as any).audioMode || null;
            // Старая сборка расширения присылает только audioMode — читаем с фолбэком, чтобы
            // прежние клиенты вели себя ровно как раньше.
            const transcriptSource = ((message as any).transcriptSource || audioMode) as
              | string
              | null;
```

В том же `case` в логе `'Start message received'` заменить объект на:

```ts
              { conn, language: activeLanguage, provider: activeProviderType, platform: (message as any).platform ?? null, audioMode, transcriptSource },
```

В `prisma.meeting.create` заменить `audioMode: audioMode ?? null,` на:

```ts
                        audioMode: transcriptSource ?? null,
```

(колонка `Meeting.audioMode` — `String?`, миграция не нужна; она хранит выбранный источник, а `meet-captions` такое же строковое значение, как `per-track`.)

Загейтить создание провайдера. Существующий блок `try { … } catch { … }`, который начинается строкой `let sttProvider: any = null;` и заканчивается комментарием `// Continue anyway - create session without STT provider` со закрывающей `}`, целиком обернуть в `if`/`else` и **сдвинуть на один уровень отступа**:

```ts
            // Create STT provider (optional - audio will still be saved even if STT fails)
            let sttProvider: any = null;
            if (!shouldOpenSttStream(transcriptSource)) {
              server.log.info(
                { conn, transcriptSource },
                'Transcript comes from platform captions; no STT stream opened',
              );
            } else {
              try {
                // …существующее тело try целиком, без изменений…
              } catch {
                // …существующее тело catch целиком, без изменений…
              }
            }
```

Само тело `try`/`catch` не меняется ни на строку — только отступ и новая обёртка. Объявление `let sttProvider: any = null;` обязано остаться **снаружи** `if`: ниже его читает `sessionManager.createSession(...)`.

- [ ] **Step 5: Добавить обработку сообщения `caption`**

В `switch (message.type)` перед `case 'speaker': {` вставить:

```ts
          case 'caption': {
            if (!sessionId) {
              server.log.warn({ conn }, 'Received caption without active session');
              return;
            }

            const session = sessionManager.getSession(sessionId);
            if (!session) {
              server.log.warn({ conn, sessionId }, 'Received caption for missing session');
              return;
            }

            const record = buildCaptionSegmentRecord(session, message, Date.now());
            if (!record) break;

            prisma.transcriptSegment.create({ data: record }).catch((err: Error) =>
              server.log.warn(
                { conn, sessionId, error: err.message },
                'Failed to persist caption segment',
              ),
            );

            server.log.info(
              { conn, sessionId, speaker: record.speaker, textLength: record.text.length },
              'Caption segment persisted',
            );
            break;
          }
```

Эха клиенту нет намеренно: реплику уже нарисовал сам контент-скрипт, и второй путь отрисовки дал бы дубль в виджете.

- [ ] **Step 6: Прогнать тесты**

Run: `npm test --workspace=@skribo/backend`
Expected: PASS, все файлы (было 134 теста, стало 134 + 8).

- [ ] **Step 7: Коммит**

```bash
git add packages/backend/src/websocket/handler.ts packages/backend/src/websocket/handler-caption.test.ts
git commit -m "feat(backend): приём реплик субтитров и сессия без STT-стрима (LS-36)"
```

---

### Task 3: `TranscriptSource` вместо `AudioMode` и флаг возможностей платформы

**Files:**
- Modify: `packages/extension/src/platform/audio-mode-capabilities.ts`
- Modify: `packages/extension/src/platform/audio-mode-capabilities.test.ts`
- Modify: `packages/extension/src/content/platform/platform-adapter.ts`
- Modify: `packages/extension/src/content/platforms/meet/config/audio-mode.ts`
- Modify: `packages/extension/src/content/recording/recording-controller.ts`
- Modify: `packages/extension/src/content/platforms/meet/recording/track-mode-controller.ts`
- Modify: `packages/extension/src/content/content.ts` (только переименование вызовов; третий вариант в селекторе добавляет Task 9)
- Modify: `packages/extension/src/background/service-worker.ts`

**Interfaces:**
- Consumes: `PlatformForStart` из `content/platform/platform-detector`.
- Produces: `TranscriptSource`, `PlatformCapabilities.supportsCaptionSource`, `supportsCaptionTranscriptSource(platform): boolean`, `resolveTranscriptSource(source, platform): TranscriptSource`, `requiresAudioCapture(source): boolean`. Из адаптера: `PlatformAdapter.supportsCaptionSourceSelection(): boolean`, `getTranscriptSource(): TranscriptSource`, `setTranscriptSource(source): void`. Из конфига Meet: `getMeetTranscriptSource()`, `setMeetTranscriptSource(source)`.
- **Удаляются:** `resolveAudioMode`, `getMeetAudioMode`, `setMeetAudioMode`, `PlatformAdapter.getAudioMode`, `PlatformAdapter.setAudioMode` — это переименование, а не второе имя рядом с прежним.
- **Остаётся:** `PlatformAdapter.supportsAudioModeSelection()` — он отвечает на другой вопрос («показывать ли селектор режима вообще»), чем новый `supportsCaptionSourceSelection()` («есть ли в списке третий вариант»).

- [ ] **Step 1: Написать падающие тесты**

В `packages/extension/src/platform/audio-mode-capabilities.test.ts` заменить весь блок тестов `resolveAudioMode` на:

```ts
describe('resolveTranscriptSource', () => {
  it('оставляет субтитры там, где платформа их умеет', () => {
    expect(resolveTranscriptSource('meet-captions', 'meet')).toBe('meet-captions');
  });

  it('не отдаёт субтитры платформе без них', () => {
    // Иначе виджет описывал бы пайплайн, которого на этой платформе не существует, — та же
    // ошибка, что чинил LS-21 для per-track.
    expect(resolveTranscriptSource('meet-captions', 'teams')).toBe('mixed');
    expect(resolveTranscriptSource('meet-captions', 'zoom')).toBe('mixed');
    expect(resolveTranscriptSource('meet-captions', undefined)).toBe('mixed');
  });

  it('платформа без per-track всегда mixed', () => {
    expect(resolveTranscriptSource('per-track', 'teams')).toBe('mixed');
    expect(resolveTranscriptSource(undefined, 'zoom')).toBe('mixed');
  });

  it('по умолчанию per-track там, где он есть', () => {
    expect(resolveTranscriptSource(undefined, 'meet')).toBe('per-track');
    expect(resolveTranscriptSource('mixed', 'meet')).toBe('mixed');
  });
});

describe('requiresAudioCapture', () => {
  it('субтитры не требуют захвата аудио', () => {
    expect(requiresAudioCapture('meet-captions')).toBe(false);
  });

  it('аудио-режимы требуют захвата', () => {
    expect(requiresAudioCapture('mixed')).toBe(true);
    expect(requiresAudioCapture('per-track')).toBe(true);
  });
});

describe('supportsCaptionTranscriptSource', () => {
  it('включён только на Meet', () => {
    expect(supportsCaptionTranscriptSource('meet')).toBe(true);
    expect(supportsCaptionTranscriptSource('pachca')).toBe(false);
    expect(supportsCaptionTranscriptSource('teams')).toBe(false);
    expect(supportsCaptionTranscriptSource('zoom')).toBe(false);
    expect(supportsCaptionTranscriptSource(undefined)).toBe(false);
  });
});
```

И привести строку импорта в начале файла к:

```ts
import {
  getPlatformCapabilities,
  requiresAudioCapture,
  resolveTranscriptSource,
  supportsCaptionTranscriptSource,
  supportsPerTrackAudioMode,
} from './audio-mode-capabilities';
```

(остальные существующие тесты файла — про `getPlatformCapabilities` и `supportsPerTrackAudioMode` — не трогать.)

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test --workspace=@skribo/extension -- audio-mode-capabilities`
Expected: FAIL — `resolveTranscriptSource`, `requiresAudioCapture`, `supportsCaptionTranscriptSource` не экспортируются.

- [ ] **Step 3: Переписать реестр возможностей**

В `packages/extension/src/platform/audio-mode-capabilities.ts`:

заменить `export type AudioMode = 'per-track' | 'mixed';` на

```ts
/**
 * Откуда берётся текст встречи. `per-track`/`mixed` — захват аудио, `meet-captions` — готовый
 * текст из субтитров платформы (LS-36). Один селектор с тремя значениями, а не две независимые
 * оси: «аудио per-track + текст из субтитров» жгло бы аудио впустую, и такое состояние не должно
 * быть выразимо.
 */
export type TranscriptSource = 'per-track' | 'mixed' | 'meet-captions';
```

в `PlatformCapabilities` добавить поле:

```ts
  /** Умеет ли платформа отдавать транскрипт из собственных субтитров (LS-36). */
  supportsCaptionSource: boolean;
```

в `DEFAULT_PLATFORM_CAPABILITIES` добавить `supportsCaptionSource: false,`; в `PLATFORM_CAPABILITIES` добавить `supportsCaptionSource: true,` для `meet` и `supportsCaptionSource: false,` для `zoom`, `teams`, `pachca`.

заменить функцию `resolveAudioMode` целиком на:

```ts
export function supportsCaptionTranscriptSource(platform: PlatformForStart): boolean {
  return getPlatformCapabilities(platform).supportsCaptionSource;
}

/**
 * Действующий источник транскрипта. Платформа, которая чего-то не умеет, не должна получать это
 * значение: описывать несуществующий пайплайн — та же ошибка, что чинил LS-21.
 */
export function resolveTranscriptSource(
  source: TranscriptSource | undefined,
  platform?: PlatformForStart,
): TranscriptSource {
  if (source === 'meet-captions') {
    return supportsCaptionTranscriptSource(platform) ? 'meet-captions' : 'mixed';
  }

  if (!supportsPerTrackAudioMode(platform)) {
    return 'mixed';
  }

  return source === 'mixed' ? 'mixed' : 'per-track';
}

/** Нужен ли для этого источника захват аудио вкладки или дорожек. */
export function requiresAudioCapture(source: TranscriptSource): boolean {
  return source !== 'meet-captions';
}
```

- [ ] **Step 4: Обновить адаптер платформы**

В `packages/extension/src/content/platform/platform-adapter.ts`:

- в импорте из `'../../platform/audio-mode-capabilities'` добавить `supportsCaptionTranscriptSource` и `type TranscriptSource`;
- импорт из `'../platforms/meet/config/audio-mode'` заменить на `getMeetTranscriptSource, setMeetTranscriptSource`;
- удалить строку `export type AudioMode = 'per-track' | 'mixed';` и вместо неё добавить `export type { TranscriptSource } from '../../platform/audio-mode-capabilities';`;
- в интерфейсе `PlatformAdapter` заменить три метода:

```ts
  supportsCaptionSourceSelection: () => boolean;
  getTranscriptSource: () => TranscriptSource;
  setTranscriptSource: (source: TranscriptSource) => void;
```

(вместо `supportsAudioModeSelection`, `getAudioMode`, `setAudioMode`);

- в возвращаемом объекте заменить их реализации на:

```ts
    supportsAudioModeSelection: () => capabilities.supportsPerTrackAudioMode,
    supportsCaptionSourceSelection: () => capabilities.supportsCaptionSource,
    getTranscriptSource: (): TranscriptSource => {
      if (platform === 'meet') return getMeetTranscriptSource();
      if (platform === 'pachca') return getPachcaAudioMode();
      if (!supportsPerTrackAudioMode(platform)) return 'mixed';
      return 'mixed';
    },
    setTranscriptSource: (source) => {
      if (platform === 'meet') {
        setMeetTranscriptSource(source);
        return;
      }
      if (platform === 'pachca' && source !== 'meet-captions') {
        setPachcaAudioMode(source);
      }
    },
```

Оставить `supportsAudioModeSelection` в интерфейсе рядом с новым `supportsCaptionSourceSelection`: первый по-прежнему отвечает «показывать ли выбор режима вообще», второй — «есть ли в списке третий вариант».

- [ ] **Step 5: Обновить хранение выбора для Meet**

Заменить содержимое `packages/extension/src/content/platforms/meet/config/audio-mode.ts` на:

```ts
import type { TranscriptSource } from '../../../../platform/audio-mode-capabilities';

const STORAGE_KEY = 'livescribe-meet-audio-mode';

/**
 * Ключ намеренно оставлен прежним (`…-audio-mode`): у пользователей в localStorage уже лежит
 * выбранный режим, и переименование ключа молча сбросило бы его на дефолт.
 */
export function getMeetTranscriptSource(): TranscriptSource {
  try {
    const raw = (localStorage.getItem(STORAGE_KEY) || '').trim().toLowerCase();
    if (raw === 'mixed') return 'mixed';
    if (raw === 'meet-captions') return 'meet-captions';
  } catch {
    // ignore localStorage errors
  }

  return 'per-track';
}

export function setMeetTranscriptSource(source: TranscriptSource): void {
  try {
    localStorage.setItem(STORAGE_KEY, source);
  } catch {
    // ignore localStorage errors
  }
}
```

- [ ] **Step 6: Обновить потребителей типа**

В `packages/extension/src/content/recording/recording-controller.ts`:
- заменить первую строку на `import type { TranscriptSource } from '../platform/platform-adapter';`
- в `RecordingControllerDeps` заменить `getAudioMode: () => AudioMode;` на `getTranscriptSource: () => TranscriptSource;`
- в `start()` заменить `const audioMode = this.deps.getAudioMode();` на `const transcriptSource = this.deps.getTranscriptSource();`, а тело `chrome.runtime.sendMessage` — на:

```ts
          {
            type: 'START_RECORDING',
            language,
            platform: this.deps.getPlatformForStartMessage(),
            audioMode: transcriptSource === 'meet-captions' ? 'mixed' : transcriptSource,
            transcriptSource,
          },
```

(`audioMode` остаётся в сообщении для совместимости со старым сервис-воркером, если тот успел загрузиться из предыдущей версии сборки.)

- в логе `'[LiveScribe] audio mode'` заменить `mode: this.deps.getAudioMode(),` на `source: this.deps.getTranscriptSource(),`.

В `packages/extension/src/content/platforms/meet/recording/track-mode-controller.ts` заменить импорт `getMeetAudioMode` на `getMeetTranscriptSource` и оба вызова `getMeetAudioMode()` — на `getMeetTranscriptSource()`. Проверки `!== 'per-track'` менять не нужно: для `meet-captions` они так же корректно пропускают старт.

В `packages/extension/src/content/content.ts` — **только механическое переименование**, чтобы `tsc` прошёл уже на этой задаче (третий вариант в селекторе и колбэки субтитров добавляет Task 9):
- в депсах `new RecordingController({ … })` заменить `getAudioMode: () => platformAdapter.getAudioMode(),` на `getTranscriptSource: () => platformAdapter.getTranscriptSource(),`;
- в `createUIWidget` заменить объявление `const selectedAudioMode = platformAdapter.getAudioMode();` на `const selectedAudioMode = platformAdapter.getTranscriptSource();`;
- в обработчике `change` селектора заменить `platformAdapter.setAudioMode(target.value);` на `platformAdapter.setTranscriptSource(target.value);`;
- вызов `platformAdapter.supportsAudioModeSelection()` в разметке селектора не трогать — метод остаётся.

В `packages/extension/src/background/service-worker.ts`:
- в импорте из `'../platform/audio-mode-capabilities'` заменить `resolveAudioMode` на `resolveTranscriptSource, requiresAudioCapture`;
- в объявлении около строки 43 заменить `audioMode?: 'mixed' | 'per-track';` на `audioMode?: 'mixed' | 'per-track';` и добавить строкой ниже `transcriptSource?: 'mixed' | 'per-track' | 'meet-captions';`;
- в `startRecordingOffscreen` заменить первые строки на:

```ts
  const platformCapabilities = getPlatformCapabilities(message.platform);
  const transcriptSource = resolveTranscriptSource(
    message.transcriptSource ?? message.audioMode,
    message.platform,
  );
  const audioMode = transcriptSource === 'meet-captions' ? 'mixed' : transcriptSource;
  currentAudioMode = audioMode;
  resetAudioLevels();
  broadcastAudioLevels();
  const shouldSkipTabCapture =
    !requiresAudioCapture(transcriptSource) ||
    (platformCapabilities.supportsPerTrackAudioMode && transcriptSource === 'per-track');
```

- в объекте лога `'startRecordingOffscreen mode'` добавить `transcriptSource,` первой строкой;
- в **обоих** вызовах `sendToOffscreen({ type: 'OFFSCREEN_START_SESSION', … })` добавить `transcriptSource,` сразу после `audioMode,`.

- [ ] **Step 7: Прогнать тесты и типы**

Run: `npm test --workspace=@skribo/extension`
Expected: PASS (98 тестов + новые из шага 1).

Run: `npm run type-check`
Expected: без ошибок. Если `tsc` жалуется на оставшиеся ссылки `getAudioMode`/`AudioMode`/`resolveAudioMode` — заменить их по указанным выше правилам; других потребителей быть не должно.

- [ ] **Step 8: Коммит**

```bash
git add packages/extension/src/platform packages/extension/src/content/platform packages/extension/src/content/platforms/meet packages/extension/src/content/recording/recording-controller.ts packages/extension/src/content/content.ts packages/extension/src/background/service-worker.ts
git commit -m "refactor(extension): режим захвата стал источником транскрипта (LS-36)"
```

---

### Task 4: Чистый разбор блока субтитров

**Files:**
- Create: `packages/extension/src/content/platforms/meet/captions/caption-dom.ts`
- Test: `packages/extension/src/content/platforms/meet/captions/caption-dom.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `normalizeCaptionText(value: string): string`, `pickCaptionRegionIndex(blockCounts: readonly number[]): number | null`, `CaptionBlockView` (`{ avatarSubtreeText: string; fullText: string }`), `CaptionReplica` (`{ speaker: string; text: string }`), `parseCaptionBlock(view: CaptionBlockView): CaptionReplica | null`.

- [ ] **Step 1: Написать падающий тест**

Создать `caption-dom.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  normalizeCaptionText,
  parseCaptionBlock,
  pickCaptionRegionIndex,
} from './caption-dom';

// Снято с живой встречи Meet 2026-08-11 (ru-RU). Блок реплики — это аватар участника, его имя
// и сам текст; классы вокруг обфусцированы и здесь намеренно не участвуют.
const SERGEY = {
  avatarSubtreeText: 'Сергей Чумеров',
  fullText: 'Сергей Чумеров Хмм короче, никаких уведомлений об этом нет. ',
};

describe('pickCaptionRegionIndex', () => {
  it('берёт регион с наибольшим числом блоков', () => {
    // Meet монтирует регион субтитров дважды (нижний оверлей и панель) — в дампе он встречается
    // два раза. Без выбора одного мы бы прочитали каждую реплику по два раза.
    expect(pickCaptionRegionIndex([0, 5])).toBe(1);
  });

  it('при равенстве берёт первый', () => {
    expect(pickCaptionRegionIndex([3, 3])).toBe(0);
  });

  it('молчит, когда блоков нет нигде', () => {
    // Регион ещё не наполнился или разметка сменилась: лучше честное «не знаю», чем
    // случайный регион, из которого не придёт ни одной реплики.
    expect(pickCaptionRegionIndex([0, 0])).toBeNull();
    expect(pickCaptionRegionIndex([])).toBeNull();
  });
});

describe('parseCaptionBlock', () => {
  it('делит блок на имя и текст', () => {
    expect(parseCaptionBlock(SERGEY)).toEqual({
      speaker: 'Сергей Чумеров',
      text: 'Хмм короче, никаких уведомлений об этом нет.',
    });
  });

  it('понимает собственную реплику («Вы»)', () => {
    expect(
      parseCaptionBlock({ avatarSubtreeText: 'Вы', fullText: 'Вы Это время. сть ' }),
    ).toEqual({ speaker: 'Вы', text: 'Это время. сть' });
  });

  it('не режет текст, начинающийся так же, как имя', () => {
    // Имя отделяется только как префикс полного текста; если Meet почему-то отдал текст без
    // префикса, лучше сохранить его целиком, чем откусить начало реплики.
    expect(
      parseCaptionBlock({ avatarSubtreeText: 'Даниил Никишкин', fullText: 'Хмм ну, да, ну' }),
    ).toEqual({ speaker: 'Даниил Никишкин', text: 'Хмм ну, да, ну' });
  });

  it('отбрасывает блок без текста', () => {
    expect(parseCaptionBlock({ avatarSubtreeText: 'Вы', fullText: 'Вы' })).toBeNull();
  });

  it('отбрасывает блок без имени', () => {
    expect(parseCaptionBlock({ avatarSubtreeText: '  ', fullText: 'какой-то текст' })).toBeNull();
  });
});

describe('normalizeCaptionText', () => {
  it('сжимает пробелы и переводы строк', () => {
    expect(normalizeCaptionText('  а  вот\n всё   норм. ')).toBe('а вот всё норм.');
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test --workspace=@skribo/extension -- caption-dom`
Expected: FAIL — модуль `./caption-dom` не существует.

- [ ] **Step 3: Реализовать модуль**

Создать `caption-dom.ts`:

```ts
// Чистый разбор субтитров Google Meet (LS-36).
//
// Ни одного класса Meet здесь нет намеренно: `.nMcdL`, `.ygicle`, `.NWpY1d` обфусцированы и
// сменятся без предупреждения. Опора — структура блока (аватар + имя + текст) и стабильные
// атрибуты, которые читает тонкий DOM-слой (`caption-reader.ts`) и приносит сюда уже в виде
// простых строк. Это же держит модуль тестируемым: у vitest в extension `environment: 'node'`,
// DOM в тестах нет.

/** Реплика: кто сказал и что. */
export interface CaptionReplica {
  speaker: string;
  text: string;
}

/** То, что DOM-слой снимает с одного блока субтитров. */
export interface CaptionBlockView {
  /** Текст поддерева, содержащего аватар участника — там же лежит его имя. */
  avatarSubtreeText: string;
  /** Полный текст блока: имя и сама реплика. */
  fullText: string;
}

export function normalizeCaptionText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Какой из регионов-кандидатов и есть список субтитров — тот, где больше всего блоков-реплик.
 *
 * Meet монтирует регион дважды, и разметка вокруг него обфусцирована, поэтому выбор идёт по
 * структуре, а не по классу. `null` означает «ни в одном регионе нет реплик»: либо субтитры ещё
 * не наполнились, либо структура сменилась — вызывающий код обязан показать это пользователем,
 * а не молча читать пустоту.
 */
export function pickCaptionRegionIndex(blockCounts: readonly number[]): number | null {
  let bestIndex: number | null = null;
  let bestCount = 0;

  blockCounts.forEach((count, index) => {
    if (count > bestCount) {
      bestCount = count;
      bestIndex = index;
    }
  });

  return bestCount > 0 ? bestIndex : null;
}

/**
 * Имя и текст из одного блока. Имя отделяется как префикс полного текста — если префикса нет
 * (Meet поменял порядок узлов), текст сохраняется целиком: потерять начало реплики хуже, чем
 * оставить в ней лишнее.
 */
export function parseCaptionBlock(view: CaptionBlockView): CaptionReplica | null {
  const speaker = normalizeCaptionText(view.avatarSubtreeText);
  const full = normalizeCaptionText(view.fullText);
  if (!speaker || !full) return null;

  const text = full.startsWith(speaker)
    ? normalizeCaptionText(full.slice(speaker.length))
    : full;

  if (!text) return null;

  return { speaker, text };
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `npm test --workspace=@skribo/extension -- caption-dom`
Expected: PASS (10 тестов).

- [ ] **Step 5: Коммит**

```bash
git add packages/extension/src/content/platforms/meet/captions/caption-dom.ts packages/extension/src/content/platforms/meet/captions/caption-dom.test.ts
git commit -m "feat(extension): чистый разбор блока субтитров Meet (LS-36)"
```

---

### Task 5: Финализация фразы

**Files:**
- Create: `packages/extension/src/content/platforms/meet/captions/caption-finalizer.ts`
- Test: `packages/extension/src/content/platforms/meet/captions/caption-finalizer.test.ts`

**Interfaces:**
- Consumes: `CaptionReplica` из `./caption-dom`.
- Produces: `CaptionEvent` (`{ type: 'interim' | 'final'; replica: CaptionReplica }`), `CAPTION_SILENCE_MS = 1500`, `CAPTION_DUPLICATE_WINDOW_MS = 10000`, класс `CaptionFinalizer` с методами `observe(key: string, replica: CaptionReplica, nowMs: number): CaptionEvent[]`, `detach(key: string, nowMs: number): CaptionEvent[]`, `tick(nowMs: number): CaptionEvent[]`, `reset(): void`.

Время передаётся аргументом, а не берётся из `Date.now()`: так тесты обходятся без `vi.useFakeTimers()` и проверяют именно правило, а не работу таймеров.

- [ ] **Step 1: Написать падающий тест**

Создать `caption-finalizer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CaptionFinalizer, CAPTION_SILENCE_MS } from './caption-finalizer';

const T0 = 1_700_000_000_000;
const SERGEY = { speaker: 'Сергей Чумеров', text: 'Идет подключение' };
const SERGEY_GROWN = { speaker: 'Сергей Чумеров', text: 'Идет подключение к субтитрам' };

describe('CaptionFinalizer', () => {
  it('первое появление блока — interim', () => {
    const finalizer = new CaptionFinalizer();
    expect(finalizer.observe('b1', SERGEY, T0)).toEqual([{ type: 'interim', replica: SERGEY }]);
  });

  it('рост фразы даёт новый interim и не финализирует', () => {
    // Meet переписывает один и тот же узел, пока уточняет распознавание. Если отправлять
    // каждую правку, в базе окажется по сегменту на каждое промежуточное состояние фразы.
    const finalizer = new CaptionFinalizer();
    finalizer.observe('b1', SERGEY, T0);
    const events = finalizer.observe('b1', SERGEY_GROWN, T0 + 400);
    expect(events).toEqual([{ type: 'interim', replica: SERGEY_GROWN }]);
  });

  it('повтор того же текста не рождает событий', () => {
    const finalizer = new CaptionFinalizer();
    finalizer.observe('b1', SERGEY, T0);
    expect(finalizer.observe('b1', SERGEY, T0 + 100)).toEqual([]);
  });

  it('тишина финализирует последнюю версию фразы', () => {
    const finalizer = new CaptionFinalizer();
    finalizer.observe('b1', SERGEY, T0);
    finalizer.observe('b1', SERGEY_GROWN, T0 + 400);

    expect(finalizer.tick(T0 + 400 + CAPTION_SILENCE_MS - 1)).toEqual([]);
    expect(finalizer.tick(T0 + 400 + CAPTION_SILENCE_MS)).toEqual([
      { type: 'final', replica: SERGEY_GROWN },
    ]);
  });

  it('открепление узла финализирует сразу, не дожидаясь тишины', () => {
    // Meet выкидывает старые блоки из скользящего окна — иногда раньше, чем истечёт тишина.
    const finalizer = new CaptionFinalizer();
    finalizer.observe('b1', SERGEY, T0);
    expect(finalizer.detach('b1', T0 + 200)).toEqual([{ type: 'final', replica: SERGEY }]);
  });

  it('не отдаёт финал дважды по одному блоку', () => {
    // Оба условия ведут к одному финалу: узел, уже отданный по тишине, при откреплении
    // не должен породить второй сегмент.
    const finalizer = new CaptionFinalizer();
    finalizer.observe('b1', SERGEY, T0);
    finalizer.tick(T0 + CAPTION_SILENCE_MS);
    expect(finalizer.detach('b1', T0 + CAPTION_SILENCE_MS + 100)).toEqual([]);
  });

  it('отбрасывает точный дубль в пределах окна', () => {
    // Meet иногда удаляет блок и добавляет заново с тем же текстом.
    const finalizer = new CaptionFinalizer();
    finalizer.observe('b1', SERGEY, T0);
    finalizer.detach('b1', T0 + 100);

    finalizer.observe('b2', SERGEY, T0 + 200);
    expect(finalizer.detach('b2', T0 + 300)).toEqual([]);
  });

  it('пропускает тот же текст, когда окно истекло', () => {
    // Человек правда может повторить фразу — вечная дедупликация теряла бы реплики.
    const finalizer = new CaptionFinalizer();
    finalizer.observe('b1', SERGEY, T0);
    finalizer.detach('b1', T0 + 100);

    finalizer.observe('b2', SERGEY, T0 + 11_000);
    expect(finalizer.detach('b2', T0 + 11_100)).toEqual([{ type: 'final', replica: SERGEY }]);
  });

  it('не считает продолжение фразы дублем', () => {
    // «да» → «да, ну» — легитимный рост, отсечение по префиксу теряло бы реальный текст.
    const finalizer = new CaptionFinalizer();
    const short = { speaker: 'Даниил Никишкин', text: 'Хмм ну' };
    const long = { speaker: 'Даниил Никишкин', text: 'Хмм ну, да, ну' };

    finalizer.observe('b1', short, T0);
    finalizer.detach('b1', T0 + 100);

    finalizer.observe('b2', long, T0 + 200);
    expect(finalizer.detach('b2', T0 + 300)).toEqual([{ type: 'final', replica: long }]);
  });

  it('различает одинаковый текст от разных людей', () => {
    const finalizer = new CaptionFinalizer();
    finalizer.observe('b1', { speaker: 'Вы', text: 'да' }, T0);
    finalizer.detach('b1', T0 + 50);

    finalizer.observe('b2', { speaker: 'Сергей Чумеров', text: 'да' }, T0 + 100);
    expect(finalizer.detach('b2', T0 + 150)).toEqual([
      { type: 'final', replica: { speaker: 'Сергей Чумеров', text: 'да' } },
    ]);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test --workspace=@skribo/extension -- caption-finalizer`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Реализовать модуль**

Создать `caption-finalizer.ts`:

```ts
import type { CaptionReplica } from './caption-dom';

// Когда реплика субтитров считается законченной (LS-36).
//
// Meet не сообщает «фраза финальна» — он просто переписывает узел, пока уточняет распознавание,
// и однажды выкидывает его из скользящего окна. Отсюда два признака конца: текст перестал
// меняться, или узел исчез. Время приходит аргументом, а не из Date.now(), чтобы правило можно
// было проверить тестом без таймеров.

export type CaptionEvent =
  | { type: 'interim'; replica: CaptionReplica }
  | { type: 'final'; replica: CaptionReplica };

/** Сколько текст должен не меняться, чтобы считаться законченным. */
export const CAPTION_SILENCE_MS = 1500;

/**
 * Окно, в котором точно такая же реплика того же человека считается повтором самого Meet, а не
 * второй фразой. Meet умеет удалить блок и добавить его заново — без этой гварды такая пара
 * превратилась бы в два одинаковых сегмента.
 */
export const CAPTION_DUPLICATE_WINDOW_MS = 10_000;

interface PendingBlock {
  replica: CaptionReplica;
  lastChangedAtMs: number;
  emitted: boolean;
}

export class CaptionFinalizer {
  private readonly pending = new Map<string, PendingBlock>();
  private recentFinals: Array<{ speaker: string; text: string; atMs: number }> = [];

  constructor(
    private readonly silenceMs: number = CAPTION_SILENCE_MS,
    private readonly duplicateWindowMs: number = CAPTION_DUPLICATE_WINDOW_MS,
  ) {}

  observe(key: string, replica: CaptionReplica, nowMs: number): CaptionEvent[] {
    const existing = this.pending.get(key);

    if (existing && existing.replica.text === replica.text && existing.replica.speaker === replica.speaker) {
      return [];
    }

    this.pending.set(key, { replica, lastChangedAtMs: nowMs, emitted: false });
    return [{ type: 'interim', replica }];
  }

  detach(key: string, nowMs: number): CaptionEvent[] {
    const entry = this.pending.get(key);
    if (!entry) return [];

    this.pending.delete(key);
    if (entry.emitted) return [];

    return this.emitFinal(entry.replica, nowMs);
  }

  tick(nowMs: number): CaptionEvent[] {
    const events: CaptionEvent[] = [];

    for (const entry of this.pending.values()) {
      if (entry.emitted) continue;
      if (nowMs - entry.lastChangedAtMs < this.silenceMs) continue;

      entry.emitted = true;
      events.push(...this.emitFinal(entry.replica, nowMs));
    }

    return events;
  }

  reset(): void {
    this.pending.clear();
    this.recentFinals = [];
  }

  private emitFinal(replica: CaptionReplica, nowMs: number): CaptionEvent[] {
    this.recentFinals = this.recentFinals.filter(
      (item) => nowMs - item.atMs <= this.duplicateWindowMs,
    );

    const isDuplicate = this.recentFinals.some(
      (item) => item.speaker === replica.speaker && item.text === replica.text,
    );
    if (isDuplicate) return [];

    this.recentFinals.push({ speaker: replica.speaker, text: replica.text, atMs: nowMs });
    return [{ type: 'final', replica }];
  }
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `npm test --workspace=@skribo/extension -- caption-finalizer`
Expected: PASS (10 тестов).

- [ ] **Step 5: Коммит**

```bash
git add packages/extension/src/content/platforms/meet/captions/caption-finalizer.ts packages/extension/src/content/platforms/meet/captions/caption-finalizer.test.ts
git commit -m "feat(extension): финализация фразы субтитров по тишине и откреплению (LS-36)"
```

---

### Task 6: Буфер отправки на время разрыва WebSocket

**Files:**
- Create: `packages/extension/src/content/platforms/meet/captions/caption-outbox.ts`
- Test: `packages/extension/src/content/platforms/meet/captions/caption-outbox.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `OutboxCaption` (`{ text: string; speaker: string | null; timestamp: number }`), `CAPTION_OUTBOX_LIMIT = 200`, класс `CaptionOutbox` с `enqueue(item: OutboxCaption): void`, `drain(): OutboxCaption[]`, геттерами `size: number` и `droppedCount: number`, методом `reset(): void`.

- [ ] **Step 1: Написать падающий тест**

Создать `caption-outbox.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CaptionOutbox, CAPTION_OUTBOX_LIMIT } from './caption-outbox';

function caption(text: string, timestamp = 0) {
  return { text, speaker: 'Вы', timestamp };
}

describe('CaptionOutbox', () => {
  it('отдаёт накопленное в порядке появления и очищается', () => {
    const outbox = new CaptionOutbox();
    outbox.enqueue(caption('первая'));
    outbox.enqueue(caption('вторая'));

    expect(outbox.drain().map((item) => item.text)).toEqual(['первая', 'вторая']);
    expect(outbox.size).toBe(0);
  });

  it('на переполнении выбрасывает самое старое и считает потерю', () => {
    // Разрыв может длиться долго; расти без предела нельзя, а терять свежий текст хуже,
    // чем самый старый — его пользователь уже видел в виджете.
    const outbox = new CaptionOutbox();
    for (let i = 0; i < CAPTION_OUTBOX_LIMIT + 2; i += 1) {
      outbox.enqueue(caption(`реплика ${i}`, i));
    }

    expect(outbox.size).toBe(CAPTION_OUTBOX_LIMIT);
    expect(outbox.droppedCount).toBe(2);
    expect(outbox.drain()[0].text).toBe('реплика 2');
  });

  it('reset чистит и очередь, и счётчик потерь', () => {
    const outbox = new CaptionOutbox();
    outbox.enqueue(caption('первая'));
    outbox.reset();

    expect(outbox.size).toBe(0);
    expect(outbox.droppedCount).toBe(0);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test --workspace=@skribo/extension -- caption-outbox`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Реализовать модуль**

Создать `caption-outbox.ts`:

```ts
// Очередь реплик, которые не удалось отправить (LS-36).
//
// В отличие от аудио, текст дёшев: пока WebSocket переустанавливается, реплики можно подержать
// и досдать после `resumeMeetingId`. Поэтому этот режим переживает разрыв лучше аудио-режимов,
// где потерянные секунды звука не восстановить.

export interface OutboxCaption {
  text: string;
  speaker: string | null;
  timestamp: number;
}

/** Предел очереди. Дальше выбрасывается самое старое — его пользователь уже видел в виджете. */
export const CAPTION_OUTBOX_LIMIT = 200;

export class CaptionOutbox {
  private queue: OutboxCaption[] = [];
  private dropped = 0;

  constructor(private readonly limit: number = CAPTION_OUTBOX_LIMIT) {}

  enqueue(item: OutboxCaption): void {
    this.queue.push(item);

    while (this.queue.length > this.limit) {
      this.queue.shift();
      this.dropped += 1;
    }
  }

  drain(): OutboxCaption[] {
    const items = this.queue;
    this.queue = [];
    return items;
  }

  get size(): number {
    return this.queue.length;
  }

  get droppedCount(): number {
    return this.dropped;
  }

  reset(): void {
    this.queue = [];
    this.dropped = 0;
  }
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `npm test --workspace=@skribo/extension -- caption-outbox`
Expected: PASS (3 теста).

- [ ] **Step 5: Коммит**

```bash
git add packages/extension/src/content/platforms/meet/captions/caption-outbox.ts packages/extension/src/content/platforms/meet/captions/caption-outbox.test.ts
git commit -m "feat(extension): буфер реплик субтитров на время разрыва WS (LS-36)"
```

---

### Task 7: Управление субтитрами Meet — включение, язык, скрытие, возврат

**Files:**
- Create: `packages/extension/src/content/platforms/meet/captions/caption-controls.ts`
- Test: `packages/extension/src/content/platforms/meet/captions/caption-controls.test.ts`

**Interfaces:**
- Consumes: `pickCaptionRegionIndex` из `./caption-dom`.
- Produces: чистые `matchesCaptionButtonLabel(label: string | null | undefined): boolean`, `meetCaptionLanguageValue(language: string): string | null`, `CAPTION_HIDDEN_STYLE` (строка инлайн-стиля); класс `MeetCaptionControls` с `readState(): { regionPresent: boolean; language: string | null }`, `enable(): Promise<boolean>`, `setLanguage(language: string): boolean`, `hide(): void`, `findRegion(): HTMLElement | null`, `restore(): Promise<void>`.

DOM-часть класса юнит-тестами не покрывается: без `jsdom` её нечем исполнить, а мокать `document` целиком значило бы тестировать мок. Она проверяется в живом Meet по чек-листу спеки; тестами закрыты чистые правила, где и живут ошибки (локализованная подпись кнопки, допустимый код языка).

- [ ] **Step 1: Написать падающий тест**

Создать `caption-controls.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { matchesCaptionButtonLabel, meetCaptionLanguageValue } from './caption-controls';

describe('matchesCaptionButtonLabel', () => {
  it('узнаёт русскую подпись кнопки', () => {
    expect(matchesCaptionButtonLabel('Включить субтитры')).toBe(true);
    expect(matchesCaptionButtonLabel('Отключить субтитры')).toBe(true);
  });

  it('узнаёт английскую подпись', () => {
    expect(matchesCaptionButtonLabel('Turn on captions')).toBe(true);
    expect(matchesCaptionButtonLabel('Turn off caption')).toBe(true);
  });

  it('не путает с настройками субтитров', () => {
    // Кнопка «Открыть настройки субтитров» существует рядом и открывает диалог, а не включает
    // субтитры: клик по ней оставил бы режим без текста и с открытым чужим окном.
    expect(matchesCaptionButtonLabel('Открыть настройки субтитров')).toBe(false);
    expect(matchesCaptionButtonLabel('Caption settings')).toBe(false);
  });

  it('спокоен к пустому значению', () => {
    expect(matchesCaptionButtonLabel(null)).toBe(false);
    expect(matchesCaptionButtonLabel(undefined)).toBe(false);
    expect(matchesCaptionButtonLabel('')).toBe(false);
  });
});

describe('meetCaptionLanguageValue', () => {
  it('коды виджета совпадают с data-value в меню Meet', () => {
    expect(meetCaptionLanguageValue('ru-RU')).toBe('ru-RU');
    expect(meetCaptionLanguageValue('en-US')).toBe('en-US');
  });

  it('незнакомый язык не выставляем', () => {
    // Лучше оставить язык Meet как есть, чем кликнуть по случайному пункту списка.
    expect(meetCaptionLanguageValue('de-DE')).toBeNull();
    expect(meetCaptionLanguageValue('')).toBeNull();
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test --workspace=@skribo/extension -- caption-controls`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Реализовать модуль**

Создать `caption-controls.ts`:

```ts
import { pickCaptionRegionIndex } from './caption-dom';

// Включение, язык и скрытие субтитров Meet (LS-36).
//
// Здесь расширение трогает чужой UI, поэтому правило одно: возвращаем всё, что тронули, и
// трогаем только то, что включили сами. Субтитры, включённые пользователем до старта, остаются
// как есть — он их читает.

const CAPTION_BUTTON_LABEL = /субтитр|captions?\b/i;
const CAPTION_SETTINGS_LABEL = /настройк|settings/i;

/**
 * Похожа ли подпись на кнопку включения субтитров. Рядом живёт «Открыть настройки субтитров» —
 * она тоже про субтитры, но открывает диалог, а не включает их.
 */
export function matchesCaptionButtonLabel(label: string | null | undefined): boolean {
  const value = label?.trim();
  if (!value) return false;
  if (CAPTION_SETTINGS_LABEL.test(value)) return false;
  return CAPTION_BUTTON_LABEL.test(value);
}

/**
 * Значение `data-value` в списке языков Meet для языка виджета.
 *
 * `data-value` несёт настоящий код локали (`ru-RU`, `en-US`) и не обфусцирован — самый надёжный
 * селектор во всей затее. Незнакомый язык даёт `null`: лучше не менять язык вовсе, чем кликнуть
 * по случайному пункту.
 */
export function meetCaptionLanguageValue(language: string): string | null {
  return language === 'ru-RU' || language === 'en-US' ? language : null;
}

/**
 * Смещение за вьюпорт вместо `display: none`: скрытый через `display` список Meet может
 * перестать наполняться (ленивый рендер), и поток данных оборвётся вместе с картинкой.
 */
export const CAPTION_HIDDEN_STYLE = 'position: fixed !important; left: -10000px !important; top: 0 !important;';

const REGION_WAIT_TIMEOUT_MS = 5000;
const REGION_POLL_INTERVAL_MS = 150;

interface CaptionControlsState {
  regionPresent: boolean;
  language: string | null;
}

export class MeetCaptionControls {
  private enabledByUs = false;
  private hiddenRegion: HTMLElement | null = null;
  private originalLanguage: string | null = null;
  private languageChangedByUs = false;
  private styleGuardObserver: MutationObserver | null = null;

  /** Регион субтитров: из кандидатов `[role="region"]` берётся тот, где больше всего блоков. */
  findRegion(): HTMLElement | null {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>('[role="region"]'),
    );
    const blockCounts = candidates.map((region) => this.countBlocks(region));
    const index = pickCaptionRegionIndex(blockCounts);
    return index === null ? null : candidates[index];
  }

  /** Блок реплики — контейнер с аватаром и текстом. Считаем аватары: их ровно по одному на блок. */
  private countBlocks(region: HTMLElement): number {
    return region.querySelectorAll('img').length;
  }

  readState(): CaptionControlsState {
    return {
      regionPresent: this.findRegion() !== null,
      language: this.readCurrentLanguage(),
    };
  }

  private readCurrentLanguage(): string | null {
    const selected = document.querySelector<HTMLElement>(
      '[role="option"][aria-selected="true"][data-value]',
    );
    return selected?.getAttribute('data-value') ?? null;
  }

  /**
   * Включить субтитры, если они выключены. Возвращает `false`, если регион так и не появился —
   * вызывающий код обязан показать это пользователю, а не молча читать пустоту.
   */
  async enable(): Promise<boolean> {
    if (this.findRegion()) return true;

    const button = Array.from(document.querySelectorAll<HTMLElement>('button[aria-label]')).find(
      (candidate) => matchesCaptionButtonLabel(candidate.getAttribute('aria-label')),
    );

    if (button) {
      button.click();
    } else {
      // Фолбэк на горячую клавишу Meet: подпись кнопки обфусцируется реже, чем классы, но
      // и она однажды сменится.
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'c', bubbles: true, cancelable: true }),
      );
    }

    const appeared = await this.waitForRegion();
    this.enabledByUs = appeared;
    return appeared;
  }

  private async waitForRegion(): Promise<boolean> {
    const deadline = Date.now() + REGION_WAIT_TIMEOUT_MS;

    while (Date.now() < deadline) {
      if (this.findRegion()) return true;
      await new Promise((resolve) => setTimeout(resolve, REGION_POLL_INTERVAL_MS));
    }

    return this.findRegion() !== null;
  }

  /** Выставить язык субтитров. Вызывается только когда субтитры включили мы. */
  setLanguage(language: string): boolean {
    const value = meetCaptionLanguageValue(language);
    if (!value) return false;

    const current = this.readCurrentLanguage();
    if (current === value) return true;

    const combobox = document.querySelector<HTMLElement>('[role="combobox"]');
    combobox?.click();

    const option = document.querySelector<HTMLElement>(`[role="option"][data-value="${value}"]`);
    if (!option) return false;

    if (!this.languageChangedByUs) {
      this.originalLanguage = current;
      this.languageChangedByUs = true;
    }

    option.click();
    return true;
  }

  /** Убрать регион с экрана и удерживать его скрытым: Meet перерисовывает узлы и сбрасывает стиль. */
  hide(): void {
    const region = this.findRegion();
    if (!region) return;

    this.hiddenRegion = region;
    region.setAttribute('style', CAPTION_HIDDEN_STYLE);

    this.styleGuardObserver?.disconnect();
    this.styleGuardObserver = new MutationObserver(() => {
      if (!this.hiddenRegion) return;
      if (this.hiddenRegion.getAttribute('style') !== CAPTION_HIDDEN_STYLE) {
        this.hiddenRegion.setAttribute('style', CAPTION_HIDDEN_STYLE);
      }
    });
    this.styleGuardObserver.observe(region, { attributes: true, attributeFilter: ['style'] });
  }

  /** Вернуть UI Meet в исходное состояние. Обязано выполняться даже на ошибке пути старта. */
  async restore(): Promise<void> {
    this.styleGuardObserver?.disconnect();
    this.styleGuardObserver = null;

    if (this.hiddenRegion) {
      this.hiddenRegion.removeAttribute('style');
      this.hiddenRegion = null;
    }

    if (this.languageChangedByUs && this.originalLanguage) {
      this.setLanguageRaw(this.originalLanguage);
    }
    this.languageChangedByUs = false;
    this.originalLanguage = null;

    if (this.enabledByUs) {
      const button = Array.from(
        document.querySelectorAll<HTMLElement>('button[aria-label]'),
      ).find((candidate) => matchesCaptionButtonLabel(candidate.getAttribute('aria-label')));
      button?.click();
      this.enabledByUs = false;
    }
  }

  private setLanguageRaw(value: string): void {
    const combobox = document.querySelector<HTMLElement>('[role="combobox"]');
    combobox?.click();
    document.querySelector<HTMLElement>(`[role="option"][data-value="${value}"]`)?.click();
  }
}
```

- [ ] **Step 4: Прогнать тесты и типы**

Run: `npm test --workspace=@skribo/extension -- caption-controls`
Expected: PASS (6 тестов).

Run: `npm run type-check`
Expected: без ошибок.

- [ ] **Step 5: Коммит**

```bash
git add packages/extension/src/content/platforms/meet/captions/caption-controls.ts packages/extension/src/content/platforms/meet/captions/caption-controls.test.ts
git commit -m "feat(extension): включение, язык и скрытие субтитров Meet с возвратом состояния (LS-36)"
```

---

### Task 8: Чтение субтитров из DOM и состояние здоровья режима

**Files:**
- Create: `packages/extension/src/content/platforms/meet/captions/caption-health.ts`
- Create: `packages/extension/src/content/platforms/meet/captions/caption-reader.ts`
- Test: `packages/extension/src/content/platforms/meet/captions/caption-health.test.ts`

**Interfaces:**
- Consumes: `parseCaptionBlock`, `CaptionBlockView`, `CaptionReplica` из `./caption-dom`; `CaptionFinalizer`, `CaptionEvent` из `./caption-finalizer`; `MeetCaptionControls` из `./caption-controls`.
- Produces: `CaptionHealthKind` (`'hidden' | 'warning' | 'error'`), `CaptionHealthState` (`{ kind: CaptionHealthKind; text: string }`), `CAPTION_SILENT_LIMIT_MS = 60000`, `CAPTION_HEALTH_TEXT` (`{ noRegion, silent }`), `captionHealthState(input: { regionPresent: boolean; msSinceLastReplica: number | null }): CaptionHealthState`, `captionLanguageMismatchText(current, wanted): string`, `captionLanguageMismatchState(current: string | null, wanted: string): CaptionHealthState`; класс `MeetCaptionReader` с `start(handlers: { onInterim(replica): void; onFinal(replica): void; onHealth(state): void }): boolean`, `stop(): void`.

- [ ] **Step 1: Написать падающий тест**

Создать `caption-health.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  captionHealthState,
  captionLanguageMismatchState,
  CAPTION_HEALTH_TEXT,
  CAPTION_SILENT_LIMIT_MS,
} from './caption-health';

describe('captionHealthState', () => {
  it('молчит, когда реплики идут', () => {
    expect(captionHealthState({ regionPresent: true, msSinceLastReplica: 2_000 })).toEqual({
      kind: 'hidden',
      text: '',
    });
  });

  it('ошибка, когда региона субтитров нет', () => {
    // Молча читать пустоту нельзя: человек будет думать, что встреча записывается.
    expect(captionHealthState({ regionPresent: false, msSinceLastReplica: null })).toEqual({
      kind: 'error',
      text: CAPTION_HEALTH_TEXT.noRegion,
    });
  });

  it('предупреждение, когда регион есть, но текста давно нет', () => {
    // Скорее всего сменилась разметка Meet и разбор перестал находить блоки.
    expect(
      captionHealthState({ regionPresent: true, msSinceLastReplica: CAPTION_SILENT_LIMIT_MS }),
    ).toEqual({ kind: 'warning', text: CAPTION_HEALTH_TEXT.silent });
  });

  it('терпит тишину до предела — в переговорах бывают паузы', () => {
    expect(
      captionHealthState({ regionPresent: true, msSinceLastReplica: CAPTION_SILENT_LIMIT_MS - 1 }),
    ).toEqual({ kind: 'hidden', text: '' });
  });

  it('не паникует, пока не было ни одной реплики', () => {
    expect(captionHealthState({ regionPresent: true, msSinceLastReplica: null })).toEqual({
      kind: 'hidden',
      text: '',
    });
  });
});

describe('captionLanguageMismatchState', () => {
  it('молчит, когда язык совпадает', () => {
    expect(captionLanguageMismatchState('ru-RU', 'ru-RU')).toEqual({ kind: 'hidden', text: '' });
  });

  it('предупреждает о расхождении, называя оба языка', () => {
    // Язык субтитров, которые человек читает сам, мы не переключаем — но промолчать нельзя:
    // расхождение выглядит как поломка распознавания, а не как настройка Meet.
    const state = captionLanguageMismatchState('en-US', 'ru-RU');
    expect(state.kind).toBe('warning');
    expect(state.text).toContain('en-US');
    expect(state.text).toContain('ru-RU');
  });

  it('молчит, когда язык субтитров прочитать не удалось', () => {
    // Пустое предупреждение хуже отсутствия: пугает, а делать с ним нечего.
    expect(captionLanguageMismatchState(null, 'ru-RU')).toEqual({ kind: 'hidden', text: '' });
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test --workspace=@skribo/extension -- caption-health`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Реализовать `caption-health.ts`**

```ts
// Здоровье режима субтитров (LS-36).
//
// Единственный признак поломки — текст перестал приходить. Разметка Meet обфусцирована и
// однажды сменится, поэтому режим обязан сказать об этом вслух: тихая пустота выглядит как
// «встреча записывается», и человек узнает правду только в кабинете.

export type CaptionHealthKind = 'hidden' | 'warning' | 'error';

export interface CaptionHealthState {
  kind: CaptionHealthKind;
  text: string;
}

/** Сколько терпим тишину при живом регионе: в переговорах бывают долгие паузы. */
export const CAPTION_SILENT_LIMIT_MS = 60_000;

export const CAPTION_HEALTH_TEXT = {
  noRegion: 'Субтитры Meet не открылись — включите их в меню встречи.',
  silent: 'Субтитры Meet не читаются: текст не приходит. Проверьте, включены ли они.',
} as const;

export function captionLanguageMismatchText(current: string, wanted: string): string {
  return `Субтитры Meet идут на ${current}, а в Skribo выбран ${wanted}. Язык включённых вами субтитров мы не меняем — переключите его в Meet или смените язык в виджете.`;
}

/**
 * Расхождение языка субтитров с выбранным в виджете.
 *
 * Субтитры, включённые пользователем, мы не переключаем — смена языка подменила бы текст у него
 * на экране посреди встречи. Но и молчать нельзя: расхождение выглядит как поломка
 * распознавания, а не как настройка Meet.
 */
export function captionLanguageMismatchState(
  current: string | null,
  wanted: string,
): CaptionHealthState {
  if (!current || current === wanted) return { kind: 'hidden', text: '' };
  return { kind: 'warning', text: captionLanguageMismatchText(current, wanted) };
}

export function captionHealthState(input: {
  regionPresent: boolean;
  msSinceLastReplica: number | null;
}): CaptionHealthState {
  if (!input.regionPresent) {
    return { kind: 'error', text: CAPTION_HEALTH_TEXT.noRegion };
  }

  if (input.msSinceLastReplica !== null && input.msSinceLastReplica >= CAPTION_SILENT_LIMIT_MS) {
    return { kind: 'warning', text: CAPTION_HEALTH_TEXT.silent };
  }

  return { kind: 'hidden', text: '' };
}
```

- [ ] **Step 4: Реализовать `caption-reader.ts`**

```ts
import { parseCaptionBlock, type CaptionBlockView, type CaptionReplica } from './caption-dom';
import { CaptionFinalizer } from './caption-finalizer';
import { MeetCaptionControls } from './caption-controls';
import { captionHealthState, type CaptionHealthState } from './caption-health';

// Тонкий DOM-слой над чистым ядром (LS-36): наблюдает регион субтитров, снимает с каждого блока
// две строки (текст поддерева с аватаром и полный текст) и отдаёт их в разбор. Логики здесь
// намеренно нет — она в caption-dom / caption-finalizer, где её проверяют тесты.

const TICK_INTERVAL_MS = 500;

interface CaptionReaderHandlers {
  onInterim: (replica: CaptionReplica) => void;
  onFinal: (replica: CaptionReplica) => void;
  onHealth: (state: CaptionHealthState) => void;
}

export class MeetCaptionReader {
  private readonly finalizer = new CaptionFinalizer();
  private readonly blockKeys = new WeakMap<Element, string>();
  private observer: MutationObserver | null = null;
  private tickTimerId: number | null = null;
  private handlers: CaptionReaderHandlers | null = null;
  private nextKey = 0;
  private lastReplicaAtMs: number | null = null;
  /** Ключи блоков, живых на предыдущем обходе: их исчезновение и есть конец фразы. */
  private liveKeys = new Set<string>();

  constructor(private readonly controls: MeetCaptionControls) {}

  start(handlers: CaptionReaderHandlers): boolean {
    this.stop();
    this.handlers = handlers;

    const region = this.controls.findRegion();
    if (!region) {
      handlers.onHealth(captionHealthState({ regionPresent: false, msSinceLastReplica: null }));
      return false;
    }

    this.observer = new MutationObserver(() => this.scan(region, Date.now()));
    this.observer.observe(region, { subtree: true, childList: true, characterData: true });

    this.tickTimerId = window.setInterval(() => {
      const now = Date.now();
      this.emit(this.finalizer.tick(now));
      this.reportHealth();
    }, TICK_INTERVAL_MS);

    this.scan(region, Date.now());
    return true;
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;

    if (this.tickTimerId !== null) {
      clearInterval(this.tickTimerId);
      this.tickTimerId = null;
    }

    // Незакрытые фразы дописываем: человек их уже произнёс и увидел в виджете.
    this.emit(this.flushPending());
    this.finalizer.reset();
    this.handlers = null;
    this.lastReplicaAtMs = null;
  }

  private flushPending(): ReturnType<CaptionFinalizer['tick']> {
    // Тишина в прошлом — tick с далёким будущим финализирует всё, что ещё висит.
    return this.finalizer.tick(Date.now() + 60_000);
  }

  private scan(region: HTMLElement, nowMs: number): void {
    const blocks = Array.from(region.querySelectorAll<HTMLElement>('img'))
      .map((avatar) => this.blockOf(avatar))
      .filter((block): block is HTMLElement => block !== null);

    const seenBlocks = new Set<Element>();
    const seenKeys = new Set<string>();

    for (const block of blocks) {
      if (seenBlocks.has(block)) continue;
      seenBlocks.add(block);

      const view = this.viewOf(block);
      if (!view) continue;

      const replica = parseCaptionBlock(view);
      if (!replica) continue;

      const key = this.keyOf(block);
      seenKeys.add(key);
      this.emit(this.finalizer.observe(key, replica, nowMs));
    }

    // Блок, пропавший между обходами, Meet выкинул из скользящего окна — фраза закончена, и
    // ждать тишины незачем. Сравнение наборов ключей дешевле и надёжнее, чем ловить
    // `removedNodes`: удаление приходит поддеревьями, и сопоставлять их с блоками пришлось бы
    // вручную.
    for (const key of this.liveKeys) {
      if (seenKeys.has(key)) continue;
      this.emit(this.finalizer.detach(key, nowMs));
    }

    this.liveKeys = seenKeys;
  }

  /**
   * Блок реплики — ближайший предок аватара, в котором уже есть текст самой реплики. Идём вверх
   * от `img`, пока текст поддерева не станет длиннее имени: так блок находится без опоры на
   * обфусцированные классы.
   */
  private blockOf(avatar: HTMLElement): HTMLElement | null {
    const nameText = (avatar.parentElement?.textContent ?? '').trim();
    let node: HTMLElement | null = avatar.parentElement;

    for (let depth = 0; node && depth < 5; depth += 1) {
      const text = (node.textContent ?? '').trim();
      if (text.length > nameText.length) return node;
      node = node.parentElement;
    }

    return null;
  }

  private viewOf(block: HTMLElement): CaptionBlockView | null {
    const avatar = block.querySelector('img');
    const avatarSubtree = avatar?.parentElement;
    if (!avatarSubtree) return null;

    return {
      avatarSubtreeText: avatarSubtree.textContent ?? '',
      fullText: block.textContent ?? '',
    };
  }

  private keyOf(block: HTMLElement): string {
    const existing = this.blockKeys.get(block);
    if (existing) return existing;

    this.nextKey += 1;
    const key = `block_${this.nextKey}`;
    this.blockKeys.set(block, key);
    return key;
  }

  private emit(events: ReturnType<CaptionFinalizer['tick']>): void {
    const handlers = this.handlers;
    if (!handlers) return;

    for (const event of events) {
      if (event.type === 'interim') {
        this.lastReplicaAtMs = Date.now();
        handlers.onInterim(event.replica);
      } else {
        this.lastReplicaAtMs = Date.now();
        handlers.onFinal(event.replica);
      }
    }
  }

  private reportHealth(): void {
    const handlers = this.handlers;
    if (!handlers) return;

    handlers.onHealth(
      captionHealthState({
        regionPresent: this.controls.findRegion() !== null,
        msSinceLastReplica:
          this.lastReplicaAtMs === null ? null : Date.now() - this.lastReplicaAtMs,
      }),
    );
  }
}
```

Оба признака конца фразы задействованы: `tick` закрывает по тишине, а `scan` — по исчезновению блока из набора живых ключей. `removedNodes` не слушаем намеренно: Meet удаляет поддеревьями, и сопоставлять их с блоками пришлось бы вручную, тогда как сравнение наборов ключей даёт тот же ответ дешевле. Правило «финал ровно один на блок» держит `CaptionFinalizer` и проверяет `caption-finalizer.test.ts`.

В `stop()` `liveKeys` тоже надо очистить — добавить `this.liveKeys = new Set();` рядом с `this.lastReplicaAtMs = null;`, иначе следующий запуск принял бы ключи прошлой сессии за исчезнувшие блоки.

- [ ] **Step 5: Прогнать тесты и типы**

Run: `npm test --workspace=@skribo/extension -- caption-health`
Expected: PASS (8 тестов).

Run: `npm run type-check`
Expected: без ошибок.

- [ ] **Step 6: Коммит**

```bash
git add packages/extension/src/content/platforms/meet/captions/caption-health.ts packages/extension/src/content/platforms/meet/captions/caption-health.test.ts packages/extension/src/content/platforms/meet/captions/caption-reader.ts
git commit -m "feat(extension): чтение субтитров Meet из DOM и индикация отказа (LS-36)"
```

---

### Task 9: Транспорт реплик и третий вариант в виджете

**Files:**
- Create: `packages/extension/src/content/platforms/meet/recording/caption-mode-controller.ts`
- Modify: `packages/extension/src/content/platform/platform-adapter.ts`
- Modify: `packages/extension/src/content/content.ts`
- Modify: `packages/extension/src/background/service-worker.ts`
- Modify: `packages/extension/src/offscreen/offscreen.ts`

**Interfaces:**
- Consumes: всё из задач 3–8; существующие `appendTranscriptReplica`, `updateTranscript`, `normalizeSpeaker`, `getSelectedLanguage`, `partialReplica`, `sttBannerKind`/`sttBannerText`/`renderSttStatusBanner`, `updateStatus`, `platformAdapter`, `contentSessionId`; `meetCaptionLanguageValue` из Task 7 и `captionLanguageMismatchState` из Task 8.
- Produces: `MeetCaptionModeController` с `start(): Promise<boolean>`, `stop(): Promise<void>`, `flushOutbox(sessionId: string): void`; сообщения `CAPTION_FINAL` (content → service worker) и `OFFSCREEN_CAPTION` (service worker → offscreen); метод адаптера `getCaptionModeController()`.

- [ ] **Step 1: Провести `caption` через offscreen**

В `packages/extension/src/offscreen/offscreen.ts` в `switch` перед `case 'OFFSCREEN_TRACK_AUDIO_CHUNK':` вставить:

```ts
    case 'OFFSCREEN_CAPTION':
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        sendResponse({ error: 'WebSocket is not connected. Please connect first.' });
        return true;
      }

      if (!message.sessionId || !message.text) {
        sendResponse({ error: 'Invalid caption payload' });
        return true;
      }

      sendMessage({
        type: 'caption',
        sessionId: message.sessionId,
        text: message.text,
        speaker: message.speaker ?? null,
        timestamp: message.timestamp ?? Date.now(),
      } as any);

      sendResponse({ success: true });
      return true;
```

В `case 'OFFSCREEN_START_SESSION'` в объект `sendMessage({ type: 'start', … })` добавить `transcriptSource: message.transcriptSource,` после `audioMode: message.audioMode,`.

- [ ] **Step 2: Провести `caption` через service worker**

В `packages/extension/src/background/service-worker.ts` перед блоком `if (message.type === 'TRACK_AUDIO_CHUNK') {` вставить:

```ts
  if (message.type === 'CAPTION_FINAL') {
    // Реплика уже нарисована в виджете; здесь её единственная задача — доехать до базы.
    sendToOffscreen({
      type: 'OFFSCREEN_CAPTION',
      sessionId: message.sessionId,
      text: message.text,
      speaker: message.speaker ?? null,
      timestamp: message.timestamp,
    })
      .then((response) => sendResponse(response ?? { success: true }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
```

- [ ] **Step 3: Написать контроллер режима**

Создать `packages/extension/src/content/platforms/meet/recording/caption-mode-controller.ts`:

```ts
import { MeetCaptionControls, meetCaptionLanguageValue } from '../captions/caption-controls';
import { MeetCaptionReader } from '../captions/caption-reader';
import { CaptionOutbox } from '../captions/caption-outbox';
import { captionLanguageMismatchState } from '../captions/caption-health';
import type { CaptionReplica } from '../captions/caption-dom';
import type { CaptionHealthState } from '../captions/caption-health';

// Оркестратор режима субтитров (LS-36) — зеркало MeetTrackModeController для аудио-дорожек.
//
// Порядок на старте важен: сначала приводим UI Meet в нужное состояние, и только если это
// удалось — начинаем сессию. Иначе можно записать «встречу», в которой не будет ни строки.

interface CaptionModeControllerParams {
  getIsCapturing: () => boolean;
  getSessionId: () => string | null;
  getSelectedLanguage: () => string;
  onInterim: (replica: CaptionReplica) => void;
  onFinal: (replica: CaptionReplica) => void;
  onHealth: (state: CaptionHealthState) => void;
}

export class MeetCaptionModeController {
  private readonly controls = new MeetCaptionControls();
  private readonly reader = new MeetCaptionReader(this.controls);
  private readonly outbox = new CaptionOutbox();
  private active = false;

  constructor(private readonly params: CaptionModeControllerParams) {}

  /** `false` означает «субтитры не поднялись» — вызывающий код обязан не начинать запись. */
  async start(): Promise<boolean> {
    const before = this.controls.readState();

    try {
      if (!before.regionPresent) {
        const enabled = await this.controls.enable();
        if (!enabled) {
          await this.controls.restore();
          return false;
        }

        // Язык и видимость меняем только у субтитров, которые включили сами: у человека,
        // читающего субтитры, подмена языка сменила бы текст на экране посреди встречи.
        this.controls.setLanguage(this.params.getSelectedLanguage());
        this.controls.hide();
      } else {
        // Субтитры уже включены пользователем: не трогаем ни видимость, ни язык — но если язык
        // расходится с выбранным, говорим об этом, иначе это выглядит как поломка распознавания.
        const wanted = meetCaptionLanguageValue(this.params.getSelectedLanguage());
        if (wanted) {
          const mismatch = captionLanguageMismatchState(before.language, wanted);
          if (mismatch.kind !== 'hidden') this.params.onHealth(mismatch);
        }
      }

      const started = this.reader.start({
        onInterim: this.params.onInterim,
        onFinal: (replica) => this.handleFinal(replica),
        onHealth: this.params.onHealth,
      });

      if (!started) {
        await this.controls.restore();
        return false;
      }

      this.active = true;
      window.addEventListener('beforeunload', this.handleUnload);
      return true;
    } catch (err) {
      console.warn('[Skribo][Meet][Captions] failed to start:', err);
      await this.controls.restore();
      return false;
    }
  }

  async stop(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    window.removeEventListener('beforeunload', this.handleUnload);

    this.reader.stop();
    this.outbox.reset();
    await this.controls.restore();
  }

  /** Досдать реплики, накопленные пока WebSocket переустанавливался. */
  flushOutbox(sessionId: string): void {
    for (const item of this.outbox.drain()) {
      this.send(sessionId, item.text, item.speaker, item.timestamp);
    }
  }

  private handleFinal(replica: CaptionReplica): void {
    this.params.onFinal(replica);

    const sessionId = this.params.getSessionId();
    const timestamp = Date.now();

    if (!sessionId || !this.params.getIsCapturing()) {
      this.outbox.enqueue({ text: replica.text, speaker: replica.speaker, timestamp });
      return;
    }

    this.send(sessionId, replica.text, replica.speaker, timestamp);
  }

  private send(sessionId: string, text: string, speaker: string | null, timestamp: number): void {
    chrome.runtime
      .sendMessage({ type: 'CAPTION_FINAL', sessionId, text, speaker, timestamp })
      .then((response) => {
        if (response?.error) {
          this.outbox.enqueue({ text, speaker, timestamp });
        }
      })
      .catch(() => {
        // Сервис-воркер спал или сокет закрыт — придержим и досдадим после resume.
        this.outbox.enqueue({ text, speaker, timestamp });
      });
  }

  private readonly handleUnload = (): void => {
    // Нельзя оставить пользователю спрятанный чужой UI. Синхронно, без await: во время
    // beforeunload асинхронный хвост уже не выполнится.
    void this.controls.restore();
  };
}
```

- [ ] **Step 4: Отдать контроллер через адаптер платформы**

В `packages/extension/src/content/platform/platform-adapter.ts`:
- добавить импорт `import { MeetCaptionModeController } from '../platforms/meet/recording/caption-mode-controller';` и типы `import type { CaptionReplica } from '../platforms/meet/captions/caption-dom';`, `import type { CaptionHealthState } from '../platforms/meet/captions/caption-health';`;
- в `PlatformAdapterParams` добавить:

```ts
  getSelectedLanguage: () => string;
  onCaptionInterim: (replica: CaptionReplica) => void;
  onCaptionFinal: (replica: CaptionReplica) => void;
  onCaptionHealth: (state: CaptionHealthState) => void;
```

- в `PlatformAdapter` добавить `getCaptionModeController: () => MeetCaptionModeController | null;`;
- в теле `createPlatformAdapter` перед `return` добавить:

```ts
  const captionModeController =
    platform === 'meet'
      ? new MeetCaptionModeController({
          getIsCapturing: params.getIsCapturing,
          getSessionId: params.getSessionId,
          getSelectedLanguage: params.getSelectedLanguage,
          onInterim: params.onCaptionInterim,
          onFinal: params.onCaptionFinal,
          onHealth: params.onCaptionHealth,
        })
      : null;
```

- в возвращаемом объекте добавить `getCaptionModeController: () => captionModeController,`.

- [ ] **Step 5: Собрать всё в виджете**

В `packages/extension/src/content/content.ts`:

**5.1.** В создание `platformAdapter` (строка ~45) добавить новые колбэки:

```ts
const platformAdapter = createPlatformAdapter({
  getIsCapturing: () => isCapturing,
  getSessionId: () => contentSessionId,
  getSelectedLanguage: () => getSelectedLanguage(),
  onCaptionInterim: (replica) => {
    partialReplica = { speaker: normalizeSpeaker(replica.speaker), text: replica.text };
    updateTranscript();
  },
  onCaptionFinal: (replica) => {
    partialReplica = null;
    // Тот же путь, что у финалов Deepgram: триггеры LS-14 живут внутри и должны работать здесь
    // ровно так же.
    appendTranscriptReplica(normalizeSpeaker(replica.speaker), replica.text, Date.now());
    updateTranscript();
  },
  onCaptionHealth: (state) => {
    // `CaptionHealthKind` — подмножество `SttBannerKind`, поэтому переиспользуем готовую
    // отрисовку полоски (LS-04) вместо второго механизма показа предупреждений.
    sttBannerKind = state.kind;
    sttBannerText = state.text;
    renderSttStatusBanner();
  },
});
const captionModeController = platformAdapter.getCaptionModeController();
```

**5.2.** В `<select id="livescribe-audio-mode">` после строки с `Mixed` добавить третий вариант:

```ts
        ${platformAdapter.supportsCaptionSourceSelection()
          ? `<option value="meet-captions" ${selectedAudioMode === 'meet-captions' ? 'selected' : ''}>Субтитры Meet (без Deepgram)</option>`
          : ''}
```

Объявление `selectedAudioMode` уже переведено на `getTranscriptSource()` в Task 3 — здесь его не трогать.

**5.3.** Обработчик `change` селектора заменить на:

```ts
  document.getElementById('livescribe-audio-mode')?.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement;
      if (
        target.value === 'mixed' ||
        target.value === 'per-track' ||
        target.value === 'meet-captions'
      ) {
        platformAdapter.setTranscriptSource(target.value);
        console.log('[Skribo] transcript source changed', {
          platform: platformAdapter.getPlatform(),
          source: target.value,
        });
      }
    });
```

**5.4.** В `handleStart` поднять режим субтитров **до** старта записи:

```ts
async function handleStart() {
  if (!recordingController) return;

  const usingCaptions = platformAdapter.getTranscriptSource() === 'meet-captions';
  if (usingCaptions && captionModeController) {
    const ready = await captionModeController.start();
    if (!ready) {
      // Молчаливого перехода на Deepgram нет: пользователь выбрал бесплатный источник,
      // тихий переход на платный — это и деньги, и приватность.
      updateStatus('error', 'Субтитры Meet не открылись — включите их в меню встречи.');
      return;
    }
  }

  await recordingController.start();
  if (isCapturing && !recordingStartedAtMs) {
    recordingStartedAtMs = Date.now();
    startMetricsTicker();
    renderAudioMetrics();
  }
}
```

**5.5.** В `handleStop` добавить остановку режима первой строкой после проверки контроллера:

```ts
async function handleStop() {
  if (!recordingController) return;
  await captionModeController?.stop();
  await recordingController.stop();
```

**5.6.** В обработчике сообщений от сервис-воркера, где `wsMessage.type === 'status' && wsMessage.sessionId` (строка ~1562), после `trackModeController.ensureStarted('ws:status');` добавить:

```ts
      captionModeController?.flushOutbox(wsMessage.sessionId);
```

**5.7.** Депсы `RecordingController` уже переведены на `getTranscriptSource` в Task 3 — здесь их не трогать.

- [ ] **Step 6: Прогнать всё**

Run: `npm test --workspace=@skribo/extension`
Expected: PASS.

Run: `npm run type-check`
Expected: без ошибок.

Run: `npm run build:extension:dev`
Expected: успешная сборка `dist-dev/`.

- [ ] **Step 7: Коммит**

```bash
git add packages/extension/src
git commit -m "feat(extension): режим субтитров Meet в виджете и доставка реплик в бэкенд (LS-36)"
```

---

### Task 10: Документация и чек-лист проверки

**Files:**
- Modify: `docs/backlog.md`
- Modify: `docs/PROGRESS.md`
- Modify: `docs/KNOWLEDGE.md`
- Modify: `AGENTS.md` (архитектура живёт здесь; `CLAUDE.md` — только отсылка к нему на 85 байт, его не трогать)

- [ ] **Step 1: Отметить LS-36 сделанным в бэклоге**

В `docs/backlog.md` заменить `- [ ] LS-36 —` на `- [x] LS-36 —` и дописать в конец записи:

```markdown
  Сделано: чистое ядро в `content/platforms/meet/captions/` (`caption-dom` — разбор блока по
  структуре, без классов Meet; `caption-finalizer` — конец фразы по тишине 1.5 с или откреплению
  узла, с гвардой точных дублей в окне 10 с; `caption-outbox` — буфер на 200 реплик на время
  разрыва WS; `caption-health` — тексты и правила полоски отказа), тонкий DOM-слой
  (`caption-reader`, `caption-controls`) и оркестратор `recording/caption-mode-controller`.
  Бэкенд: `case 'caption'` пишет тот же `TranscriptSegment`, что финалы Deepgram, а сессия с
  `transcriptSource: 'meet-captions'` не открывает STT-стрим (`shouldOpenSttStream`).
  ⚠️ Визуальная проверка за владельцем — чек-лист в плане
  `docs/superpowers/plans/2026-08-11-meet-captions-source.md`.
```

- [ ] **Step 2: Обновить курсор состояния**

В `docs/PROGRESS.md` после последнего раздела «Сделано (последнее, …)» добавить:

```markdown
## Сделано (последнее, LS-36)

- **LS-36 — источник транскрипта из субтитров Google Meet.** Третье значение селектора
  (`TranscriptSource = per-track | mixed | meet-captions`): в этом режиме аудио не захватывается
  вообще, STT-провайдер на бэкенде не создаётся, а текст берётся из собственных субтитров Meet —
  бесплатно и с настоящими именами участников вместо угадывания по индикатору громкости
  (LS-20/LS-33 угадывают, здесь имя приходит вместе с репликой). Субтитры включаются и
  скрываются автоматически, но только то, что включили сами: язык и видимость субтитров,
  включённых пользователем, не трогаются — при расхождении языка виджет предупреждает.
  Финалы уходят сообщением `caption` (`content → service worker → offscreen → бэкенд`) в тот же
  `TranscriptSegment`, что и финалы Deepgram; эха назад нет, реплику рисует сам контент-скрипт
  через `appendTranscriptReplica`, поэтому триггеры LS-14 работают без изменений.
  Тестами закрыты правила, а не разметка: разбор блока, финализация фразы, дедуп, буфер на
  разрыв, тексты полоски отказа, подпись кнопки субтитров, допустимый код языка, и на бэкенде —
  запись сегмента и отказ от STT-стрима. ADR-0001 в силе: он про STT-провайдеров на бэкенде, а
  здесь распознаёт сам Meet.
  - ⚠️ **Визуальная проверка за пользователем:** среда агента не грузит unpacked-расширение.
    Чек-лист (8 пунктов) — в конце `docs/superpowers/plans/2026-08-11-meet-captions-source.md`.
```

- [ ] **Step 3: Записать грабли в KNOWLEDGE**

В `docs/KNOWLEDGE.md` добавить пункты:

```markdown
- **Vitest в `packages/extension` — `environment: 'node'`, `jsdom` не установлен.** Поэтому
  чистые функции принимают простые структуры, а не `Element` (`pickActiveIndicatorIndex` берёт
  `string[][]`, `parseCaptionBlock` — две строки). DOM-часть проверяется в браузере.
- **Свежий git-worktree требует `npm run build --workspace=@skribo/shared`** перед тестами
  бэкенда, иначе `Failed to resolve entry for package "@skribo/shared"` в трёх файлах.
- **Разметка Meet: за что держаться.** Классы (`.nMcdL`, `.ygicle`, `.a4cQT`) обфусцированы и
  сменятся. Стабильны `role`, `aria-label` и особенно `data-value` в меню языков субтитров — там
  настоящий код локали (`ru-RU`, `en-US`). Регион субтитров ищется по структуре (сколько внутри
  блоков «аватар + имя + текст»), а не по классу, и Meet монтирует его дважды — нужен выбор одного.
- **Скрывать регион субтитров только смещением за вьюпорт**, никогда `display: none`: скрытый
  через `display` список Meet может перестать наполняться, и поток текста оборвётся вместе с
  картинкой.
```

- [ ] **Step 4: Обновить описание архитектуры**

В `AGENTS.md`:
- в «Project Overview» после строки про `per-track` добавить:

```markdown
- **meet-captions** mode: транскрипт берётся из собственных субтитров Google Meet (DOM), аудио не
  захватывается и Deepgram не задействован (LS-36)
```

- в «Current Status» в блок «Platform audio modes» дописать `Meet дополнительно умеет meet-captions (источник текста вместо захвата аудио).`;
- там же после «STT is Deepgram-only» дописать: `Режим meet-captions не противоречит ADR-0001: распознаёт сам Meet, бэкенд получает готовый текст сообщением caption и не создаёт STT-провайдера.`

- [ ] **Step 5: Коммит**

```bash
git add docs AGENTS.md
git commit -m "docs: LS-36 закрыт, режим субтитров Meet описан"
```

---

## Проверка в живом Meet (за владельцем)

Среда агента не грузит unpacked-расширение — как в LS-14, финальную проверку делает владелец. Загрузить `packages/extension/dist-dev` (или `dist-dev-prod`), выбрать в виджете «Субтитры Meet», затем пройти чек-лист:

1. Субтитры были выключены → старт включает их, регион не виден, текст идёт в виджет.
2. Субтитры были включены вручную → остаются видимыми, язык не меняется, дублирования реплик нет.
3. Имена в виджете совпадают с плитками участников.
4. Стоп возвращает исходное состояние: видимость, язык, вкл/выкл.
5. Текст встречи доехал в кабинет (карточка встречи в `app.skribo.ru`).
6. Языки `ru-RU` и `en-US` выставляются и возвращаются.
7. Триггеры (LS-14) подсвечиваются на финальных репликах.
8. Смещение региона за вьюпорт не сломало автоскролл Meet. Если сломало — заменить `CAPTION_HIDDEN_STYLE` на `opacity: 0 !important; pointer-events: none !important;` (риск зафиксирован в спеке).
