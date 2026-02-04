# Quick Start: Platform Speaker Research

## Быстрый старт за 5 шагов

### 1. Собери расширение
```bash
npm run build:extension
```

### 2. Загрузи в Chrome
- Открой `chrome://extensions`
- Включи "Developer mode"
- "Load unpacked" → выбери `packages/extension/dist`

### 3. Открой платформу
Выбери одну из:
- **Teams**: https://teams.microsoft.com
- **Пачка**: https://app.pachca.com
- **Meet**: https://meet.google.com
- **Zoom**: https://zoom.us

### 4. Открой DevTools и запусти
```javascript
// В консоли DevTools:
startTracking()

// Проверь платформу:
getCurrentPlatform()
```

### 5. Присоединись к звонку и говори
Наблюдай логи в консоли!

---

## Полезные команды

```javascript
findParticipants()  // Найти участников
getLogs()           // Посмотреть логи
exportLogs()        // Экспорт в JSON
clearLogs()         // Очистить
stopTracking()      // Остановить
```

## Что искать в логах

✅ **Повторяющиеся паттерны** при смене спикера
✅ **Классы** с "active", "speaking", "highlight"
✅ **Стили** border/outline/box-shadow
✅ **ARIA** атрибуты с именами участников

## Сохрани результаты

```javascript
const data = exportLogs()
console.log(data)
// Скопируй и сохрани
```

---

📖 **Подробная инструкция**: [PLATFORM_RESEARCH.md](./PLATFORM_RESEARCH.md)
