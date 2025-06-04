# 🎥 WHIP/WHEP Screen Streaming Server

Минимальная реализация сервера для потокового вещания экрана с использованием стандартных протоколов **WHIP** и **WHEP**.

## 📋 Что это такое?

### WHIP (WebRTC-HTTP Ingestion Protocol) - RFC 9725
- **Официальный стандарт IETF** для отправки WebRTC потоков через HTTP
- Использует HTTP POST для обмена SDP offer/answer
- HTTP PATCH для передачи ICE candidates
- HTTP DELETE для завершения сессии
- **Никаких WebSocket'ов** - только стандартный HTTP!

### WHEP (WebRTC-HTTP Egress Protocol) - Draft
- Протокол-компаньон для получения WebRTC потоков
- Аналогичный HTTP-based подход
- Пока в статусе draft, но широко поддерживается

## 🚀 Быстрый старт

### Windows (PowerShell):
```powershell
# Установка зависимостей
npm install

# Запуск сервера
npm start
```

### Использование:
1. Откройте http://localhost:8080
2. В разделе "Вещание" - начните трансляцию экрана
3. В разделе "Просмотр" - подключитесь к потоку
4. Откройте в новой вкладке для тестирования

## 📡 API Endpoints

### WHIP (для вещания):
```http
POST /whip
Content-Type: application/sdp
Body: SDP offer

→ 201 Created
Location: /whip/sessions/{sessionId}
Content-Type: application/sdp
Accept-Patch: application/trickle-ice-sdpfrag
Body: SDP answer
```

```http
PATCH /whip/sessions/{sessionId}
Content-Type: application/trickle-ice-sdpfrag
Body: ICE candidate fragment

→ 204 No Content
```

```http
DELETE /whip/sessions/{sessionId}
→ 204 No Content
```

### WHEP (для просмотра):
```http
POST /whep
Content-Type: application/sdp
Body: SDP offer

→ 201 Created
Location: /whep/sessions/{viewerId}
Content-Type: application/sdp
Accept-Patch: application/trickle-ice-sdpfrag
Body: SDP answer
```

```http
PATCH /whep/sessions/{viewerId}
Content-Type: application/trickle-ice-sdpfrag
Body: ICE candidate fragment

→ 204 No Content
```

```http
DELETE /whep/sessions/{viewerId}
→ 204 No Content
```

## 📊 Статус API
```http
GET /api/status
→ {
  "activeSessions": 1,
  "viewers": 2,
  "sessions": [...],
  "viewerList": [...]
}
```

## 🔧 Технические детали

### Без WebSocket'ов!
В отличие от многих WebRTC реализаций, WHIP/WHEP используют только HTTP:
- ✅ HTTP POST/PATCH/DELETE
- ✅ Стандартные HTTP заголовки
- ✅ Совместимость с CDN и load balancers
- ❌ WebSocket сигналинг не нужен

### Поддерживаемые браузеры:
- Chrome/Edge 72+
- Firefox 66+
- Safari 13+

Требуется поддержка `getDisplayMedia()` для демонстрации экрана.

## 📖 Официальная документация

- **WHIP RFC 9725**: https://datatracker.ietf.org/doc/rfc9725/
- **WHEP Draft**: https://datatracker.ietf.org/doc/draft-murillo-whep/

## 🛠️ Архитектура

```
┌─────────────┐    HTTP POST/PATCH/DELETE    ┌─────────────┐
│   Browser   │◄────────────────────────────►│   Server    │
│  (Streamer) │         WHIP RFC 9725        │             │
└─────────────┘                              │             │
                                             │             │
┌─────────────┐    HTTP POST/PATCH/DELETE    │             │
│   Browser   │◄────────────────────────────►│             │
│  (Viewer)   │         WHEP Draft           │             │
└─────────────┘                              └─────────────┘
```

## ⚠️ Ограничения демо

Это демонстрационная реализация:
- Использует mock SDP responses
- Нет реального media relay
- Подходит для изучения протоколов WHIP/WHEP
- Для продакшена нужен полноценный WebRTC media server (Janus, Kurento, etc.)

## 🎯 Для продакшена

Рекомендуемые решения:
- **Janus WebRTC Server** с WHIP/WHEP плагинами
- **Simple Whep Server** от Eyevinn Technology
- **Ant Media Server** с поддержкой WHIP
- **LiveKit** с WHIP endpoint 