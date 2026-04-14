# ADR 0015 — normalizeExports 对 export default function 追加 named re-export 导致 Babel 报错

**日期**: 2026-04-14
**背景**: Claude 实现过程中自发现（-self）；用户在平台验证迭代功能时，第三轮 feature_add 后 Sandpack 报 SyntaxError

---

## 问题描述

Sandpack 预览面板报错：

```
SyntaxError: /App.js: Export 'App' is not defined. (36:9)

  34 | export default App;
  35 | // [builder-ai: export normalization]
> 36 | export { App };
     |          ^
```

---

## 根因

`lib/sandpack-config.ts` 的 `normalizeExports` 函数对所有只有 default export 没有 named export 的文件，追加 `export { Name };`。

对于 `export default function App() {}` 这种写法，标准 ES 规范确实会创建本地绑定 `App`，所以 `export { App }` 理论上合法。但 **Sandpack 使用的旧版 Babel 不认为 `export default function` 创建了可用于 `export { }` 的本地绑定**，导致编译报错 "Export 'App' is not defined"。

而 `function App() {} ... export default App;` 这种写法，`App` 是在上方声明的独立变量，`export { App }` 没有问题。

---

## 修复

在 `normalizeExports` 中区分两种 default export：

- `export default function/class Name` → **不追加** `export { Name }`（Babel 不兼容）
- `export default Name`（引用已有变量）→ 追加 `export { Name }`（安全）

```typescript
// 修复前
if (defaultName && !namedSet.has(defaultName)) {
  additions.push(`export { ${defaultName} };`);
}

// 修复后
if (defaultName && !namedSet.has(defaultName)) {
  if (!defaultFnMatch) {
    additions.push(`export { ${defaultName} };`);
  }
}
```

diff 涉及文件：
- `lib/sandpack-config.ts`：跳过 `export default function/class` 的 named re-export
- `__tests__/sandpack-config.test.ts`：更新测试，分别验证两种 case

---

## 为什么之前没暴露

前两轮生成中，AI 恰好使用了 `function App() {} export default App;` 的写法（先声明再 default export），normalizeExports 追加的 `export { App }` 没问题。第三轮 AI 切换到 `export default function App()` 的写法，触发了 Babel 不兼容。

---

## 预防措施

- 测试已覆盖两种 export default 写法，防止回归
- `normalizeExports` 的追加逻辑应尽量保守，只在确定安全时才修改代码
