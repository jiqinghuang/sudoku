"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/* UI 接线测试：用最小 DOM stub 真正执行 dist/ui.js（index.html 加载的同一份界面脚本）
   目的是覆盖「求解 → 步骤表 → 上一步/下一步」这条链路，
   而不是只测纯函数 Sudoku.solve()。 */
const fs = require('fs');
const Sudoku = require('./solver.js');
const script = fs.readFileSync(__dirname + '/ui.js', 'utf8'); // 与 index.html 实际加载的一致
// 测试里直接访问 solve() 结果的松散字段（final 等），统一解包为 any
const solveAny = (g) => Sudoku.solve(g);
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  PASS ' + m)) : (fail++, console.log('  FAIL ' + m)); };
function mkEl(tag) {
    const t = (tag || 'div').toUpperCase();
    const el = {
        tagName: t, textContent: '', value: '', type: '', className: '', checked: false,
        dataset: {}, style: {}, children: [], onclick: null, ondblclick: null,
        _html: '',
        get innerHTML() {
            return this._html;
        },
        set innerHTML(v) {
            this._html = String(v);
            this.children = [...String(v).matchAll(/<(li|button|div|span|i)\b/g)].map(m => mkEl(m[1]));
        },
        appendChild(c) { this.children.push(c); return c; },
        classList: { add() { } },
        scrollIntoView() { },
        querySelectorAll(sel) {
            const want = sel.replace(/[^a-z]/gi, '').toUpperCase();
            return this.children.filter(c => c.tagName === want);
        },
        querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    };
    return el;
}
const cache = {};
const document = {
    querySelector: (sel) => (cache[sel] || (cache[sel] = mkEl())),
    querySelectorAll: () => [],
    createElement: (tag) => mkEl(tag),
    addEventListener() { },
};
let keyHandler = null;
const api = new Function('document', 'addEventListener', 'alert', 'Sudoku', script + `
  ;return { doSolve, goto, stop, editGiven, bitsOf, parsePuzzle,
           get cur() { return cur; }, get steps() { return steps; },
           get sel() { return sel; },
           get given() { return given; }, set given(v) { given = v; } };
`)(document, (type, fn) => { if (type === 'keydown')
    keyHandler = fn; }, () => { }, Sudoku);
/* ---------- 1. 核心回归：求解后步骤表必须非空，且能前进/后退 ---------- */
console.log('\n[U1] 求解 → 步骤表 → 上一步/下一步');
const WIKI = '530070000600195000098000060800060003400803001700020006060000280000419005000080079'
    .split('').map(Number);
{
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
    api.goto(3);
    ok(api.cur === 3, `连续前进到第 3 步（实际 ${api.cur}）`);
    api.goto(2);
    ok(api.cur === 2, `点「上一步」回退到第 2 步（实际 ${api.cur}）`);
    api.goto(0);
    ok(api.cur === 0, '回到开头');
    api.goto(-5);
    ok(api.cur === 0, `越界后退不会变负（实际 ${api.cur}）`);
    api.goto(9999);
    ok(api.cur === api.steps.length, `越界前进夹在末步（${api.cur} / ${api.steps.length}）`);
    const liCount = cache['#steps'].querySelectorAll('li').length;
    ok(liCount === api.steps.length, `步骤列表渲染了 ${liCount} 行，与步骤数一致`);
    ok(/步（填数/.test(cache['#sCnt'].textContent), `步骤计数: "${cache['#sCnt'].textContent}"`);
}
console.log('\n[U2] 逐步回放的盘面必须与步骤严格对应');
{
    const g = api.given, st = api.steps;
    let mismatch = 0;
    for (let k = 1; k <= st.length; k++) {
        const s = Sudoku.stateAt(g, st, k);
        if (Array.from(s.val).filter(Boolean).length !==
            g.filter(Boolean).length + st.slice(0, k).reduce((n, x) => n + (x.kind === 'place' ? x.moves.length : 0), 0))
            mismatch++;
    }
    ok(mismatch === 0, `${st.length} 步回放，每步已填格数自洽（异常 ${mismatch} 处）`);
    const fin = Sudoku.stateAt(g, st, st.length);
    const sol = solveAny(g);
    ok(Array.from(fin.val).join('') === sol.final.join(''), '回放到底的盘面 == 唯一解');
}
console.log('\n[U3] 题目异常时步骤表必须为空，状态标签不能残留旧值');
{
    const save = api.given.slice();
    const bad = save.slice();
    bad[0] = 5;
    bad[1] = 5; // 同行重复
    api.given = bad;
    api.doSolve();
    ok(api.steps.length === 0, '冲突题 -> 步骤表为空');
    ok(/重复/.test(cache['#diag'].innerHTML), '冲突题 -> 诊断面板说明原因');
    ok(cache['#tState'].textContent === '题目有误', `冲突题 -> 状态标签更新: "${cache['#tState'].textContent}"`);
    api.goto(5);
    ok(api.cur === 0, '冲突题点「下一步」不会有任何变化');
    const multi = new Array(81).fill(0); // 空盘 = 多解
    api.given = multi;
    api.doSolve();
    ok(api.steps.length === 0, '多解题 -> 步骤表为空');
    ok(/不唯一/.test(cache['#diag'].innerHTML), '多解题 -> 诊断面板说明原因');
    ok(cache['#tState'].textContent === '多解', `多解题 -> 状态标签更新: "${cache['#tState'].textContent}"`);
    api.given = Array.from(solveAny(save).final); // 填满
    api.doSolve();
    ok(api.steps.length === 0, '已填满 -> 无需推理');
    api.given = save;
}
console.log('\n[U4] 生成题目后可直接回放');
{
    api.given = new Array(81).fill(0);
    api.doSolve();
    ok(api.steps.length === 0, '空盘判定为多解且不产生步骤');
    for (const mc of [40, 34, 28, 24]) {
        const p = Sudoku.generatePuzzle(mc);
        api.given = p;
        api.doSolve();
        const okS = api.steps.length > 0 && api.cur === 0;
        api.goto(1);
        const moved = api.cur === 1;
        api.goto(api.steps.length);
        const fin = Array.from(Sudoku.stateAt(p, api.steps, api.steps.length).val).join('');
        ok(okS && moved && fin === solveAny(p).final.join(''), `clues≈${p.filter(Boolean).length} 的题：${api.steps.length} 步，可前进，可回放到解`);
    }
}
console.log('\n[U5] 键盘/数字键盘修改谜面路径一致，状态标签不残留');
{
    api.given = WIKI.slice();
    api.doSolve();
    ok(/共 \d+ 步/.test(cache['#tState'].textContent), '求解成功后状态标签为步数');
    // 键盘路径
    const selBefore = api.sel;
    keyHandler({ key: '5', target: { tagName: 'DIV' }, preventDefault() { } });
    ok(api.given[selBefore] === 5 && api.steps.length === 0 && api.cur === 0, '键盘填数：写入谜面并清空步骤');
    ok(cache['#tState'].textContent === '未解题', `键盘填数后状态标签重置: "${cache['#tState'].textContent}"`);
    ok(/已修改谜面/.test(cache['#diag'].innerHTML), '键盘填数后诊断面板提示重新求解');
    // 数字键盘路径（直接调 editGiven，与按钮 onclick 同一函数）
    api.editGiven(0, 9);
    ok(api.given[0] === 9 && api.steps.length === 0, '数字键盘路径同样清空步骤');
    ok(cache['#tState'].textContent === '未解题', '数字键盘路径同样重置状态标签');
    ok(cache['#board'].children.length === 81, `多次重绘后棋盘节点不重复堆积（${cache['#board'].children.length} 格）`);
}
console.log('\n[U6] 批量步骤的界面渲染');
{
    api.given = WIKI.slice();
    api.doSolve(); // U5 改过谜面，这里重新求解
    const bi = api.steps.findIndex(s => s.kind === 'place' && s.moves.length > 1);
    const batch = api.steps[bi];
    ok(bi >= 0 && !!batch, `存在批量步骤（第 ${bi + 1} 步，${batch ? batch.moves.length : 0} 格）`);
    api.goto(bi + 1);
    const html = cache['#reason'].innerHTML;
    const st = batch;
    ok(new RegExp(`本步 ${st.moves.length} 格`).test(html), '理由面板显示本步格数');
    ok(st.moves.every(mv => html.includes(Sudoku.nm(mv.i))), '理由面板列出每一格的推理');
    ok(/涉及单元/.test(html) && /推理格/.test(html), '理由面板带图例');
    ok(cache['#sCnt'].textContent.includes(`填数 ${st.moves.length}`) || /填数 \d+/.test(cache['#sCnt'].textContent), `步骤计数按格统计: "${cache['#sCnt'].textContent}"`);
}
console.log('\n[U7] 排除步骤：被划掉的候选必须回显且带删除线');
{
    const xw = '.7..28...32....59...........1.....468.4.9.1......3.....6.28..5....9.4.7.1........'
        .split('').map(c => c === '.' ? 0 : +c);
    api.given = xw;
    api.doSolve();
    const bi = api.steps.findIndex(s => s.kind === 'elim');
    ok(bi >= 0, `存在排除步骤（第 ${bi + 1} 步）`);
    api.goto(bi + 1);
    const st = api.steps[bi];
    let strikeCells = 0, shownDigits = 0;
    const cells = st?.cells ?? [];
    for (const i of cells) {
        const html = cache['#board'].children[i].children[1].innerHTML;
        if (/class="strike"/.test(html))
            strikeCells++;
        for (const d of Sudoku.bits(st?.mask ?? 0))
            if (html.includes(`>${d}</i>`))
                shownDigits++;
    }
    ok(strikeCells > 0, `排除格回显了被划掉的候选（${strikeCells}/${cells.length} 格）`);
    ok(shownDigits > 0, `划掉的数字仍在候选里显示（${shownDigits} 处）`);
}
console.log('\n[U8] 粘贴解析：多种格式等价，非法输入被拒绝');
{
    const S = '530070000600195000098000060800060003400803001700020006060000280000419005000080079';
    const D = '53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79';
    const expect = S.split('').map(Number);
    const cases = [
        ['81 字符（0 为空）', S],
        ['81 字符（. 为空）', D],
        ['81 字符（- 为空）', D.replace(/\./g, '-')],
        ['点分隔 81 格', S.split('').join('.')],
        ['0. 前缀 + 81 字符', '0.' + S],
        ['0. 前缀 + 点分隔', '0.' + S.split('').join('.')],
        ['9 行 × 9 格（点分隔）', S.match(/.{9}/g).join('.')],
        ['9 行 × 9 格（换行）', S.match(/.{9}/g).join('\n')],
    ];
    let bad = 0;
    for (const [name, text] of cases) {
        const g = api.parsePuzzle(text);
        if (!g || g.join('') !== expect.join('')) {
            bad++;
            console.log('    解析失败: ' + name + ' -> ' + (g ? g.join('') : 'null'));
        }
    }
    ok(bad === 0, `${cases.length} 种粘贴格式都解析为同一谜面（失败 ${bad}）`);
    ok(api.parsePuzzle('123') === null, '位数不足 -> 拒绝');
    ok(api.parsePuzzle('') === null, '空输入 -> 拒绝');
    ok(api.parsePuzzle('abc') === null, '纯字母 -> 拒绝');
    cache['#paste'] = mkEl('input'); // 端到端：载入按钮 -> 写入谜面 -> 自动求解
    cache['#paste'].value = D;
    cache['#bPaste'].onclick();
    ok(api.given.join('') === expect.join('') && api.steps.length > 0, `点「载入」后谜面进入棋盘并自动求解（${api.steps.length} 步）`);
}
console.log(`\n========== UI 测试 通过 ${pass} / 失败 ${fail} ==========`);
process.exit(fail ? 1 : 0);
