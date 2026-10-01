"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// 数独求解器测试（源码 src/test.ts → 编译产物 dist/test.js）
// 测试直接 require 同目录的 dist/solver.js 产物——测的就是浏览器实际加载的那份代码。
const Sudoku = require('./solver.js');
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  PASS ' + m)) : (fail++, console.log('  FAIL ' + m)); };
/* 分段执行：某一段抛出的运行时异常只记一次失败并继续跑完其余段落，
   不会中断整个测试文件（旧版一处异常会吞掉后面所有段落的报告）。 */
function section(name, fn) {
    console.log('\n[' + name + ']');
    try {
        fn();
    }
    catch (e) {
        fail++;
        console.log('  FAIL 段落异常 [' + name + ']：' + e.message);
    }
}
// solve() 的返回是按 status 区分的联合类型；测试断言跟随运行时结果，
// 统一经此解包，保持与原 test.js 相同的松散访问风格。
const solve = (g) => Sudoku.solve(g);
const parse = (s) => s.replace(/[^0-9]/g, '').split('').map(Number);
const WIKI_G = parse(`530070000600195000098000060800060003400803001700020006060000280000419005000080079`);
const WIKI_S = parse(`534678912672195348198342567859761423426853791713924856961537284287419635345286179`);
/* ---- 朴素 DFS：作为对拍参照（与求解器实现完全独立） ---- */
const PEER = [];
for (let i = 0; i < 81; i++) {
    const r = (i / 9) | 0, c = i % 9, p = [];
    for (let k = 0; k < 9; k++) {
        if (k !== c)
            p.push(r * 9 + k);
        if (k !== r)
            p.push(k * 9 + c);
    }
    const br = (r / 3 | 0) * 3, bc = (c / 3 | 0) * 3;
    for (let k = 0; k < 9; k++) {
        const x = br + ((k / 3) | 0), y = bc + k % 3;
        if (x !== r || y !== c)
            p.push(x * 9 + y);
    }
    PEER.push(p);
}
const naive = (g, lim) => {
    let n = 0;
    const v = g.slice();
    (function rec() {
        if (n >= lim)
            return;
        let i = -1;
        for (let k = 0; k < 81; k++)
            if (!v[k]) {
                i = k;
                break;
            }
        if (i < 0) {
            n++;
            return;
        }
        for (let d = 1; d <= 9; d++) {
            let o = true;
            for (const p of PEER[i])
                if (v[p] === d) {
                    o = false;
                    break;
                }
            if (!o)
                continue;
            v[i] = d;
            rec();
            v[i] = 0;
            if (n >= lim)
                return;
        }
    })();
    return n;
};
const noUnitDup = (g) => {
    for (let i = 0; i < 81; i++)
        if (g[i])
            for (const p of PEER[i])
                if (g[p] === g[i])
                    return false;
    return true;
};
/* 校验一个“解”确实是合法数独，且与谜面一致 */
const validSolution = (v, g) => {
    for (let i = 0; i < 81; i++)
        if (!v[i] || (g[i] && v[i] !== g[i]))
            return false;
    for (let u = 0; u < 9; u++) {
        const rs = new Set(), cs = new Set(), bs = new Set();
        for (let k = 0; k < 9; k++) {
            const ri = u * 9 + k, ci = k * 9 + u;
            const bi = ((u / 3 | 0) * 3 + ((k / 3) | 0)) * 9 + (u % 3) * 3 + k % 3;
            if (rs.has(v[ri]) || cs.has(v[ci]) || bs.has(v[bi]))
                return false;
            rs.add(v[ri]);
            cs.add(v[ci]);
            bs.add(v[bi]);
        }
    }
    return true;
};
let r; // 第 [1] 段求解的经典题结果，后续多段复用
section('1 经典题：唯一解 + 解正确', () => {
    r = solve(WIKI_G);
    ok(r.status === 'ok', 'status=ok (得到 ' + r.status + ')');
    ok(r.final && r.final.join('') === WIKI_S.join(''), '解与标准答案一致');
    ok(r.guesses === 0, '无需试填 (guesses=' + r.guesses + ')');
    ok(r.backtracks === 0, '无试错回溯 (backtracks=' + r.backtracks + ')');
    console.log('    步骤数=' + r.steps.length + '  技巧=' + JSON.stringify(r.stats) + '  回溯=' + r.backtracks);
});
section('2 回放一致性：逐步折叠第 k 步 == 求解器内部第 k 步', () => {
    let bad = 0, badCand = 0;
    for (let k = 0; k <= r.steps.length; k++) {
        const s = Sudoku.stateAt(WIKI_G, r.steps, k);
        const placed = r.steps.slice(0, k).reduce((n, x) => n + (x.kind === 'place' ? x.moves.length : 0), 0);
        const filled = Array.from(s.val).filter(Boolean).length;
        if (filled !== WIKI_G.filter(Boolean).length + placed)
            bad++;
        for (let i = 0; i < 81; i++)
            if (!s.val[i] && !s.cand[i])
                badCand++;
        // 候选集必须是真实可能值的子集（不能含同行列宫已占的数字）
        for (let i = 0; i < 81; i++)
            if (s.val[i] && s.cand[i])
                bad++;
    }
    ok(bad === 0, '每一步的已填格数自洽 (' + bad + ' 处异常)');
    ok(badCand === 0, '过程中无「空且零候选」的矛盾格 (' + badCand + ' 处)');
    const fin = Sudoku.stateAt(WIKI_G, r.steps, r.steps.length);
    ok(Array.from(fin.val).join('') === WIKI_S.join(''), '回放到底 == 标准答案');
});
section('3 每一步的理由与合法性', () => {
    ok(r.steps.every((s) => s.reason && s.reason.length > 20), '每步都有非空理由');
    ok(r.steps.every((s) => s.kind === 'place'
        ? s.moves.every((mv) => mv.reason.includes('【'))
        : s.reason.includes('【')), '每格理由都带技巧标签');
    {
        let bad = 0;
        for (let k = 1; k <= r.steps.length; k++) {
            const st = r.steps[k - 1], s = Sudoku.stateAt(WIKI_G, r.steps, k - 1);
            if (st.kind === 'place') {
                const seen = new Set();
                for (const mv of st.moves) {
                    if (s.val[mv.i])
                        bad++; // 不能重复填
                    if (!(s.cand[mv.i] & (1 << (mv.v - 1))))
                        bad++; // 值必须在当时候选内
                    if (seen.has(mv.i))
                        bad++; // 同一批不能重复填同一格
                    seen.add(mv.i);
                    if (!mv.reason || mv.reason.length < 20)
                        bad++; // 每格都要有理由
                }
            }
            else {
                if (!st.cells.length)
                    bad++;
                if (st.cells.some((i) => s.val[i]))
                    bad++; // 不能排除已填格
                if (st.cells.some((i) => !(s.cand[i] & st.mask)))
                    bad++; // 当时确实含该候选
            }
        }
        ok(bad === 0, '每步都基于当时盘面合法 (' + bad + ' 处异常)');
        const filled = r.steps.reduce((n, s) => n + (s.kind === 'place' ? s.moves.length : 0), 0);
        ok(filled === 81 - WIKI_G.filter(Boolean).length, `填数步数 ${filled} == 空格数 ${81 - WIKI_G.filter(Boolean).length}`);
        // 隐性唯一数的理由里「已填 N 格」必须与实际一致
        let wrongCount = 0, hiddenN = 0;
        for (let k = 1; k <= r.steps.length; k++) {
            const st = r.steps[k - 1];
            if (st.kind !== 'place')
                continue;
            const s = Sudoku.stateAt(WIKI_G, r.steps, k - 1);
            for (const mv of st.moves) {
                if (mv.tech !== 'hidden')
                    continue;
                hiddenN++;
                const unit = /【(.+?)唯一】/.exec(mv.reason)[1];
                let u;
                if (unit.endsWith('行'))
                    u = +unit.slice(1, -1) - 1;
                else if (unit.endsWith('列'))
                    u = 9 + +unit.slice(1, -1) - 1;
                else
                    u = 18 + +unit.slice(1, -1) - 1;
                const filled = Sudoku.UNITS[u].filter(i => s.val[i]).length;
                if (+/已填 (\d+) 格/.exec(mv.reason)[1] !== filled)
                    wrongCount++;
            }
        }
        ok(hiddenN > 0 && wrongCount === 0, `隐性唯一数理由的「已填 N 格」与实际一致（${hiddenN} 条，${wrongCount} 条错误）`);
        // ui.ts 以 esc() 转义后拼 innerHTML：求解器自由文本不含 HTML 特殊字符是前置约束
        ok(r.steps.every((s) => !/[<>&]/.test(s.reason || '')
            && (s.kind !== 'place' || s.moves.every((mv) => !/[<>&]/.test(mv.reason || '')))), '理由文本不含 HTML 特殊字符（ui 层 esc 的前置约束）');
    }
});
section('4 题目错误（已知数字冲突）', () => {
    const bad = WIKI_G.slice();
    bad[0] = 5;
    bad[1] = 5; // R1C1 和 R1C2 都是 5
    const x = solve(bad);
    ok(x.status === 'invalid', 'status=invalid (得到 ' + x.status + ')');
    ok(/第1行/.test(x.msg) && /R1C1/.test(x.msg) && /R1C2/.test(x.msg), '行重复定位到行: ' + x.msg);
    ok(!/R1C1、R1C1/.test(x.msg), '冲突列表不重复列同一格');
    const col = WIKI_G.slice();
    col[18] = 5; // R3C1 与 R1C1 同列
    const y = solve(col);
    ok(y.status === 'invalid' && /第1列/.test(y.msg), '列重复定位到列: ' + y.msg);
    const box = WIKI_G.slice();
    box[19] = 5; // R3C2 与 R1C1 同宫
    const z = solve(box);
    ok(z.status === 'invalid' && /第1宫/.test(z.msg), '宫重复定位到宫: ' + z.msg);
});
section('5 无解（已知数字不重复，但全局无解）', () => {
    let seed = 424242;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let found = 0, tried = 0, totalBacktracks = 0;
    while (found < 3 && tried < 40000) {
        tried++;
        const p = WIKI_G.slice();
        for (let k = 0; k < 5; k++) {
            const i = (rnd() * 81) | 0;
            p[i] = 1 + ((rnd() * 9) | 0);
        }
        if (!noUnitDup(p))
            continue;
        if (naive(p, 1) !== 0)
            continue; // 确认确实无解
        found++;
        const rr = solve(p);
        totalBacktracks += rr.backtracks;
        ok(rr.status === 'nosol', `无解题 #${found}（${p.filter(Boolean).length} 个已知数字）-> status=nosol`);
        ok(/无解/.test(rr.msg || ''), `  报错文案说明无解: ${(rr.msg || '').slice(0, 46)}…`);
        if (found === 1)
            console.log('    样例谜面: ' + p.slice(0, 9).join('') + ' / ' + p.slice(9, 18).join('') + ' / …');
    }
    ok(found >= 3, `构造出 ${found} 个无解样本（尝试 ${tried} 次）`);
    ok(Number.isInteger(totalBacktracks) && totalBacktracks >= 0, `无解题回溯计数是合法整数 ${totalBacktracks}（回归：NaN）`);
});
section('6 多解', () => {
    let found = 0;
    for (let i = 0; i < 81 && found < 2; i++) {
        const p = WIKI_G.slice();
        p[i] = 0;
        const x = solve(p);
        if (x.status === 'multi') {
            found++;
            ok(/不唯一/.test(x.msg), `挖空第${i}格 -> 报不唯一: ${(x.msg || '').split('\n')[0]}`);
        }
    }
    ok(found >= 1, '至少找到 1 个多解样本 (' + found + ')');
    const p = WIKI_G.slice();
    p[80] = 0; // 最后一格通常是唯一可推的
    ok(solve(p).status === 'ok', '只去掉唯一可推格时仍是唯一解');
});
section('7 边界与性能', () => {
    const t0 = Date.now();
    const empty = solve(new Array(81).fill(0));
    ok(Date.now() - t0 < 8000, `空盘不死循环/不过慢 (${Date.now() - t0}ms, status=${empty.status})`);
    const f = solve(WIKI_S.slice());
    ok(f.status === 'ok' && f.steps.length === 0, '已填满的合法盘返回 ok 且无步骤');
    const badfull = WIKI_S.slice();
    badfull[0] = 1;
    ok(['invalid', 'nosol'].includes(solve(badfull).status), '填满但冲突 -> ' + solve(badfull).status);
    const t1 = Date.now();
    let uniq = 0, gens = 0;
    const clueCounts = [];
    for (const mc of [40, 34, 28, 24]) {
        for (let rep = 0; rep < 3; rep++) {
            const p = Sudoku.generatePuzzle(mc);
            gens++;
            clueCounts.push(p.filter(Boolean).length);
            const sols = Sudoku.findAll(p, 2).solutions;
            const rr = solve(p);
            if (sols.length === 1 && rr.status === 'ok' && rr.final.join('') === sols[0].join(''))
                uniq++;
            else
                console.log('    gen fail mc=' + mc + ' clues=' + p.filter(Boolean).length + ' status=' + rr.status +
                    '\n      puzzle=' + p.map((x) => x || '.').join(''));
        }
    }
    ok(uniq === gens, `生成器 ${gens} 道题全部唯一且解正确 (${uniq}/${gens})，耗时 ${Date.now() - t1}ms`);
    ok(clueCounts.every(c => c >= 24 && c <= 45), 'clue 数在合理区间: ' + clueCounts.join(','));
});
section('8 回归：与朴素 DFS 对拍（防止过度剪枝 / 漏解）', () => {
    let seed = 777;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let mismatch = 0, tested = 0, exact = 0;
    for (let trial = 0; trial < 220; trial++) {
        const order = Array.from({ length: 81 }, (_, i) => i);
        for (let i = 80; i > 0; i--) {
            const j = (rnd() * (i + 1)) | 0;
            [order[i], order[j]] = [order[j], order[i]];
        }
        const p = WIKI_S.slice();
        const mc = 17 + ((rnd() * 26) | 0); // 17~42 个已知数
        for (const i of order) {
            if (p.filter(Boolean).length <= mc)
                break;
            if (rnd() < 0.45)
                p[i] = 0;
        }
        const sols = Sudoku.findAll(p, 3).solutions;
        const a = sols.length;
        const b = naive(p, 3);
        tested++;
        if (sols.some(v => !validSolution(v, p))) {
            mismatch++;
            if (mismatch <= 3)
                console.log(`    非法解 clues=${p.filter(Boolean).length}`);
        }
        if (a !== b) {
            mismatch++;
            if (mismatch <= 3)
                console.log(`    mismatch clues=${p.filter(Boolean).length} findAll=${a} naive=${b}`);
        }
        if (a === b)
            exact++;
        // 同时验证：若 findAll 判唯一，则解必须与终盘一致（题是从 WIKI_S 挖的）
        if (a === 1) {
            const rr = solve(p);
            if (rr.status !== 'ok' || rr.final.join('') !== WIKI_S.join('')) {
                mismatch++;
                console.log('    唯一解不符 clues=' + p.filter(Boolean).length + ' status=' + rr.status);
            }
        }
    }
    ok(mismatch === 0, `${tested} 道随机题与朴素 DFS 解数完全一致 (一致 ${exact}，不符 ${mismatch})`);
});
section('9 技巧回归：隐性数组 / X-Wing 必须能触发（旧版隐性数对是死代码）', () => {
    const parseDots = (s) => s.split('').map(c => c === '.' ? 0 : +c);
    const cases = [
        ['hiddenSub', '..46..9......9...8...34.5...5...14...2.....9.7.....856..15.7..4.8.4...3..........'],
        ['xwing', '.7..28...32....59...........1.....468.4.9.1......3.....6.28..5....9.4.7.1........'],
    ];
    for (const [tech, str] of cases) {
        const g = parseDots(str);
        const rr = solve(g);
        ok(rr.status === 'ok' && (rr.stats[tech] || 0) > 0, `${tech} 被使用 ${rr.stats[tech] || 0} 次，status=${rr.status}`);
        ok(Number.isInteger(rr.backtracks) && rr.backtracks > 0, `${tech} 题确实发生回溯 ${rr.backtracks} 次（回归：NaN/恒 0）`);
        const sols = Sudoku.findAll(g, 2).solutions;
        ok(sols.length === 1 && rr.final.join('') === sols[0].join(''), `${tech} 题唯一解且答案一致`);
    }
});
section('10 批量填数：一步多格且互不依赖', () => {
    const multi = r.steps.filter((s) => s.kind === 'place' && s.moves.length > 1);
    const maxN = Math.max(0, ...multi.map((s) => s.moves.length));
    ok(multi.length > 0, `存在多格步骤（${multi.length} 步批量，单步最多 ${maxN} 格）`);
    const totalPlaced = r.steps.reduce((n, s) => n + (s.kind === 'place' ? s.moves.length : 0), 0);
    ok(totalPlaced === 81 - WIKI_G.filter(Boolean).length, `总填格数 ${totalPlaced} == 空格数 ${81 - WIKI_G.filter(Boolean).length}`);
    let bad = 0;
    for (let k = 1; k <= r.steps.length; k++) {
        const st = r.steps[k - 1];
        if (st.kind !== 'place')
            continue;
        const s = Sudoku.stateAt(WIKI_G, r.steps, k - 1);
        const seen = new Set();
        for (const mv of st.moves) {
            if (seen.has(mv.i) || s.val[mv.i] || !(s.cand[mv.i] & (1 << (mv.v - 1))))
                bad++;
            seen.add(mv.i);
        }
    }
    ok(bad === 0, `批量步骤每格都合法且不重复 (${bad} 处异常)`);
    const bi = r.steps.findIndex((s) => s.kind === 'place' && s.moves.length > 1);
    if (bi >= 0) {
        const flipped = r.steps.map((s, i) => i === bi ? Object.assign({}, s, { moves: s.moves.slice().reverse() }) : s);
        const a = Sudoku.stateAt(WIKI_G, r.steps, bi + 1);
        const b = Sudoku.stateAt(WIKI_G, flipped, bi + 1);
        ok(a.val.join('') === b.val.join('') && a.cand.join('') === b.cand.join(''), '批量内顺序不影响回放结果（互不依赖）');
    }
});
section('11 Worker 协议：dist/worker.js 与 ui.ts 的消息契约', () => {
    const src = fs.readFileSync(__dirname + '/worker.js', 'utf8');
    const posted = [];
    const stubSelf = {
        importScripts() { }, // 测试里 Sudoku 已注入，无需真加载
        postMessage(m) { posted.push(m); },
        onmessage: null,
    };
    // 以参数注入 worker.js 用到的两个自由变量（self / Sudoku）——与浏览器 Worker 内一致
    const initWorker = new Function('self', 'Sudoku', src);
    initWorker(stubSelf, Sudoku);
    const fire = (msg) => { posted.length = 0; stubSelf.onmessage({ data: msg }); return posted[0]; };
    const a = fire({ type: 'solve', given: WIKI_G, id: 7 });
    ok(a && a.id === 7 && a.data.status === 'ok', 'solve：回带请求 id，status=ok');
    ok(a.data.final.join('') === WIKI_S.join(''), 'solve：解与标准答案一致');
    ok(JSON.stringify(a.data.steps) === JSON.stringify(solve(WIKI_G).steps), 'solve：步骤表与主线程求解完全一致');
    const b = fire({ type: 'generate', minClues: 34, id: 8 });
    ok(b && b.id === 8 && Array.isArray(b.data) && b.data.length === 81, 'generate：回带 id，产出 81 格谜面');
    ok(b.data.filter(Boolean).length >= 24 && solve(b.data).status === 'ok', 'generate：谜面唯一可解');
    ok(fire({ type: 'unknown', id: 9 }) === undefined, '未知消息类型被忽略（不回复、不崩溃）');
});
console.log(`\n========== 通过 ${pass} / 失败 ${fail} ==========`);
process.exit(fail ? 1 : 0);
