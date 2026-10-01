# 数独 · 逐步解 (Sudoku Step Solver)

零依赖的数独求解 + 逐步推理演示：每一步都给出中文理由，可前进 / 后退 / 自动播放。
TypeScript 源码在 `src/`，`tsc` 编译产物在 `dist/`（随仓库提交，浏览器只加载产物）。

## 使用

直接用浏览器打开 `index.html` 即可（无需服务器）。

- 手动输入：点击格子后用键盘 `1`–`9` 填数，`0`/`Del` 清除
- 粘贴谜面：支持 81 字符（`0`/`.`/`-` 表示空）、`.` 分隔的 81 格、9 行×9 格，可带 `0.` 行号前缀
- 随机题：简单 / 中等 / 困难 / 专家，生成时保证唯一解
- 快捷键：`Enter` 下一步 · `Backspace` 上一步 · `空格` 自动播放 · `双击` 跳到该步

## 文件

| 文件 | 说明 |
| --- | --- |
| `index.html` | 界面骨架（HTML + CSS），加载 `dist/solver.js` 与 `dist/ui.js` |
| `src/solver.ts` | 求解器源码：位运算 + 约束传播 + 唯一解搜索 + 回放/生成（浏览器与 Node 共用） |
| `src/ui.ts` | 界面逻辑源码：渲染、回放、键盘 / 粘贴 / 随机题 |
| `src/test.ts` | 求解器测试：正确性、回放、与朴素 DFS 对拍、技巧回归 |
| `src/uitest.ts` | UI 接线测试：最小 DOM stub 执行 dist/ui.js |
| `src/globals.d.ts` | 最小环境类型声明（刻意不引入 @types/node） |
| `dist/` | 编译产物，随仓库提交；`npm test` 测的就是这份代码 |
| `tsconfig.json` | strict + CommonJS + ES2020 |

## 开发与测试

```bash
npm install        # typescript 是唯一 devDependency（运行时零依赖）
npm run build      # tsc：src/*.ts → dist/*.js
npm run typecheck  # 仅类型检查，不产出
npm test           # 先 build，再跑 node dist/test.js && node dist/uitest.js
```

改完 `src/` 记得 `npm run build`——`index.html` 加载的是 `dist/` 产物。
Node ≥ 22.18 也可以直接 `node src/test.ts`（类型剥离）做快速冒烟，但正式测试以 dist 为准。

## 求解器

- 推理技巧：唯一候选数、行/列/宫唯一、区块摒除、显性数对/三数组、隐性数对/三数组、X-Wing
- **一步可填多格**：同一盘面下所有互不依赖的确定格（唯一候选 + 行/列/宫唯一）合并成一步，
  每格保留各自的理由；批内顺序无关（`test.ts [10]` 有反序回放验证）
- 技巧不够时用 MRV 试填 + 回溯，步骤表中标记为「试填」
- `solve()` 在全程无试填时直接判定唯一解；有试填时才用 `findAll()` 复核解的数量
- `stateAt(given, steps, k)` 把前 k 步折叠成盘面，UI 回放与测试共用

## 步骤结构与可视化

每个技巧除了 `reason` 文字，还带 `meta` 高亮信息：

```ts
// 填数：moves 可含多格；排除：{ kind:'elim', mask, cells }
{ kind: 'place', moves: [{ i, v, tech, reason, meta }] }
meta = { units: [行/列/宫编号], focus: [推理格], marks: { 格号: { pick, strike } } }
```

界面据此渲染：浅蓝底＝涉及单元、琥珀框＝推理格、琥珀底＋✕＋红色删除线＝被排除的候选，
被划掉的候选即使已从盘面移除也会回显，方便对照理由。
