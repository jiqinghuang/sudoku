/* 求解 Worker（源码 src/worker.ts → 编译产物 dist/worker.js）
   ui.ts 在 Worker 可用时把耗时的 solve / generatePuzzle 委托到这里执行，
   避免专家题同步计算冻结界面；Worker 不可用（如 file:// 双击打开）时
   ui.ts 自动回退主线程同步执行，不影响功能。
   importScripts 加载的 solver.js 与页面加载的是同一份 dist 产物
   （UMD 包装：无 module 时挂到全局 self.Sudoku）。
   消息契约（与 ui.ts 的 runTask、test.ts 的 [11] 段对应）：
     收 { type:'solve', given, id }       → 回 { id, data: SolveResult }
     收 { type:'generate', minClues, id }  → 回 { id, data: number[]（81 格谜面） }
     未知 type 一律忽略（不回复、不崩溃）。 */

/* Worker 全局与页面共享 self 符号，但 DOM 类型库只认 Window——
   这里按需收窄成 Worker 侧实际用到的最小接口面。 */
const ctx = self as unknown as {
  importScripts(...urls: string[]): void;
  onmessage: ((e: { data: any }) => void) | null;
  postMessage(message: unknown): void;
};

ctx.importScripts('solver.js');

ctx.onmessage = (e): void => {
  const msg = e.data;
  if (msg.type === 'solve') ctx.postMessage({ id: msg.id, data: Sudoku.solve(msg.given) });
  else if (msg.type === 'generate') ctx.postMessage({ id: msg.id, data: Sudoku.generatePuzzle(msg.minClues) });
};
