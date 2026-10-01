"use strict";
/* 数独逐步解 · 界面（源码 src/ui.ts → 编译产物 dist/ui.js）
   浏览器由 index.html 依次加载 dist/solver.js（挂载全局 Sudoku）与本文件；
   uitest.ts 用最小 DOM stub 直接执行同一份 dist/ui.js 做接线测试。 */
const $ = (s) => document.querySelector(s); // 页面很小，DOM 查找统一按 any 处理
const board = $('#board'), pad = $('#pad');
let given = new Array(81).fill(0);
let steps = [], res = null, cur = 0, sel = 40, playing = null, showCands = false, showElims = true;
const cellEls = [];
function buildBoard() {
    board.innerHTML = '';
    for (let i = 0; i < 81; i++) {
        const el = document.createElement('div');
        const v = document.createElement('span');
        v.className = 'v';
        const cands = document.createElement('div');
        cands.className = 'cands';
        const badge = document.createElement('span');
        badge.className = 'badge';
        el.appendChild(v);
        el.appendChild(cands);
        el.appendChild(badge);
        el.onclick = () => { sel = i; render(); };
        el.ondblclick = () => { const n = steps.findIndex(s2 => s2.kind === 'place' && s2.moves.some(m => m.i === i)); if (n >= 0) {
            cur = n + 1;
            render();
        } };
        board.appendChild(el);
        cellEls.push({ el, v, cands, badge });
    }
}
function stepMeta(st) {
    const units = new Set(), focus = new Set(), marks = {};
    const metas = st.kind === 'place' ? st.moves.map(m => m.meta) : [st.meta];
    for (const m of metas) {
        if (!m)
            continue;
        for (const u of m.units || [])
            units.add(u);
        for (const i of m.focus || [])
            focus.add(i);
        for (const k in m.marks)
            marks[k] = Object.assign(marks[k] || {}, m.marks[k]);
    }
    return { units, focus, marks };
}
function render() {
    if (!cellEls.length)
        buildBoard();
    const s = Sudoku.stateAt(given, steps, cur);
    const curStep = cur > 0 ? steps[cur - 1] : null;
    const meta = curStep ? stepMeta(curStep) : null;
    const elimSet = curStep && curStep.kind === 'elim' ? new Set(curStep.cells) : null;
    const placed = new Set(), guessCells = new Set(), deduced = new Set();
    for (let k = 0; k < cur; k++) {
        const st = steps[k];
        if (st.kind !== 'place')
            continue;
        for (const mv of st.moves)
            (mv.tech === 'guess' ? guessCells : deduced).add(mv.i);
    }
    for (const mv of curStep && curStep.kind === 'place' ? curStep.moves : [])
        placed.add(mv.i);
    const unitCells = new Set();
    if (meta)
        for (const u of meta.units)
            for (const i of Sudoku.UNITS[u])
                unitCells.add(i);
    const selV = given[sel] || s.val[sel];
    const [sr, sc] = Sudoku.RC(sel);
    const hit = new Set();
    for (let k = 0; k < 9; k++) {
        hit.add(sr * 9 + k);
        hit.add(k * 9 + sc);
    }
    const br = Math.floor(sr / 3) * 3, bc = Math.floor(sc / 3) * 3;
    for (let k = 0; k < 9; k++)
        hit.add((br + ((k / 3) | 0)) * 9 + bc + k % 3);
    for (let i = 0; i < 81; i++) {
        const [r, c] = Sudoku.RC(i), { el, v, cands, badge } = cellEls[i];
        let cls = 'cell';
        if (c === 2 || c === 5)
            cls += ' bR';
        if (r === 2 || r === 5)
            cls += ' bB';
        if (given[i])
            cls += ' given';
        else if (s.val[i])
            cls += guessCells.has(i) ? ' guess' : deduced.has(i) ? ' stepped' : '';
        if (hit.has(i) && !given[i] && !s.val[i])
            cls += ' peer';
        if (unitCells.has(i) && !given[i] && !s.val[i])
            cls += ' hl-unit';
        if (elimSet && elimSet.has(i))
            cls += ' elim';
        if (meta && meta.focus.has(i))
            cls += ' hl-focus';
        if (selV && s.val[i] === selV)
            cls += ' same';
        if (i === sel)
            cls += ' sel';
        if (placed.has(i))
            cls += ' cur';
        el.className = cls;
        const mk = meta && meta.marks[i];
        if ((showCands || mk) && !s.val[i]) {
            let cm = s.cand[i];
            if (mk && mk.strike)
                for (const d of mk.strike)
                    cm |= 1 << (d - 1); // 被划掉的候选已从盘面移除，回显出来才能看到删除线
            const cd = bitsOf(cm);
            v.textContent = '';
            cands.innerHTML = cd.map(x => {
                let cl = '';
                if (mk && mk.pick === x)
                    cl = 'pick';
                else if (mk && mk.strike && mk.strike.includes(x))
                    cl = 'strike';
                else if (cd.length === 1)
                    cl = 'g';
                return `<i${cl ? ` class="${cl}"` : ''}>${x}</i>`;
            }).join('');
        }
        else {
            cands.innerHTML = '';
            v.textContent = String(s.val[i] || ''); // 迁移注：仅为通过 strict 类型检查，运行时输出不变
        }
        badge.textContent = elimSet && elimSet.has(i) ? '✕' : '';
    }
    renderReason();
    renderSteps();
}
const bitsOf = Sudoku.bits;
const TECHN = { naked: '唯一候选数', hidden: '行/列/宫唯一', locked: '区块摒除',
    nakedSub: '显性数组', hiddenSub: '隐性数组', xwing: 'X-Wing',
    guess: '试填（非唯一）', mixed: '混合' };
function techLabel(st) {
    if (st.kind === 'elim' || st.tech !== 'mixed')
        return TECHN[st.tech]; // mixed 只出现在填数步
    const c = {};
    for (const mv of st.moves)
        c[mv.tech] = (c[mv.tech] || 0) + 1;
    return Object.keys(c).map(t => `${TECHN[t]}×${c[t]}`).join('、');
}
function moveHead(mv, showIdx, k = 0) {
    const isG = mv.tech === 'guess';
    const idx = showIdx ? `<span class="idx">${k + 1}</span>` : '';
    const tag = showIdx ? `<span class="tech${isG ? ' guess' : ''}">${TECHN[mv.tech]}</span>` : '';
    return `<div class="mvh">${idx}${tag}<span class="pos">${Sudoku.nm(mv.i)}</span> → <span class="val${isG ? ' g' : ''}">${mv.v}</span></div>`;
}
const legend = () => '<div class="lgd"><span class="lg u"></span>涉及单元<span class="lg f"></span>推理格<span class="lg s"></span>排除候选</div>';
function renderReason() {
    const box = $('#reason'), idx = $('#rIdx');
    if (!steps.length) {
        box.innerHTML = '<div class="t">—</div>暂无步骤';
        idx.textContent = '';
        return;
    }
    if (cur === 0) {
        box.innerHTML = '<div class="t">—</div>已回到初始谜面，点「下一步」开始逐步推理。';
        idx.textContent = '';
        return;
    }
    const st = steps[cur - 1];
    idx.textContent = `第 ${cur} / ${steps.length} 步`;
    if (st.kind === 'place' && st.moves.length > 1) {
        box.innerHTML = `<div class="t"><span class="tech">本步 ${st.moves.length} 格</span>${techLabel(st)}</div>` +
            st.moves.map((mv, k) => `<div class="mv">${moveHead(mv, true, k)}<div class="mvr">${mv.reason.replace(/\n/g, '<br>')}</div></div>`).join('') +
            legend();
        return;
    }
    if (st.kind === 'place') {
        const mv = st.moves[0];
        box.innerHTML = `<div class="t">${moveHead(mv, false)}</div>${mv.reason.replace(/\n/g, '<br>')}` + legend();
        return;
    }
    const head = `<span class="tech">${TECHN[st.tech]}</span><span class="pos">${st.cells.map(Sudoku.nm).join('、')}</span> 排除 <span class="val g">{${bitsOf(st.mask).join(',')}}</span>`;
    box.innerHTML = `<div class="t">${head}</div>${st.reason.replace(/\n/g, '<br>')}` + legend();
}
function stepText(st) {
    if (st.kind === 'place') {
        const mv = st.moves;
        return mv.length === 1 ? `${Sudoku.nm(mv[0].i)} = ${mv[0].v}`
            : `${Sudoku.nm(mv[0].i)} = ${mv[0].v} 等 ${mv.length} 格`;
    }
    return `${Sudoku.nm(st.cells[0])}${st.cells.length > 1 ? ` 等${st.cells.length}格` : ''} 排除 {${bitsOf(st.mask).join(',')}}`;
}
function renderSteps() {
    const el = $('#steps');
    if (!steps.length) {
        el.innerHTML = '<div class="empty">先填入已知数字，点「求解」</div>';
        $('#sCnt').textContent = '';
        return;
    }
    const list = steps.map((s, i) => ({ s, i })).filter(({ s }) => showElims || s.kind === 'place');
    const placedN = steps.reduce((n, s) => n + (s.kind === 'place' ? s.moves.length : 0), 0);
    const elimN = steps.reduce((n, s) => n + (s.kind === 'elim' ? 1 : 0), 0);
    $('#sCnt').textContent = `${steps.length} 步（填数 ${placedN} / 排除 ${elimN}）`;
    el.innerHTML = '<ol>' + list.map(({ s, i }) => {
        const n = i + 1, on = n === cur, past = n < cur;
        const isG = s.kind === 'place' && s.moves.every(m => m.tech === 'guess');
        const k = s.kind === 'elim' ? 'e' : isG ? 'g' : s.tech === 'mixed' ? 'm' : '';
        return `<li class="${k} ${on ? 'on' : ''} ${past ? 'past' : ''}" data-n="${n}"><span class="n">${n}</span><span class="k">${techLabel(s)}</span><span class="x">${stepText(s)}</span></li>`;
    }).join('') + '</ol>';
    const on = el.querySelector('li.on');
    if (on)
        on.scrollIntoView({ block: 'nearest' });
    el.querySelectorAll('li').forEach((li) => li.onclick = () => { stop(); cur = +li.dataset.n; render(); });
}
function diag(html) { $('#diag').innerHTML = html; }
const row = (cls, t) => `<div class="s ${cls}"><span class="dot"></span><span>${t}</span></div>`;
function setState(t, cls) {
    const el = $('#tState');
    el.textContent = t;
    el.className = cls ? `tag ${cls}` : 'tag';
}
function doSolve() {
    stop();
    cur = 0;
    steps = [];
    res = Sudoku.solve(given);
    const clues = given.filter(Boolean).length;
    let h = row('info', `已知数字 <b>${clues}</b> 个，空格 <b>${81 - clues}</b> 个`);
    if (res.status === 'invalid') {
        setState('题目有误', 'err');
        diag(h + row('bad', '❌ ' + res.msg));
        render();
        return;
    }
    if (res.status === 'nosol') {
        setState('无解', 'err');
        diag(h + row('bad', '❌ ' + res.msg));
        render();
        return;
    }
    if (res.status === 'multi') {
        setState('多解', 'err');
        diag(h + row('bad', '❌ ' + res.msg.replace(/\n/g, '<br>'))
            + row('info', '需先补充已知数字使其唯一，才能给出确定步骤。'));
        render();
        return;
    }
    steps = res.steps || []; // 关键：把求解结果接到回放用的步骤表
    h += row('ok', '✅ 唯一解（已验证解的数量 = 1）');
    if (res.guesses)
        h += row('warn', `⚠ 含 <b>${res.guesses}</b> 步试填（逻辑推理已无法推进），这些步已标黄，不具备唯一性。`);
    else
        h += row('ok', '全程仅用唯一性逻辑推理，无需试填。');
    if (res.backtracks)
        h += row('info', `求解时发生 ${res.backtracks} 次试错回溯（未在步骤表中显示）。`);
    const t = res.stats || {};
    h += row('info', '技巧统计：' + (Object.keys(TECHN).filter(k => t[k]).map(k => `${TECHN[k]}×${t[k]}`).join('，') || '无'));
    if (!steps.length)
        h += row('warn', '题目已填满，无需推理。');
    diag(h);
    setState(`共 ${steps.length} 步${res.guesses ? '（含试填）' : ''}`, steps.length === 0 ? '' : res.guesses ? 'warn' : 'ok');
    render();
}
function goto(n) { cur = Math.max(0, Math.min(steps.length, n)); render(); }
function stop() { if (playing) {
    clearInterval(playing);
    playing = null;
    $('#bPlay').textContent = '▶ 自动';
} }
function play() {
    if (!steps.length)
        return;
    if (playing) {
        stop();
        return;
    }
    if (cur >= steps.length)
        cur = 0;
    const sp = 1100 - (+$('#spd').value) * 95;
    $('#bPlay').textContent = '⏸ 暂停';
    playing = setInterval(() => { if (cur >= steps.length) {
        stop();
        return;
    } goto(cur + 1); }, sp);
}
/* ---- 键盘 / 按钮 ---- */
function editGiven(i, v) {
    stop();
    given[i] = v;
    steps = [];
    cur = 0;
    res = null;
    setState('未解题');
    diag(row('info', '已修改谜面，点「求解」重新生成步骤。'));
}
const D = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
pad.innerHTML = D.map(d => `<button data-d="${d}">${d === '0' ? '清除' : d}</button>`).join('');
pad.querySelectorAll('button').forEach((b) => b.onclick = () => {
    editGiven(sel, +b.dataset.d);
    sel = (sel + 1) % 81;
    render();
});
$('#bSolve').onclick = doSolve;
$('#bFirst').onclick = () => { stop(); goto(0); };
$('#bPrev').onclick = () => { stop(); goto(cur - 1); };
$('#bNext').onclick = () => { stop(); goto(cur + 1); };
$('#bLast').onclick = () => { stop(); goto(steps.length); };
$('#bPlay').onclick = play;
$('#spd').oninput = () => { if (playing) {
    stop();
    if (cur < steps.length)
        play();
} }; // 播放中调速立即生效
$('#cCands').onchange = (e) => { showCands = e.target.checked; render(); };
$('#cElims').onchange = (e) => { showElims = e.target.checked; renderSteps(); };
$('#bClr').onclick = () => {
    stop();
    given = new Array(81).fill(0);
    steps = [];
    cur = 0;
    sel = 40;
    res = null;
    setState('未解题');
    diag(row('info', '空白盘面，点数字键填入已知数字。'));
    render();
};
/* 解析粘贴的谜面，支持：
   1) 81 字符，0 / . / - 表示空
   2) . 分隔的 81 个单字符格
   3) 9 行 × 9 格（行内可再用 . 分隔）
   4) 以上任意一种带 "0." 行号前缀（如 0.530070…）
   返回长度 81 的数字数组；无法解析返回 null。 */
function parseOne(raw) {
    const cells = (s) => s.split('').map(ch => (ch >= '1' && ch <= '9') ? +ch : 0);
    if (raw.length === 81)
        return cells(raw);
    const tokens = raw.split('.').filter(Boolean);
    if (tokens.length === 81 && tokens.every(t => t.length === 1))
        return tokens.map(t => +t);
    if (tokens.length === 9 && tokens.every(t => t.length === 9))
        return cells(tokens.join(''));
    const digits = raw.replace(/\./g, '');
    if (digits.length === 81)
        return cells(digits);
    return null;
}
function parsePuzzle(text) {
    let raw = String(text == null ? '' : text).replace(/[^0-9.\-]/g, '').replace(/-/g, '.');
    for (let depth = 0; depth < 3; depth++) {
        const g = parseOne(raw);
        if (g)
            return g;
        if (!/^\d+\./.test(raw))
            break;
        raw = raw.replace(/^\d+\./, '');
    }
    return null;
}
$('#bPaste').onclick = () => {
    const g = parsePuzzle($('#paste').value);
    if (!g) {
        alert('无法解析谜面：需要 81 个字符（0 / . / - 表示空），或用 . 分隔的 81 格，或 9 行×9 格（可带 0. 行号前缀）。');
        return;
    }
    given = g;
    steps = [];
    cur = 0;
    doSolve();
};
document.querySelectorAll('[data-gen]').forEach(b => b.onclick = () => {
    stop();
    given = Sudoku.generatePuzzle(+b.dataset.gen);
    steps = [];
    cur = 0;
    doSolve();
});
addEventListener('keydown', (e) => {
    const tgt = e.target;
    if (tgt.tagName === 'INPUT') { // 输入框/滑杆交给控件自己处理
        if (tgt.type === 'text' && e.key === 'Enter')
            $('#bPaste').click();
        return;
    }
    const r = (sel / 9 | 0), c = sel % 9;
    if (e.key === 'ArrowUp') {
        sel = ((r + 8) % 9) * 9 + c;
        e.preventDefault();
    }
    else if (e.key === 'ArrowDown') {
        sel = ((r + 1) % 9) * 9 + c;
        e.preventDefault();
    }
    else if (e.key === 'ArrowLeft') {
        sel = r * 9 + (c + 8) % 9;
        e.preventDefault();
    }
    else if (e.key === 'ArrowRight') {
        sel = r * 9 + (c + 1) % 9;
        e.preventDefault();
    }
    else if (e.key >= '1' && e.key <= '9')
        editGiven(sel, +e.key);
    else if (e.key === '0' || e.key === 'Delete')
        editGiven(sel, 0);
    else if (e.key === 'Enter') {
        stop();
        goto(cur + 1);
        e.preventDefault();
    }
    else if (e.key === ' ') {
        play();
        e.preventDefault();
    }
    else if (e.key === 'Backspace') {
        stop();
        goto(cur - 1);
        e.preventDefault();
    }
    else
        return;
    render();
});
render();
diag('<div class="s info"><span class="dot"></span><span>点「随机题」载入，或在格中输入已知数字后点「求解」。</span></div>');
