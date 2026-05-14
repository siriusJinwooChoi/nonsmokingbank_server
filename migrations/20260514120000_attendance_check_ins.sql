-- 출석일별 이력 (달력 표시·기기 간 동기화용). BFF는 service role로 접근.
create table if not exists public.attendance_check_ins (
  user_id uuid not null references auth.users (id) on delete cascade,
  check_in_date date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, check_in_date)
);

create index if not exists attendance_check_ins_user_id_idx
  on public.attendance_check_ins (user_id);

comment on table public.attendance_check_ins is '사용자가 출석 버튼으로 체크한 날짜(서울 기준 yyyy-MM-dd에 대응하는 date)';

-- 기존 사용자: 마지막 출석일만이라도 복구해 달력에 한 칸이라도 남김
insert into public.attendance_check_ins (user_id, check_in_date)
select user_id, attendance_last_date
from public.coins_and_attendance
where attendance_last_date is not null
on conflict (user_id, check_in_date) do nothing;

alter table public.attendance_check_ins enable row level security;

-- 클라이언트는 BFF만 사용. 직접 Supabase 접근 시 본인 행 조회만 허용.
create policy attendance_check_ins_select_own on public.attendance_check_ins
  for select using (auth.uid() = user_id);
