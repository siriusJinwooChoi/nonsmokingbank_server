-- Supabase / PostgreSQL: 절약 금액 → 금연코인 환전 누적(원 단위)
ALTER TABLE coins_and_attendance
  ADD COLUMN IF NOT EXISTS savings_exchanged_to_coins_won bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN coins_and_attendance.savings_exchanged_to_coins_won IS
  'Cumulative won amount the user has converted to golden coins (100 won = 1 coin).';
