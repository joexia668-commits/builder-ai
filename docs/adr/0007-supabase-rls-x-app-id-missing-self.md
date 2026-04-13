# ADR 0007 — Supabase RLS 406：supabaseClient.js 缺少 x-app-id header

**日期**: 2026-04-13  
**背景**: Claude 自发现（-self）；用户在浏览器控制台看到 406 Not Acceptable

---

## 问题描述

Sandpack 生成的 app 调用 Supabase REST API 时报 406：

```
GET https://<project>.supabase.co/rest/v1/DynamicAppData?select=data&key=eq.user 406 (Not Acceptable)
```

---

## 根因

`lib/sandpack-config.ts` 的 `buildSupabaseClientCode()` 生成的 supabase client 没有设置 `x-app-id` global header：

```typescript
// 修复前 — 缺少 header
export const supabase = createClient('url', 'key');
```

`DynamicAppData` 表的 RLS 策略依赖该 header 做行隔离：

```sql
CREATE POLICY "select_by_app_id" ON "DynamicAppData"
  FOR SELECT USING ("appId" = current_setting('request.headers')::json->>'x-app-id');
```

header 缺失时 `current_setting('request.headers')::json->>'x-app-id'` 返回 null，RLS 拒绝所有行，`.single()` 拿到 0 行，PostgREST 返回 406。

---

## 修复

`buildSupabaseClientCode(projectId)` 加入 global header：

```typescript
// 修复后
export const supabase = createClient('url', 'key', {
  global: { headers: { 'x-app-id': 'projectId' } },
});
```

`projectId` 由 `buildSandpackConfig(input, projectId)` 传入，来源是 URL 路由参数 `project.id`（数据库主键），F5 刷新后不变，RLS 隔离持续有效。

diff 涉及文件：
- `lib/sandpack-config.ts`：`buildSupabaseClientCode` 加参数 + header；调用处传 `projectId`；移除 `void projectId` 占位注释
- `__tests__/supabase-injection.test.ts`：新增 SB-07 断言 `x-app-id` 与 `projectId` 存在于生成代码中

---

## 为什么之前没暴露

RLS policies（`supabase/rls-policies.sql`）是后补部署的，部署前无 RLS 保护，所有请求都能通过，缺少 header 不会报错。policies 部署后问题才显现。

---

## 预防措施

- 新增 RLS 策略后，必须同步验证 client 端是否已传递对应 header
- `buildSupabaseClientCode` 的集成测试（SB-07）已覆盖此断言，防止回归
