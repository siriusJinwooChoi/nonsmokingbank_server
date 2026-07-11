-- Phase A/B: post_type, metadata, room goals, damta sessions, SOS FCM prefs

ALTER TABLE quit_room_posts
  ADD COLUMN IF NOT EXISTS post_type text NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS author_system boolean NOT NULL DEFAULT false;

UPDATE quit_room_posts
SET post_type = 'sos'
WHERE is_sos_alert = true AND post_type = 'text';

ALTER TABLE quit_room_posts
  DROP CONSTRAINT IF EXISTS quit_room_posts_post_type_check;

ALTER TABLE quit_room_posts
  ADD CONSTRAINT quit_room_posts_post_type_check
  CHECK (post_type IN (
    'text', 'share', 'sos', 'certify', 'cheer', 'mission', 'report', 'damta'
  ));

ALTER TABLE quit_rooms
  ADD COLUMN IF NOT EXISTS goal_type text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS goal_days integer,
  ADD COLUMN IF NOT EXISTS goal_end_date date,
  ADD COLUMN IF NOT EXISTS pledge_text text,
  ADD COLUMN IF NOT EXISTS challenge_started_at timestamptz;

ALTER TABLE quit_rooms
  DROP CONSTRAINT IF EXISTS quit_rooms_goal_type_check;

ALTER TABLE quit_rooms
  ADD CONSTRAINT quit_rooms_goal_type_check
  CHECK (goal_type IN ('none', 'days', 'date'));

CREATE TABLE IF NOT EXISTS quit_room_damta_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES quit_rooms(id) ON DELETE CASCADE,
  started_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_quit_room_damta_sessions_room_active
  ON quit_room_damta_sessions (room_id, status)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS quit_room_damta_participants (
  session_id uuid NOT NULL REFERENCES quit_room_damta_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, user_id)
);

CREATE TABLE IF NOT EXISTS quit_room_weekly_reports (
  room_id uuid NOT NULL REFERENCES quit_rooms(id) ON DELETE CASCADE,
  week_key text NOT NULL,
  post_id uuid NOT NULL REFERENCES quit_room_posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, week_key)
);

ALTER TABLE notification_settings
  ADD COLUMN IF NOT EXISTS quit_room_sos_enabled boolean NOT NULL DEFAULT true;
