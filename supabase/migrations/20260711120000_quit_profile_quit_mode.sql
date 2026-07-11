-- quit_profile: 금연 모드(연속/재시작) 및 최초 시작 시각
ALTER TABLE public.quit_profile
  ADD COLUMN IF NOT EXISTS quit_mode text NOT NULL DEFAULT 'continuous';

ALTER TABLE public.quit_profile
  ADD COLUMN IF NOT EXISTS quit_mode_changed_at_ms bigint;

ALTER TABLE public.quit_profile
  ADD COLUMN IF NOT EXISTS origin_start_time_ms bigint;

COMMENT ON COLUMN public.quit_profile.quit_mode IS 'continuous | restart';
COMMENT ON COLUMN public.quit_profile.origin_start_time_ms IS '최초 금연 시작 시각(ms). 재시작 모드에서도 누적 여정용';
