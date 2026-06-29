-- 담타시간(커뮤니티) 메시지 (기존 테이블 스키마 불일치 시 보정 포함)

CREATE TABLE IF NOT EXISTS public.damta_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '#22d3ee',
  author_name text NOT NULL DEFAULT '익명',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 기존 테이블에 user_id 등 누락 컬럼 추가
ALTER TABLE public.damta_messages
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL;

ALTER TABLE public.damta_messages
  ADD COLUMN IF NOT EXISTS text text;

ALTER TABLE public.damta_messages
  ADD COLUMN IF NOT EXISTS color text;

ALTER TABLE public.damta_messages
  ADD COLUMN IF NOT EXISTS author_name text;

ALTER TABLE public.damta_messages
  ADD COLUMN IF NOT EXISTS created_at timestamptz;

-- 레거시 컬럼명 보정 (message → text, author_id → user_id)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'damta_messages' AND column_name = 'message'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'damta_messages' AND column_name = 'text'
  ) THEN
    UPDATE public.damta_messages
    SET text = message
    WHERE (text IS NULL OR text = '') AND message IS NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'damta_messages' AND column_name = 'author_id'
  ) THEN
    UPDATE public.damta_messages
    SET user_id = author_id
    WHERE user_id IS NULL AND author_id IS NOT NULL;
  END IF;
END $$;

ALTER TABLE public.damta_messages
  ALTER COLUMN text SET DEFAULT '';

ALTER TABLE public.damta_messages
  ALTER COLUMN color SET DEFAULT '#22d3ee';

ALTER TABLE public.damta_messages
  ALTER COLUMN author_name SET DEFAULT '익명';

ALTER TABLE public.damta_messages
  ALTER COLUMN created_at SET DEFAULT now();

UPDATE public.damta_messages
SET created_at = now()
WHERE created_at IS NULL;

CREATE INDEX IF NOT EXISTS damta_messages_created_at_idx
  ON public.damta_messages (created_at DESC);

CREATE INDEX IF NOT EXISTS damta_messages_user_id_idx
  ON public.damta_messages (user_id);

ALTER TABLE public.damta_messages ENABLE ROW LEVEL SECURITY;
