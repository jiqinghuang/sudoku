"use strict";
/* 数独求解器（位运算 + 约束传播 + 唯一解搜索 + 逐步推理）
   源码：src/solver.ts → 编译产物：dist/solver.js（随仓库提交）
   浏览器：<script src="dist/solver.js"></script> → window.Sudoku
   Node：  const Sudoku = require('./solver.js')

   步骤结构：
   - 填数：{ kind:'place', moves:[{i,v,tech,reason,meta}...] }
     同一盘面下互不依赖的确定格会合并成一步（moves 长度 > 1）
   - 排除：{ kind:'elim', tech, mask, cells, reason, meta }
   meta 供界面高亮：{ units:[行/列/宫编号], focus:[推理格], marks:{格号:{pick,strike}} } */
(function (root, factory) {
    if (typeof module === 'object' && module.exports)
        module.exports = factory();
    else
        root.Sudoku = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const ALL = 0x1FF;
    const PC = new Uint8Array(512);
    for (let i = 0; i < 512; i++)
        PC[i] = (i & 1) + (i >> 1 ? PC[i >> 1] : 0);
    const pop = (m) => PC[m & 0x1FF];
    const bitOf = (d) => 1 << (d - 1);
    const valOfBit = (b) => 31 - Math.clz32(b) + 1;
    const bits = (m) => { const a = []; for (let d = 1; d <= 9; d++)
        if (m & bitOf(d))
            a.push(d); return a; };
    const boxOf = (r, c) => Math.floor(r / 3) * 3 + Math.floor(c / 3);
    const RC = (i) => [(i / 9) | 0, i % 9];
    const nm = (i) => { const [r, c] = RC(i); return `R${r + 1}C${c + 1}`; };
    const ln = (i) => { const [r, c] = RC(i); return `第${r + 1}行第${c + 1}列`; };
    const list = (a) => a.map(nm).join('、');
    const PEERS = [], UNITS = [], RNAME = [];
    for (let i = 0; i < 81; i++) {
        const [r, c] = RC(i), p = new Set();
        for (let k = 0; k < 9; k++) {
            if (k !== c)
                p.add(r * 9 + k);
            if (k !== r)
                p.add(k * 9 + c);
        }
        const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
        for (let k = 0; k < 9; k++) {
            const x = br + ((k / 3) | 0), y = bc + k % 3;
            if (x !== r || y !== c)
                p.add(x * 9 + y);
        }
        PEERS.push([...p]); // 迁移时修复：行/列/宫交叠导致每格混入 4 个重复邻居（24 项 → 20 个唯一格）
    }
    for (let r = 0; r < 9; r++)
        UNITS.push(Array.from({ length: 9 }, (_, c) => r * 9 + c));
    for (let c = 0; c < 9; c++)
        UNITS.push(Array.from({ length: 9 }, (_, r) => r * 9 + c));
    for (let b = 0; b < 9; b++) {
        const u = [], br = Math.floor(b / 3) * 3, bc = b % 3 * 3;
        for (let k = 0; k < 9; k++)
            u.push((br + ((k / 3) | 0)) * 9 + bc + k % 3);
        UNITS.push(u);
    }
    for (let u = 0; u < 27; u++)
        RNAME.push(u < 9 ? `第${u + 1}行` : u < 18 ? `第${u - 8}列` : `第${u - 17}宫`);
    const clone = (s) => ({ val: Int8Array.from(s.val), cand: Int16Array.from(s.cand) });
    /** 由谜面建立初始状态 + 校验已知数字冲突 */
    function init(given) {
        const s = { val: new Int8Array(81), cand: new Int16Array(81).fill(ALL) };
        const seen = { r: new Int16Array(9), c: new Int16Array(9), b: new Int16Array(9) };
        for (let i = 0; i < 81; i++) {
            const d = given[i];
            if (!d)
                continue;
            const [r, c] = RC(i), x = boxOf(r, c), m = bitOf(d);
            let unit = -1;
            if (seen.r[r] & m)
                unit = r;
            else if (seen.c[c] & m)
                unit = 9 + c;
            else if (seen.b[x] & m)
                unit = 18 + x;
            if (unit >= 0) {
                const other = [];
                for (const j of UNITS[unit])
                    if (j !== i && given[j] === d)
                        other.push(j);
                const at = other.concat(i).sort((a, b) => a - b).map(nm);
                return { error: 'known', msg: `题目本身有矛盾：数字 ${d} 在${RNAME[unit]}里重复出现（${at.join('、')}）。同一行/列/宫不能有两个 ${d}，请检查这几格的输入。` };
            }
            seen.r[r] |= m;
            seen.c[c] |= m;
            seen.b[x] |= m;
            s.val[i] = d;
        }
        for (let i = 0; i < 81; i++) {
            if (s.val[i]) {
                s.cand[i] = 0;
                continue;
            }
            const [r, c] = RC(i);
            s.cand[i] = ALL & ~(seen.r[r] | seen.c[c] | seen.b[boxOf(r, c)]);
        }
        return { state: s };
    }
    const full = (s) => { for (let i = 0; i < 81; i++)
        if (!s.val[i])
            return false; return true; };
    const dead = (s) => { for (let i = 0; i < 81; i++)
        if (!s.val[i] && !s.cand[i])
            return i; return -1; };
    function place(s, i, v) {
        s.val[i] = v;
        s.cand[i] = 0;
        const m = ~bitOf(v);
        for (const p of PEERS[i])
            if (!s.val[p])
                s.cand[p] &= m;
    }
    const usedIn = (s, u) => { let m = 0; for (const i of UNITS[u])
        if (s.val[i])
            m |= bitOf(s.val[i]); return m; };
    const candTxt = (s, i) => `{${bits(s.cand[i]).join(',')}}`;
    const cellCands = (s, cells) => cells.map(i => `${nm(i)}${candTxt(s, i)}`).join('、');
    /* ============================================================
       各技巧：返回步骤（含 reason 文字 + meta 高亮信息）
       文案面向初学者：结论 → 为什么 → 结论 → 💡 口诀
       ============================================================ */
    /* ---- 技巧 1：唯一候选数 ---- */
    function makeNaked(s, i, v) {
        const [r, c] = RC(i), b = boxOf(r, c);
        const dr = bits(usedIn(s, r)), dc = bits(usedIn(s, 9 + c)), db = bits(usedIn(s, 18 + b));
        return { i, v, tech: 'naked',
            reason: `【唯一候选数】${ln(i)}只剩一个候选：${v}，可以直接填入。\n` +
                `为什么：它所在的第${r + 1}行已经填了 {${dr.join(',')}}，第${c + 1}列已经填了 {${dc.join(',')}}，第${b + 1}宫已经填了 {${db.join(',')}}。\n` +
                `按规则，同一个行、列、宫里不能有重复数字，所以上面这些数字这格都不能填——1～9 里只剩 ${v} 没被排除，它就是唯一选择。\n` +
                `💡 小提示：「候选数」就是每个空格目前还允许填的数字；一格被 8 个数字堵死，剩下那个就是唯一候选。`,
            meta: { units: [r, 9 + c, 18 + b], focus: [i], marks: { [i]: { pick: v } } } };
    }
    /* ---- 技巧 2：隐性唯一数（行/列/宫唯一） ---- */
    function makeHidden(s, u, i, d) {
        const others = UNITS[u].filter(j => j !== i && !s.val[j]);
        const filled = UNITS[u].filter(j => s.val[j]);
        const missing = bits(ALL & ~usedIn(s, u));
        const marks = { [i]: { pick: d } };
        for (const j of others)
            if (s.cand[j] & bitOf(d))
                marks[j] = { strike: [d] };
        return { i, v: d, tech: 'hidden',
            reason: `【${RNAME[u]}唯一】数字 ${d} 在${RNAME[u]}里只剩 ${nm(i)} 一格能放。\n` +
                `为什么：${RNAME[u]}已填 ${filled.length} 格（${filled.map(j => `${nm(j)}=${s.val[j]}`).join('、') || '无'}），还缺 {${missing.join(',')}}，${d} 是其中之一。\n` +
                `逐格看${RNAME[u]}的其余空格${others.length ? `（${cellCands(s, others)}）` : '（无空格）'}：它们的候选里都没有 ${d}，只有 ${nm(i)} 还留得住 ${d}。\n` +
                `每个数字在每个行/列/宫里都必须出现一次——既然别处都放不下，${d} 就只能填在 ${nm(i)}。\n` +
                `💡 小提示：这叫「隐性唯一」——这格看似候选很多，其实其中一个数字全单元只有它接得住。`,
            meta: { units: [u], focus: [i], marks } };
    }
    /* ---- 技巧 3：区块摒除（宫消行 / 宫消列 / 行消宫 / 列消宫） ---- */
    function tLocked(s) {
        for (let b = 0; b < 9; b++) {
            for (let d = 1; d <= 9; d++) {
                const bit = bitOf(d);
                const spots = UNITS[18 + b].filter(i => !s.val[i] && (s.cand[i] & bit));
                if (spots.length < 2)
                    continue;
                const rows = [...new Set(spots.map(i => (i / 9) | 0))], cols = [...new Set(spots.map(i => i % 9))];
                if (rows.length === 1) {
                    const r = rows[0];
                    const t = UNITS[r].filter(i => !spots.includes(i) && !s.val[i] && (s.cand[i] & bit));
                    if (t.length) {
                        const others = UNITS[18 + b].filter(i => !spots.includes(i) && !s.val[i]);
                        const marks = {};
                        for (const i of t)
                            marks[i] = { strike: [d] };
                        return { kind: 'elim', tech: 'locked', mask: bit, cells: t,
                            reason: `【区块摒除·宫消行】第${b + 1}宫的数字 ${d} 只能落在 ${list(spots)}，而这几格全在第${r + 1}行。\n` +
                                `为什么：把第${b + 1}宫的其余空格逐个看${others.length ? `（${cellCands(s, others)}）` : ''}，它们的候选里都没有 ${d}——所以第${b + 1}宫的 ${d} 只能在 ${list(spots)} 这几格里挑。\n` +
                                `不管 ${d} 最后落在哪一格，它都在第${r + 1}行，而同一行不能有两个 ${d}。\n` +
                                `结论：第${r + 1}行宫外的这些格子可以划掉 ${d}：${cellCands(s, t)}。\n` +
                                `💡 小提示：某个数字在一个宫里被挤进同一行，这一行宫外的同数字候选就全部排除。`,
                            meta: { units: [18 + b, r], focus: spots, marks } };
                    }
                }
                if (cols.length === 1) {
                    const c = cols[0];
                    const t = UNITS[9 + c].filter(i => !spots.includes(i) && !s.val[i] && (s.cand[i] & bit));
                    if (t.length) {
                        const others = UNITS[18 + b].filter(i => !spots.includes(i) && !s.val[i]);
                        const marks = {};
                        for (const i of t)
                            marks[i] = { strike: [d] };
                        return { kind: 'elim', tech: 'locked', mask: bit, cells: t,
                            reason: `【区块摒除·宫消列】第${b + 1}宫的数字 ${d} 只能落在 ${list(spots)}，而这几格全在第${c + 1}列。\n` +
                                `为什么：把第${b + 1}宫的其余空格逐个看${others.length ? `（${cellCands(s, others)}）` : ''}，它们的候选里都没有 ${d}——所以第${b + 1}宫的 ${d} 只能在 ${list(spots)} 这几格里挑。\n` +
                                `不管 ${d} 最后落在哪一格，它都在第${c + 1}列，而同一列不能有两个 ${d}。\n` +
                                `结论：第${c + 1}列宫外的这些格子可以划掉 ${d}：${cellCands(s, t)}。\n` +
                                `💡 小提示：某个数字在一个宫里被挤进同一列，这一列宫外的同数字候选就全部排除。`,
                            meta: { units: [18 + b, 9 + c], focus: spots, marks } };
                    }
                }
            }
        }
        for (let u = 0; u < 18; u++) {
            for (let d = 1; d <= 9; d++) {
                const bit = bitOf(d);
                const spots = UNITS[u].filter(i => !s.val[i] && (s.cand[i] & bit));
                if (spots.length < 2)
                    continue;
                const bs = [...new Set(spots.map(i => boxOf((i / 9) | 0, i % 9)))];
                if (bs.length === 1) {
                    const b = bs[0];
                    const t = UNITS[18 + b].filter(i => !spots.includes(i) && !s.val[i] && (s.cand[i] & bit));
                    if (t.length) {
                        const others = UNITS[u].filter(i => !spots.includes(i) && !s.val[i]);
                        const marks = {};
                        for (const i of t)
                            marks[i] = { strike: [d] };
                        return { kind: 'elim', tech: 'locked', mask: bit, cells: t,
                            reason: `【区块摒除·${RNAME[u]}消宫】${RNAME[u]}的数字 ${d} 只能落在 ${list(spots)}，而这几格全在第${b + 1}宫。\n` +
                                `为什么：把${RNAME[u]}的其余空格逐个看${others.length ? `（${cellCands(s, others)}）` : ''}，它们的候选里都没有 ${d}——所以${RNAME[u]}的 ${d} 只能在 ${list(spots)} 这几格里挑。\n` +
                                `不管 ${d} 最后落在哪一格，它都在第${b + 1}宫，而同一宫不能有两个 ${d}。\n` +
                                `结论：第${b + 1}宫内、${RNAME[u]}外的这些格子可以划掉 ${d}：${cellCands(s, t)}。\n` +
                                `💡 小提示：某个数字在一行/列里被挤进同一个宫，这个宫内该行/列外的同数字候选就全部排除。`,
                            meta: { units: [u, 18 + b], focus: spots, marks } };
                    }
                }
            }
        }
    }
    /* ---- 技巧 4：显性数对/三数组 ---- */
    function combos(a, k) {
        const out = [];
        (function go(i, cur) {
            if (cur.length === k) {
                out.push(cur.slice());
                return;
            }
            for (let j = i; j < a.length; j++) {
                cur.push(a[j]);
                go(j + 1, cur);
                cur.pop();
            }
        })(0, []);
        return out;
    }
    function tNakedSubset(s) {
        for (let u = 0; u < 27; u++) {
            const cells = UNITS[u].filter(i => !s.val[i]);
            for (let k = 2; k <= 3; k++) {
                for (const combo of combos(cells, k)) {
                    let mask = 0;
                    for (const i of combo)
                        mask |= s.cand[i];
                    if (pop(mask) !== k)
                        continue;
                    const t = UNITS[u].filter(i => !s.val[i] && !combo.includes(i) && (s.cand[i] & mask));
                    if (!t.length)
                        continue;
                    const marks = {};
                    for (const i of t)
                        marks[i] = { strike: bits(mask) };
                    return { kind: 'elim', tech: 'nakedSub', mask, cells: t,
                        reason: `【显性数${k === 2 ? '对' : '组'}】${RNAME[u]}里 ${cellCands(s, combo)} 这 ${k} 格，候选合起来正好只有 ${k} 个数字：{${bits(mask).join(',')}}。\n` +
                            `为什么：${k} 个格子要填 ${k} 个互不相同的数字，而它们能填的数合起来刚好就是 {${bits(mask).join(',')}}——这几个数字只能由这几格"承包"。\n` +
                            `结论：${RNAME[u]}的其他格子就用不上 {${bits(mask).join(',')}} 了，划掉：${cellCands(s, t)}。\n` +
                            `💡 小提示：「显性」＝从格子上直接看得出来：${k} 格只含 ${k} 种候选，别的格子就别抢了。`,
                        meta: { units: [u], focus: combo, marks } };
                }
            }
        }
    }
    /* ---- 技巧 5：隐性数对/三数组（k 个数字只出现在同一单元的 k 格里） ---- */
    const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const COMBOS = { 2: combos(DIGITS, 2), 3: combos(DIGITS, 3) };
    function tHiddenSubset(s) {
        for (let u = 0; u < 27; u++) {
            const used = usedIn(s, u), pos = new Int16Array(10); // pos[d]：单元内可放 d 的格位掩码
            for (let x = 0; x < 9; x++) {
                const i = UNITS[u][x];
                if (s.val[i])
                    continue;
                const m = s.cand[i];
                for (const d of DIGITS)
                    if (m & bitOf(d))
                        pos[d] |= 1 << x;
            }
            for (const k of [2, 3]) {
                for (const combo of COMBOS[k]) {
                    let m = 0, spotsMask = 0;
                    for (const d of combo) {
                        if (used & bitOf(d)) {
                            m = 0;
                            break;
                        }
                        m |= bitOf(d);
                        spotsMask |= pos[d];
                    }
                    if (!m || pop(spotsMask) !== k)
                        continue;
                    let extra = 0;
                    const t = [];
                    for (let x = 0; x < 9; x++)
                        if (spotsMask & (1 << x)) {
                            const i = UNITS[u][x], e = s.cand[i] & ~m;
                            if (e) {
                                extra |= e;
                                t.push(i);
                            }
                        }
                    if (!extra)
                        continue;
                    const spots = [];
                    for (let x = 0; x < 9; x++)
                        if (spotsMask & (1 << x))
                            spots.push(UNITS[u][x]);
                    const marks = {};
                    for (const i of t)
                        marks[i] = { strike: bits(s.cand[i] & extra) };
                    const per = t.map(i => `${nm(i)} 划掉 {${bits(s.cand[i] & extra).join(',')}}`).join('；');
                    return { kind: 'elim', tech: 'hiddenSub', mask: extra, cells: t,
                        reason: `【隐性数${k === 2 ? '对' : '组'}】${RNAME[u]}里，数字 {${bits(m).join(',')}} 只可能落在 ${cellCands(s, spots)} 这 ${k} 格。\n` +
                            `为什么：把${RNAME[u]}的空格逐个检查，{${bits(m).join(',')}} 在别的空格里都放不进，只有这 ${k} 格接得住——这 ${k} 格必须腾出位置装下这 ${k} 个数。\n` +
                            `结论：这几格除了 {${bits(m).join(',')}} 之外的候选都放不下了，划掉：${per}。\n` +
                            `💡 小提示：「隐性」＝要把整个单元里某些数字的可能位置数一遍才看得出来，藏在候选背后。`,
                        meta: { units: [u], focus: spots, marks } };
                }
            }
        }
    }
    /* ---- 技巧 6：X-Wing（矩形摒除） ---- */
    function tXWing(s) {
        for (let d = 1; d <= 9; d++) {
            const b = bitOf(d);
            for (let r1 = 0; r1 < 9; r1++) { // 行 → 列
                const a = UNITS[r1].filter(i => !s.val[i] && (s.cand[i] & b));
                if (a.length !== 2)
                    continue;
                for (let r2 = r1 + 1; r2 < 9; r2++) {
                    const c2 = UNITS[r2].filter(i => !s.val[i] && (s.cand[i] & b));
                    if (c2.length !== 2)
                        continue;
                    const ca = a[0] % 9, cb = a[1] % 9;
                    if (!(c2.some(i => i % 9 === ca) && c2.some(i => i % 9 === cb)))
                        continue;
                    const t = [];
                    for (const col of [ca, cb])
                        for (let r = 0; r < 9; r++) {
                            if (r === r1 || r === r2)
                                continue;
                            const i = r * 9 + col;
                            if (!s.val[i] && (s.cand[i] & b))
                                t.push(i);
                        }
                    if (!t.length)
                        continue;
                    const marks = {};
                    for (const i of t)
                        marks[i] = { strike: [d] };
                    return { kind: 'elim', tech: 'xwing', mask: b, cells: t,
                        reason: `【X-Wing】数字 ${d}：在第${r1 + 1}行只能放在第${ca + 1}、${cb + 1}列，在第${r2 + 1}行也只能放在这两列，四角构成一个矩形（${cellCands(s, a.concat(c2))}）。\n` +
                            `为什么：第${r1 + 1}行需要一个 ${d}，第${r2 + 1}行也需要；两行都只有这两个位置，又不能挤进同一列，所以一个 ${d} 占第${ca + 1}列、另一个占第${cb + 1}列，刚好占满。\n` +
                            `结论：无论谁占哪列，第${ca + 1}列和第${cb + 1}列的 ${d} 都被这两个角用掉了，这两列其他行的格子放不了：${cellCands(s, t)} 划掉 ${d}。\n` +
                            `💡 小提示：X-Wing 就是两行、两列各两条"通道"锁成矩形，四角互锁，另外两条边上的候选全部排除。`,
                        meta: { units: [r1, r2], focus: a.concat(c2), marks } };
                }
            }
            for (let c1 = 0; c1 < 9; c1++) { // 列 → 行
                const a = UNITS[9 + c1].filter(i => !s.val[i] && (s.cand[i] & b));
                if (a.length !== 2)
                    continue;
                for (let c2 = c1 + 1; c2 < 9; c2++) {
                    const B = UNITS[9 + c2].filter(i => !s.val[i] && (s.cand[i] & b));
                    if (B.length !== 2)
                        continue;
                    const ra = (a[0] / 9) | 0, rb = (a[1] / 9) | 0;
                    if (!(B.some(i => ((i / 9) | 0) === ra) && B.some(i => ((i / 9) | 0) === rb)))
                        continue;
                    const t = [];
                    for (const row of [ra, rb])
                        for (let c = 0; c < 9; c++) {
                            if (c === c1 || c === c2)
                                continue;
                            const i = row * 9 + c;
                            if (!s.val[i] && (s.cand[i] & b))
                                t.push(i);
                        }
                    if (!t.length)
                        continue;
                    const marks = {};
                    for (const i of t)
                        marks[i] = { strike: [d] };
                    return { kind: 'elim', tech: 'xwing', mask: b, cells: t,
                        reason: `【X-Wing】数字 ${d}：在第${c1 + 1}列只能放在第${ra + 1}、${rb + 1}行，在第${c2 + 1}列也只能放在这两行，四角构成一个矩形（${cellCands(s, a.concat(B))}）。\n` +
                            `为什么：第${c1 + 1}列需要一个 ${d}，第${c2 + 1}列也需要；两列都只有这两个位置，又不能挤进同一行，所以一个 ${d} 占第${ra + 1}行、另一个占第${rb + 1}行，刚好占满。\n` +
                            `结论：无论谁占哪行，第${ra + 1}行和第${rb + 1}行的 ${d} 都被这两个角用掉了，这两行其他列的格子放不了：${cellCands(s, t)} 划掉 ${d}。\n` +
                            `💡 小提示：X-Wing 就是两行、两列各两条"通道"锁成矩形，四角互锁，另外两条边上的候选全部排除。`,
                        meta: { units: [9 + c1, 9 + c2], focus: a.concat(B), marks } };
                }
            }
        }
    }
    /* ---- 试填 ---- */
    function makeGuess(s, i, v) {
        return { i, v, tech: 'guess',
            reason: `【试填·此步不唯一】前面所有推理技巧都用尽了仍推不动，只能做假设：${ln(i)}先试着填 ${v}。\n` +
                `为什么：${ln(i)}的候选是 {${bits(s.cand[i]).join(',')}}，每一个都没法用唯一性证明或排除，只能挑候选最少的格子先假设一个。\n` +
                `接下来如果推出矛盾，会自动回到这里换下一个数字重试——试错过程不会出现在步骤表里，你看到的这步是最终走通的假设。\n` +
                `💡 小提示：出现试填，说明这道题超出了本工具的技巧范围（需要更高阶技巧），步骤的唯一性不再保证。`,
            meta: { units: [], focus: [i], marks: { [i]: { pick: v } } } };
    }
    const TECH = { naked: '唯一候选数', hidden: '行/列/宫唯一', locked: '区块摒除',
        nakedSub: '显性数组', hiddenSub: '隐性数组', xwing: 'X-Wing',
        guess: '试填(非唯一)', mixed: '混合' };
    /* ---- 批量收集：同一盘面下所有互不依赖的确定格 ---- */
    function collectSingles(s) {
        const moves = [], used = new Uint8Array(81);
        for (let i = 0; i < 81; i++) { // 唯一候选数
            if (s.val[i])
                continue;
            const m = s.cand[i];
            if (m && !(m & (m - 1))) {
                moves.push(makeNaked(s, i, valOfBit(m)));
                used[i] = 1;
            }
        }
        for (let u = 0; u < 27; u++) { // 行/列/宫唯一
            const uM = usedIn(s, u);
            for (let d = 1; d <= 9; d++) {
                if (uM & bitOf(d))
                    continue;
                let spot = -1, cnt = 0;
                for (const i of UNITS[u])
                    if (!s.val[i] && (s.cand[i] & bitOf(d))) {
                        spot = i;
                        if (++cnt > 1)
                            break;
                    }
                if (cnt === 1 && !used[spot]) {
                    moves.push(makeHidden(s, u, spot, d));
                    used[spot] = 1;
                }
            }
        }
        return moves;
    }
    function makeBatchStep(moves) {
        if (moves.length === 1) {
            const mv = moves[0];
            return { kind: 'place', moves, i: mv.i, v: mv.v, tech: mv.tech, reason: mv.reason, meta: mv.meta };
        }
        const counts = {};
        for (const mv of moves)
            counts[mv.tech] = (counts[mv.tech] || 0) + 1;
        const label = Object.keys(counts).map(t => `${TECH[t]}×${counts[t]}`).join('、');
        const lines = moves.map((mv, k) => `${k + 1}. ${nm(mv.i)} = ${mv.v}（${TECH[mv.tech]}）`);
        return { kind: 'place', moves, tech: 'mixed',
            reason: `本步 ${moves.length} 格一次填入：${label}。\n` +
                `这些都是基于本步开始时的盘面就能确定的格子——各自的理由互相独立、谁也不依赖谁，先后顺序不影响结果，可以放心一次填入。\n` +
                `逐格结论：\n${lines.join('\n')}` };
    }
    function findStep(s) {
        const moves = collectSingles(s);
        if (moves.length)
            return makeBatchStep(moves);
        for (const f of [tLocked, tNakedSubset, tHiddenSubset, tXWing]) {
            const r = f(s);
            if (r)
                return r;
        }
        return undefined;
    }
    /** 应用一步；若与当前盘面冲突（只在错误分支里可能发生）返回冲突格，否则返回 -1 */
    function applyStep(s, st) {
        if (st.kind === 'place') {
            for (const mv of st.moves) {
                if (s.val[mv.i])
                    return mv.i;
                const [r, c] = RC(mv.i), b = boxOf(r, c);
                if ((usedIn(s, r) | usedIn(s, 9 + c) | usedIn(s, 18 + b)) & bitOf(mv.v))
                    return mv.i;
                place(s, mv.i, mv.v);
            }
        }
        else
            for (const c of st.cells)
                s.cand[c] &= ~st.mask;
        return -1;
    }
    function countStep(stats, st) {
        if (st.kind === 'place') {
            for (const mv of st.moves)
                stats[mv.tech] = (stats[mv.tech] || 0) + 1;
        }
        else
            stats[st.tech] = (stats[st.tech] || 0) + 1;
    }
    function pickGuess(s) {
        let b = -1, bn = 10;
        for (let i = 0; i < 81; i++)
            if (!s.val[i]) {
                const n = pop(s.cand[i]);
                if (n > 1 && n < bn) {
                    bn = n;
                    b = i;
                }
            }
        return b;
    }
    /* ---- 搜索：返回完整线性步骤表 ---- */
    function search(s, steps, stats) {
        for (;;) {
            if (full(s))
                return { ok: true, steps, solution: Array.from(s.val) };
            const d = dead(s);
            if (d >= 0)
                return { ok: false, conflict: d };
            const st = findStep(s);
            if (!st)
                break;
            const cf = applyStep(s, st);
            if (cf >= 0)
                return { ok: false, conflict: cf };
            steps.push(st);
            countStep(stats, st);
        }
        const gi = pickGuess(s);
        if (gi < 0)
            return { ok: false, conflict: dead(s) };
        for (const v of bits(s.cand[gi])) {
            const s2 = clone(s);
            place(s2, gi, v);
            if (dead(s2) >= 0) {
                stats.backtracks = (stats.backtracks || 0) + 1;
                continue;
            }
            const r = search(s2, [], stats);
            if (r.ok) {
                const g = { kind: 'place', moves: [makeGuess(s, gi, v)], i: gi, v, tech: 'guess', meta: null };
                g.reason = g.moves[0].reason;
                g.meta = g.moves[0].meta;
                stats.guess = (stats.guess || 0) + 1;
                return { ok: true, steps: steps.concat([g]).concat(r.steps), solution: r.solution };
            }
            stats.backtracks = (stats.backtracks || 0) + 1;
        }
        return { ok: false, conflict: gi };
    }
    /* ---- 唯一解计数（到 limit 为止） ---- */
    function findAll(given, limit = 2) {
        const r0 = init(given);
        if (r0.error)
            return { solutions: [], error: true, msg: r0.msg };
        const out = [];
        (function rec(s) {
            if (out.length >= limit)
                return;
            for (;;) {
                if (full(s)) {
                    out.push(Array.from(s.val));
                    return;
                }
                const d = dead(s);
                if (d >= 0)
                    return;
                const st = findStep(s);
                if (!st)
                    break;
                if (applyStep(s, st) >= 0)
                    return;
            }
            const gi = pickGuess(s);
            if (gi < 0)
                return;
            for (const v of bits(s.cand[gi])) {
                if (out.length >= limit)
                    return;
                const s2 = clone(s);
                place(s2, gi, v);
                if (dead(s2) >= 0)
                    continue;
                rec(s2);
            }
        })(r0.state);
        return { solutions: out };
    }
    /** 回放：把 steps 的前 k 步应用到谜面，得到该时刻的盘面（UI 与测试共用） */
    function stateAt(given, steps, k) {
        const s = { val: new Int8Array(81), cand: new Int16Array(81).fill(ALL) };
        const seen = { r: new Int16Array(9), c: new Int16Array(9), b: new Int16Array(9) };
        for (let i = 0; i < 81; i++)
            if (given[i]) {
                const [r, c] = RC(i), m = bitOf(given[i]);
                seen.r[r] |= m;
                seen.c[c] |= m;
                seen.b[boxOf(r, c)] |= m;
                s.val[i] = given[i];
                s.cand[i] = 0;
            }
        for (let i = 0; i < 81; i++)
            if (!s.val[i]) {
                const [r, c] = RC(i);
                s.cand[i] = ALL & ~(seen.r[r] | seen.c[c] | seen.b[boxOf(r, c)]);
            }
        if (steps) {
            const n = Math.min(k, steps.length);
            for (let j = 0; j < n; j++)
                applyStep(s, steps[j]);
        }
        return s;
    }
    /** 主入口 */
    function solve(given) {
        const r0 = init(given);
        if (r0.error)
            return { status: 'invalid', msg: r0.msg };
        const clues = given.filter(Boolean).length;
        if (full(r0.state)) {
            return { status: 'ok', clues, steps: [], final: Array.from(r0.state.val), stats: {}, guesses: 0, backtracks: 0 };
        }
        const stats = {};
        const r = search(clone(r0.state), [], stats);
        if (!r.ok) {
            const c = r.conflict != null && r.conflict >= 0 ? r.conflict : -1;
            return { status: 'nosol', clues, backtracks: stats.backtracks || 0, msg: c >= 0
                    ? `题目无解。按现有已知数字推下去，${ln(c)}一个数字都放不进：它所在的行、列、宫把 1～9 全占满了（或候选全被排除），说明已知数字之间有矛盾，请检查输入。`
                    : '题目无解。请检查已知数字的输入。' };
        }
        const guesses = stats.guess || 0;
        const backtracks = stats.backtracks || 0;
        if (guesses === 0) {
            // 每一步都是保持解集不变的确定性推理，最终得到唯一终盘 ⇒ 题目唯一解
            return { status: 'ok', clues, steps: r.steps, final: r.solution, stats, guesses: 0, backtracks };
        }
        const sols = findAll(given, 2).solutions;
        if (sols.length === 0)
            return { status: 'nosol', clues, backtracks, msg: '题目无解。请检查已知数字的输入。' };
        if (sols.length > 1) {
            const diff = [];
            for (let i = 0; i < 81; i++)
                if (sols[0][i] !== sols[1][i])
                    diff.push(`${nm(i)} 可为 ${sols[0][i]} 或 ${sols[1][i]}`);
            return { status: 'multi', clues, msg: `题目不唯一：至少存在 2 个不同解，无法给出唯一步骤。\n差异格：${diff.slice(0, 8).join('；')}${diff.length > 8 ? ` …共 ${diff.length} 格` : ''}\n💡 多半是已知数字太少，再补几个已知数就能变成唯一解。`,
                diff, steps: null };
        }
        return { status: 'ok', clues, steps: r.steps, final: sols[0], stats, guesses, backtracks };
    }
    /* ---- 题目生成：先随机终盘，再挖空，每次保证唯一解 ---- */
    const FALLBACK_SOL = [5, 3, 4, 6, 7, 8, 9, 1, 2, 6, 7, 2, 1, 9, 5, 3, 4, 8, 1, 9, 8, 3, 4, 2, 5, 6, 7,
        8, 5, 9, 7, 6, 1, 4, 2, 3, 4, 2, 6, 8, 5, 3, 7, 9, 1, 7, 1, 3, 9, 2, 4, 8, 5, 6,
        9, 6, 1, 5, 3, 7, 2, 8, 4, 2, 8, 7, 4, 1, 9, 6, 3, 5, 3, 4, 5, 2, 8, 6, 1, 7, 9];
    let seed = (Date.now() ^ 0x9e3779b9) >>> 0; // xorshift32：长周期，不会退化成短周期
    const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
    function randomSolution() {
        for (let t = 0; t < 60; t++) {
            const p = new Array(81).fill(0);
            for (let k = 0; k < 20; k++) {
                const i = (rnd() * 81) | 0;
                if (!p[i])
                    p[i] = 1 + ((rnd() * 9) | 0);
            }
            const r = findAll(p, 1);
            if (r.solutions[0])
                return Array.from(r.solutions[0]);
        }
        return FALLBACK_SOL.slice();
    }
    function generatePuzzle(minClues) {
        const sol = randomSolution();
        const order = Array.from({ length: 81 }, (_, i) => i);
        for (let i = 80; i > 0; i--) {
            const j = (rnd() * (i + 1)) | 0;
            [order[i], order[j]] = [order[j], order[i]];
        }
        const p = sol.slice(); // 从唯一解出发逐个挖空；挖后必须仍是唯一解
        let clues = 81;
        for (const i of order) {
            if (clues <= minClues)
                break;
            const keep = p[i];
            p[i] = 0;
            if (findAll(p, 2).solutions.length !== 1)
                p[i] = keep;
            else
                clues--;
        }
        return p;
    }
    return { solve, findAll, generatePuzzle, stateAt, ALL, RC, nm, ln, bits, pop, PEERS, UNITS, RNAME, TECH };
});
