alter table public.notification_settings
  add column if not exists pattern_reminder_slots_json jsonb not null default '[]'::jsonb;
