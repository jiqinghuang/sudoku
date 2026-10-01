/* UI 接线测试：用最小 DOM stub 真正执行 dist/ui.js（index.html 加载的同一份界面脚本）
   目的是覆盖「求解 → 步骤表 → 上一步/下一步」这条链路，
   而不是只测纯函数 Sudoku.solve()。
   覆盖两条调度路径：U1–U7 在 Node 无 Worker，走的是「同步回退」分支
   （与浏览器 file:// 场景同一条）；U8 注入假 Worker，覆盖有 Worker 时的
   正常应答与各类失败降级。Worker 消息契约本身由 test.ts 的 [11] 段验证。 */
const fs = require('fs');
const Sudoku = require('./solver.js') as SudokuAPI;
const script = fs.readFileSync(__dirname + '/ui.js', 'utf8');   // 与 index.html 实际加载的一致

// 测试里直接访问 solve() 结果的松散字段（final 等），统一解包为 any
const solveAny = (g: number[]): any => Sudoku.solve(g);

let pass = 0, fail = 0;
const ok = (c: unknown, m: string): void => { c ? (pass++, console.log('  PASS ' + m)) : (fail++, console.log('  FAIL ' + m)); };

/* 分段执行：某一段抛出的运行时异常只记一次失败并继续跑完其余段落，
   不会中断整个测试文件。 */
function section(name: string, fn: () => void): void {
  console.log('\n[' + name + ']');
  try { fn(); } catch (e) { fail++; console.log('  FAIL 段落异常 [' + name + ']：' + (e as Error).message); }
}

/* ---------- 最小 DOM stub ---------- */
interface StubEl {
  tagName: string; textContent: string; value: string; type: string; className: string;
  checked: boolean; disabled: boolean; dataset: Record<string, string>; style: Record<string, unknown>;
  children: StubEl[]; onclick: any; ondblclick: any;
  _html: string; innerHTML: string;
  appendChild(c: StubEl): StubEl;
  classList: { add(): void };
  scrollIntoView(opts?: unknown): void;
  querySelectorAll(sel: string): StubEl[];
  querySelector(sel: string): StubEl | null;
}

function mkEl(tag?: string): StubEl {
  const t = (tag || 'div').toUpperCase();
  const el: StubEl = {
    tagName: t, textContent: '', value: '', type: '', className: '', checked: false, disabled: false,
    dataset: {}, style: {}, children: [], onclick: null, ondblclick: null,
    _html: '',
    get innerHTML() {                       // 只按出现次数造子节点，够测试用
      return this._html;
    },
    set innerHTML(v: string) {
      this._html = String(v);
      this.children = [...String(v).matchAll(/<(li|button|div|span|i)\b/g)].map(m => mkEl(m[1]));
    },
    appendChild(c) { this.children.push(c); return c; },
    classList: { add() {} },
    scrollIntoView() {},
    querySelectorAll(sel) {
      const want = sel.replace(/[^a-z]/gi, '').toUpperCase();
      return this.children.filter(c => c.tagName === want);
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
  };
  return el;
}
const cache: Record<string, StubEl> = {};
const document = {
  querySelector: (sel: string): StubEl => (cache[sel] || (cache[sel] = mkEl())),
  querySelectorAll: (): StubEl[] => [],
  createElement: (tag: string): StubEl => mkEl(tag),
  addEventListener(): void {},
};
let keyHandler: ((e: any) => void) | null = null;

interface UiApi {
  doSolve(): void; goto(n: number): void; stop(): void; editGiven(i: number, v: number): void;
  bitsOf(m: number): number[];
  readonly cur: number; readonly steps: Step[]; readonly sel: number;
  given: number[];
}

/* 每次调用都跑出一份全新的界面实例（模块级状态相互独立），供 U8 反复注入不同的 Worker。 */
const loadUi = (): UiApi => new Function('document', 'addEventListener', 'alert', 'Sudoku', script + `
  ;return { doSolve, goto, stop, editGiven, bitsOf,
           get cur() { return cur; }, get steps() { return steps; },
           get sel() { return sel; },
           get given() { return given; }, set given(v) { given = v; } };
`)(document, (type: string, fn: (e: any) => void): void => { if (type === 'keydown') keyHandler = fn; }, (): void => {}, Sudoku) as UiApi;

const api = loadUi();

const WIKI = '530070000600195000098000060800060003400803001700020006060000280000419005000080079'
  .split('').map(Number);

section('U1 求解 → 步骤表 → 上一步/下一步', () => {
  api.given = WIKI.slice();
  api.doSolve();
  ok(/唯一解/.test(cache['#diag'].innerHTML), '诊断面板判定为唯一解');
  ok(api.steps.length > 0, `求解后 steps 非空（实际 ${api.steps.length} 步）`);
  ok(api.cur === 0, '求解后 cur 归零');
  ok(/共 \d+ 步/.test(cache['#tState'].textContent), `状态标签更新: "${cache['#tState'].textContent}"`);
  ok(cache['#board'].children.length === 81, `棋盘节点只建一次（${cache['#board'].children.length} 格）`);

  api.goto(1);
  ok(api.cur === 1, `点「下一步」cur 前进到 1（实际 ${api.cur}）`);
  const reasonAfter1 = cache['#reason'].innerHTML;
  ok(/R\dC\d/.test(reasonAfter1), '理由面板显示了格子位置');
  ok(/【.+】/.test(reasonAfter1), '理由面板显示了技巧标签');
  ok(cache['#rIdx'].textContent.includes('/'), `右上角显示步号: "${cache['#rIdx'].textContent}"`);

  api.goto(3); ok(api.cur === 3, `连续前进到第 3 步（实际 ${api.cur}）`);
  api.goto(2); ok(api.cur === 2, `点「上一步」回退到第 2 步（实际 ${api.cur}）`);
  api.goto(0); ok(api.cur === 0, '回到开头');
  api.goto(-5); ok(api.cur === 0, `越界后退不会变负（实际 ${api.cur}）`);
  api.goto(9999); ok(api.cur === api.steps.length, `越界前进夹在末步（${api.cur} / ${api.steps.length}）`);

  const liCount = cache['#steps'].querySelectorAll('li').length;
  ok(liCount === api.steps.length, `步骤列表渲染了 ${liCount} 行，与步骤数一致`);
  ok(/步（填数/.test(cache['#sCnt'].textContent), `步骤计数: "${cache['#sCnt'].textContent}"`);
});

section('U2 逐步回放的盘面必须与步骤严格对应', () => {
  const g = api.given, st = api.steps;
  let mismatch = 0;
  for (let k = 1; k <= st.length; k++) {
    const s = Sudoku.stateAt(g, st, k);
    if (Array.from(s.val).filter(Boolean).length !==
        g.filter(Boolean).length + st.slice(0, k).reduce((n, x) => n + (x.kind === 'place' ? x.moves.length : 0), 0)) mismatch++;
  }
  ok(mismatch === 0, `${st.length} 步回放，每步已填格数自洽（异常 ${mismatch} 处）`);
  const fin = Sudoku.stateAt(g, st, st.length);
  const sol = solveAny(g);
  ok(Array.from(fin.val).join('') === sol.final.join(''), '回放到底的盘面 == 唯一解');
});

section('U3 题目异常时步骤表必须为空，状态标签不能残留旧值', () => {
  const save = api.given.slice();
  const bad = save.slice(); bad[0] = 5; bad[1] = 5;          // 同行重复
  api.given = bad; api.doSolve();
  ok(api.steps.length === 0, '冲突题 -> 步骤表为空');
  ok(/重复/.test(cache['#diag'].innerHTML), '冲突题 -> 诊断面板说明原因');
  ok(cache['#tState'].textContent === '题目有误', `冲突题 -> 状态标签更新: "${cache['#tState'].textContent}"`);
  api.goto(5); ok(api.cur === 0, '冲突题点「下一步」不会有任何变化');

  const multi = new Array(81).fill(0);                        // 空盘 = 多解
  api.given = multi; api.doSolve();
  ok(api.steps.length === 0, '多解题 -> 步骤表为空');
  ok(/不唯一/.test(cache['#diag'].innerHTML), '多解题 -> 诊断面板说明原因');
  ok(cache['#tState'].textContent === '多解', `多解题 -> 状态标签更新: "${cache['#tState'].textContent}"`);

  api.given = Array.from(solveAny(save).final);               // 填满
  api.doSolve();
  ok(api.steps.length === 0, '已填满 -> 无需推理');
  api.given = save;
});

section('U4 生成题目后可直接回放', () => {
  api.given = new Array(81).fill(0);
  api.doSolve();
  ok(api.steps.length === 0, '空盘判定为多解且不产生步骤');

  for (const mc of [40, 34, 28, 24]) {
    const p = Sudoku.generatePuzzle(mc);
    api.given = p; api.doSolve();
    const okS = api.steps.length > 0 && api.cur === 0;
    api.goto(1); const moved = api.cur === 1;
    api.goto(api.steps.length);
    const fin = Array.from(Sudoku.stateAt(p, api.steps, api.steps.length).val).join('');
    ok(okS && moved && fin === solveAny(p).final.join(''),
       `clues≈${p.filter(Boolean).length} 的题：${api.steps.length} 步，可前进，可回放到解`);
  }
});

section('U5 键盘/数字键盘修改谜面路径一致，状态标签不残留', () => {
  api.given = WIKI.slice(); api.doSolve();
  ok(/共 \d+ 步/.test(cache['#tState'].textContent), '求解成功后状态标签为步数');

  // 键盘路径
  const selBefore = api.sel;
  keyHandler!({ key: '5', target: { tagName: 'DIV' }, preventDefault() {} });
  ok(api.given[selBefore] === 5 && api.steps.length === 0 && api.cur === 0, '键盘填数：写入谜面并清空步骤');
  ok(cache['#tState'].textContent === '未解题', `键盘填数后状态标签重置: "${cache['#tState'].textContent}"`);
  ok(/已修改谜面/.test(cache['#diag'].innerHTML), '键盘填数后诊断面板提示重新求解');

  // 数字键盘路径（直接调 editGiven，与按钮 onclick 同一函数）
  api.editGiven(0, 9);
  ok(api.given[0] === 9 && api.steps.length === 0, '数字键盘路径同样清空步骤');
  ok(cache['#tState'].textContent === '未解题', '数字键盘路径同样重置状态标签');
  ok(cache['#board'].children.length === 81, `多次重绘后棋盘节点不重复堆积（${cache['#board'].children.length} 格）`);
});

section('U6 批量步骤的界面渲染', () => {
  api.given = WIKI.slice(); api.doSolve();            // U5 改过谜面，这里重新求解
  const bi = api.steps.findIndex(s => s.kind === 'place' && s.moves.length > 1);
  const batch = api.steps[bi] as PlaceStep | undefined;
  ok(bi >= 0 && !!batch, `存在批量步骤（第 ${bi + 1} 步，${batch ? batch.moves.length : 0} 格）`);
  api.goto(bi + 1);
  const html = cache['#reason'].innerHTML;
  const st = batch!;
  ok(new RegExp(`本步 ${st.moves.length} 格`).test(html), '理由面板显示本步格数');
  ok(st.moves.every(mv => html.includes(Sudoku.nm(mv.i))), '理由面板列出每一格的推理');
  ok(/涉及单元/.test(html) && /推理格/.test(html), '理由面板带图例');
  ok(cache['#sCnt'].textContent.includes(`填数 ${st.moves.length}`) || /填数 \d+/.test(cache['#sCnt'].textContent), `步骤计数按格统计: "${cache['#sCnt'].textContent}"`);
});

section('U7 排除步骤：被划掉的候选必须回显且带删除线', () => {
  const xw = '.7..28...32....59...........1.....468.4.9.1......3.....6.28..5....9.4.7.1........'
    .split('').map(c => c === '.' ? 0 : +c);
  api.given = xw; api.doSolve();
  const bi = api.steps.findIndex(s => s.kind === 'elim');
  ok(bi >= 0, `存在排除步骤（第 ${bi + 1} 步）`);
  api.goto(bi + 1);
  const st = api.steps[bi] as ElimStep | undefined;
  let strikeCells = 0, shownDigits = 0;
  const cells = st?.cells ?? [];
  for (const i of cells) {
    const html = cache['#board'].children[i].children[1].innerHTML;
    if (/class="strike"/.test(html)) strikeCells++;
    for (const d of Sudoku.bits(st?.mask ?? 0)) if (html.includes(`>${d}</i>`)) shownDigits++;
  }
  ok(strikeCells > 0, `排除格回显了被划掉的候选（${strikeCells}/${cells.length} 格）`);
  ok(shownDigits > 0, `划掉的数字仍在候选里显示（${shownDigits} 处）`);
});

/* ---------- U8: Worker 分支（Node 默认环境下 ui.js 走不到的唯一一段） ----------
   ui.js 里 Worker 是自由变量，在 new Function 沙箱中解析到 globalThis：
   注入假 Worker 即可覆盖「有 Worker」的全部路径（含降级），无需真实浏览器。 */
section('U8 Worker 分支：正常应答 / 各类失败降级均不卡死', () => {
  const g = globalThis as unknown as { Worker?: unknown };
  const savedWorker = g.Worker, savedWarn = console.warn;
  console.warn = (): void => {};                 // 屏蔽 [worker] 降级告警，保持测试输出干净
  const solved = (g2: any): number => g2.steps.length;
  try {
    // W1 正常异步应答：Worker 算完回 { id, data }
    g.Worker = class { onmessage: any = null; onerror: any = null;
      postMessage(m: any): void { this.onmessage({ data: { id: m.id, data: Sudoku.solve(m.given) } }); } };
    const w1 = loadUi(); w1.given = WIKI.slice(); w1.doSolve();
    ok(solved(w1) > 0, `W1 Worker 正常应答：按 id 收到结果并渲染（${solved(w1)} 步）`);
    ok(/唯一解/.test(cache['#diag'].innerHTML), 'W1 诊断面板判定为唯一解');
    ok(cache['#bSolve'].disabled === false, 'W1 任务完成后按钮恢复可用');

    // W2 脚本加载/运行失败（404、CSP、Worker 内抛错）→ onerror 结清在途任务并退回同步
    g.Worker = class { onmessage: any = null; onerror: any = null;
      postMessage(): void { this.onerror({ type: 'error', message: 'stub: load failed' }); } };
    const w2 = loadUi(); w2.given = WIKI.slice(); w2.doSolve();
    ok(solved(w2) > 0, `W2 onerror 降级：同步回退拿到完整步骤（${solved(w2)} 步）`);
    ok(cache['#bSolve'].disabled === false, 'W2 降级后按钮恢复可用（未卡在禁用态）');

    // W3 投递期抛错（结构化克隆失败等）→ 就地退回同步
    g.Worker = class { onmessage: any = null; onerror: any = null;
      postMessage(): void { throw new Error('stub: DataCloneError'); } };
    const w3 = loadUi(); w3.given = WIKI.slice(); w3.doSolve();
    ok(solved(w3) > 0, `W3 投递抛错降级：任务仍被结清（${solved(w3)} 步）`);
    ok(cache['#bSolve'].disabled === false, 'W3 投递失败后按钮恢复可用');

    // W4 构造即抛错（file:// 双击打开的 SecurityError）
    g.Worker = class { constructor() { throw new Error('stub: SecurityError'); } };
    const w4 = loadUi(); w4.given = WIKI.slice(); w4.doSolve();
    ok(solved(w4) > 0, `W4 Worker 构造抛错：同步路径完全可用（${solved(w4)} 步）`);

    // W5 降级后同步求解也抛错 → fail 回调收尾，界面恢复可交互（回归：busy 永久卡死）
    g.Worker = class { onmessage: any = null; onerror: any = null;
      postMessage(): void { this.onerror({ type: 'error', message: 'stub: boom' }); } };
    const w5 = loadUi(); w5.given = WIKI.slice();
    const realSolve = (Sudoku as any).solve;
    (Sudoku as any).solve = (): never => { throw new Error('stub: solver boom'); };
    try { w5.doSolve(); } finally { (Sudoku as any).solve = realSolve; }
    ok(solved(w5) === 0, 'W5 求解抛错：不产生半成品步骤');
    ok(cache['#bSolve'].disabled === false, 'W5 求解抛错后按钮恢复可用（回归：卡死）');
    ok(/求解出错/.test(cache['#diag'].innerHTML), 'W5 诊断面板如实报错');
    ok(cache['#tState'].textContent === '求解失败', 'W5 状态标签切到失败态');
  } finally {
    console.warn = savedWarn;
    if (savedWorker === undefined) delete g.Worker; else g.Worker = savedWorker;
  }
});

console.log(`\n========== UI 测试 通过 ${pass} / 失败 ${fail} ==========`);
process.exit(fail ? 1 : 0);

export {};
