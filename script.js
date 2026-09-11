/* ═══════════════════════════════════════════════════════════
   Business Result Intermediate B1 — study guide reader
   Trình đọc ghi chú + trình phát audio, không phụ thuộc thư viện ngoài.
   ═══════════════════════════════════════════════════════════ */
(() => {
'use strict';

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const HEADPHONE = '\u{1F3A7}';

/* ── localStorage an toàn ─────────────────────────────────── */
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem('brsg:' + key); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('brsg:' + key, JSON.stringify(value)); } catch { /* chế độ riêng tư */ }
  }
};

/* ═══════════ 1. MARKDOWN → HTML ═══════════ */

const slug = (text) => text
  .replace(/[*`]/g, '')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}\s-]/gu, '')
  .trim()
  .replace(/\s+/g, '-');

const esc = (s) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** `#mục` và `#mục/neo` trở thành nút điều hướng trong trang. */
function link(href, label) {
  if (!href.startsWith('#')) return `<a href="${href}" target="_blank" rel="noopener">${label}</a>`;
  const [sec, head] = href.slice(1).split('/');
  return `<a class="xlink" href="${href}" data-go="${sec}"` +
         (head ? ` data-head="${head}"` : '') + `>${label}</a>`;
}

function inline(text) {
  let s = esc(text);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => link(href, label));
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  return s;
}

const RE_TABLE_SEP = /^\s*\|[-\s:|]+\|\s*$/;
const cells = (line) => line.trim()
  .replace(/^\|/, '').replace(/\|$/, '')
  .split('|').map((c) => c.trim());

/** Markdown của riêng file này: mỗi khối là một dòng, cách nhau bằng dòng trống. */
function mdToHtml(md) {
  const lines = md.split('\n');
  const out = [];
  let list = null;                                   // {tag, items:[], last}

  const flush = () => {
    if (!list) return;
    out.push(`<${list.tag}>${list.items.join('')}</${list.tag}>`);
    list = null;
  };

  const pushItem = (tag, num, html) => {
    if (list && (list.tag !== tag || (tag === 'ol' && num !== list.last + 1))) flush();
    if (!list) list = { tag, items: [], last: 0 };
    list.items.push(tag === 'ol' ? `<li data-n="${num}">${html}</li>` : `<li>${html}</li>`);
    list.last = num;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;

    const head = /^(#{1,5})\s+(.*)$/.exec(raw);
    if (head) {
      flush();
      const level = Math.min(head[1].length, 6);
      out.push(`<h${level} id="${slug(head[2])}">${inline(head[2])}</h${level}>`);
      continue;
    }

    /* bảng: dòng đầu + dòng phân cách ---|--- */
    if (raw.trim().startsWith('|') && RE_TABLE_SEP.test(lines[i + 1] || '')) {
      flush();
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++]);
      i--;
      const cols = cells(rows[0]);
      const body = rows.slice(2).filter((r) => r.trim());
      out.push(
        '<div class="table-wrap"><table>' +
        '<thead><tr>' + cols.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead>' +
        '<tbody>' + body.map((r) =>
          `<tr>${cells(r).map((c, n) =>
            `<td${n === 0 ? ' class="c1"' : ''} data-th="${esc(cols[n] || '')}">${inline(c)}</td>`
          ).join('')}</tr>`).join('') +
        '</tbody></table></div>'
      );
      continue;
    }

    if (/^-{3,}$/.test(raw.trim())) { flush(); out.push('<hr>'); continue; }

    if (raw.startsWith('>')) {                       // blockquote (gộp dòng liền kề)
      flush();
      const buf = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      i--;
      const warn = /⚠️|Bẫy|Lỗi|Cảnh báo/.test(buf.join(' '));
      out.push(`<blockquote${warn ? ' class="warn"' : ''}>${mdToHtml(buf.join('\n'))}</blockquote>`);
      continue;
    }

    const ol = /^(\d{1,2})\.\s+(.*)$/.exec(raw);
    if (ol) { pushItem('ol', Number(ol[1]), inline(ol[2])); continue; }

    const ul = /^[-*+]\s+(.*)$/.exec(raw);
    if (ul) { pushItem('ul', 0, inline(ul[1])); continue; }

    flush();
    out.push(`<p>${inline(raw)}</p>`);
  }
  flush();
  return out.join('\n');
}

/* ═══════════ 2. TÁCH THÀNH CÁC MỤC ═══════════ */

const book = { front: [], sections: [], notes: [], index: [] };

/** Dòng bảng thành câu đọc được, để tìm kiếm ra kết quả tử tế. */
function plain(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = cells(s).filter(Boolean).join(' — ');
  return s.replace(/[*`#]/g, '').trim();
}

function parseBook(md) {
  let current = null;
  for (const line of md.split('\n')) {
    const m = /^##\s+(.+)$/.exec(line);
    if (m) {
      current = { title: m[1].trim(), lines: [] };
      book.sections.push(current);
      continue;
    }
    (current ? current.lines : book.front).push(line);
  }

  book.notes = book.front.filter((l) => l.startsWith('>')).map((l) => l.replace(/^>\s?/, ''));

  book.sections.forEach((sec) => {
    sec.id = slug(sec.title);
    sec.headHtml = `<h2>${inline(sec.title)}</h2>`;
    sec.bodyHtml = mdToHtml(sec.lines.join('\n'));

    const unit = /^Unit\s+(\d+)\s*—\s*(.+)$/.exec(sec.title);
    sec.isUnit = Boolean(unit);
    sec.num = unit ? Number(unit[1]) : null;
    sec.shortTitle = unit ? unit[2] : sec.title;
    sec.tracks = sec.isUnit ? audioFiles.filter((f) => f.group === sec.num) : [];

    sec.lessons = [];
    let head = null;
    for (const line of sec.lines) {
      const h3 = /^###\s+(.+)$/.exec(line);
      if (h3) {
        head = { id: slug(h3[1]), title: h3[1].trim() };
        sec.lessons.push(head);
        continue;
      }
      if (/^#{1,5}\s/.test(line) || !line.trim() || line.startsWith('>')) continue;
      if (RE_TABLE_SEP.test(line) || /^-{3,}$/.test(line.trim())) continue;
      const text = plain(line);
      if (text) book.index.push({ sec, head, text });
    }
  });
}

/* ═══════════ 3. AUDIO ═══════════ */

const audioFiles = (window.AUDIO_FILES || []).map((f, i) => ({ ...f, i }));
const byName = new Map(audioFiles.map((f) => [f.name, f]));

const audio    = $('#audio');
const playerEl = $('#player');
const seekEl   = $('#seek');
const RATES    = [0.75, 1, 1.25, 1.5, 2];

let currentFile = null;

const fmtTime = (s) => {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  return m + ':' + String(Math.floor(s % 60)).padStart(2, '0');
};
/** Sách đánh số bài nghe theo dạng "unit.track" — dùng đúng cách đánh số đó. */
const trackNo = (f) => `${f.group}.${f.index}`;
const fileLabel = (f) => `Unit ${f.group} · bài nghe ${trackNo(f)}`;

function setSeekFill() {
  const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
  seekEl.style.setProperty('--pct', pct + '%');
  if (!seekEl.dataset.dragging) seekEl.value = String(Math.round(pct * 10));
  $('#npCur').textContent = fmtTime(audio.currentTime);
  $('#npDur').textContent = fmtTime(audio.duration);
}

function play(file, { silent = false } = {}) {
  if (!file) return;
  if (currentFile !== file) {
    currentFile = file;
    audio.src = encodeURI(file.src);
    audio.playbackRate = store.get('rate', 1);
    playerEl.dataset.empty = 'false';
    $('#npTitle').textContent = 'Bài nghe ' + trackNo(file);
    $('#npSub').textContent = file.name;
    if ('mediaSession' in navigator && typeof MediaMetadata === 'function') {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: 'Bài nghe ' + trackNo(file), artist: fileLabel(file),
          album: 'Business Result Intermediate'
        });
      } catch { /* trình duyệt không hỗ trợ */ }
    }
  }
  audio.play().catch(() => { if (!silent) toast('Trình duyệt chặn tự động phát — bấm ▶ để nghe.'); });
  refreshTracks();
  renderLibrary();
}

function step(delta) {
  if (!audioFiles.length) return;
  const at = currentFile ? currentFile.i : -1;
  play(audioFiles[(at + delta + audioFiles.length) % audioFiles.length]);
}

audio.addEventListener('timeupdate', setSeekFill);
audio.addEventListener('loadedmetadata', setSeekFill);
audio.addEventListener('play',  () => { playerEl.classList.add('is-playing'); refreshTracks(); renderLibrary(); });
audio.addEventListener('pause', () => { playerEl.classList.remove('is-playing'); refreshTracks(); renderLibrary(); });
audio.addEventListener('ended', () => { if (!audio.loop) step(1); });
audio.addEventListener('error', () => {
  if (audio.src) toast('Không mở được tệp audio. Kiểm tra thư mục audio còn nguyên không.');
});

$('#btnPlay').addEventListener('click', () => {
  if (!currentFile) {
    const first = (activeSection && activeSection.tracks.length) ? activeSection.tracks[0] : audioFiles[0];
    if (first) play(first); else openLibrary();
    return;
  }
  audio.paused ? audio.play().catch(() => {}) : audio.pause();
});
$('#btnPrev').addEventListener('click', () => step(-1));
$('#btnNext').addEventListener('click', () => step(1));

seekEl.addEventListener('input', () => {
  seekEl.dataset.dragging = '1';
  seekEl.style.setProperty('--pct', (seekEl.value / 10) + '%');
});
seekEl.addEventListener('change', () => {
  delete seekEl.dataset.dragging;
  if (audio.duration) audio.currentTime = (seekEl.value / 1000) * audio.duration;
});

$('#btnRate').addEventListener('click', () => {
  const now = store.get('rate', 1);
  const next = RATES[(RATES.indexOf(now) + 1) % RATES.length];
  store.set('rate', next);
  audio.playbackRate = next;
  $('#btnRate').textContent = next + '×';
});

$('#btnLoop').addEventListener('click', (e) => {
  audio.loop = !audio.loop;
  e.currentTarget.setAttribute('aria-pressed', String(audio.loop));
  toast(audio.loop ? 'Bật lặp lại một bài.' : 'Tắt lặp lại.');
});

/* ── Bảng bài nghe của unit ───────────────────────────────── */
function unitAudioHtml(sec) {
  if (!sec.tracks.length) return '';
  return `<section class="unit-audio" aria-label="Bài nghe của ${esc(sec.title)}">
    <div class="ua-head">
      <span class="ua-ico" aria-hidden="true">${HEADPHONE}</span>
      <b>Bài nghe Unit ${sec.num}</b>
      <small>${sec.tracks.length} tệp · đánh số như trong sách</small>
    </div>
    <div class="ua-list">${sec.tracks.map((f) => `
      <button class="ua-track" data-track="${esc(f.name)}">
        <span class="ua-dot" aria-hidden="true">▶</span>
        <span class="ua-no">${trackNo(f)}</span>
      </button>`).join('')}</div>
  </section>`;
}

function refreshTracks() {
  $$('#docBody [data-track]').forEach((el) => {
    const on = currentFile && currentFile.name === el.dataset.track;
    el.classList.toggle('is-current', Boolean(on));
    el.classList.toggle('is-playing', Boolean(on && !audio.paused));
    el.querySelector('.ua-dot').textContent = (on && !audio.paused) ? '▮▮' : '▶';
  });
}

/* ── Thư viện audio ───────────────────────────────────────── */
const libraryEl = $('#library');

function openLibrary() {
  $('#libHint').textContent = `${audioFiles.length} tệp · gộp theo unit · bấm để phát`;
  libraryEl.hidden = false;
  renderLibrary();
  setTimeout(() => $('#libSearch').focus(), 60);
}

function closeLibrary() { libraryEl.hidden = true; }

function renderLibrary() {
  if (libraryEl.hidden) return;
  const q = $('#libSearch').value.trim().toLowerCase();
  const hits = audioFiles.filter((f) =>
    !q || f.name.toLowerCase().includes(q) || trackNo(f).includes(q));
  const list = $('#libList');

  if (!hits.length) {
    list.innerHTML = '<p class="empty">Không có tệp nào khớp.</p>';
    return;
  }

  let html = '', group = null;
  for (const f of hits) {
    if (f.group !== group) {
      group = f.group;
      const sec = book.sections.find((s) => s.num === group);
      html += `<div class="lib-group">Unit ${group}${sec ? ' · ' + esc(sec.shortTitle) : ''}</div>`;
    }
    const cur = currentFile && currentFile.name === f.name;
    html += `<button class="lib-item${cur ? ' is-current' : ''}" data-file="${esc(f.name)}">
      <span class="dot">${cur && !audio.paused ? '▮▮' : '▶'}</span>
      <span class="nm">Bài nghe ${trackNo(f)}</span>
      <span class="sub">${esc(f.name)}</span>
    </button>`;
  }
  list.innerHTML = html;
}

$('#libList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-file]');
  if (!btn) return;
  const file = byName.get(btn.dataset.file);
  if (file) play(file);
});

$('#libSearch').addEventListener('input', renderLibrary);
$('#btnLibrary').addEventListener('click', openLibrary);
$$('[data-close]', libraryEl).forEach((el) => el.addEventListener('click', closeLibrary));

if (store.get('warnHidden', false)) $('#libWarn').hidden = true;
$('#btnWarnHide').addEventListener('click', () => {
  $('#libWarn').hidden = true;
  store.set('warnHidden', true);
});

/* phát một bài nghe từ bảng trong nội dung */
$('#docBody').addEventListener('click', (e) => {
  const el = e.target.closest('[data-track]');
  if (!el) return;
  const file = byName.get(el.dataset.track);
  if (!file) return;
  if (currentFile === file && !audio.paused) { audio.pause(); return; }
  play(file);
});

/* ═══════════ 4. ĐIỀU HƯỚNG & HIỂN THỊ ═══════════ */

const views = { home: $('#viewHome'), doc: $('#viewDoc'), search: $('#viewSearch') };
let activeSection = null;

function showView(name) {
  Object.entries(views).forEach(([k, el]) => { el.hidden = k !== name; });
}

function buildChrome() {
  const units  = book.sections.filter((s) => s.isUnit);
  const others = book.sections.filter((s) => !s.isUnit);

  /* thẻ chọn unit trên thanh trên cùng */
  const sel = $('#unitSelect');
  sel.innerHTML =
    '<option value="">📒 Trang chủ</option>' +
    `<optgroup label="Unit">${units.map((s) =>
      `<option value="${s.id}">Unit ${s.num} — ${esc(s.shortTitle)}</option>`).join('')}</optgroup>` +
    `<optgroup label="Tra cứu">${others.map((s) =>
      `<option value="${s.id}">${esc(s.title)}</option>`).join('')}</optgroup>`;
  sel.addEventListener('change', () => { go(sel.value || null); });

  /* mục lục bên trái */
  $('#toc').innerHTML = book.sections.map((s) => `
    <div class="toc-group" data-group="${s.id}">
      <button class="toc-sec" data-go="${s.id}">
        <span class="num">${s.isUnit ? s.num : '§'}</span>
        <span class="label">${esc(s.isUnit ? s.shortTitle : s.title)}</span>
      </button>
      <div class="toc-lessons">${s.lessons.map((l) =>
        `<button class="toc-lesson" data-go="${s.id}" data-head="${l.id}">${esc(l.title)}</button>`
      ).join('')}</div>
    </div>`).join('');

  /* thẻ trên trang chủ */
  const card = (s) => `
    <button class="card" data-go="${s.id}">
      <span class="card-top">
        <span class="card-num">${s.isUnit ? 'Unit ' + s.num : '§'}</span>
        ${s.tracks.length ? `<span class="card-audio">${HEADPHONE} ${s.tracks.length}</span>` : ''}
      </span>
      <h3>${esc(s.isUnit ? s.shortTitle : s.title)}</h3>
      <p>${s.lessons.length ? esc(s.lessons.map((l) => l.title).join(' · ')) : 'Mở để xem nội dung'}</p>
    </button>`;
  $('#unitGrid').innerHTML  = units.map(card).join('');
  $('#extraGrid').innerHTML = others.map(card).join('');

  /* số liệu + ghi chú trên trang chủ */
  const lessons = book.sections.reduce((n, s) => n + s.lessons.length, 0);
  $('#heroStats').innerHTML =
    `<span>${units.length} unit</span><span>${lessons} mục</span>` +
    `<span>${HEADPHONE} ${audioFiles.length} bài nghe</span><span>${others.length} phần tra cứu</span>`;
  $('#homeNotes').innerHTML = book.notes.map((n) => `<div class="note">${inline(n)}</div>`).join('');
}

function go(sectionId, headId = null, { push = true } = {}) {
  closeNav();

  if (!sectionId) {
    activeSection = null;
    showView('home');
    syncActive();
    $('#unitSelect').value = '';
    if (push) history.pushState({}, '', '#');
    window.scrollTo({ top: 0 });
    return;
  }

  const sec = book.sections.find((s) => s.id === sectionId);
  if (!sec) { go(null, null, { push }); return; }

  activeSection = sec;
  $('#docBody').innerHTML = sec.headHtml + unitAudioHtml(sec) + sec.bodyHtml;
  refreshTracks();

  $('#crumbs').innerHTML =
    `<button data-go="">Trang chủ</button><span>›</span><span>${esc(sec.title)}</span>`;

  const at   = book.sections.indexOf(sec);
  const prev = book.sections[at - 1];
  const next = book.sections[at + 1];
  $('#pager').innerHTML =
    (prev ? `<button data-go="${prev.id}"><small>← Trước</small><span>${esc(prev.title)}</span></button>` : '') +
    (next ? `<button class="next" data-go="${next.id}"><small>Tiếp →</small><span>${esc(next.title)}</span></button>` : '');

  showView('doc');
  $('#unitSelect').value = sec.id;
  store.set('last', sec.id);
  syncActive(headId);

  if (push) history.pushState({}, '', '#' + sec.id + (headId ? '/' + headId : ''));

  if (headId) {
    const target = document.getElementById(headId);
    if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  }
  window.scrollTo({ top: 0 });
}

function syncActive(headId) {
  $$('.toc-group').forEach((g) => {
    const on = activeSection && g.dataset.group === activeSection.id;
    g.classList.toggle('is-open', Boolean(on));
    $('.toc-sec', g).classList.toggle('is-active', Boolean(on));
  });
  $$('.toc-lesson').forEach((b) => b.classList.toggle('is-active', b.dataset.head === headId));
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-go]');
  if (!btn) return;
  e.preventDefault();
  go(btn.dataset.go || null, btn.dataset.head || null);
});

$('#btnHome').addEventListener('click', (e) => { e.preventDefault(); go(null); });

window.addEventListener('popstate', () => routeFromHash({ push: false }));

function routeFromHash({ push } = { push: false }) {
  const [sec, head] = decodeURIComponent(location.hash.replace(/^#/, '')).split('/');
  go(sec || null, head || null, { push });
}

/* ═══════════ 5. TÌM KIẾM ═══════════ */

let searchTimer = null;

function runSearch(query) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) {
    // chỉ quay lại nội dung khi đang ở màn hình kết quả, tránh nhảy trang khi gõ ký tự đầu
    if (!views.search.hidden) go(activeSection ? activeSection.id : null, null, { push: false });
    return;
  }

  const hits = [];
  for (const entry of book.index) {
    const at = entry.text.toLowerCase().indexOf(q);
    if (at === -1) continue;
    const from = Math.max(0, at - 60);
    const snippet = (from ? '…' : '') + entry.text.slice(from, at + q.length + 110) + '…';
    hits.push({ ...entry, snippet });
    if (hits.length >= 80) break;
  }

  $('#searchTitle').textContent = hits.length
    ? `${hits.length} kết quả cho “${query.trim()}”`
    : `Không tìm thấy “${query.trim()}”`;

  $('#searchResults').innerHTML = hits.length
    ? hits.map((h) => `
        <button class="result" data-go="${h.sec.id}"${h.head ? ` data-head="${h.head.id}"` : ''}>
          <span class="where">${esc(h.sec.title)}${h.head ? ' › ' + esc(h.head.title) : ''}</span>
          <span class="snip">${esc(h.snippet).replace(
            new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>')}</span>
        </button>`).join('')
    : '<p class="empty">Thử từ khoá khác, hoặc bỏ dấu nháy và ký tự đặc biệt.</p>';

  showView('search');
  window.scrollTo({ top: 0 });
}

$('#searchInput').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const value = e.target.value;
  searchTimer = setTimeout(() => runSearch(value), 180);
});

/* ═══════════ 6. GIAO DIỆN PHỤ ═══════════ */

/* ngăn kéo mục lục trên điện thoại */
const sidebar = $('#sidebar');
const openNav  = () => {
  sidebar.classList.add('is-open');
  $('#scrim').hidden = false;
  $('#btnMenu').setAttribute('aria-expanded', 'true');
};
const closeNav = () => {
  sidebar.classList.remove('is-open');
  $('#scrim').hidden = true;
  $('#btnMenu').setAttribute('aria-expanded', 'false');
};
$('#btnMenu').addEventListener('click', () =>
  sidebar.classList.contains('is-open') ? closeNav() : openNav());
$('#btnCloseNav').addEventListener('click', closeNav);
$('#scrim').addEventListener('click', closeNav);

/* sáng / tối */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  store.set('theme', theme);
}
$('#btnTheme').addEventListener('click', () =>
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));

/* thanh tiến độ đọc */
const progressFill = $('#progressFill');
addEventListener('scroll', () => {
  const max = document.documentElement.scrollHeight - innerHeight;
  progressFill.style.width = (max > 0 ? (scrollY / max) * 100 : 0) + '%';
}, { passive: true });

/* phím tắt */
addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);

  if (e.key === 'Escape') {
    if (!libraryEl.hidden) { closeLibrary(); return; }
    if (sidebar.classList.contains('is-open')) { closeNav(); return; }
    if (typing) document.activeElement.blur();
    return;
  }
  if (typing) return;

  if (e.key === '/') { e.preventDefault(); $('#searchInput').focus(); return; }
  if (e.key === ' ') { e.preventDefault(); $('#btnPlay').click(); return; }
  if (!currentFile) return;
  if (e.key === 'ArrowRight') audio.currentTime += 5;
  if (e.key === 'ArrowLeft')  audio.currentTime -= 5;
});

/* thông báo ngắn */
let toastTimer = null;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

/* ═══════════ 7. KHỞI ĐỘNG ═══════════ */

async function loadMarkdown() {
  try {
    const res = await fetch('business-result.md', { cache: 'no-cache' });
    if (res.ok) {
      const text = await res.text();
      if (text.trim().startsWith('#')) return text;
    }
  } catch { /* mở bằng file:// — dùng bản nhúng */ }
  return window.BOOK_MD || '';
}

(async function init() {
  applyTheme(store.get('theme',
    matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  $('#btnRate').textContent = store.get('rate', 1) + '×';

  const md = await loadMarkdown();
  if (!md) {
    $('#docBody').innerHTML =
      '<p class="empty">Không đọc được <code>business-result.md</code> và cũng không thấy ' +
      '<code>book-data.js</code>. Hãy chạy trang qua một máy chủ tĩnh, ví dụ ' +
      '<code>python -m http.server</code>.</p>';
    showView('doc');
    return;
  }

  parseBook(md);
  buildChrome();

  if (location.hash.length > 1) routeFromHash();
  else go(null, null, { push: false });

  if (!audioFiles.length) {
    toast('Không thấy tệp audio nào — kiểm tra lại book-data.js.');
  }
})();

})();
