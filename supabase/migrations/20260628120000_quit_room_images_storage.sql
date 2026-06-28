-- 금연방 게시물 이미지 Storage 버킷 (공개 읽기)
-- Supabase SQL Editor에서 한 번 실행하세요.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'quit-room-images',
  'quit-room-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 공개 읽기 (모든 사용자)
DROP POLICY IF EXISTS "quit_room_images_public_read" ON storage.objects;
CREATE POLICY "quit_room_images_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'quit-room-images');

-- 인증된 사용자 업로드 (service role은 RLS 우회)
DROP POLICY IF EXISTS "quit_room_images_auth_insert" ON storage.objects;
CREATE POLICY "quit_room_images_auth_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'quit-room-images');
