# Guest Session Restore — Design Spec

**Date:** 2026-04-11  
**File affected:** `components/layout/guest-login-buttons.tsx`

## Problem

当 localStorage 存有 `builder_ai_guest_id` 时，登录页同时显示 "Continue as Guest" 和 "Try as Guest" 两个按钮。用户误点 "Try as Guest" 会创建新 guest 账号并覆盖 localStorage，导致旧 guest 账号的项目永久丢失。

## Correct Behavior

| localStorage 状态 | 显示按钮 |
|---|---|
| 无 guest ID | 只显示 "Try as Guest" |
| 有 guest ID（账号有效） | 只显示 "Continue as Guest" |
| 有 guest ID（账号已过期被清理） | 显示错误提示 + "Try as Guest" |

## State Changes

添加 `expiredSession: boolean` state（默认 `false`）：

- `true`：账号恢复失败，账号已被清理
- `false`：正常状态

## handleRestoreGuest — 修改点

将 `signIn` 改为 `redirect: false`，在组件内处理结果：

```
result = await signIn("credentials", { guestId: savedGuestId, redirect: false })

if result.error:
  localStorage.removeItem(STORAGE_KEY)
  setSavedGuestId(null)
  setExpiredSession(true)
else:
  router.push("/")
```

## 错误提示 UI

在按钮区域上方显示 banner，条件：`expiredSession === true`：

> ⚠ 你的访客会话已过期，之前的项目已被清除。

样式：浅橙/浅红背景，小号文字，不遮挡主流程。

用户点击 "Try as Guest" 后创建新账号，错误提示自动消失（`setSavedGuestId` 会更新，`expiredSession` 重置为 `false`）。

## 无需改动的文件

- `lib/auth.ts` — `authorize()` 返回 `null` 的行为已正确（账号不存在时 signIn 失败）
- `app/api/auth/guest/guest-service.ts`
- `app/api/auth/guest/route.ts`

## 测试要点

- 首次访问：只显示 "Try as Guest"
- 登录后退出：只显示 "Continue as Guest"，无 "Try as Guest"
- 账号过期后点 "Continue as Guest"：显示错误提示，localStorage 清除，显示 "Try as Guest"
- 点 "Try as Guest" 后重新登录：正常创建新账号，错误提示消失
