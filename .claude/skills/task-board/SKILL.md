---
name: task-board
description: >-
  Читать и обновлять доску Skribo в self-hosted Vikunja (kanban.skribo.ru):
  колонки Входящие/Бэклог/В работе/На проверке/Готово, перенос карточки между колонками,
  комментарии, метки feature/bug. Использовать, когда нужно выбрать задачу, взять в работу,
  двинуть статус или закрыть. Механика — Vikunja REST API.
---

# task-board — доска задач Skribo (Vikunja, self-hosted)

**ПРАВИЛО (обязательно, без вопросов пользователю):** на КАЖДУЮ единицу работы (фича/баг/
фикс, даже однострочный) — СНАЧАЛА карточка на доске и перевод в **«В работе»**, потом код;
по завершении реализации → **«На проверке»**, после деплоя → **«Готово»**, и **краткий
комментарий** в карточке что сделано. Автономно; никогда не спрашивать «заводить ли карточку /
двигать ли доску» — просто делать. GitHub — только код/коммиты/релизы.

**Найденное по ходу — тоже карточка.** Если при разборе одной задачи всплыл отдельный дефект,
он получает свою карточку сразу, даже если чинить его сейчас не собираемся. Иначе находка
живёт только в диалоге и теряется вместе с сессией.

## Доступ
- Доска: **https://kanban.skribo.ru** (Vikunja, self-hosted на том же сервере `45.147.176.79`,
  systemd-юнит `vikunja`, Caddy проксирует на `127.0.0.1:3456`).
- Проект **Skribo** id `5`, kanban-view id `20`. Колонки (bucket id):
  **Входящие=9, Бэклог=10, В работе=11, На проверке=12, Готово=13**. Метки: **feature=3, bug=4**.
- Креды в **`~/.skribo-vikunja.env`** (`VIKUNJA_URL`, `VIKUNJA_USER`=skribo-bot, `VIKUNJA_PASS`)
  — читать из файла, **в чат/логи не выводить**. Логинимся каждый раз (JWT).
- Все `curl` — с `dangerouslyDisableSandbox` (сеть). Если используешь python/urllib вместо curl,
  сначала сними прокси-переменные (`env -u https_proxy -u http_proxy …`), иначе соединение
  рвётся на CONNECT.

```bash
set -a; . ~/.skribo-vikunja.env; set +a
B="$VIKUNJA_URL/api/v1"
JWT=$(curl -s -X POST "$B/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$VIKUNJA_USER\",\"password\":\"$VIKUNJA_PASS\"}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
A=(-H "Authorization: Bearer $JWT" -H 'Content-Type: application/json')
```

## Операции

**Прочитать доску** (канбан = список бакетов, у каждого `tasks[]`):
```bash
curl -s "$B/projects/5/views/20/tasks" "${A[@]}" | python3 -c '
import sys,json
for bk in json.load(sys.stdin):
    ts=bk.get("tasks") or []
    print("["+bk["title"]+"] "+str(len(ts)))
    for t in ts: print("   #"+str(t["id"]), t["title"])'
```

**Создать карточку** (новая задача попадает в первую колонку «Входящие»):
```bash
TID=$(curl -s -X PUT "$B/projects/5/tasks" "${A[@]}" \
  --data "$(python3 -c 'import json,sys;print(json.dumps({"title":sys.argv[1],"description":sys.argv[2]}))' "НАЗВАНИЕ" "ОПИСАНИЕ")" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
```

**Двинуть карточку в колонку** (bucket id, напр. 11 = «В работе»):
```bash
curl -s -X POST "$B/projects/5/views/20/buckets/11/tasks" "${A[@]}" -d "{\"task_id\":$TID}" -o /dev/null -w "%{http_code}\n"
```

**Метка feature/bug** на карточку:
```bash
curl -s -X PUT "$B/tasks/$TID/labels" "${A[@]}" -d '{"label_id":3}' -o /dev/null -w "%{http_code}\n"   # 3=feature, 4=bug
```

**Краткий комментарий** (что сделано):
```bash
curl -s -X PUT "$B/tasks/$TID/comments" "${A[@]}" \
  --data "$(python3 -c 'import json,sys;print(json.dumps({"comment":sys.argv[1]}))' "Готово: <1-2 строки, версия/коммит если релиз>")" \
  -o /dev/null -w "%{http_code}\n"
```

**Комментарий держит HTML, а не текст.** Переводы строк и `-`/`1.` схлопнутся в кашу —
списки и абзацы размечать тегами: `<p>`, `<ol><li>…</li></ol>`, `<ul><li>…</li></ul>`,
`<strong>`. Длинный текст удобнее писать в файл и подставлять из него:
```bash
curl -s -X PUT "$B/tasks/$TID/comments" "${A[@]}" \
  --data "$(python3 -c 'import json,sys;print(json.dumps({"comment":open(sys.argv[1]).read()}))' comment.html)" \
  -o /dev/null -w "%{http_code}\n"
```
Правка своего комментария (без плодения новых) — `POST /tasks/$TID/comments/<commentId>`
с телом `{"id":<commentId>,"comment":"<html>"}`; список комментариев — `GET /tasks/$TID/comments`.

Карточку для клиента писать **простым языком**: что теперь работает и что нужно от него,
без технических терминов, названий файлов и коммитов.

**Пометить готовой** (галочка done, опц. при переносе в «Готово»):
```bash
curl -s -X POST "$B/tasks/$TID" "${A[@]}" -d "{\"id\":$TID,\"done\":true}" -o /dev/null -w "%{http_code}\n"
```

## Жизненный цикл
**Входящие** (сырые запросы клиента/владельца) → разобрать → **Бэклог** → взял → **В работе**
→ реализовано и смёржено → **На проверке** (краткий коммент что сделано) → задеплоено → **Готово**.

«Взять следующую задачу» — скилл `check-tasks`. Фоновый опрос новых — `watch-board`.

## Доска и `docs/backlog.md`
Доска — трекер работы, `backlog.md` — планировочный документ с фазами и обоснованиями. Живут
параллельно (как в expeditor): id `LS-NN` — общий ключ, по нему карточка и запись в бэклоге
находят друг друга. Статус закрытой задачи — по-прежнему состояние git (коммит в `main`).

## Клиент/пользователи
Vikunja-инстанс один на несколько проектов: `Expeditor` (id 2) и `Skribo` (id 5). Владелец
инстанса — `aleksander`, автоматизация Skribo — бот `skribo-bot` (владелец проекта 5, у
`aleksander` на него право admin). **Регистрация на инстансе закрыта** — новые пользователи
только через CLI на сервере: `cd /opt/vikunja && vikunja user create -u <имя> -e <email>`.

Доступ клиенту даётся **на конкретный проект** (link share), другие проекты он не видит: ссылка
на доску Expeditor не открывает Skribo и наоборот. Link share умеет право на запись — если
ссылка уходит клиенту только посмотреть, выдавать её на чтение.
