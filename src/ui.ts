/* 数独逐步解 · 界面（源码 src/ui.ts → 编译产物 dist/ui.js）
   浏览器由 index.html 依次加载 dist/solver.js（挂载全局 Sudoku）与本文件；
   uitest.ts 用最小 DOM stub 直接执行同一份 dist/ui.js 做接线测试。 */
const $ = (s: string): any => document.querySelector(s);      // 页面很小，DOM 查找统一按 any 处理
const board = $('#board'), pad = $('#pad');
let given: number[] = new Array(81).fill(0);
let steps: Step[] = [], cur = 0, sel = 40,
    playing: number | null = null, showCands = false, showElims = true;
/* 讲解模式：一步一格（true，默认）还是同类确定格合并成一步（false）。
   两条模式都来自同一次推理，只是步骤表的展示粒度不同——见 solver.solve 的 opts.mode。 */
let stepMode = true;
/* 讲解模式下用来标注「这 N 步其实是同一次推理」的原始推理步数，由 applySteps 还原 */
let teachBatchSteps = 0;
/* 批量步的逐格理由是否展开：'步骤序号:格序' 集合，折叠状态跨重绘保留 */
const openMoves = new Set<string>();

/* ---- 状态折叠由 solver.js 的 Sudoku.stateAt(given, steps, k) 提供 ---- */

/* ---- HTML 转义：拼进 innerHTML 的动态文本必须经此处理 ----
   当前动态文本全部由求解器生成（数字、格名、中文说明），本身不含 HTML 特殊字符；
   转义属纵深防御——将来引入外部文本（如恢复粘贴载入）时不会形成注入点。
   结构性模板与内部常量（TECHN、Sudoku.nm 等）无需转义。
   入参按 unknown 接收并 String() 化：solver 新增技巧而 TECHN 忘记同步时
   techLabel() 会返回 undefined，此处不应再抛错把整个 render 打断。 */
const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);

const bitsOf = Sudoku.bits;

/* ---- 求解任务调度：优先走 Web Worker（dist/worker.js），专家题不冻结界面 ----
   Worker 不可用（file:// 双击打开、脚本加载失败）时自动回退主线程同步执行——
   两条路径跑的是同一份 dist/solver.js，行为一致；Node 下的 uitest 无 Worker，
   走的正是同步回退路径。epoch 是谜面版本号：任何修改谜面的操作都会使其自增，
   异步等待期间谜面若被改动，过期结果按版本丢弃。
   任务一定以「成功回调」或 fail 回调结束：同步求解抛错、postMessage 投递失败、
   Worker 内异常回退重试再抛错，都由 settle() 兜住，保证调用方的 setBusy(false)
   必定执行——否则按钮会永久停在禁用态、状态标签永远显示「求解中…」。 */
type SolveMsg = { type: 'solve'; given: number[]; mode: 'fast' | 'teach' };
type TaskMsg = SolveMsg | { type: 'generate'; minClues: number };
interface PendingTask { msg: TaskMsg; fn: (data: any) => void; fail: (err: unknown) => void }

let worker: Worker | null = null, workerBroken = false, taskId = 0, busy = false, epoch = 0;
const pending: Map<number, PendingTask> = new Map();
try { worker = new Worker('dist/worker.js'); }
catch (e) { workerBroken = true; console.warn('[worker] 不可用，改为主线程同步求解：' + (e as Error).message); }

const runSync = (msg: TaskMsg): any =>
  msg.type === 'solve' ? Sudoku.solve(msg.given, { mode: msg.mode }) : Sudoku.generatePuzzle(msg.minClues);

/* 同步执行并兜住异常：这是「派发失败后重试」与「无 Worker 直接同步」两条路径的共同出口。 */
function settle(p: PendingTask): void {
  try { p.fn(runSync(p.msg)); } catch (e) { p.fail(e); }
}

function runTask(msg: TaskMsg, fn: (data: any) => void, fail: (err: unknown) => void): void {
  const p: PendingTask = { msg, fn, fail };
  if (!worker || workerBroken) { settle(p); return; }
  const id = ++taskId;
  pending.set(id, p);
  try { worker.postMessage(Object.assign({ id }, msg)); }
  catch (e) {   // 结构化克隆失败等投递期异常：就地退回同步，不把任务悬在 pending 里
    console.warn('[worker] 投递失败，回退同步执行：' + (e as Error).message);
    pending.delete(id); settle(p);
  }
}

function setBusy(on: boolean): void {   // 任务在途：禁用会触发新任务的按钮，防重复提交
  busy = on;
  $('#bSolve').disabled = on;
  (document.querySelectorAll('[data-gen]') as NodeListOf<HTMLElement>).forEach((b: any) => { b.disabled = on; });
}

if (worker) {
  worker.onmessage = (e: MessageEvent): void => {
    const p = pending.get(e.data.id);
    if (p) { pending.delete(e.data.id); try { p.fn(e.data.data); } catch (err) { p.fail(err); } }
  };
  worker.onerror = (e: ErrorEvent): void => {   // 脚本 404 / 被 CSP 拦截 / Worker 内求解抛错
    console.warn('[worker] 运行失败，改为主线程同步求解：' + (e.message || e.type));
    workerBroken = true; worker = null;        // 一次性退回同步路径，不反复重试坏掉的 Worker
    const tasks = [...pending.values()];
    pending.clear();
    for (const t of tasks) settle(t);
  };
}

/* ---- 棋盘渲染（节点只建一次，之后只更新类名与内容） ---- */
interface CellRefs { el: HTMLDivElement; v: HTMLSpanElement; cands: HTMLDivElement; badge: HTMLSpanElement }
const cellEls: CellRefs[] = [];
function buildBoard(): void {
  board.innerHTML = '';
  for (let i = 0; i < 81; i++) {
    const el = document.createElement('div');
    const v = document.createElement('span'); v.className = 'v';
    const cands = document.createElement('div'); cands.className = 'cands';
    const badge = document.createElement('span'); badge.className = 'badge';
    el.appendChild(v); el.appendChild(cands); el.appendChild(badge);
    el.onclick = () => { sel = i; render(); };
    el.ondblclick = () => { const n = steps.findIndex(s2 => s2.kind === 'place' && s2.moves.some(m => m.i === i)); if (n >= 0) { cur = n + 1; render(); } };
    board.appendChild(el);
    cellEls.push({ el, v, cands, badge });
  }
}

/* ---- 步骤表装载：把求解结果写入当前步骤表。
   求解始终先跑 fast 模式拿到「规范步骤表」，再由 solver 按 mode 拆成一步一格——
   两条模式的推理路径与终盘因此完全一致，只是展示粒度不同。
   cur 夹在新表长度内：切模式后不会停在不存在的步号上。 ---- */
function applySteps(data: any): void {
  steps = data.steps || [];
  // 讲解模式下，一个 fast 步会被拆成多步贴在一起，它们属于同一次推理：据此还原「推理步数」
  const before = (k: number): number[] => Array.from(Sudoku.stateAt(given, steps, k).val);
  let bs = 0, prev = -1;
  for (let k = 1; k <= steps.length; k++) {
    const st = steps[k - 1];
    if (st.kind !== 'place') continue;
    if (steps[k] === undefined) break;                  // 末尾整批尚未落盘：不计入已完成批次
    const v = before(k); let applied = 0;
    for (const mv of st.moves) if (v[mv.i]) applied++;
    if (applied > 0 && applied !== prev) bs++;          // 已落盘格数跳变 = 进入下一批
    prev = applied;
  }
  teachBatchSteps = bs;
  if (cur > steps.length) cur = steps.length;
}

function stepMeta(st: Step): { units: Set<number>; focus: Set<number>; marks: Record<string, StepMetaMarks> } {
  const units = new Set<number>(), focus = new Set<number>(), marks: Record<string, StepMetaMarks> = {};
  const metas = st.kind === 'place' ? st.moves.map(m => m.meta) : [st.meta];
  for (const m of metas) {
    if (!m) continue;
    for (const u of m.units || []) units.add(u);
    for (const i of m.focus || []) focus.add(i);
    for (const k in m.marks) marks[k] = Object.assign(marks[k] || {}, m.marks[k]);
  }
  return { units, focus, marks };
}

function render(): void {
  if (!cellEls.length) buildBoard();
  const s = Sudoku.stateAt(given, steps, cur);
  const curStep = cur > 0 ? steps[cur - 1] : null;
  const meta = curStep ? stepMeta(curStep) : null;
  const elimSet = curStep && curStep.kind === 'elim' ? new Set(curStep.cells) : null;
  const placed = new Set<number>(), guessCells = new Set<number>(), deduced = new Set<number>();
  for (let k = 0; k < cur; k++) {
    const st = steps[k];
    if (st.kind !== 'place') continue;
    for (const mv of st.moves) (mv.tech === 'guess' ? guessCells : deduced).add(mv.i);
  }
  for (const mv of curStep && curStep.kind === 'place' ? curStep.moves : []) placed.add(mv.i);
  const unitCells = new Set<number>();
  if (meta) for (const u of meta.units) for (const i of Sudoku.UNITS[u]) unitCells.add(i);
  const selV = given[sel] || s.val[sel];
  const [sr, sc] = Sudoku.RC(sel);
  const hit = new Set<number>();
  for (let k = 0; k < 9; k++) { hit.add(sr * 9 + k); hit.add(k * 9 + sc); }
  const br = Math.floor(sr / 3) * 3, bc = Math.floor(sc / 3) * 3;
  for (let k = 0; k < 9; k++) hit.add((br + ((k / 3) | 0)) * 9 + bc + k % 3);

  for (let i = 0; i < 81; i++) {
    const [r, c] = Sudoku.RC(i), { el, v, cands, badge } = cellEls[i];
    let cls = 'cell';
    if (c === 2 || c === 5) cls += ' bR';
    if (r === 2 || r === 5) cls += ' bB';
    if (given[i]) cls += ' given';
    else if (s.val[i]) cls += guessCells.has(i) ? ' guess' : deduced.has(i) ? ' stepped' : '';
    if (hit.has(i) && !given[i] && !s.val[i]) cls += ' peer';
    if (unitCells.has(i) && !given[i] && !s.val[i]) cls += ' hl-unit';
    if (elimSet && elimSet.has(i)) cls += ' elim';
    if (meta && meta.focus.has(i)) cls += ' hl-focus';
    if (selV && s.val[i] === selV) cls += ' same';
    if (i === sel) cls += ' sel';
    if (placed.has(i)) cls += ' cur';
    el.className = cls;

    const mk = meta && meta.marks[i];
    if ((showCands || mk) && !s.val[i]) {
      let cm = s.cand[i];
      if (mk && mk.strike) for (const d of mk.strike) cm |= 1 << (d - 1);   // 被划掉的候选已从盘面移除，回显出来才能看到删除线
      const cd = bitsOf(cm);
      v.textContent = '';
      cands.innerHTML = cd.map(x => {
        let cl = '';
        if (mk && mk.pick === x) cl = 'pick';
        else if (mk && mk.strike && mk.strike.includes(x)) cl = 'strike';
        else if (cd.length === 1) cl = 'g';
        return `<i${cl ? ` class="${cl}"` : ''}>${x}</i>`;
      }).join('');
    } else {
      cands.innerHTML = '';
      v.textContent = String(s.val[i] || '');        // 迁移注：仅为通过 strict 类型检查，运行时输出不变
    }
    badge.textContent = elimSet && elimSet.has(i) ? '✕' : '';
  }
  renderReason(); renderSteps();
}

const TECHN: Record<string, string> = { naked: '唯一候选数', hidden: '行/列/宫唯一', locked: '区块摒除',
                nakedSub: '显性三数组', hiddenSub: '隐性三数组', xwing: 'X-Wing',
                guess: '试填（非唯一）', mixed: '混合' };

function techLabel(st: Step): string {
  if (st.kind === 'elim' || st.tech !== 'mixed') return TECHN[st.tech];   // mixed 只出现在填数步
  const c: Record<string, number> = {};
  for (const mv of st.moves) c[mv.tech] = (c[mv.tech] || 0) + 1;
  return Object.keys(c).map(t => `${TECHN[t]}×${c[t]}`).join('、');
}

function moveHead(mv: Move, showIdx: boolean, k = 0, stepSize = 0): string {
  const isG = mv.tech === 'guess';
  const idx = showIdx ? `<span class="idx">${k + 1}</span>` : '';
  const tag = showIdx ? `<span class="tech${isG ? ' guess' : ''}">${TECHN[mv.tech]}</span>` : '';
  const n = stepSize > 1 ? `<span class="ncell">${stepSize} 格</span>` : '';
  return `<div class="mvh">${idx}${tag}${n}<span class="pos">${Sudoku.nm(mv.i)}</span> → <span class="val${isG ? ' g' : ''}">${mv.v}</span></div>`;
}

const legend = (): string => '<div class="lgd"><span class="lg u"></span>涉及单元<span class="lg f"></span>推理格<span class="lg s"></span>排除候选</div>';

/* 批量步的逐格理由：每格一条「第 N 步 · 技巧 · 格 → 值」摘要，点开看完整推理。
   以前所有理由平铺在一起，单步最多 28 格时一屏糊住、找不到重点；
   现在默认只展开第一条，其余点开（openMoves 记住展开状态，重绘不丢）。 */
function moveList(st: PlaceStep, stepIdx: number): string {
  return st.moves.map((mv, k) => {
    const key = `${stepIdx}:${k}`;
    const open = openMoves.has(key) || (k === 0 && !st.moves.some((_, j) => openMoves.has(`${stepIdx}:${j}`)));
    return `<details class="mv" data-mvk="${key}"${open ? ' open' : ''}>` +
      `<summary class="mvs">${moveHead(mv, true, k)}<span class="more">展开理由</span></summary>` +
      `<div class="mvr">${esc(mv.reason).replace(/\n/g, '<br>')}</div></details>`;
  }).join('');
}

function renderReason(): void {
  const box = $('#reason'), idx = $('#rIdx');
  if (!steps.length) { box.innerHTML = '<div class="t">—</div>暂无步骤'; idx.textContent = ''; return; }
  if (cur === 0) { box.innerHTML = '<div class="t">—</div>已回到初始谜面，点「下一步」开始逐步推理。'; idx.textContent = ''; return; }
  const st = steps[cur - 1];
  idx.textContent = st.kind === 'place' && st.moves.length > 1
    ? `第 ${cur} / ${steps.length} 步 · 本步 ${st.moves.length} 格`
    : `第 ${cur} / ${steps.length} 步`;
  if (st.kind === 'place' && st.moves.length > 1) {
    box.innerHTML = `<div class="t"><span class="tech">本步 ${st.moves.length} 格</span>${esc(techLabel(st))}</div>` +
      moveList(st, cur - 1) + legend();
    wireMoveToggles();
    return;
  }
  if (st.kind === 'place') {
    const mv = st.moves[0];
    box.innerHTML = `<div class="t">${moveHead(mv, false)}</div>${esc(mv.reason).replace(/\n/g, '<br>')}` + legend();
    return;
  }
  const head = `<span class="tech">${esc(TECHN[st.tech])}</span><span class="pos">${st.cells.map(Sudoku.nm).join('、')}</span> 排除 <span class="val g">{${bitsOf(st.mask).join(',')}}</span>`;
  box.innerHTML = `<div class="t">${head}</div>${esc(st.reason).replace(/\n/g, '<br>')}` + legend();
}

function stepText(st: Step): string {
  if (st.kind === 'place') {
    const mv = st.moves;
    return mv.length === 1 ? `${Sudoku.nm(mv[0].i)} = ${mv[0].v}`
      : `${Sudoku.nm(mv[0].i)} = ${mv[0].v} 等 ${mv.length} 格`;
  }
  return `${Sudoku.nm(st.cells[0])}${st.cells.length > 1 ? ` 等${st.cells.length}格` : ''} 排除 {${bitsOf(st.mask).join(',')}}`;
}

/* details 展开状态在 innerHTML 重建后会丢，这里把用户的点开/收起记进 openMoves。
   onclick 的 this 是 #reason（事件冒泡到容器），从 closest 反查是哪一个 details。 */
function wireMoveToggles(): void {
  const box = $('#reason');
  box.onclick = function (e: any): void {
    const t = e && e.target && e.target.closest ? e.target.closest('details.mv') : null;
    if (!t || !box.contains(t)) return;
    const key = t.dataset.mvk;
    if (t.open) openMoves.add(key); else openMoves.delete(key);
  };
}

function renderSteps(): void {
  const el = $('#steps');
  if (!steps.length) { el.innerHTML = '<div class="empty">先填入已知数字，点「求解」</div>'; $('#sCnt').textContent = ''; return; }
  const list = steps.map((s, i) => ({ s, i })).filter(({ s }) => showElims || s.kind === 'place');
  const placedN = steps.reduce((n, s) => n + (s.kind === 'place' ? s.moves.length : 0), 0);
  const elimN = steps.reduce((n, s) => n + (s.kind === 'elim' ? 1 : 0), 0);
  $('#sCnt').textContent = `${steps.length} 步（填数 ${placedN} / 排除 ${elimN}）`;
  el.innerHTML = '<ol>' + list.map(({ s, i }) => {
    const n = i + 1, on = n === cur, past = n < cur;
    const isG = s.kind === 'place' && s.moves.every(m => m.tech === 'guess');
    const k = s.kind === 'elim' ? 'e' : isG ? 'g' : s.tech === 'mixed' ? 'm' : '';
    const ncell = s.kind === 'place' && s.moves.length > 1 ? `<span class="nc">${s.moves.length}格</span>` : '';
    return `<li class="${k} ${on ? 'on' : ''} ${past ? 'past' : ''}" data-n="${n}"><span class="n">${n}</span><span class="k">${esc(techLabel(s))}</span>${ncell}<span class="x">${esc(stepText(s))}</span></li>`;
  }).join('') + '</ol>';
  const on = el.querySelector('li.on'); if (on) on.scrollIntoView({ block: 'nearest' });
  el.querySelectorAll('li').forEach((li: any) => li.onclick = () => { stop(); cur = +li.dataset.n; render(); });
}

function diag(html: string): void { $('#diag').innerHTML = html; }
const row = (cls: string, t: string): string => `<div class="s ${cls}"><span class="dot"></span><span>${t}</span></div>`;

function setState(t: string, cls?: string): void {   // cls: ok / err / warn，给顶栏状态标签上色
  const el = $('#tState');
  el.textContent = t;
  el.className = cls ? `tag ${cls}` : 'tag';
}

function doSolve(): void {
  if (busy) return;                              // 已有任务在途，忽略重复触发
  stop(); cur = 0; steps = []; teachBatchSteps = 0;   // 清干净：否则上一次的「推理步数」会残留到本次诊断里
  const ep = epoch;                              // 记下谜面版本：等待期间谜面变了就丢弃结果
  setBusy(true); setState('求解中…');
  runTask({ type: 'solve', given, mode: stepMode ? 'teach' : 'fast' }, (res: SolveResult) => {
    setBusy(false);
    if (ep !== epoch) return;                     // 过期结果：谜面已被修改，等用户重新求解
    const clues = given.filter(Boolean).length;
    let h = row('info', `已知数字 <b>${clues}</b> 个，空格 <b>${81 - clues}</b> 个`);
    if (res.status === 'invalid') { setState('题目有误', 'err'); diag(h + row('bad', '❌ ' + esc(res.msg))); render(); return; }
    if (res.status === 'nosol') { setState('无解', 'err'); diag(h + row('bad', '❌ ' + esc(res.msg))); render(); return; }
    if (res.status === 'multi') { setState('多解', 'err'); diag(h + row('bad', '❌ ' + esc(res.msg).replace(/\n/g, '<br>'))
      + row('info', '需先补充已知数字使其唯一，才能给出确定步骤。')); render(); return; }
    applySteps(res);                               // 关键：把求解结果接到回放用的步骤表
    h += row('ok', '✅ 唯一解（已验证解的数量 = 1）');
    if (res.guesses) h += row('warn', `⚠ 含 <b>${res.guesses}</b> 步试填（逻辑推理已无法推进），这些步已标黄，不具备唯一性。`);
    else h += row('ok', '全程仅用唯一性逻辑推理，无需试填。');
    if (res.backtracks) h += row('info', `求解时发生 ${res.backtracks} 次试错回溯（未在步骤表中显示）。`);
    const t = res.stats || {};
    h += row('info', '技巧统计：' + (Object.keys(TECHN).filter(k => t[k]).map(k => `${TECHN[k]}×${t[k]}`).join('，') || '无'));
    if (!steps.length) h += row('warn', '题目已填满，无需推理。');
    else if (stepMode && teachBatchSteps && steps.length > teachBatchSteps)
      h += row('info', `讲解模式：一步一格，共 ${steps.length} 步；每步左上角的「第 N 步」标注同属第 N 次推理。`);
    diag(h);
    setState(`共 ${steps.length} 步${res.guesses ? '（含试填）' : ''}`,
             steps.length === 0 ? '' : res.guesses ? 'warn' : 'ok');
    render();
  }, (err) => {                                // 求解抛错：恢复可交互状态并如实报错
    setBusy(false);
    setState('求解失败', 'err');
    diag(row('bad', '❌ 求解出错：' + esc(err instanceof Error ? err.message : err)));
  });
}

function goto(n: number): void { cur = Math.max(0, Math.min(steps.length, n)); render(); }
function stop(): void { if (playing) { clearInterval(playing); playing = null; $('#bPlay').textContent = '▶ 自动'; } }
function play(): void {
  if (!steps.length) return;
  if (playing) { stop(); return; }
  if (cur >= steps.length) cur = 0;
  const sp = 1100 - (+$('#spd').value) * 95;
  $('#bPlay').textContent = '⏸ 暂停';
  playing = setInterval(() => { if (cur >= steps.length) { stop(); return; } goto(cur + 1); }, sp);
}

/* ---- 键盘 / 按钮 ---- */
function editGiven(i: number, v: number): boolean {   // 键盘与数字键盘共用，避免两条路径行为不一致
  if (busy) return false;   // 任务在途时忽略改谜面：否则刚填的数字会被同批在途的出题结果静默覆盖
  stop(); epoch++; given[i] = v; steps = []; cur = 0; teachBatchSteps = 0;
  setState('未解题');
  diag(row('info', '已修改谜面，点「求解」重新生成步骤。'));
  return true;
}
const D: string[] = ['1','2','3','4','5','6','7','8','9','0'];
pad.innerHTML = D.map(d => `<button data-d="${d}">${d === '0' ? '清除' : d}</button>`).join('');
pad.querySelectorAll('button').forEach((b: any) => b.onclick = () => {
  if (editGiven(sel, +b.dataset.d)) { sel = (sel + 1) % 81; render(); }   // 未写入（任务在途）则光标不前进
});
$('#bSolve').onclick = doSolve;
$('#bFirst').onclick = () => { stop(); goto(0); };
$('#bPrev').onclick = () => { stop(); goto(cur - 1); };
$('#bNext').onclick = () => { stop(); goto(cur + 1); };
$('#bLast').onclick = () => { stop(); goto(steps.length); };
$('#bPlay').onclick = play;
$('#spd').oninput = () => { if (playing) { stop(); if (cur < steps.length) play(); } };   // 播放中调速立即生效
$('#cCands').onchange = (e: any) => { showCands = e.target.checked; render(); };
$('#cElims').onchange = (e: any) => { showElims = e.target.checked; renderSteps(); };
/* 换讲解粒度：已求解的盘面直接重算一份步骤表，不必让用户再点一次「求解」。
   重算走同一条 runTask（Worker 或同步回退），epoch 未变，过期结果仍按版本丢弃。 */
$('#cMode').onchange = (e: any) => {
  stepMode = e.target.checked;
  openMoves.clear();
  if (steps.length) doSolve(); else render();
};
$('#bExpand').onclick = () => {
  const st = cur > 0 ? steps[cur - 1] : null;
  if (!st || st.kind !== 'place' || st.moves.length < 2) return;   // 只对批量步有意义
  const n = st.moves.length;
  const expanded = st.moves.every((_, k) => openMoves.has(`${cur - 1}:${k}`));
  if (expanded) openMoves.clear();                                 // 收起 = 恢复「只展开第一条」
  else for (let k = 0; k < n; k++) openMoves.add(`${cur - 1}:${k}`);
  renderReason();
};
$('#bClr').onclick = () => { stop(); epoch++; given = new Array(81).fill(0); steps = []; cur = 0; sel = 40; teachBatchSteps = 0;
  setState('未解题');
  diag(row('info', '空白盘面，点数字键填入已知数字。')); render(); };
(document.querySelectorAll('[data-gen]') as NodeListOf<HTMLElement>).forEach(b => b.onclick = () => {
  if (busy) return;                               // 出题中/求解中，忽略重复点击
  stop(); steps = []; cur = 0; epoch++; teachBatchSteps = 0;   // 换题使在途求解结果失效
  const ep = epoch;
  setBusy(true); setState('出题中…');
  runTask({ type: 'generate', minClues: +(b.dataset.gen as string) }, (p: number[]) => {
    setBusy(false);
    if (ep !== epoch) return;                     // 等待期间用户清空/改过谜面：丢弃本次出题，不覆盖用户操作
    given = p; doSolve();
  }, (err) => {
    setBusy(false);
    setState('出题失败', 'err');
    diag(row('bad', '❌ 出题出错：' + esc(err instanceof Error ? err.message : err)));
  });
});

addEventListener('keydown', (e: KeyboardEvent) => {
  const tgt = e.target as unknown as { tagName: string; type: string };
  if (tgt.tagName === 'INPUT') return;           // 滑杆等控件交给它自己处理
  const r = (sel / 9 | 0), c = sel % 9;
  if (e.key === 'ArrowUp') { sel = ((r + 8) % 9) * 9 + c; e.preventDefault(); }
  else if (e.key === 'ArrowDown') { sel = ((r + 1) % 9) * 9 + c; e.preventDefault(); }
  else if (e.key === 'ArrowLeft') { sel = r * 9 + (c + 8) % 9; e.preventDefault(); }
  else if (e.key === 'ArrowRight') { sel = r * 9 + (c + 1) % 9; e.preventDefault(); }
  else if (e.key >= '1' && e.key <= '9') editGiven(sel, +e.key);
  else if (e.key === '0' || e.key === 'Delete') editGiven(sel, 0);
  else if (e.key === 'Enter') { stop(); goto(cur + 1); e.preventDefault(); }
  else if (e.key === ' ') { play(); e.preventDefault(); }
  else if (e.key === 'Backspace') { stop(); goto(cur - 1); e.preventDefault(); }
  else return;
  render();
});

render();
diag('<div class="s info"><span class="dot"></span><span>点「随机题」载入，或在格中输入已知数字后点「求解」。</span></div>');
