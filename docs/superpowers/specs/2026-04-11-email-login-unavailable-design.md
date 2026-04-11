# Email Login Unavailable Notice — Design

**Goal:** Visually disable the email login form and inform users it's temporarily unavailable (no verified domain on Resend free tier).

**Architecture:** Single-component change to `EmailLoginForm`. No new files, no API changes.

---

## Changes

### `components/layout/email-login-form.tsx`

- Input: `disabled={true}`, placeholder → `"邮箱登录暂不可用"`
- Button: `disabled={true}`, text remains `"发送登录链接"`
- Add a line of small text below the button: `"📧 域名验证后即可开放使用"`
- Remove the loading state logic (form is always disabled, no submission needed)

## Visual Result

```
[ 邮箱登录暂不可用              ]   ← input, greyed out
[ 发送登录链接                  ]   ← button, greyed out
  📧 域名验证后即可开放使用         ← small hint text
```

## Out of Scope

- No feature flag or env var toggle (re-enable by reverting this change when domain is ready)
- No backend changes
