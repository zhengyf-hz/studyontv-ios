'use strict';

/* ============================================================
   题了个题 · iPad / iOS 版（离线 PWA）
   设计前提：iOS 不允许第三方 App 拦截其他 App，
   因此本版采用「App 内闭环」：答题赚时长 → 在 App 内观看 → 时间到再答一轮。
   ============================================================ */

const LS_KEY = 'studyontv.ios.v1';
const IDB_NAME = 'studyontv-ios';
const IDB_STORE = 'blobs';

/* ---------- 示例题库 ---------- */
const DEFAULT_BANK = [
  { id: 'q01', star: 1, type: 'judge', stem: '0 是自然数。', options: ['对', '错'], answer: [0], explain: '自然数从 0 开始，0、1、2、3……都是自然数。' },
  { id: 'q02', star: 2, type: 'single', stem: '“不耻下问”中“耻”的意思是：', options: ['以……为耻', '羞耻的事', '耻辱', '看不起别人'], answer: [0], explain: '“不耻下问”指向地位比自己低的人请教也不觉得羞耻。' },
  { id: 'q03', star: 2, type: 'fill', stem: '7 × 8 = ______', answer: ['56'], explain: '七八五十六。' },
  { id: 'q04', star: 3, type: 'single', stem: 'He ______ to school every day.', options: ['go', 'goes', 'going', 'gone'], answer: [1], explain: '一般现在时，主语 He 是第三人称单数，动词加 -es。' },
  { id: 'q05', star: 3, type: 'multi', stem: '下列属于哺乳动物的有：', options: ['鲸', '蝙蝠', '企鹅', '鲨鱼'], answer: [0, 1], explain: '鲸和蝙蝠都是胎生、哺乳的哺乳动物；企鹅是鸟类，鲨鱼是鱼类。' },
  { id: 'q06', star: 4, type: 'fill', stem: '“会当凌绝顶，______。”请补全下一句。', answer: ['一览众山小'], explain: '出自杜甫《望岳》，下一句是“一览众山小”。' },
  { id: 'q07', star: 4, type: 'subj', stem: '小明有 12 支铅笔，分给 3 个同学后还剩 3 支，平均每人分到几支？请写出算式和答案。', answer: ['（12－3）÷3＝3，平均每人分到 3 支'], explain: '先算分出去的支数：12－3＝9；再平均分给 3 人：9÷3＝3。' },
  { id: 'q08', star: 5, type: 'single', stem: '太阳系中体积最大的行星是：', options: ['木星', '土星', '地球', '海王星'], answer: [0], explain: '木星是太阳系体积和质量都最大的行星。' },
  { id: 'q09', star: 1, type: 'judge', stem: '“apple”的复数形式是“apples”。', options: ['对', '错'], answer: [0], explain: '一般名词直接加 -s。' },
  { id: 'q10', star: 5, type: 'multi', stem: '下列属于中国古代四大发明的有：', options: ['造纸术', '指南针', '火药', '地动仪'], answer: [0, 1, 2], explain: '四大发明是造纸术、印刷术、指南针、火药；地动仪是张衡发明的测震仪器。' },
  { id: 'q11', star: 3, type: 'single', stem: '一个正方形的边长扩大到原来的 2 倍，面积扩大到原来的几倍？', options: ['2 倍', '4 倍', '6 倍', '8 倍'], answer: [1], explain: '面积 = 边长 × 边长，边长乘 2，面积乘 2 × 2 = 4。' },
  { id: 'q12', star: 2, type: 'judge', stem: '洗完手随手关紧水龙头，可以节约用水。', options: ['对', '错'], answer: [0], explain: '随手关水是最容易做到的节水习惯。' }
];

/* ---------- 工具 ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function uid() { return 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function normText(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, '').replace(/[，。！？、；：“”‘’（）()]/g, '');
}
function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function minutesText(sec) { return (Math.round(sec / 60 * 10) / 10).toString().replace(/\.0$/, ''); }

/* ---------- 状态 ---------- */
function defaultState() {
  return {
    pin: '',
    settings: {
      dailyLimitMin: 60,
      taskSize: 5,
      passRate: 0.8,
      extraWrong: 3,
      starReward: { 1: 2, 2: 4, 3: 6, 4: 8, 5: 10 },
      windowOn: false,
      windowStart: '17:00',
      windowEnd: '21:00',
      theme: 'auto',
      videoUrl: '',
      videoName: ''
    },
    bank: DEFAULT_BANK.slice(),
    progress: { date: todayKey(), usedSec: 0, history: [] },
    session: null
  };
}

function load() {
  let raw = null;
  try { raw = localStorage.getItem(LS_KEY); } catch (e) { raw = null; }
  const base = defaultState();
  if (!raw) return base;
  let saved;
  try { saved = JSON.parse(raw); } catch (e) { return base; }
  if (!saved || typeof saved !== 'object') return base;
  const out = Object.assign(base, saved);
  out.settings = Object.assign(base.settings, saved.settings || {});
  out.settings.starReward = Object.assign(base.settings.starReward, (saved.settings || {}).starReward || {});
  out.progress = Object.assign(base.progress, saved.progress || {});
  out.bank = Array.isArray(saved.bank) && saved.bank.length ? saved.bank : base.bank;
  if (!out.progress.date) out.progress.date = todayKey();
  return out;
}

const S = load();
let ui = { name: 'home', msg: '' };

function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) { console.warn('保存失败', e); }
}

function rollDay() {
  const t = todayKey();
  if (S.progress.date !== t) {
    S.progress.date = t;
    S.progress.usedSec = 0;
    S.session = null;
    save();
  }
}
rollDay();

/* ---------- IndexedDB：本地视频 ---------- */
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbPut(key, val) {
  return idb().then(db => new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(val, key);
    tx.oncomplete = () => res(true);
    tx.onerror = () => rej(tx.error);
  }));
}
function idbGet(key) {
  return idb().then(db => new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const r = tx.objectStore(IDB_STORE).get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
function idbDel(key) {
  return idb().then(db => new Promise((res) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => res(true);
  }));
}

/* ---------- 主题 ---------- */
function applyTheme() {
  const t = S.settings.theme || 'auto';
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.body.classList.toggle('theme-dark', dark);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#12141a' : '#f4f5f7');
}
applyTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

/* ---------- 时段 ---------- */
function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function inWindow() {
  const st = S.settings;
  if (!st.windowOn) return true;
  const n = nowHHMM();
  if (st.windowStart <= st.windowEnd) return n >= st.windowStart && n < st.windowEnd;
  return n >= st.windowStart || n < st.windowEnd;
}

/* ---------- 题库操作 ---------- */
function getQ(id) { return S.bank.find(q => q.id === id) || null; }
function starOf(q) { return clamp(parseInt(q.star, 10) || 1, 1, 5); }
function rewardMinOf(q) { return Number(S.settings.starReward[starOf(q)] || 0); }

/* ---------- 会话：出题 ---------- */
function ensureSession() {
  if (S.session && S.session.status) return S.session;
  return null;
}

function startSession() {
  const st = S.settings;
  const size = clamp(parseInt(st.taskSize, 10) || 5, 1, 30);
  const bank = S.bank.slice();
  if (!bank.length) return false;

  const used = [];
  const push = (v) => {
    const id = typeof v === 'string' ? v : (v && v.id);
    if (!id || !getQ(id) || used.includes(id)) return;
    used.push(id);
  };

  // 1) 加练池优先（跨天保留）
  const pool = (S.progress.extraPool || []).slice();
  pool.forEach(id => { if (getQ(id)) push(id); });

  // 2) 补足常规题数：优先没做过的，其次随机
  const seen = S.progress.seen || {};
  const unseen = bank.filter(q => !seen[q.id] && !used.includes(q.id));
  const rest = bank.filter(q => seen[q.id] && !used.includes(q.id));
  const pick = (arr, n) => {
    const a = arr.slice().sort(() => Math.random() - 0.5);
    return a.slice(0, n);
  };
  pick(unseen, size - used.length).forEach(q => push(q.id));
  if (used.length < size) pick(rest, size - used.length).forEach(q => push(q.id));

  S.session = {
    status: 'quiz',
    queue: used,
    idx: 0,
    correct: 0,
    wrong: 0,
    earnedSec: 0,
    wrongInTask: 0,
    extraAdded: 0,
    awardedSec: 0,
    remainSec: 0,
    startedAt: Date.now()
  };
  save();
  return true;
}

function currentQuestion() {
  const s = S.session;
  if (!s) return null;
  return getQ(s.queue[s.idx]);
}

/* ---------- 观看计时 ---------- */
let watchTimer = null;
function stopWatchTimer() {
  if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
}

function startWatchTimer() {
  stopWatchTimer();
  const s = S.session;
  if (!s) return;
  const video = $('#watchVideo');
  let last = Date.now();
  let tickCount = 0;

  const tick = () => {
    const now = Date.now();
    const dt = Math.min(2, (now - last) / 1000);   // 单次最多记 2 秒，防止切后台跳表
    last = now;
    if (document.visibilityState !== 'visible') return;
    s.remainSec = Math.max(0, s.remainSec - dt);
    S.progress.usedSec += dt;
    tickCount++;
    if (tickCount % 5 === 0) save();
    const tEl = $('#timerBig');
    if (tEl) tEl.textContent = fmtClock(s.remainSec);
    const bar = $('#watchBar');
    if (bar) {
      const total = Math.max(1, s.awardedSec);
      bar.style.width = `${clamp((1 - s.remainSec / total) * 100, 0, 100)}%`;
    }
    updateChip();
    if (s.remainSec <= 0.5) {
      stopWatchTimer();
      finishWatch();
    }
  };
  watchTimer = setInterval(tick, 500);
  document.addEventListener('visibilitychange', onVisibility);
  if (video) { video.currentTime = 0; video.play().catch(() => {}); }
}

function onVisibility() {
  if (document.visibilityState !== 'visible' && S.session && S.session.status === 'watch') {
    const v = $('#watchVideo');
    if (v) v.pause();
  }
}

function finishWatch() {
  const v = $('#watchVideo');
  if (v) v.pause();
  const s = S.session;
  if (s) {
    const watchedMin = Math.max(0, (s.awardedSec - s.remainSec) / 60);
    S.progress.history.push({
      date: S.progress.date,
      ts: Date.now(),
      kind: 'watch',
      minutes: Math.round(watchedMin * 10) / 10,
      awarded: Math.round(s.awardedSec / 60 * 10) / 10
    });
    ui.endedEarly = s.remainSec > 1;
    S.session = null;
  }
  save();
  ui.name = 'watchEnd';
  render();
}

/* ---------- 渲染 ---------- */
function updateChip() {
  const chip = $('#statChip');
  if (!chip) return;
  const lim = Number(S.settings.dailyLimitMin || 0);
  chip.textContent = `今日 ${minutesText(S.progress.usedSec)} / ${lim} 分钟`;
}

function render() {
  rollDay();
  applyTheme();
  updateChip();
  stopWatchTimer();
  const view = $('#view');
  if (!view) return;

  if (!S.pin) return renderPinSetup(view);

  switch (ui.name) {
    case 'parent': return renderParent(view);
    case 'watchEnd': return renderWatchEnd(view);
    case 'done': return renderDone(view);
    case 'outside': return renderOutside(view);
    default: return renderHome(view);
  }
}

/* --- 首次设置 PIN --- */
let pinBuffer = '';
let pinMode = 'setup';   // setup | verify | change
function renderPinSetup(view) {
  pinBuffer = '';
  view.innerHTML = `
    <div class="card center">
      <div class="hero">
        <div class="big">🔒</div>
        <h2>先设置管理密码</h2>
        <p>家长用这个密码进入家长面板。设置后孩子需要答对题才能获得观看时长。</p>
      </div>
      <div class="pin-dots" id="pinDots">${'<div class="pin-dot"></div>'.repeat(4)}</div>
      <div class="muted" id="pinTip">请输入 4 位数字</div>
      <div class="keypad" style="margin-top:16px">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button class="key" data-k="${n}">${n}</button>`).join('')}
        <button class="key" data-k="del">⌫</button>
        <button class="key" data-k="0">0</button>
        <button class="key" data-k="ok">✓</button>
      </div>
    </div>`;
  bindKeypad(() => {
    S.pin = pinBuffer;
    save();
    ui.name = 'home';
    toast('密码已设置');
    render();
  });
}

function bindKeypad(onOk) {
  $('#pinDots') && $$('#pinDots .pin-dot');
  const paint = () => {
    $$('#pinDots .pin-dot').forEach((d, i) => d.classList.toggle('on', i < pinBuffer.length));
  };
  paint();
  $$('.keypad .key').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.k;
      if (k === 'del') { pinBuffer = pinBuffer.slice(0, -1); paint(); return; }
      if (k === 'ok') { if (pinBuffer.length === 4) onOk(); else toast('请输入 4 位数字'); return; }
      if (pinBuffer.length >= 4) return;
      pinBuffer += k; paint();
      if (pinBuffer.length === 4) setTimeout(() => onOk(), 160);
    });
  });
}

/* --- 主屏 --- */
function renderHome(view) {
  if (!inWindow()) {
    return renderOutside(view);
  }
  const limSec = Number(S.settings.dailyLimitMin || 0) * 60;
  if (S.progress.usedSec >= limSec - 1) {
    ui.name = 'done';
    return renderDone(view);
  }

  const s = ensureSession();
  if (s && s.status === 'watch') return renderWatch(view);
  if (s && s.status === 'quiz') return renderQuiz(view);

  if (!S.bank.length) {
    view.innerHTML = `
      <div class="card hero">
        <div class="big">📭</div>
        <h2>题库是空的</h2>
        <p>先进入家长面板添加题目，或恢复示例题库。</p>
      </div>
      <button class="btn block ghost" id="toParent">进入家长面板</button>`;
    $('#toParent').addEventListener('click', requestPin);
    return;
  }

  const need = clamp(parseInt(S.settings.taskSize, 10) || 5, 1, 30);
  const pool = (S.progress.extraPool || []).length;
  const remain = limSec - S.progress.usedSec;
  view.innerHTML = `
    <div class="card">
      <div class="hero">
        <div class="big">📚</div>
        <h2>先学再看</h2>
        <p>本次 ${need + pool} 道题，正确率要达到 ${Math.round(Number(S.settings.passRate) * 100)}%，答对才按星级发时长。</p>
      </div>
      <div class="row" style="justify-content:center;margin-top:14px">
        <button class="btn" id="startQuiz">开始答题</button>
      </div>
      <div class="muted center" style="margin-top:14px">
        今日剩余可用 ${minutesText(remain)} 分钟，每日上限 ${S.settings.dailyLimitMin} 分钟
      </div>
    </div>
    <div class="card tight">
      <div class="muted">星级奖励：1★ ${S.settings.starReward[1]}分 · 2★ ${S.settings.starReward[2]}分 · 3★ ${S.settings.starReward[3]}分 · 4★ ${S.settings.starReward[4]}分 · 5★ ${S.settings.starReward[5]}分</div>
      <div class="row row-right" style="margin-top:10px">
        <button class="btn sm ghost" id="toParent">家长面板</button>
      </div>
    </div>`;
  $('#startQuiz').addEventListener('click', () => {
    if (!startSession()) return toast('题库为空');
    render();
  });
  $('#toParent').addEventListener('click', requestPin);
}

function renderOutside(view) {
  ui.name = 'outside';
  view.innerHTML = `
    <div class="card hero">
      <div class="big">⏰</div>
      <h2>现在不是可用时段</h2>
      <p>可用时段：${esc(S.settings.windowStart)} – ${esc(S.settings.windowEnd)}</p>
      <button class="btn ghost sm" id="toParent" style="margin-top:10px">家长面板</button>
    </div>`;
  $('#toParent') && $('#toParent').addEventListener('click', requestPin);
}

function renderDone(view) {
  ui.name = 'done';
  view.innerHTML = `
    <div class="card hero">
      <div class="big">🌙</div>
      <h2>今天的时长用完啦</h2>
      <p>已经用满 ${S.settings.dailyLimitMin} 分钟，明天再来。</p>
      <div class="row" style="margin-top:12px">
        <button class="btn ghost sm" id="toParent">家长面板</button>
      </div>
    </div>`;
  $('#toParent').addEventListener('click', requestPin);
}

/* --- 答题 --- */
function renderQuiz(view) {
  const s = S.session;
  const q = currentQuestion();
  if (!q) { S.session = null; save(); return renderHome(view); }
  const st = S.settings;
  const dots = s.queue.map((id, i) => {
    if (i < s.idx) {
      return `<span class="dot ${(s.results || [])[i] ? 'done-ok' : 'done-bad'}"></span>`;
    }
    if (i === s.idx) return '<span class="dot now"></span>';
    return '<span class="dot"></span>';
  }).join('');

  const typeLabel = { single: '单选题', multi: '多选题', judge: '判断题', fill: '填空题', subj: '主观题' }[q.type] || '单选题';
  const stars = '★'.repeat(starOf(q));

  let body = '';
  if (q.type === 'fill') {
    body = `<div class="fill-wrap"><input id="fillInput" type="text" inputmode="text" autocomplete="off" placeholder="在这里输入答案"></div>`;
  } else if (q.type === 'subj') {
    body = `
      <div class="fill-wrap">
        <textarea id="subjInput" class="answer-box" placeholder="写出你的思路和答案（家长可在记录中查看）"></textarea>
      </div>`;
  } else {
    body = `<div class="opts" id="opts">${(q.options || []).map((o, i) => `
      <button class="opt" data-i="${i}" type="button">
        <span class="key">${'ABCDEFGH'[i] || i + 1}</span>
        <span class="txt">${esc(o)}</span>
      </button>`).join('')}</div>`;
  }

  view.innerHTML = `
    <div class="card">
      <div class="quiz-head">
        <span class="muted">第 ${s.idx + 1} / ${s.queue.length} 题 · ${typeLabel} · ${stars}</span>
        <div class="dots">${dots}</div>
      </div>
      <div class="stem"><span class="tag">${stars}</span>${esc(q.stem)}</div>
      ${body}
      <div id="fb"></div>
      <div class="quiz-foot"><button class="btn" id="submitBtn">提交</button></div>
    </div>
    <div class="card tight">
      <div class="muted">已答对 ${s.correct} 题 · 已赚 ${rewardMinutesFromSession(s)} 分钟 · 正确率需达 ${Math.round(Number(st.passRate) * 100)}% 才发放</div>
    </div>`;

  let selected = new Set();
  let submitted = false;

  if (q.type !== 'fill' && q.type !== 'subj') {
    $$('#opts .opt').forEach(btn => {
      btn.addEventListener('click', () => {
        if (submitted) return;
        const i = Number(btn.dataset.i);
        if (q.type === 'multi') {
          if (selected.has(i)) { selected.delete(i); btn.classList.remove('sel'); }
          else { selected.add(i); btn.classList.add('sel'); }
        } else {
          selected = new Set([i]);
          $$('#opts .opt').forEach(b => b.classList.toggle('sel', Number(b.dataset.i) === i));
        }
      });
    });
  }

  const submit = () => {
    if (submitted) return;
    let ok = false;
    let userAnswerText = '';

    if (q.type === 'fill') {
      const v = ($('#fillInput') || {}).value || '';
      if (!v.trim()) return toast('先写答案再提交');
      userAnswerText = v;
      ok = (q.answer || []).some(a => normText(a) === normText(v));
    } else if (q.type === 'subj') {
      const v = ($('#subjInput') || {}).value || '';
      if (!v.trim()) return toast('先写下你的答案');
      userAnswerText = v;
      // 主观题：自评
      ok = null;
    } else {
      if (!selected.size) return toast('先选一个答案');
      userAnswerText = Array.from(selected).map(i => 'ABCDEFGH'[i]).join('');
      const ans = (q.answer || []).slice().sort((a, b) => a - b);
      const mine = Array.from(selected).sort((a, b) => a - b);
      ok = ans.length === mine.length && ans.every((v, i) => v === mine[i]);
    }

    submitted = true;
    const submitBtn = $('#submitBtn');
    if (submitBtn) submitBtn.style.display = 'none';
    if (q.type !== 'fill' && q.type !== 'subj') {
      $$('#opts .opt').forEach(b => {
        b.disabled = true;
        const i = Number(b.dataset.i);
        if ((q.answer || []).includes(i)) b.classList.add('correct');
        else if (selected.has(i)) b.classList.add('wrong');
      });
    }

    if (ok === null) {
      renderSubjFeedback(q, userAnswerText);
      return;
    }
    commitAnswer(ok, userAnswerText);
    showFeedback(q, ok, userAnswerText);
  };
  $('#submitBtn').addEventListener('click', submit);
  const fillInput = $('#fillInput');
  if (fillInput) fillInput.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

function renderSubjFeedback(q, userAnswerText) {
  const fb = $('#fb');
  const ref = (q.answer || []).join(' / ');
  fb.innerHTML = `
    <div class="feedback">
      <div class="verdict">对照参考答案，自己批改一下</div>
      <div class="answer-line"><strong>参考答案：</strong>${esc(ref)}</div>
      <div class="explain">${esc(q.explain || '')}</div>
      <div class="row" style="margin-top:12px">
        <button class="btn sm ok" id="selfOk">我答对了</button>
        <button class="btn sm danger" id="selfBad">没答对</button>
      </div>
    </div>`;
  $('#selfOk').addEventListener('click', () => { commitAnswer(true, userAnswerText, ref); showFeedback(q, true, userAnswerText, true); });
  $('#selfBad').addEventListener('click', () => { commitAnswer(false, userAnswerText, ref); showFeedback(q, false, userAnswerText, true); });
}

function rewardMinutesFromSession(s) {
  const total = s.earnedSec / 60;
  return Math.round(total * 10) / 10;
}

function commitAnswer(ok, userText, refAnswer) {
  const s = S.session;
  if (!s) return;
  s.results = s.results || [];
  s.results[s.idx] = !!ok;
  const q = currentQuestion();

  S.progress.seen = S.progress.seen || {};
  const rec = S.progress.seen[q.id] || { right: 0, wrong: 0 };
  if (ok) {
    rec.right++;
    s.correct++;
    s.earnedSec += rewardMinOf(q) * 60;
    const pool = S.progress.extraPool || [];
    const at = pool.indexOf(q.id);
    if (at >= 0) pool.splice(at, 1);   // 答对加练题，出池
  } else {
    rec.wrong++;
    s.wrong++;
    s.wrongInTask++;
    S.progress.extraPool = S.progress.extraPool || [];
    if (!S.progress.extraPool.includes(q.id)) S.progress.extraPool.push(q.id);
    // 错题达到阈值 → 现场加练一道
    const th = clamp(parseInt(S.settings.extraWrong, 10) || 3, 1, 10);
    if (s.wrongInTask >= th) {
      s.wrongInTask = 0;
      s.extraAdded++;
      const cand = S.bank.filter(x => x.id !== q.id && !s.queue.includes(x.id));
      if (cand.length) {
        const add = cand[Math.floor(Math.random() * cand.length)];
        s.queue.push(add.id);
        if (!S.progress.extraPool.includes(add.id)) S.progress.extraPool.push(add.id);
      }
    }
  }
  S.progress.seen[q.id] = rec;
  if (!S.progress.history) S.progress.history = [];
  S.progress.history.push({
    date: S.progress.date, ts: Date.now(), kind: 'answer',
    qid: q.id, right: !!ok, star: starOf(q),
    userText: String(userText || '').slice(0, 300),
    refAnswer: Array.isArray(refAnswer) ? refAnswer.join(' / ') : (refAnswer || '')
  });
  if (S.progress.history.length > 400) S.progress.history = S.progress.history.slice(-400);
  save();
}

function showFeedback(q, ok, userText, isSubj) {
  const fb = $('#fb');
  const ansText = (q.answer || []).map((a, i) => {
    if (q.type === 'fill') return a;
    if (q.type === 'subj') return a;
    return ('ABCDEFGH'[a] ? 'ABCDEFGH'[a] + '. ' : '') + (q.options && q.options[a] != null ? q.options[a] : '');
  }).join(' / ');
  const isLast = S.session.idx + 1 >= S.session.queue.length;

  fb.innerHTML = `
    <div class="feedback ${ok ? 'ok' : 'bad'}">
      <div class="verdict">${ok ? '✅ 答对了' : '❌ 答错了'}</div>
      <div class="answer-line"><strong>正确答案：</strong>${esc(ansText || '—')}</div>
      ${isSubj ? `<div class="answer-line"><strong>你的答案：</strong>${esc(userText)}</div>` : ''}
      <div class="explain">${esc(q.explain || '')}</div>
    </div>
    <div class="quiz-foot"><button class="btn ${ok ? 'ok' : ''}" id="nextBtn">${isLast ? '完成本轮' : '继续下一题'}</button></div>`;

  $('#nextBtn').addEventListener('click', () => {
    const s = S.session;
    if (!s) return;
    s.idx++;
    if (s.idx >= s.queue.length) { settleTask(); }
    else { save(); render(); }
  });
}

function settleTask() {
  const s = S.session;
  const st = S.settings;
  const total = s.queue.length;
  const rate = total ? s.correct / total : 0;
  const pass = rate >= Number(st.passRate);
  const earned = s.earnedSec;
  const limSec = Number(st.dailyLimitMin || 0) * 60;
  const left = Math.max(0, limSec - S.progress.usedSec);

  if (!pass) {
    S.session = null;
    S.progress.history.push({
      date: S.progress.date, ts: Date.now(), kind: 'fail',
      total: total, correct: s.correct, rate: Math.round(rate * 100) / 100
    });
    save();
    ui.name = 'home';
    render();
    toast(`正确率 ${Math.round(rate * 100)}%，需达到 ${Math.round(Number(st.passRate) * 100)}%，再答一轮`);
    return;
  }

  const awarded = Math.min(earned, left);
  s.status = 'watch';
  s.awardedSec = awarded;
  s.remainSec = awarded;
  s.results = s.results || [];
  save();
  render();
  if (awarded <= 0) toast('今日时长已用完，奖励无法发放');
}

/* --- 观看页 --- */
function renderWatch(view) {
  const s = S.session;
  if (!s) return renderHome(view);
  const st = S.settings;
  view.innerHTML = `
    <div class="card">
      <div class="watch-stage" id="stage">
        <div class="watch-empty" id="stageEmpty">正在准备视频…</div>
      </div>
      <div class="timer-big" id="timerBig">${fmtClock(s.remainSec)}</div>
      <div class="timer-sub">本次可观看 ${minutesText(s.awardedSec)} 分钟 · 时间到会自动结束</div>
      <div class="bar" style="margin-top:12px"><i id="watchBar" style="width:0%"></i></div>
      <div class="row" style="justify-content:center;margin-top:16px">
        <button class="btn ghost sm" id="pauseBtn">暂停</button>
        <button class="btn ghost sm" id="endBtn">结束观看</button>
      </div>
    </div>
    <div class="muted center">离开这个页面或切到别的 App，计时会暂停——这里的时间只算真正在看的时间。</div>`;

  loadVideo();

  let paused = false;
  $('#pauseBtn').addEventListener('click', (e) => {
    const v = $('#watchVideo');
    paused = !paused;
    e.currentTarget.textContent = paused ? '继续' : '暂停';
    if (v) { if (paused) v.pause(); else v.play().catch(() => {}); }
    if (paused) stopWatchTimer(); else startWatchTimer();
  });
  $('#endBtn').addEventListener('click', () => {
    const v = $('#watchVideo');
    if (v) v.pause();
    finishWatch();
  });

  startWatchTimer();
}

function loadVideo() {
  const st = S.settings;
  const stage = $('#stage');
  if (!stage) return;
  const use = (src) => {
    stage.innerHTML = `<video id="watchVideo" playsinline controls preload="auto" src="${src}"></video>`;
    const v = $('#watchVideo');
    v.addEventListener('error', () => {
      stage.innerHTML = `<div class="watch-empty">视频加载失败，计时仍在继续。<br>请家长面板里更换视频源。</div>`;
    });
  };
  if (st.videoName) {
    idbGet('video').then(blob => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        use(url);
      } else if (st.videoUrl) use(esc(st.videoUrl));
      else stage.innerHTML = `<div class="watch-empty">没有找到本地视频，计时照常进行。</div>`;
    }).catch(() => {
      if (st.videoUrl) use(esc(st.videoUrl));
      else stage.innerHTML = `<div class="watch-empty">无法读取本地视频，计时照常进行。</div>`;
    });
    return;
  }
  if (st.videoUrl) { use(esc(st.videoUrl)); return; }
  stage.innerHTML = `<div class="watch-empty">还没设置视频。<br>家长可在面板里填一个视频链接，或选择本机的视频文件。<br><br>这段时间仍在计时。</div>`;
}

function renderWatchEnd(view) {
  const limSec = Number(S.settings.dailyLimitMin || 0) * 60;
  const left = limSec - S.progress.usedSec;
  const early = !!ui.endedEarly;
  view.innerHTML = `
    <div class="card hero">
      <div class="big">${early ? '👌' : '⏳'}</div>
      <h2>${early ? '这次先看到这儿' : '这一轮的时间用完了'}</h2>
      <p>想继续看，就要再答一轮题。今日还剩 ${liberalLeft(left)}。</p>
      <div class="row" style="margin-top:12px;justify-content:center">
        <button class="btn" id="again">再答一轮</button>
        <button class="btn ghost" id="toParent">家长面板</button>
      </div>
    </div>`;
  $('#again').addEventListener('click', () => {
    ui.name = 'home';
    if (left <= 1) { renderDone($('#view')); return; }
    renderHome($('#view'));
  });
  $('#toParent').addEventListener('click', requestPin);
}
function liberalLeft(sec) {
  if (sec <= 1) return '0 分钟';
  return minutesText(sec) + ' 分钟';
}

/* --- 家长验证 --- */
function requestPin() {
  pinBuffer = '';
  pinMode = 'verify';
  const view = $('#view');
  view.innerHTML = `
    <div class="card center">
      <div class="hero">
        <div class="big">🔑</div>
        <h2>家长验证</h2>
        <p>输入 4 位管理密码进入家长面板。</p>
      </div>
      <div class="pin-dots" id="pinDots">${'<div class="pin-dot"></div>'.repeat(4)}</div>
      <div class="keypad" style="margin-top:16px">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button class="key" data-k="${n}">${n}</button>`).join('')}
        <button class="key" data-k="del">⌫</button>
        <button class="key" data-k="0">0</button>
        <button class="key" data-k="ok">✓</button>
      </div>
      <div class="row" style="justify-content:center;margin-top:14px">
        <button class="btn ghost sm" id="cancelPin">返回</button>
      </div>
    </div>`;
  $('#cancelPin').addEventListener('click', () => { ui.name = 'home'; render(); });
  bindKeypad(() => {
    if (pinBuffer === S.pin) {
      ui.name = 'parent';
      ui.tab = 'rules';
      toast('欢迎回来');
      render();
    } else {
      pinBuffer = '';
      $$('#pinDots .pin-dot').forEach(d => d.classList.remove('on'));
      toast('密码不对，再试一次');
    }
  });
}

/* --- 家长面板 --- */
function renderParent(view) {
  const tab = ui.tab || 'rules';
  const tabs = [
    ['rules', '规则'],
    ['bank', '题库'],
    ['video', '视频'],
    ['log', '记录'],
    ['more', '其他']
  ];
  view.innerHTML = `
    <div class="card tight">
      <div class="row" style="justify-content:space-between;align-items:center">
        <h3 style="margin:0">家长面板</h3>
        <div class="row">
          ${tabs.map(([k, n]) => `<button class="btn sm ${k === tab ? '' : 'ghost'}" data-tab="${k}">${n}</button>`).join('')}
        </div>
      </div>
    </div>
    <div id="panelBody"></div>
    <div class="card tight">
      <div class="row" style="justify-content:space-between;align-items:center">
        <span class="muted">今日已用 ${minutesText(S.progress.usedSec)} 分钟 · 上限 ${S.settings.dailyLimitMin} 分钟</span>
        <button class="btn sm ghost" id="backHome">回到孩子端</button>
      </div>
    </div>`;
  $$('[data-tab]').forEach(b => b.addEventListener('click', () => { ui.tab = b.dataset.tab; render(); }));
  $('#backHome').addEventListener('click', () => { ui.name = 'home'; render(); });

  const body = $('#panelBody');
  if (tab === 'rules') renderRules(body);
  else if (tab === 'bank') renderBank(body);
  else if (tab === 'video') renderVideo(body);
  else if (tab === 'log') renderLog(body);
  else renderMore(body);
}

function renderRules(body) {
  const st = S.settings;
  body.innerHTML = `
    <div class="card">
      <h2>规则</h2>
      <div class="form">
        <div class="field"><label>每日可用上限（分钟）</label><input type="number" id="fDaily" min="0" max="1440" value="${st.dailyLimitMin}"></div>
        <div class="field"><label>每轮题数</label><input type="number" id="fSize" min="1" max="30" value="${st.taskSize}"></div>
        <div class="field"><label>通过正确率（%）</label><input type="number" id="fRate" min="0" max="100" step="5" value="${Math.round(Number(st.passRate) * 100)}"></div>
        <div class="field"><label>答错几题加练 1 题</label><input type="number" id="fExtra" min="1" max="10" value="${st.extraWrong}"></div>
        <div class="form-block">
          <label>星级奖励时长（分钟，答对才发）</label>
          <div class="star-row">
            ${[1, 2, 3, 4, 5].map(n => `
              <div class="star-cell">
                <span>${n}★</span>
                <input type="number" min="0" max="120" id="fStar${n}" value="${st.starReward[n]}">
              </div>`).join('')}
          </div>
        </div>
        <div class="field"><label>启用可用时段</label><input type="checkbox" id="fWindowOn" ${st.windowOn ? 'checked' : ''} style="width:auto"></div>
        <div class="field"><label>时段开始</label><input type="time" id="fWindowStart" value="${esc(st.windowStart)}"></div>
        <div class="field"><label>时段结束</label><input type="time" id="fWindowEnd" value="${esc(st.windowEnd)}"></div>
        <div class="field"><label>界面主题</label>
          <select id="fTheme">
            <option value="auto" ${st.theme === 'auto' ? 'selected' : ''}>跟随系统</option>
            <option value="light" ${st.theme === 'light' ? 'selected' : ''}>浅色</option>
            <option value="dark" ${st.theme === 'dark' ? 'selected' : ''}>深色</option>
          </select>
        </div>
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:16px">
        <button class="btn" id="saveRules">保存规则</button>
      </div>
    </div>`;

  $('#saveRules').addEventListener('click', () => {
    const st2 = S.settings;
    st2.dailyLimitMin = clamp(parseInt($('#fDaily').value, 10) || 0, 0, 1440);
    st2.taskSize = clamp(parseInt($('#fSize').value, 10) || 5, 1, 30);
    st2.passRate = clamp(parseInt($('#fRate').value, 10) || 0, 0, 100) / 100;
    st2.extraWrong = clamp(parseInt($('#fExtra').value, 10) || 3, 1, 10);
    [1, 2, 3, 4, 5].forEach(n => {
      st2.starReward[n] = clamp(parseInt($('#fStar' + n).value, 10) || 0, 0, 120);
    });
    st2.windowOn = $('#fWindowOn').checked;
    st2.windowStart = $('#fWindowStart').value || '00:00';
    st2.windowEnd = $('#fWindowEnd').value || '23:59';
    st2.theme = $('#fTheme').value;
    save(); applyTheme(); toast('规则已保存'); render();
  });
}

function renderBank(body) {
  const qs = S.bank;
  body.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:12px">
        <h2 style="margin:0">题库（${qs.length} 题）</h2>
        <div class="row">
          <button class="btn sm" id="addQ">新增</button>
          <button class="btn sm ghost" id="impQ">导入</button>
          <button class="btn sm ghost" id="expQ">导出</button>
        </div>
      </div>
      <div class="list">
        ${qs.map(q => `
          <div class="list-item">
            <span class="badge">${'★'.repeat(starOf(q))}</span>
            <div class="grow">
              <div class="t">${esc(q.stem)}</div>
              <div class="m">${{ single: '单选', multi: '多选', judge: '判断', fill: '填空', subj: '主观' }[q.type] || '单选'} · 奖励 ${rewardMinOf(q)} 分钟</div>
            </div>
            <button class="btn sm ghost" data-edit="${q.id}">改</button>
            <button class="btn sm ghost" data-del="${q.id}">删</button>
          </div>`).join('')}
      </div>
      <input type="file" id="fileImp" accept=".json,application/json" style="display:none">
    </div>
    <div id="editor"></div>`;

  $('#addQ').addEventListener('click', () => renderEditor({ id: '', star: 2, type: 'single', stem: '', options: ['', ''], answer: [], explain: '' }));
  $$('[data-edit]').forEach(b => b.addEventListener('click', () => {
    const q = getQ(b.dataset.edit);
    if (q) renderEditor(JSON.parse(JSON.stringify(q)));
  }));
  $$('[data-del]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.del;
    const q = getQ(id);
    if (!q) return;
    if (!confirm(`删除这道题？\n${q.stem.slice(0, 40)}`)) return;
    S.bank = S.bank.filter(x => x.id !== id);
    S.progress.extraPool = (S.progress.extraPool || []).filter(x => x !== id);
    save(); toast('已删除'); render();
  }));
  $('#expQ').addEventListener('click', () => {
    const data = { version: 1, app: 'studyontv-ios', questions: S.bank };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `题库-${todayKey()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    toast('已导出');
  });
  $('#impQ').addEventListener('click', () => $('#fileImp').click());
  $('#fileImp').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try { data = JSON.parse(reader.result); } catch (err) { toast('不是合法的 JSON'); return; }
      const list = Array.isArray(data) ? data : (data.questions || []);
      if (!Array.isArray(list) || !list.length) { toast('文件里没有题目'); return; }
      const cleaned = list.map(raw => ({
        id: raw.id || uid(),
        star: clamp(parseInt(raw.star, 10) || 1, 1, 5),
        type: ['single', 'multi', 'judge', 'fill', 'subj'].includes(raw.type) ? raw.type : 'single',
        stem: String(raw.stem || raw.question || '').slice(0, 2000),
        options: Array.isArray(raw.options) ? raw.options.map(o => String(o)).slice(0, 8) : [],
        answer: Array.isArray(raw.answer) ? raw.answer : (raw.answer != null ? [raw.answer] : []),
        explain: String(raw.explain || raw.analysis || '')
      })).filter(q => q.stem);
      if (!cleaned.length) { toast('没有可用的题目'); return; }
      if (!confirm(`导入 ${cleaned.length} 道题，替换现有 ${S.bank.length} 道？\n（点取消则追加到现有题库）`)) {
        S.bank = S.bank.concat(cleaned);
        save(); toast(`已追加 ${cleaned.length} 道题`); render();
        return;
      }
      S.bank = cleaned;
      save(); toast(`已替换为 ${cleaned.length} 道题`); render();
    };
    reader.readAsText(f);
  });
}

function renderEditor(q) {
  const box = $('#editor');
  if (!box) return;
  const isNew = !q.id;
  const answerText = q.type === 'fill' || q.type === 'subj'
    ? (q.answer || []).join('\n')
    : (q.answer || []).map(i => Number(i) + 1).join(',');
  box.innerHTML = `
    <div class="card">
      <h2>${isNew ? '新增题目' : '编辑题目'}</h2>
      <div class="form">
        <div class="field"><label>题型</label>
          <select id="eType">
            <option value="single" ${q.type === 'single' ? 'selected' : ''}>单选</option>
            <option value="multi" ${q.type === 'multi' ? 'selected' : ''}>多选</option>
            <option value="judge" ${q.type === 'judge' ? 'selected' : ''}>判断</option>
            <option value="fill" ${q.type === 'fill' ? 'selected' : ''}>填空</option>
            <option value="subj" ${q.type === 'subj' ? 'selected' : ''}>主观</option>
          </select>
        </div>
        <div class="field"><label>星级（1–5，决定奖励时长）</label>
          <input type="number" id="eStar" min="1" max="5" value="${starOf(q)}">
        </div>
        <div class="form-block"><label>题干</label><textarea id="eStem">${esc(q.stem)}</textarea></div>
        <div class="form-block"><label>选项（每行一个；判断/填空/主观题可留空）</label><textarea id="eOpts">${esc((q.options || []).join('\n'))}</textarea></div>
        <div class="form-block"><label id="eAnsLabel">答案（选择题填选项序号，如 1 或 1,2；填空/主观题写参考答案，可多行）</label><textarea id="eAns">${esc(answerText)}</textarea></div>
        <div class="form-block"><label>解析（可选）</label><textarea id="eExplain">${esc(q.explain || '')}</textarea></div>
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:16px">
        <button class="btn ghost" id="cancelEdit">取消</button>
        <button class="btn" id="saveEdit">保存</button>
      </div>
    </div>`;

  $('#eType').addEventListener('change', () => {
    const t = $('#eType').value;
    $('#eAnsLabel').textContent = (t === 'fill' || t === 'subj')
      ? '参考答案（填空可多行，任一匹配即算对；主观题为自评参考）'
      : '答案（选项序号，从 1 开始；多选如 1,3）';
  });
  $('#cancelEdit').addEventListener('click', () => { box.innerHTML = ''; });
  $('#saveEdit').addEventListener('click', () => {
    const type = $('#eType').value;
    const stem = $('#eStem').value.trim();
    if (!stem) return toast('题干不能为空');
    let options = $('#eOpts').value.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 8);
    let answer = [];
    const rawAns = $('#eAns').value.trim();
    if (type === 'fill' || type === 'subj') {
      answer = rawAns.split('\n').map(s => s.trim()).filter(Boolean);
      if (!answer.length) return toast('参考答案不能为空');
    } else {
      if (type === 'judge' && !options.length) options = ['对', '错'];
      if (!options.length) return toast('选择题至少要有一个选项');
      answer = rawAns.split(/[,，、\s]+/).filter(Boolean)
        .map(x => parseInt(x, 10) - 1)
        .filter(n => n >= 0 && n < options.length);
      if (!answer.length) return toast('答案要填选项序号（从 1 开始）');
      if (type === 'single' || type === 'judge') answer = [answer[0]];
    }
    const obj = {
      id: q.id || uid(),
      star: clamp(parseInt($('#eStar').value, 10) || 1, 1, 5),
      type, stem, options, answer,
      explain: $('#eExplain').value.trim()
    };
    if (q.id) {
      S.bank = S.bank.map(x => x.id === q.id ? obj : x);
    } else {
      S.bank.unshift(obj);
    }
    save();
    box.innerHTML = '';
    toast('已保存');
    render();
    ui.tab = 'bank';
  });
}

function renderVideo(body) {
  const st = S.settings;
  body.innerHTML = `
    <div class="card">
      <h2>观看内容</h2>
      <div class="form">
        <div class="form-block">
          <label>在线视频地址（mp4 直链，或可直接播放的 https 链接）</label>
          <input id="vUrl" type="text" placeholder="https://example.com/kid.mp4" value="${esc(st.videoUrl)}">
        </div>
        <div class="form-block">
          <label>或选择本机视频文件（存在这台设备本地，离线也能看）</label>
          <input id="vFile" type="file" accept="video/*">
          <div class="muted">${st.videoName ? `当前本地视频：${esc(st.videoName)}` : '当前没有本地视频'}</div>
        </div>
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:16px">
        <button class="btn ghost" id="clearVideo">清空视频源</button>
        <button class="btn" id="saveVideo">保存</button>
      </div>
    </div>
    <div class="card tight">
      <div class="muted">提示：本地视频存在浏览器的 IndexedDB 里，只在当前设备有效；不要在 Safari 里“清除网站数据”，否则会被清掉。单个文件建议不超过 300MB。</div>
    </div>`;

  $('#vFile').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (f.size > 400 * 1024 * 1024) { toast('文件太大，建议换小一点的视频'); return; }
    idbPut('video', f).then(() => {
      S.settings.videoName = f.name;
      S.settings.videoUrl = '';
      save();
      toast('本地视频已保存');
      render();
      ui.tab = 'video';
    }).catch(() => toast('保存失败，可能是空间不足'));
  });
  $('#saveVideo').addEventListener('click', () => {
    const url = $('#vUrl').value.trim();
    S.settings.videoUrl = url;
    if (url) { S.settings.videoName = ''; idbDel('video'); }
    save(); toast('已保存'); render(); ui.tab = 'video';
  });
  $('#clearVideo').addEventListener('click', () => {
    S.settings.videoUrl = '';
    S.settings.videoName = '';
    idbDel('video');
    save(); toast('已清空'); render(); ui.tab = 'video';
  });
}

function renderLog(body) {
  const hist = (S.progress.history || []).slice(-60).reverse();
  const seen = S.progress.seen || {};
  const rows = hist.map(h => {
    const t = new Date(h.ts);
    const time = `${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    if (h.kind === 'watch') return `<tr><td>${time}</td><td>观看</td><td>本次观看 ${h.minutes} 分钟${h.awarded ? `（奖励 ${h.awarded} 分钟）` : ''}</td><td></td></tr>`;
    if (h.kind === 'fail') return `<tr><td>${time}</td><td>未通过</td><td>${h.correct || 0}/${h.total || 0}，正确率 ${Math.round((h.rate || 0) * 100)}%</td><td></td></tr>`;
    const q = getQ(h.qid);
    return `<tr><td>${time}</td><td>${h.right ? '✅ 对' : '❌ 错'}</td><td>${esc((q ? q.stem : h.qid).slice(0, 26))}${q ? '…' : ''}</td><td class="num">${h.star}★</td></tr>`;
  }).join('');

  const wrongTop = Object.keys(seen)
    .map(id => ({ id, q: getQ(id), ...seen[id] }))
    .filter(x => x.q && x.wrong > 0)
    .sort((a, b) => b.wrong - a.wrong)
    .slice(0, 8)
    .map(x => `<div class="list-item"><div class="grow"><div class="t">${esc(x.q.stem.slice(0, 50))}</div><div class="m">对 ${x.right} 次 · 错 ${x.wrong} 次</div></div><span class="badge">错 ${x.wrong}</span></div>`)
    .join('') || '<div class="muted">还没有错题记录。</div>';

  body.innerHTML = `
    <div class="card">
      <h2>使用记录</h2>
      <div class="scroll-x">
        <table class="rec">
          <thead><tr><th>时间</th><th>事件</th><th>内容</th><th class="num">星级</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4" class="muted">还没有记录</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <h2>错题排行</h2>
      <div class="list">${wrongTop}</div>
    </div>
    <div class="card tight">
      <div class="row" style="justify-content:space-between;align-items:center">
        <span class="muted">加练池：${(S.progress.extraPool || []).length} 题</span>
        <button class="btn sm ghost" id="clearExtra">清空加练池</button>
      </div>
    </div>`;
  $('#clearExtra').addEventListener('click', () => {
    S.progress.extraPool = [];
    save(); toast('加练池已清空'); render(); ui.tab = 'log';
  });
}

function renderMore(body) {
  const st = S.settings;
  body.innerHTML = `
    <div class="card">
      <h2>数据与维护</h2>
      <div class="row" style="margin-bottom:14px">
        <button class="btn sm ghost" id="skipToday">今天免答（直接放行一次）</button>
        <button class="btn sm ghost" id="resetToday">重置今日已用时长</button>
        <button class="btn sm ghost" id="restoreBank">恢复示例题库</button>
        <button class="btn sm ghost" id="changePin">修改管理密码</button>
        <button class="btn sm danger" id="wipeAll">清空全部数据</button>
      </div>
      <div class="muted">
        奖励 ${S.settings.starReward[1]}/${S.settings.starReward[2]}/${S.settings.starReward[3]}/${S.settings.starReward[4]}/${S.settings.starReward[5]} 分钟 ·
        每轮 ${S.settings.taskSize} 题 · 正确率 ${Math.round(Number(S.settings.passRate) * 100)}% ·
        每日 ${S.settings.dailyLimitMin} 分钟
      </div>
    </div>
    <div class="card tight">
      <div class="muted">
        本版为离线网页应用（PWA），数据保存在本机浏览器里，不上传服务器。<br>
        版本：iOS 版 v1.0 · 题库 ${S.bank.length} 题 · 存储占用约 ${(new Blob([JSON.stringify(S)]).size / 1024).toFixed(1)} KB
      </div>
    </div>`;

  $('#skipToday').addEventListener('click', () => {
    const need = Number(st.dailyLimitMin || 0) * 60;
    S.progress.usedSec = 0;
    S.session = {
      status: 'watch',
      queue: [], idx: 0, correct: 0, wrong: 0,
      earnedSec: need, awardedSec: Math.min(need, need), remainSec: Math.min(need, need),
      wrongInTask: 0, extraAdded: 0, startedAt: Date.now()
    };
    save(); ui.name = 'home'; toast('已放行本轮'); render();
  });
  $('#resetToday').addEventListener('click', () => {
    S.progress.usedSec = 0; save(); toast('已重置今日时长'); render();
  });
  $('#restoreBank').addEventListener('click', () => {
    if (!confirm('用示例题库覆盖当前题库？')) return;
    S.bank = DEFAULT_BANK.map(q => JSON.parse(JSON.stringify(q)));
    save(); toast('已恢复示例题库'); render();
  });
  $('#changePin').addEventListener('click', () => {
    const n = prompt('输入新的 4 位管理密码：', '');
    if (n == null) return;
    if (!/^\d{4}$/.test(n)) return toast('必须是 4 位数字');
    S.pin = n; save(); toast('密码已修改');
  });
  $('#wipeAll').addEventListener('click', () => {
    if (!confirm('清空所有数据（题库、记录、设置、密码）？此操作不可撤销。')) return;
    localStorage.removeItem(LS_KEY);
    idbDel('video');
    location.reload();
  });
}

/* ---------- toast ---------- */
let toastTimer = null;
function toast(msg) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------- 顶部交互 ---------- */
let brandTaps = [];
$('#brand').addEventListener('click', () => {
  const now = Date.now();
  brandTaps = brandTaps.filter(t => now - t < 3000);
  brandTaps.push(now);
  if (brandTaps.length >= 5) {
    brandTaps = [];
    requestPin();
  }
});
$('#themeBtn').addEventListener('click', () => {
  const order = ['auto', 'light', 'dark'];
  const cur = order.indexOf(S.settings.theme || 'auto');
  S.settings.theme = order[(cur + 1) % 3];
  save(); applyTheme();
  toast({ auto: '跟随系统', light: '浅色', dark: '深色' }[S.settings.theme]);
});

/* ---------- 启动 ---------- */
render();

/* 注册 Service Worker（仅在 https / localhost 下有效） */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
