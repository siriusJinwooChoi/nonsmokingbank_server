-- 나의 드림카 브랜드·단계 (앱 /v1/sync 와 연동)
create table if not exists public.dream_car_progress (
  user_id uuid primary key references auth.users (id) on delete cascade,
  dream_car_brand text,
  dream_car_stage integer not null default 1,
  updated_at timestamptz not null default now(),
  constraint dream_car_stage_range check (dream_car_stage >= 1 and dream_car_stage <= 10)
);

create index if not exists dream_car_progress_user_id_idx on public.dream_car_progress (user_id);

alter table public.dream_car_progress enable row level security;

create policy "dream_car_progress_select_own"
  on public.dream_car_progress for select
  using (auth.uid() = user_id);

create policy "dream_car_progress_insert_own"
  on public.dream_car_progress for insert
  with check (auth.uid() = user_id);

create policy "dream_car_progress_update_own"
  on public.dream_car_progress for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "dream_car_progress_delete_own"
  on public.dream_car_progress for delete
  using (auth.uid() = user_id);

comment on table public.dream_car_progress is '금연뱅크 나의 드림카 브랜드(hyundai|kia|null)·단계(1-10); BFF는 service role로 RLS 우회';
