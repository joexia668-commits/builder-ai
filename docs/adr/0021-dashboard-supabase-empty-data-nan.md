# 0021 — Dashboard 场景从 Supabase 读空数据导致 NaN 崩溃

## 问题描述

生成数据仪表盘类应用时，LLM 生成的代码从 Supabase `DynamicAppData` 表读取数据（如 `sales`），但沙箱环境中该表为空，请求返回 406 (Not Acceptable) 或空数组。图表组件用空/undefined 值计算 SVG 坐标，产生 NaN，导致：

```
GET .../rest/v1/DynamicAppData?select=data&appId=eq.xxx&key=eq.sales 406 (Not Acceptable)
Error: <polyline> attribute points: Expected number, "20,NaN 60,NaN 100,N…"
Received NaN for the `cy` attribute.
```

## 根因

`lib/scene-rules.ts` 的 dashboard 场景规则只约束了图表实现方式（纯 SVG，禁 recharts），但没有约束数据来源。LLM 看到 Engineer prompt 中有 Supabase 可用的说明，就自作主张从远程读取数据，而沙箱环境不会预置任何数据。

## 修复

在 dashboard 场景规则中新增第 7 条规则：

```diff
+ 7. 数据源：仪表盘必须使用 hardcoded mock 数据（直接定义在组件或常量文件中），
+    禁止从 Supabase 或任何远程 API 读取数据。
+    原因：沙箱环境无预置数据，远程请求必然返回空/报错导致图表渲染 NaN
```

同时补充了错误示例和正确示例（含 mock 数据写法）。

## 预防措施

- 对于展示类场景（dashboard、landing page），场景规则应明确禁止远程数据依赖
- 未来如有其他纯展示场景，同样需在场景规则中约束数据来源为 hardcoded mock
