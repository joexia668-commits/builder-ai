# 0022 — 自定义 Hook 返回值格式不一致导致 TypeError

## 问题描述

生成超级马里奥等多文件项目时，自定义 hook（如 `useGameData`）返回对象 `{ gameData, updateGameData }`，但调用方用数组解构 `const [gameData, updateGameData] = useGameData()`，导致运行时报错：

```
/App.js: object is not iterable (cannot read property Symbol(Symbol.iterator))
```

## 根因

多文件并行生成时，hook 文件和调用方文件由不同的 Engineer 请求独立生成。Architect scaffold 只描述了 `exports: ["useGameData"]`，没有约束返回值格式。两个独立的 LLM 请求对 "hook 返回数组还是对象" 各自做了不同假设。

## 修复

在 `lib/generate-prompts.ts` 的 `getMultiFileEngineerPrompt` 中新增规则：

- 自定义 hook 必须返回**对象**（`return { data, loading, update }`）
- 调用方必须用**对象解构**（`const { data, loading, update } = useXxx()`）
- 禁止 hook 返回数组，因为数组解构依赖位置顺序，多文件并行生成时无法保证一致

选择对象而非数组的原因：对象解构靠属性名匹配，即使 hook 和调用方的字段顺序不同也不会出错。

## 预防措施

- 通用规则已加入 Engineer multi-file prompt，所有多文件项目生效
- 未来如果 Architect scaffold 能描述 hook 返回值 schema（如 `returns: { data: GameState, update: Function }`），可以进一步约束
