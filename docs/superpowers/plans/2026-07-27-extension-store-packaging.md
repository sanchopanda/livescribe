# Chrome Web Store packaging Implementation Plan (LS-05)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Довести расширение до готовности к публикации в Chrome Web Store: иконки, чистый store-manifest, zip-сборка, privacy policy и гайд по дашборду.

**Architecture:** Иконки-монограмма (PIL, PNG коммитятся); `vite.config` при `EXT_TARGET=store` сужает права/matches и вырезает `platform-research`; pack-скрипт собирает zip; privacy policy — публичный роут `/privacy` в кабинете; гайд в `docs/guides/`.

**Tech Stack:** MV3 + `@crxjs/vite-plugin` (manifest импортируется объектом в `vite.config.ts`), Vite, React (admin). Иконки — Python/PIL (проверено: `ImageFont.load_default(size)` рендерит «S»). Spec: `docs/superpowers/specs/2026-07-27-extension-store-packaging-design.md`.

## Global Constraints

- Store-сборка (`EXT_TARGET=store`) НЕ должна содержать `<all_urls>`, `localhost`, `platform-research`, YouTube. Dev-сборка (без флага) — остаётся широкой, не ломать.
- Иконки-PNG **коммитятся** (Python нужен только для регенерации; в рантайме/CI не требуется).
- Privacy `/privacy` — публичный роут (вне `ProtectedRoute`).
- Русский UI/текст; английские идентификаторы. Не генерировать фейковые скриншоты/логотип.
- Перед коммитом: `npm run type-check` зелёный; сборки затронутых воркспейсов проходят.
- Читать файл перед правкой; следовать паттернам (crxjs manifest-объект; admin роуты в `main.tsx`).

---

### Task 1: Иконки-монограмма + manifest

**Files:**
- Create: `packages/extension/scripts/gen-icons.py`
- Create: `packages/extension/public/icons/icon-16.png`, `icon-48.png`, `icon-128.png` (сгенерированные)
- Modify: `packages/extension/public/manifest.json`

**Interfaces:**
- Produces: три PNG-иконки + `icons`/`action.default_icon` в manifest.

- [ ] **Step 1:** `packages/extension/scripts/gen-icons.py`:
```python
#!/usr/bin/env python3
"""Generate Skribo extension monogram icons ('S' on #0d9488). One-off; PNGs are committed."""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
os.makedirs(OUT, exist_ok=True)

def render(size: int) -> Image.Image:
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=round(size * 0.22), fill=(13, 148, 136, 255))
    font = ImageFont.load_default(size=round(size * 0.68))
    bbox = d.textbbox((0, 0), 'S', font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((size - w) / 2 - bbox[0], (size - h) / 2 - bbox[1]), 'S', font=font, fill=(255, 255, 255, 255))
    return img

base = render(128)
base.save(os.path.join(OUT, 'icon-128.png'))
for s in (48, 16):
    base.resize((s, s), Image.LANCZOS).save(os.path.join(OUT, f'icon-{s}.png'))
print('wrote icon-16/48/128.png to', os.path.abspath(OUT))
```

- [ ] **Step 2:** Сгенерировать иконки: `python3 packages/extension/scripts/gen-icons.py`. Проверить, что появились `packages/extension/public/icons/icon-{16,48,128}.png` и они непустые (`ls -la`). (PIL уже установлен в окружении.)

- [ ] **Step 3:** В `packages/extension/public/manifest.json` добавить (после `"description"`):
```json
  "icons": { "16": "icons/icon-16.png", "48": "icons/icon-48.png", "128": "icons/icon-128.png" },
```
и в блок `"action"` добавить `default_icon` (рядом с `default_popup`/`default_title`):
```json
    "default_icon": { "16": "icons/icon-16.png", "48": "icons/icon-48.png", "128": "icons/icon-128.png" }
```

- [ ] **Step 4: Verify** — `npm run build:extension` (dev, из корня) собирается; иконки скопированы: `ls packages/extension/dist/icons/`. `npm run type-check` зелёный.

- [ ] **Step 5: Commit**
```bash
git add packages/extension/scripts/gen-icons.py packages/extension/public/icons packages/extension/public/manifest.json
git commit -m "feat(extension): monogram icons (16/48/128) + manifest icons"
```

---

### Task 2: Store-таргет сборки + pack-скрипт

**Files:**
- Modify: `packages/extension/vite.config.ts`
- Create: `scripts/pack-extension.sh`
- Modify: `package.json` (root — скрипт `pack:extension`)
- Modify: `.gitignore` (игнор zip-артефакта)

**Interfaces:**
- Consumes: `manifest` (Task 1 иконки уже в нём).
- Produces: store-трансформ manifest под `EXT_TARGET=store`; `npm run pack:extension` → zip.

- [ ] **Step 1:** В `packages/extension/vite.config.ts` — после `import manifest ...` добавить трансформ и использовать его в `crx()`:
```ts
const EXT_TARGET = process.env.EXT_TARGET;

function activeManifest() {
  if (EXT_TARGET !== 'store') return manifest;
  const m = JSON.parse(JSON.stringify(manifest)) as typeof manifest;
  m.host_permissions = [
    'https://api.skribo.ru/*',
    'https://app.skribo.ru/*',
    'https://meet.google.com/*',
    'https://zoom.us/*',
    'https://*.zoom.us/*',
    'https://teams.microsoft.com/*',
    'https://*.teams.microsoft.com/*',
    'https://*.pachca.com/*',
    'https://app.pachca.com/*',
  ];
  m.content_scripts = m.content_scripts
    .filter((cs: any) => !cs.js.some((j: string) => j.includes('platform-research')))
    .map((cs: any) => ({ ...cs, matches: cs.matches.filter((p: string) => !p.includes('youtube')) }));
  return m;
}
```
Заменить `crx({ manifest: manifest as any })` на `crx({ manifest: activeManifest() as any })`.

- [ ] **Step 2:** Не собирать `platform-research` в store-режиме. В `rollupOptions.input` вынести объект и убрать ключ условно:
```ts
      input: {
        offscreen: path.resolve(__dirname, 'src/offscreen/offscreen.ts'),
        content: path.resolve(__dirname, 'src/content/content.ts'),
        'pachca-webrtc-tracks-main': path.resolve(__dirname, 'src/content/platforms/pachca/audio/per-track/webrtc-tracks-main.ts'),
        'meet-webrtc-tracks-main': path.resolve(__dirname, 'src/content/platforms/meet/audio/per-track/webrtc-tracks-main.ts'),
        ...(EXT_TARGET === 'store' ? {} : { 'platform-research': path.resolve(__dirname, 'src/content/platform-research.ts') }),
      },
```
(остальной `output`/`entryFileNames` не трогать — ветка `platform-research` в нём безвредна, когда входа нет.)

- [ ] **Step 3:** `scripts/pack-extension.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./packages/extension/public/manifest.json').version")
echo "Building store extension v$VERSION ..."
WS_URL=wss://api.skribo.ru/ws API_URL=https://api.skribo.ru CABINET_URL=https://app.skribo.ru EXT_TARGET=store \
  npm run build:extension
OUT="skribo-extension-${VERSION}.zip"
rm -f "$OUT"
( cd packages/extension/dist && zip -qr "../../../$OUT" . )
echo "Packed: $OUT"
```
Сделать исполняемым: `chmod +x scripts/pack-extension.sh`.

- [ ] **Step 4:** В корневом `package.json` в `scripts` добавить: `"pack:extension": "bash scripts/pack-extension.sh"`. В `.gitignore` добавить строку `skribo-extension-*.zip`.

- [ ] **Step 5: Verify (store-сборка чистая).**
```bash
npm run pack:extension
echo "--- store manifest checks (все должны быть ПУСТО, кроме icons) ---"
grep -c "all_urls\|localhost\|platform-research\|youtube" packages/extension/dist/manifest.json   # ожидаем 0
grep -c "icons/icon-128.png" packages/extension/dist/manifest.json                                  # ожидаем >=1
ls -la skribo-extension-*.zip
echo "--- dev-сборка НЕ тронута (all_urls на месте) ---"
npm run build:extension >/dev/null 2>&1 && grep -c "all_urls" packages/extension/dist/manifest.json  # ожидаем >=1
```
Ожидание: store-manifest без all_urls/localhost/platform-research/youtube, с icons; zip создан; dev-сборка снова широкая.

- [ ] **Step 6: Commit**
```bash
git add packages/extension/vite.config.ts scripts/pack-extension.sh package.json .gitignore
git commit -m "feat(extension): store build target (narrow perms, strip research) + pack script"
```

---

### Task 3: Privacy policy `/privacy` в кабинете + гайд дашборда

**Files:**
- Create: `packages/admin/src/pages/PrivacyPage.tsx`
- Modify: `packages/admin/src/main.tsx`
- Create: `docs/guides/chrome-web-store.md`

**Interfaces:**
- Produces: публичная страница `/privacy`; гайд по подаче.

- [ ] **Step 1:** `PrivacyPage.tsx` — статическая RU-страница. Обернуть в простой контейнер (инлайн-стиль или переиспользовать существующий layout-класс, если есть подходящий; допустимо инлайн `style={{ maxWidth: 720, margin: '40px auto', padding: '0 20px', lineHeight: 1.6 }}`). Содержимое (заголовки + абзацы):
  - **H1** «Политика конфиденциальности Skribo», строка «Дата вступления: 27 июля 2026».
  - «**Какие данные.** Email и имя аккаунта; аудио звонков, которые вы записываете расширением; получаемые транскрипты; метаданные встреч (платформа, время, длительность).»
  - «**Как обрабатываем.** Аудио передаётся на наш сервер и в сервис распознавания речи Deepgram. Транскрипты могут отправляться в OpenRouter (LLM), когда вы запускаете анализ встречи или быстрое саммари.»
  - «**Хранение.** Транскрипты и метаданные хранятся в нашей базе данных, привязаны к вашему аккаунту и доступны в кабинете. Быстрое live-саммари не сохраняется.»
  - «**Третьи стороны.** Deepgram (распознавание речи), OpenRouter (LLM-анализ). Мы не продаём ваши данные и не используем их для рекламы.»
  - «**Ваш контроль.** Вы можете просматривать и удалять встречи в кабинете; удаление аккаунта — по запросу.»
  - «**Согласие участников.** Вы обязаны уведомить других участников звонка и получить их согласие на запись согласно применимому законодательству.»
  - «**Контакт.** support@skribo.ru» (плейсхолдер — подтвердить реальный адрес перед подачей).
  - «**Изменения.** Мы можем обновлять эту политику; актуальная дата — вверху.»
  Ссылка «← Ко входу» (`Link` на `/login`).

- [ ] **Step 2:** В `packages/admin/src/main.tsx` — импортировать `PrivacyPage` и добавить публичный роут рядом с `/login`/`/forgot` (вне `ProtectedRoute`):
```tsx
<Route path="/privacy" element={<PrivacyPage />} />
```

- [ ] **Step 3:** `docs/guides/chrome-web-store.md` — гайд по подаче. Разделы:
  - **Подготовка пакета:** `npm run pack:extension` → `skribo-extension-<version>.zip`.
  - **Аккаунт:** Chrome Web Store developer account, разовый взнос $5, верификация.
  - **Обоснования прав** (готовые тексты для дашборда):
    - `tabCapture` — «Захват аудио активной вкладки для транскрипции звонка по явному действию пользователя (кнопка Start в виджете).»
    - `offscreen` — «Offscreen-документ обрабатывает аудио и держит WebSocket к STT-бэкенду (service worker MV3 не держит долгие соединения).»
    - `scripting` — «Внедрение виджета/контент-скрипта на страницах поддерживаемых платформ.»
    - `storage` — «Локальное хранение токена аккаунта и настроек виджета (триггеры, размер/позиция).»
    - `alarms` — «Таймеры keep-alive для активной сессии записи.»
    - `activeTab` — «Доступ к текущей вкладке при запуске записи.»
    - Хосты — «Домены Meet/Zoom/Teams/Pachca — для виджета; api/app.skribo.ru — связь с бэкендом и кабинетом.»
  - **Data usage disclosures:** собираем — аутентификационные данные (токен), PII (email), пользовательский контент (аудио/транскрипты); сертификации: не продаём, используем только для заявленной функции, не для оценки платёжеспособности.
  - **Privacy policy URL:** `https://app.skribo.ru/privacy`.
  - **Ассеты (делает пользователь):** иконка стора 128 (есть в `public/icons`), ≥1 скриншот 1280×800 (3-5 желательно), описание (RU + опц. EN), категория.
  - **Ревью:** с `tabCapture` + аудио + несколькими хостами ревью тщательное и не мгновенное (дни).

- [ ] **Step 4: Verify** — `npm run type-check` зелёный; `npm run build --workspace=@skribo/admin` собирается; локально маршрут `/privacy` рендерит страницу (проверить чтением роутинга + сборкой; живой рендер после деплоя).

- [ ] **Step 5: Commit**
```bash
git add packages/admin/src/pages/PrivacyPage.tsx packages/admin/src/main.tsx docs/guides/chrome-web-store.md
git commit -m "feat(admin): /privacy policy page; docs: Chrome Web Store submission guide"
```

---

## Self-Review

- **Spec coverage:** иконки+manifest → Task 1; store-таргет (сужение прав/matches, срез research) + pack zip → Task 2; privacy `/privacy` + гайд → Task 3. Проверки чистоты store-manifest → Task 2 Step 5.
- **Placeholder scan:** весь код приведён (PIL-скрипт, vite-трансформ, pack.sh, privacy-контент, разделы гайда). `support@skribo.ru` помечен как плейсхолдер к подтверждению — не «TODO в коде», а сознательный контент.
- **Type consistency:** `EXT_TARGET==='store'` — единый флаг в vite (manifest-трансформ + rollup input); pack-скрипт задаёт его же. Роут `/privacy` — как `/login`/`/forgot` (публичный). Версия zip берётся из того же `manifest.json`, где иконки.

## Вне плана (follow-up)
- Реальный логотип вместо монограммы; скриншоты/промо; локализация листинга.
- Сама подача, оплата, заполнение дашборда, публикация — пользователь.
- Подтвердить реальный контактный email в privacy policy.
