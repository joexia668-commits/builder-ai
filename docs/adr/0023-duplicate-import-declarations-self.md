# 0023 — LLM 生成重复 import 声明导致 SyntaxError（自发现）

## 问题描述

LLM 在同一文件中多次 import 同一模块的不同成员，导致 Sandpack Babel 编译报错：

```
Identifier 'useState' has already been declared. (131:9)
```

典型场景：文件顶部 `import { useState } from 'react'`，文件中间又出现 `import { useState, useEffect } from 'react'`。

## 根因

LLM 在生成较长文件时（150+ 行），容易在不同逻辑段重复写 import 语句。Sandpack 使用的 Babel 编译器不允许同一作用域内重复声明同名绑定。此前无任何后处理逻辑检测和合并重复 import。

## 修复

在 `lib/sandpack-config.ts` 新增 `deduplicateImports()` 函数，在 `normalizeExports()` 之后、送入 Sandpack 之前执行：

1. 扫描所有 `import { ... } from '...'` 语句
2. 检测同一模块被 import 多次的情况
3. 将所有 named imports 合并到第一次出现的位置
4. 删除后续重复的 import 行

示例：
```
// 修复前
import { useState } from 'react';       // 第 1 行
import { useState, useEffect } from 'react';  // 第 131 行 → 报错

// 修复后
import { useState, useEffect } from 'react';  // 第 1 行（合并）
```

## 预防措施

- `deduplicateImports` 作为通用后处理步骤，对所有生成的文件生效
- 不依赖 LLM 行为改变，纯确定性修复
