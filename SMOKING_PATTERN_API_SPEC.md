# Smoking Pattern API Spec

## 목적
- `방금 피움(smoked)`과 `지금 너무 피우고싶을때(craving)` 이벤트를 서버에 누적 저장
- 패턴 기반 예방 알림 on/off를 서버와 동기화

## DB 스키마
- 테이블: `smoking_pattern_logs`
  - `id` `bigserial` PK
  - `user_id` `uuid` FK (`auth.users.id`)
  - `action` `text` (`smoked | craving`)
  - `event_at` `timestamptz`
  - `event_hour` `int` (0~23)
  - `event_minute` `int` (0~59)
  - `time_label` `text`
  - `situation` `text`
  - `emotion` `text`
  - `created_at` `timestamptz default now()`
- 기존 테이블 확장: `notification_settings.pattern_reminder_enabled boolean default true not null`

## 엔드포인트

### 1) 패턴 로그 저장
- `POST /v1/smoking-patterns/logs`
- Body
```json
{
  "action": "smoked",
  "eventAtMs": 1715050000000,
  "hour": 9,
  "minute": 12,
  "timeLabel": "아침",
  "situation": "스트레스",
  "emotion": "짜증"
}
```
- Response `200`
```json
{ "ok": true }
```

### 2) 패턴 로그 조회
- `GET /v1/smoking-patterns/logs?limit=50`
- Response `200`
```json
{
  "ok": true,
  "logs": [
    {
      "id": 10,
      "action": "smoked",
      "event_at": "2026-05-06T08:15:00.000Z",
      "event_hour": 17,
      "event_minute": 15,
      "time_label": "식사 전후",
      "situation": "습관",
      "emotion": "집중 안됨",
      "created_at": "2026-05-06T08:15:04.000Z"
    }
  ]
}
```

### 3) 패턴 알림 설정 조회
- `GET /v1/smoking-patterns/settings`
- Response `200`
```json
{
  "ok": true,
  "patternReminderEnabled": true
}
```

### 4) 패턴 알림 설정 변경
- `PUT /v1/smoking-patterns/settings`
- Body
```json
{
  "patternReminderEnabled": false
}
```
- Response `200`
```json
{
  "ok": true,
  "patternReminderEnabled": false
}
```
