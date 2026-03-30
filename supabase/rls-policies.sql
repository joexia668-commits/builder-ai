-- BuilderAI: Row Level Security policies for dynamic_app_data
--
-- IMPORTANT: Execute this SQL in Supabase Dashboard → SQL Editor
--
-- Context: This project uses NextAuth (not Supabase Auth), so auth.uid() is always
-- null. Isolation is enforced via the x-app-id request header, which Sandpack-generated
-- apps set to their own projectId when making Supabase calls.

-- NOTE: Prisma maps model name DynamicAppData to table "DynamicAppData" (PascalCase, quoted).
-- Field appId maps to column "appId" (camelCase, quoted). No @map directives in schema.

-- Enable RLS on the table
ALTER TABLE "DynamicAppData" ENABLE ROW LEVEL SECURITY;

-- SELECT: only allow reading rows where appId matches the x-app-id request header
CREATE POLICY "select_by_app_id" ON "DynamicAppData"
  FOR SELECT USING ("appId" = current_setting('request.headers')::json->>'x-app-id');

-- INSERT: only allow writing rows where appId matches the x-app-id request header
CREATE POLICY "insert_by_app_id" ON "DynamicAppData"
  FOR INSERT WITH CHECK ("appId" = current_setting('request.headers')::json->>'x-app-id');

-- UPDATE: restrict updates to matching appId rows
CREATE POLICY "update_by_app_id" ON "DynamicAppData"
  FOR UPDATE USING ("appId" = current_setting('request.headers')::json->>'x-app-id');

-- DELETE: restrict deletes to matching appId rows
CREATE POLICY "delete_by_app_id" ON "DynamicAppData"
  FOR DELETE USING ("appId" = current_setting('request.headers')::json->>'x-app-id');
