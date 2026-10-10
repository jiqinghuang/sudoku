/* 求解 Worker（源码 src/worker.ts → 编译产物 dist/worker.js）
   ui.ts 在 Worker 可用时把耗时的 solve / generatePuzzle 委托到这里执行，
   避免专家题同步计算冻结界面；Worker 不可用（如 file:// 双击打开）时
   ui.ts 自动回退主线程同步执行，不影响功能。
   importScripts 加载的 solver.js 与页面加载的是同一份 dist 产物
   （UMD 包装：无 module 时挂到全局 self.Sudoku）。
   消息契约（与 ui.ts 的 runTask、test.ts 的 [11] 段对应）：
     收 { type:'solve', given, mode, id }   → 回 { id, data: SolveResult }
     （mode:'fast' | 'teach' 原样转交 Sudoku.solve；省略等价于 fast，兼容旧客户端）
     收 { type:'generate', difficulty, id }  → 回 { id, data: number[]（81 格谜面） }
      （difficulty:'easy'|'medium'|'hard'|'expert'，按实际所需最高技巧定级出题；
        旧客户端若仍传 minClues，则退回复用旧的按线索数挖空）
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
  // mode 原样转交 Sudoku.solve（fast / teach），保证 Worker 与主线程同步路径的步骤表一致
  if (msg.type === 'solve') ctx.postMessage({ id: msg.id, data: Sudoku.solve(msg.given, { mode: msg.mode }) });
  else if (msg.type === 'generate') ctx.postMessage({ id: msg.id,
    data: msg.difficulty ? Sudoku.generateByDifficulty(msg.difficulty) : Sudoku.generatePuzzle(msg.minClues) });
};
