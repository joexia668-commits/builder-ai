# 0019 - Hook 文件缺少 React Hooks 显式导入

## 问题描述

多文件生成场景下，`/hooks/useSettings.js` 等独立 hook 文件频繁出现运行时报错：

```
useState is not defined (2:34)
```

错误发生在 Sandpack 预览沙箱内，页面白屏无法使用。

## 根因

LLM 在生成独立 hook 文件时漏写 React hooks 的 import 语句：

```javascript
// ❌ 错误：直接使用 useState，未 import
export function useSettings() {
  const [volume, setVolume] = useState(50);  // ReferenceError
}
```

`App.js` 较少出现此问题，因为 LLM 习惯在 App.js 写完整 import。但对于 `/hooks/*.js`、`/utils/*.js` 等子文件，LLM 经常依赖"全局可用"的错误假设。

Sandpack 沙箱不会自动注入任何全局变量，每个文件必须显式导入所需的 React hooks。

## 修复

在 `lib/generate-prompts.ts` 的 `getMultiFileEngineerPrompt` 严禁包限制块之后，新增强制规则：

```
【React Hooks 导入规则 - 每个文件必须显式导入】
每个使用 React hooks 的文件顶部必须有明确的 import 语句，Sandpack 沙箱不会自动注入：
  import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
错误：直接使用 useState(...) 而不 import → 运行时报错"useState is not defined"
正确：文件第一行写 import { useState } from 'react'，只导入本文件实际用到的 hooks。
```

## 预防措施

- 规则置于 prompt 严禁包块之后，属于高可见位置，LLM 读到此处时尚未开始生成代码
- 只约束多文件路径（`getMultiFileEngineerPrompt`）；单文件 App.js 路径（`getSystemPrompt("engineer")`）已有"可以使用 React hooks"的说明，实际出现率低，暂不修改
- 若后续在单文件路径也出现此问题，在 `getSystemPrompt("engineer")` 对应位置补充相同规则
