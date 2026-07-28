# Tactiq UI — дизайн-референс кабинета

Скриншоты кабинета конкурента (Tactiq, `app.tactiq.io`) — визуальный ориентир для развития
нашего кабинета. Не копировать 1:1, брать паттерны.

| Файл | Экран | Что берём |
|---|---|---|
| `tactiq-my-meetings-list.png` | My Meetings (список) | Timeline-группировка по датам, per-row иконки (share/link/email/archive), лейблы. Наш список проще (карточки + поиск + сорт). |
| `tactiq-search.png` | Search (глобальный поиск) | Отдельная страница поиска по встречам/участникам/лейблам, empty-state с подсказками. → **LS-16** |
| `tactiq-meeting-ai-prompts.png` | Встреча → AI Chats («What will you create today?») | Набор промптов (Short/Detailed summary, Summary & Action items, Generate tasks…), выбор языка вывода, чат. Наш анализ — one-shot по кнопке. → будущий AI-чат/типы анализа. |
| `tactiq-meeting-short-summary.png` | Встреча → результат Short summary | Рендер саммари + follow-up-вопрос. У нас есть саммари+action items (LS-09A), без follow-up. |
| `tactiq-meeting-transcript.png` | Встреча → Transcript | **Тайминги `mm:ss` по репликам**, **поиск в транскрипте**, hover-действия на реплике. → **LS-17** (тайминги+поиск; hover-действия — позже). |

Спека ближайшего куска: `docs/superpowers/specs/2026-07-28-cabinet-search-transcript-ux-design.md`.
