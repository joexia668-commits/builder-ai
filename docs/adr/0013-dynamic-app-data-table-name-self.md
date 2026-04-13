# ADR 0013 — DynamicAppData 表名不一致

**日期**: 2026-04-14  
**背景**: Claude 自发现（-self）；生成的应用查询 `dynamic_app_data`（snake_case），但 Supabase 表名为 `DynamicAppData`（PascalCase），导致 404

## 问题描述

Prisma model `DynamicAppData` 在数据库中创建 PascalCase 表名 `"DynamicAppData"`。但 Engineer 提示词中多处写的是 `dynamic_app_data`（snake_case），LLM 生成的代码用 `supabase.from('dynamic_app_data')` → Supabase 返回 404。

## 根因

提示词中 Supabase 表名与数据库实际表名不一致。

## 修复

将所有提示词中的 `dynamic_app_data` 统一为 `DynamicAppData`：
- `getSystemPrompt("engineer")` — 主 engineer 提示词
- `getMultiFileEngineerPrompt()` — 多文件 engineer 提示词  
- `buildMissingFileEngineerPrompt()` — 缺失文件补全提示词
- `buildMismatchedFilesEngineerPrompt()` — import/export 修复提示词

同步更新测试 `SB-01` 断言。

## 预防措施

- 表名使用 Prisma model 名而非猜测的 snake_case
- 后续如需改为 snake_case，应在 Prisma schema 加 `@@map("dynamic_app_data")` 并重新 push
