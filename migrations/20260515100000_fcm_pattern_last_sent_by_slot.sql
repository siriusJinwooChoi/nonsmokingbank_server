-- FCM 패턴 알림: 슬롯별 일 1회 중복 방지 (KST 날짜 문자열)
alter table public.notification_settings
  add column if not exists fcm_pattern_last_sent_ymd_by_slot jsonb not null default '{}'::jsonb;

comment on column public.notification_settings.fcm_pattern_last_sent_ymd_by_slot is
  'FCM 흡연 패턴 미리 알림용: { "0": "yyyy-mm-dd", ... } 슬롯 인덱스별 마지막 발송일(KST)';
