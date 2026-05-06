create table if not exists public.smoking_pattern_logs (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('smoked', 'craving')),
  event_at timestamptz not null,
  event_hour integer not null check (event_hour between 0 and 23),
  event_minute integer not null check (event_minute between 0 and 59),
  time_label text not null default '',
  situation text not null default '',
  emotion text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists smoking_pattern_logs_user_event_at_idx
  on public.smoking_pattern_logs (user_id, event_at desc);

alter table public.notification_settings
  add column if not exists pattern_reminder_enabled boolean not null default true;
