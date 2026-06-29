-- 신규 가입 시 quit_profile 기본값: 온보딩 미완료(start_time_ms=0, is_configured=false)
-- 기존 quit_profile 테이블에 start_time_ms 등 컬럼이 없으면 먼저 ADD COLUMN 으로 보정한다.

CREATE TABLE IF NOT EXISTS public.quit_profile (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  is_configured boolean NOT NULL DEFAULT false,
  daily_cigarettes integer NOT NULL DEFAULT 0,
  cigarettes_per_pack integer NOT NULL DEFAULT 20,
  price_per_pack integer NOT NULL DEFAULT 4500,
  start_time_ms bigint NOT NULL DEFAULT 0,
  lung_health integer NOT NULL DEFAULT 100,
  lung_last_updated_ms bigint NOT NULL DEFAULT 0
);

ALTER TABLE public.quit_profile
  ADD COLUMN IF NOT EXISTS is_configured boolean NOT NULL DEFAULT false;

ALTER TABLE public.quit_profile
  ADD COLUMN IF NOT EXISTS daily_cigarettes integer NOT NULL DEFAULT 0;

ALTER TABLE public.quit_profile
  ADD COLUMN IF NOT EXISTS cigarettes_per_pack integer NOT NULL DEFAULT 20;

ALTER TABLE public.quit_profile
  ADD COLUMN IF NOT EXISTS price_per_pack integer NOT NULL DEFAULT 4500;

ALTER TABLE public.quit_profile
  ADD COLUMN IF NOT EXISTS duration_days integer;

ALTER TABLE public.quit_profile
  ADD COLUMN IF NOT EXISTS start_time_ms bigint NOT NULL DEFAULT 0;

ALTER TABLE public.quit_profile
  ADD COLUMN IF NOT EXISTS failure_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.quit_profile
  ADD COLUMN IF NOT EXISTS goal_days integer;

ALTER TABLE public.quit_profile
  ADD COLUMN IF NOT EXISTS goal_congratulated_day integer;

ALTER TABLE public.quit_profile
  ADD COLUMN IF NOT EXISTS lung_health integer NOT NULL DEFAULT 100;

ALTER TABLE public.quit_profile
  ADD COLUMN IF NOT EXISTS lung_last_updated_ms bigint NOT NULL DEFAULT 0;

ALTER TABLE public.quit_profile
  ADD COLUMN IF NOT EXISTS pinned_reason_text text;

ALTER TABLE public.quit_profile
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;

  IF to_regclass('public.quit_profile') IS NOT NULL THEN
    INSERT INTO public.quit_profile (
      user_id,
      is_configured,
      daily_cigarettes,
      cigarettes_per_pack,
      price_per_pack,
      start_time_ms,
      lung_health,
      lung_last_updated_ms
    )
    VALUES (
      NEW.id,
      false,
      0,
      20,
      4500,
      0,
      100,
      0
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  IF to_regclass('public.reasons') IS NOT NULL THEN
    INSERT INTO public.reasons (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  IF to_regclass('public.notification_settings') IS NOT NULL THEN
    INSERT INTO public.notification_settings (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  IF to_regclass('public.game_stats') IS NOT NULL THEN
    INSERT INTO public.game_stats (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'quit_profile'
      AND column_name = 'start_time_ms'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'quit_profile'
      AND column_name = 'is_configured'
  ) THEN
    UPDATE public.quit_profile
    SET
      start_time_ms = 0,
      lung_last_updated_ms = 0
    WHERE is_configured = false
      AND COALESCE(start_time_ms, 0) > 0;
  END IF;
END $$;
