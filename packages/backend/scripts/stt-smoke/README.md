# stt-smoke

Одноразовый смок-скрипт для сравнения облачных STT на нашем аудио (PCM s16le, 16 кГц, 1 канал).
Контекст и мотивация — в спеке `docs/superpowers/specs/2026-08-06-cloud-stt-smoke-design.md`:
проверяем, отдают ли Nemotron 3.5 (Together AI) и SaluteSpeech (GigaAM) внятный русский в
стриминге, с эталоном — существующим прод-провайдером Deepgram nova-3. По ходу Задачи 3 в
объём добавлен третий провайдер — `whisper` (`openai/whisper-large-v3`), который отдаётся через
тот же Together Realtime эндпоинт, что и Nemotron (см. `providers/nemotron.ts`).

## Env-переменные

Читаются из `packages/backend/.env` (скрипт грузит его сам через `dotenv`):

- `DEEPGRAM_API_KEY` — для провайдера `deepgram`.
- `TOGETHER_API_KEY` — для провайдеров `nemotron` и `whisper` (оба идут через один и тот же
  Together AI Realtime эндпоинт, см. `providers/nemotron.ts`).
- Провайдер `salute` (SaluteSpeech/GigaAM) не реализован и не будет — облачного доступа к
  GigaAM для физлица нет, решение зафиксировано в
  `docs/decisions/0005-stt-strategy-self-hosted-ru.md`. Env-переменных для него не заводили.

## Команды

```bash
cd packages/backend

# Эталон — Deepgram nova-3 (уже работает)
npm run stt:smoke -- --file recordings/<name>.wav --provider deepgram --seconds 30

# Nemotron 3.5 ASR Streaming (Together AI)
npm run stt:smoke -- --file recordings/<name>.wav --provider nemotron --seconds 30

# Whisper large-v3 (тот же Together Realtime эндпоинт, другой query-параметр model)
npm run stt:smoke -- --file recordings/<name>.wav --provider whisper --seconds 30

# SaluteSpeech (GigaAM) — снят из объёма смока, провайдер не реализован (см. Findings)
npm run stt:smoke -- --file recordings/<name>.wav --provider salute --seconds 30
```

Флаги: `--language ru` (по умолчанию `ru`; для Together-провайдеров обязателен — без него Whisper
переводит речь на английский вместо транскрибации, см. Findings), `--seconds N` (обрезать запись,
чтобы не гонять целиковый звонок и не тратить лишние деньги), `--out <dir>` (по умолчанию
`scripts/stt-smoke/out`), `--raw` (сохранить сырые сообщения провайдера в
`out/<model-slug>-raw.jsonl` — для nemotron/whisper).

Результат — три файла в `out/`: `<recording>-<provider>.jsonl` (построчные события
`{ msFromStart, isFinal, text, audioPosSec?, durationSec? }`), `<recording>-<provider>.txt`
(склеенный финальный текст, для чтения глазами) и `<recording>-<provider>.meta.json`
(`{ audioSec }` — фактическая длительность поданного аудио с учётом `--seconds`; читает
`stt:report`, чтобы не путать обрезанный прогон с длиной всего WAV-файла).

### Отчёт по прогонам

```bash
# Собирает все *-<provider>.jsonl с этим basename в out/ в одну сравнительную таблицу + транскрипты
npm run stt:report -- --file <recording-basename> --out scripts/stt-smoke/out
```

Флаги: `--file <basename>` (обязателен; имя записи без `.wav` и без `-<provider>.jsonl`,
например `recording-62a7123a-2026-02-18T08-04-37-722Z`), `--out <dir>` (по умолчанию
`scripts/stt-smoke/out` — тот же каталог, что у `stt:smoke`), `--wav-dir <dir>` (по умолчанию
`recordings` — куда смотреть за исходным WAV, если для какого-то прогона нет `.meta.json`).
Результат — `out/<basename>-report.md`.

**`out/` не коммитить целиком — там могут быть транскрипты реальных звонков.** Каталог уже в
`.gitignore`. Короткие иллюстративные фрагменты (пара фраз, чтобы показать разницу «до/после»
настройки VAD и т.п.) в доках и комментариях — допустимы, см. Findings ниже и
`docs/research/2026-08-06-cloud-stt-smoke-results.md`.

**После правок в `packages/backend/src/stt`** обязательно прогонять
`npm run type-check:scripts` — этот скрипт жёстко импортирует прод-адаптер
(`providers/deepgram.ts` → `createDeepgramRunner` из `src/stt`), а корневой `npm run type-check`
`scripts/` не покрывает (у backend-пакета отдельный `tsconfig.scripts.json` для `scripts/**/*`,
обычный `type-check` собирает только `src/**/*`).

## Findings

Полный отчёт с таблицами метрик и диагнозом — в
`docs/research/2026-08-06-cloud-stt-smoke-results.md`. Здесь — выжимка по протоколу
Together AI Realtime, применимая к обеим моделям на этом эндпоинте (Nemotron 3.5, Whisper large-v3):

- **Аутентификация** — `Authorization: Bearer <TOGETHER_API_KEY>` в заголовке при открытии WS,
  без отдельного шага получения ephemeral-токена.
- **Конфигурационное сообщение перед аудио не нужно.** Все параметры — через query строки
  подключения: `model`, `input_audio_format=pcm_s16le_16000` (не `pcm16` — сервер принимает и
  `pcm16` без ошибки, но задокументированное значение другое), `language` (ISO 639-1, например
  `ru`) и VAD-параметры (`turn_detection`, `threshold`, `min_silence_duration_ms`,
  `max_speech_duration_s`, `speech_pad_ms`). Есть и альтернативный путь — сообщение
  `transcription_session.updated` после `session.created`, но он не потребовался.
- **Грабля №1 — VAD с дефолтами Together (`min_silence_duration_ms=500`, `max_speech_duration_s=5.0`)
  не годится для наших звонков.** Режет речь каждые 5 секунд и на любой полусекундной паузе —
  тишина внутри фразы превращается в точки, а разрыв посреди слова ломает распознавание следующего
  куска. До/после на одном и том же фрагменте записи (Nemotron):
  - до (дефолт): `«Робот себе. . .  . .  в франтей Никиту. . .  Н. . .  Никита потенциальный фронт»`
  - после (`turn_detection=server_vad&threshold=0.15&min_silence_duration_ms=3000&max_speech_duration_s=30&speech_pad_ms=300`):
    `«Привет. . .  Получается, фронте и Ники том. . .  Вот так.  Никита потенциальный фронт, наверное...»`

  Качество после правки визуально подтягивается почти до уровня Deepgram nova-3 (артефактные точки
  остаются — см. ниже, но обрывов слов и подмены смысла нет).
- **Грабля №2 — `language` обязателен для Whisper.** Без него `openai/whisper-large-v3` на этом
  эндпоинте не транскрибирует русскую речь, а переводит её на английский (классический
  Whisper-режим без явного языка: «Hello everyone! ... Nikita is a potential front, probably.»
  вместо русского). С `language=ru` в query — транскрибирует нормально. Nemotron распознаёт
  русский и без `language` (мультиязычный автодетект), но параметр применяется к обеим моделям
  одинаково для честного сравнения. Формальная схема параметров realtime-эндпоинта в openapi.yaml
  документирует только `model`/`input_audio_format`; `language` — задокументированное поле
  батчевого `POST /audio/transcriptions` (ISO 639-1), но в query realtime-эндпоинта оно тоже
  сработало без ошибок.
- **Оба Together-провайдера теряют самое начало звонка** (у Deepgram — «Алло. Алло. Всем
  привет.», у Nemotron/Whisper — в среднем только «Привет»/«Всем привет»). Пробовал более
  мягкий VAD (`threshold=0.05`, `min_speech_duration_ms=50`, `speech_pad_ms=500`) — начало не
  вернулось, значит это не наша настройка VAD режет короткие реплики, а сама модель их не
  распознаёт на первых секундах потока. Для продукта это заметный дефект (потеря первых слов
  встречи), но не лечится настройками, которые мы перепробовали.
- **Сервер событий (те же имена у Nemotron и Whisper):** `session.created` (один раз при
  открытии), `conversation.item.input_audio_transcription.delta` (партиал, текст в поле
  `delta`), `conversation.item.input_audio_transcription.completed` (финал, текст в поле
  `transcript`, не `delta`!). У обоих типов кадров — `start`/`duration` сегмента в секундах.
- **Артефактные сегменты-точки.** Часть завершённых сегментов у Nemotron состоит только из
  повторяющихся точек (`". . . . ."`, до ~90 повторов в одном сегменте на 6-минутной записи) —
  похоже, VAD всё равно отправляет длинную тишину/неречевой звук на распознавание, и модель
  возвращает пунктуацию вместо пустой строки. Ничего не фильтровалось в коде смока — сырые
  события в `.jsonl` остаются как прислал сервер. Для реальной интеграции стоило бы добавить
  пост-фильтр пустых/чисто-пунктуационных финалов.
- **Стабильность 6-минутной сессии (Nemotron):** без разрывов, последнее событие пришло на
  374 500 мс (запись 374.5 с) — соединение держится весь звонок.
- **Грабля №3 — «медианное отставание финала» (`medianFinalLagMs`) не равно воспринимаемой
  задержке ответа.** Это разница между часами прогона (`msFromStart`) и позицией сегмента,
  которую сообщает сам провайдер (`audioPosSec + durationSec`) — две разные шкалы времени, и они
  расходятся не из-за задержки сети, а из-за того, как провайдер ведёт счёт внутри своей сессии.
  У Deepgram расхождение (~13.6–13.8 с на обеих записях) — это конкретно поведение прод-адаптера
  `DeepgramSTT`, не ошибка метрики: коротко после начала звонка (13–18 с) происходит один
  реконнект (`tryReconnect()` в `src/stt/deepgram.ts`), после которого Deepgram присылает `start`
  относительно новой WS-сессии (снова от 0), а буферизованное за время реконнекта аудио прилетает
  разом. Это отдельный баг прод-кода, заведён как **LS-30** в `docs/backlog.md` — метрика смока
  тут просто вскрыла симптом. Дальше `msFromStart` в смоке (считается от старта всего прогона) и
  `start` из новой Deepgram-сессии просто не совпадают по нулевой точке — сдвиг застывает на
  ~13.5 с и держится до конца звонка (не растёт, не уменьшается). У Nemotron/Whisper реконнектов не было, и та же
  формула даёт правдоподобные 4–8 с — то есть сама формула считает верно, менять её не нужно, но
  **для реальной оценки отзывчивости эта метрика не годится ни для одного провайдера.** Смотреть
  нужно `tailLatencyMs` (пришёл ли последний финал раньше конца записи или после — отрицательное
  значит в хвосте была тишина) и `medianFinalIntervalMs` (как часто на экране появляется новый
  кусок текста — у Deepgram ~3.8 с на обеих записях, у Nemotron/Whisper с нашим VAD ~9–20 с:
  осознанная плата за длинные сегменты и меньше обрывков слов).
- **Цены.** У Together все модели типа `transcribe` идут по одной ставке `$0.0015/мин`
  (подтверждено из каталога `GET /v1/models`, поле `pricing.transcribe.price_per_minute`) — не
  только Nemotron и Whisper, но и `deepgram/nova-3-multi`/`deepgram/nova-3-en`/`deepgram/flux`,
  то есть саму модель nova-3 тоже можно получить через Together по цене в ~5 раз ниже прямого
  тарифа Deepgram ($0.0077/мин). В объём этого смока замена транспорта для nova-3 не входила —
  зафиксировано как возможное направление для отдельной задачи.
- **SaluteSpeech (GigaAM)** — вне объёма смока: облачного доступа к GigaAM для физлица нет,
  `providers/salute.ts` не создавался, ветка `'salute'` в CLI бросает понятную ошибку.
