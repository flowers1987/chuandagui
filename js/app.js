import {
  getAllOutfits, getOutfit, putOutfit, deleteOutfit,
  getAllKnowledge, putKnowledge, deleteKnowledge, uid,
  getCategories, putCategory, deleteCategory,
} from './db.js';
import { buildZip, blobToBytes } from './zip.js';
import { buildWordDoc } from './word.js';

// ---------- DOM 工具 ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const SEASON_LABEL = { spring: '春季', summer: '夏季', autumn: '秋季', winter: '冬季' };
const FOLDER_NAME = { spring: '春季穿搭', summer: '夏季穿搭', autumn: '秋季穿搭', winter: '冬季穿搭' };

let state = {
  view: 'wardrobe',
  season: 'all',
  createSeasons: [],    // 支持多选
  editingOutfitId: null,
  pendingPhotos: [],   // {id, blob, name, url}
  editingKnowledgeId: null,
  knowledgeCategory: 'all',      // 知识列表筛选（分类）
  editingKnowledgeCategory: null, // 编辑/新建时选中的分类
  cardUrls: new Set(),  // 已生成的预览 URL，需回收
};

// 分类缓存
let categories = [];
let categoryMap = {};   // id -> name

async function loadCategories() {
  categories = await getCategories();
  categoryMap = {};
  categories.forEach((c) => { categoryMap[c.id] = c.name; });
}

// ---------- Toast ----------
let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2000);
}

// ---------- 二次确认 ----------
function showConfirm(text, onConfirm) {
  $('#dialogText').textContent = text;
  const mask = $('#dialogMask');
  mask.hidden = false;
  const c = $('#dialogCancel');
  const ok = $('#dialogConfirm');
  const cleanup = () => { mask.hidden = true; c.onclick = null; ok.onclick = null; };
  c.onclick = cleanup;
  ok.onclick = () => { cleanup(); onConfirm(); };
}

// ---------- 操作列表弹窗 ----------
function showActionSheet(items) {
  const mask = $('#sheetMask');
  const sheet = $('#sheet');
  sheet.innerHTML = '';
  items.forEach((it) => {
    const b = document.createElement('button');
    b.className = 'sheet-item' + (it.danger ? ' danger' : '');
    b.textContent = it.label;
    b.onclick = () => { mask.hidden = true; it.onTap(); };
    sheet.appendChild(b);
  });
  const cancel = document.createElement('button');
  cancel.className = 'sheet-item';
  cancel.textContent = '取消';
  cancel.onclick = () => { mask.hidden = true; };
  sheet.appendChild(cancel);
  mask.hidden = false;
}

// ---------- 进度条 ----------
function showProgress(text) {
  $('#progressText').textContent = text;
  $('#progressFill').style.width = '0%';
  $('#progressMask').hidden = false;
}
function updateProgress(ratio) {
  $('#progressFill').style.width = Math.round(ratio * 100) + '%';
}
function hideProgress() { $('#progressMask').hidden = true; }

// ---------- 时间格式 ----------
function fmtStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
}
function fmtDate(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------- 视图路由 ----------
function showView(view) {
  state.view = view;
  const views = { wardrobe: '#view-wardrobe', create: '#view-create', knowledge: '#view-knowledge', 'knowledge-edit': '#view-knowledge-edit' };
  Object.entries(views).forEach(([k, sel]) => { $(sel).hidden = (k !== view); });

  const tabbar = $('#tabbar');
  const back = $('#appbarBack');
  const action = $('#appbarAction');
  const title = $('#appbarTitle');

  tabbar.style.display = (view === 'wardrobe' || view === 'knowledge') ? 'flex' : 'none';
  back.hidden = (view === 'wardrobe' || view === 'knowledge');

  // 重置创建/编辑态
  if (view === 'wardrobe') { title.textContent = '穿搭柜'; action.hidden = false; action.textContent = '···'; action.onclick = openWardrobeMenu; }
  if (view === 'knowledge') { title.textContent = '穿搭知识'; action.hidden = false; action.textContent = '···'; action.onclick = openKnowledgeMenu; }
  if (view === 'create') { title.textContent = '创建穿搭'; action.hidden = false; action.textContent = '保存'; action.onclick = saveOutfit; }
  if (view === 'knowledge-edit') { title.textContent = state.editingKnowledgeId ? '编辑知识' : '新建知识'; action.hidden = false; action.textContent = '保存'; action.onclick = saveKnowledge; }

  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  $('#content').scrollTop = 0;
}

// ---------- 衣橱：渲染 ----------
function seasonBadges(o) {
  const arr = (o.seasons && o.seasons.length) ? o.seasons : [o.season];
  return arr.map((s) => `<span class="card-season season-${s}">${SEASON_LABEL[s]}</span>`).join('');
}

async function renderWardrobe() {
  revokeCardUrls();
  const grid = $('#cardGrid');
  grid.innerHTML = '';
  const all = await getAllOutfits();
  const list = state.season === 'all' ? all : all.filter((o) => (o.seasons || [o.season]).includes(state.season));

  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = `<div class="empty-ill">
      <svg viewBox="0 0 64 64" width="58" height="58" aria-hidden="true">
        <path d="M23 13 L25 8" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
        <path d="M41 13 L39 8" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
        <path d="M22 13 L25 23 L19 31 L9 53 Q32 59 55 53 L45 31 L39 23 L42 13 Q32 19 22 13 Z" fill="#fff"/>
      </svg>
    </div><div class="empty-text">暂无该季节穿搭，快去创建吧</div>`;
    grid.appendChild(empty);
    return;
  }

  list.forEach((o) => {
    const first = o.photos && o.photos[0];
    const url = first ? URL.createObjectURL(first.blob) : '';
    if (url) state.cardUrls.add(url);
    const card = document.createElement('div');
    card.className = 'outfit-card';
    card.innerHTML = `
      ${first ? `<img class="thumb" src="${url}" alt="穿搭">` : `<div class="thumb" style="display:flex;align-items:center;justify-content:center;background:#eee;font-size:30px;">🖼️</div>`}
      <button class="card-more">⋯</button>
      <div class="card-body">
        <div class="card-seasons">${seasonBadges(o)}</div>
      </div>`;
    card.querySelector('.card-more').onclick = (e) => { e.stopPropagation(); openCardMenu(o.id); };
    let longPressed = false;
    bindLongPress(card, () => { longPressed = true; openCardMenu(o.id); });
    card.onclick = () => { if (longPressed) { longPressed = false; return; } openLightbox(o); };
    grid.appendChild(card);
  });
}

function revokeCardUrls() {
  state.cardUrls.forEach((u) => URL.revokeObjectURL(u));
  state.cardUrls.clear();
}

function openCardMenu(id) {
  showActionSheet([
    { label: '修改', onTap: () => enterEditOutfit(id) },
    { label: '删除', danger: true, onTap: () => {
      showConfirm('确定删除该穿搭方案？删除后无法恢复', async () => {
        await deleteOutfit(id);
        toast('已删除');
        renderWardrobe();
      });
    } },
  ]);
}

// 长按支持
function bindLongPress(el, cb) {
  let timer = null, startX = 0, startY = 0;
  el.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX; startY = e.touches[0].clientY;
    timer = setTimeout(cb, 500);
  });
  el.addEventListener('touchmove', (e) => {
    if (Math.abs(e.touches[0].clientX - startX) > 10 || Math.abs(e.touches[0].clientY - startY) > 10) clearTimeout(timer);
  });
  el.addEventListener('touchend', () => clearTimeout(timer));
  el.addEventListener('touchcancel', () => clearTimeout(timer));
}

// ---------- 穿搭大图查看器 ----------
const lightboxState = { photos: [], index: 0, urls: [] };

function openLightbox(o) {
  const photos = (o.photos || []).filter((p) => p && p.blob);
  if (photos.length === 0) { toast('该穿搭暂无可预览的图片'); return; }
  lightboxState.photos = photos;
  lightboxState.index = 0;
  lightboxState.urls = photos.map((p) => URL.createObjectURL(p.blob));
  $('#lightbox').hidden = false;
  renderLightbox();
}

function renderLightbox() {
  const { photos, index, urls } = lightboxState;
  const img = $('#lbImg');
  img.src = urls[index];
  // 重新触发入场动画
  img.style.animation = 'none'; void img.offsetWidth; img.style.animation = '';
  $('#lbCount').textContent = `${index + 1} / ${photos.length}`;

  const dots = $('#lbDots');
  dots.innerHTML = '';
  if (photos.length > 1) {
    photos.forEach((_, i) => {
      const d = document.createElement('span');
      d.className = 'lb-dot' + (i === index ? ' active' : '');
      dots.appendChild(d);
    });
  }

  const thumbs = $('#lbThumbs');
  thumbs.innerHTML = '';
  if (photos.length > 1) {
    photos.forEach((_, i) => {
      const t = document.createElement('button');
      t.className = 'lb-thumb' + (i === index ? ' active' : '');
      t.innerHTML = `<img src="${urls[i]}" alt="">`;
      t.onclick = () => gotoLightbox(i);
      thumbs.appendChild(t);
    });
    const active = thumbs.querySelector('.active');
    if (active) active.scrollIntoView({ inline: 'center', block: 'nearest' });
  }
}

function gotoLightbox(i) {
  const n = lightboxState.photos.length;
  if (n === 0) return;
  lightboxState.index = (i + n) % n;
  renderLightbox();
}

function closeLightbox() {
  $('#lightbox').hidden = true;
  $('#lbImg').src = '';
  lightboxState.urls.forEach((u) => URL.revokeObjectURL(u));
  lightboxState.urls = [];
  lightboxState.photos = [];
  lightboxState.index = 0;
}

// 季节切换（带轻量 loading）
function switchSeason(season) {
  if (season === state.season) return;
  state.season = season;
  $$('.season-tab').forEach((t) => t.classList.toggle('active', t.dataset.season === season));
  const pr = $('#pullRefresh');
  pr.classList.add('show');
  setTimeout(async () => { await renderWardrobe(); pr.classList.remove('show'); }, 200);
}

// 衣橱右上角菜单
function openWardrobeMenu() {
  showActionSheet([{ label: '导出全部穿搭照片', onTap: exportAllPhotos }]);
}

// ---------- 创建穿搭 ----------
function enterCreate() {
  state.createSeasons = [];
  state.editingOutfitId = null;
  state.pendingPhotos = [];
  $('#seasonPicker').querySelectorAll('.sp-item').forEach((b) => b.classList.remove('active'));
  $('#seasonHint').textContent = '请选择穿搭季节（必填，可多选）';
  renderPendingPhotos();
  showView('create');
}

// 修改已有穿搭：预填数据进入创建视图
function enterEditOutfit(id) {
  getAllOutfits().then((list) => {
    const o = list.find((x) => x.id === id);
    if (!o) return;
    state.editingOutfitId = id;
    state.createSeasons = (o.seasons && o.seasons.length) ? o.seasons.slice() : [o.season];
    state.pendingPhotos = (o.photos || []).map((p) => ({
      id: p.id || uid(), name: p.name, blob: p.blob, url: URL.createObjectURL(p.blob),
    }));
    $('#seasonPicker').querySelectorAll('.sp-item').forEach((b) => b.classList.toggle('active', state.createSeasons.includes(b.dataset.season)));
    $('#seasonHint').textContent = '已选择：' + state.createSeasons.map((s) => SEASON_LABEL[s]).join('、');
    renderPendingPhotos();
    showView('create');
    $('#appbarTitle').textContent = '修改穿搭';
  });
}

function renderPendingPhotos() {
  const picker = $('#photoPicker');
  picker.querySelectorAll('.photo-item, .photo-thumb').forEach((n) => n.remove());
  const add = $('#photoAdd');
  state.pendingPhotos.forEach((p) => {
    const wrap = document.createElement('div');
    wrap.className = 'photo-item';
    wrap.innerHTML = `<img class="photo-thumb" src="${p.url}"><button class="photo-del">×</button>`;
    wrap.querySelector('.photo-del').onclick = () => {
      URL.revokeObjectURL(p.url);
      state.pendingPhotos = state.pendingPhotos.filter((x) => x.id !== p.id);
      renderPendingPhotos();
    };
    picker.insertBefore(wrap, add);
  });
}

function onPickPhotos(fileList) {
  const files = Array.from(fileList).filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type));
  if (files.length === 0) { toast('仅支持 JPG / PNG / WEBP 格式'); return; }
  files.forEach((f) => {
    state.pendingPhotos.push({ id: uid(), blob: f, name: f.name || ('photo_' + uid() + '.jpg'), url: URL.createObjectURL(f) });
  });
  renderPendingPhotos();
}

async function saveOutfit() {
  if (state.createSeasons.length === 0) { toast('请选择穿搭季节（可多选）'); return; }
  if (state.pendingPhotos.length === 0) { toast('请先添加穿搭照片'); return; }
  const isEdit = !!state.editingOutfitId;
  let createdAt = Date.now();
  if (isEdit) {
    const prev = await getOutfit(state.editingOutfitId);
    if (prev) createdAt = prev.createdAt; // 保留创建时间，顺序稳定
  }
  const outfit = {
    id: isEdit ? state.editingOutfitId : uid(),
    seasons: state.createSeasons.slice(),
    createdAt,
    photos: state.pendingPhotos.map((p) => ({ id: p.id, name: p.name, blob: p.blob })),
  };
  try {
    await putOutfit(outfit);
  } catch (e) {
    toast('图片上传失败，请重试'); return;
  }
  state.pendingPhotos.forEach((p) => URL.revokeObjectURL(p.url));
  state.pendingPhotos = [];
  state.createSeasons = [];
  state.editingOutfitId = null;
  state.season = 'all';
  $$('.season-tab').forEach((t) => t.classList.toggle('active', t.dataset.season === 'all'));
  showView('wardrobe');
  await renderWardrobe();
  toast(isEdit ? '已修改' : '穿搭已保存');
}

// ---------- 穿搭知识 ----------
async function renderKnowledge() {
  await loadCategories();
  renderCatTabs();
  const all = await getAllKnowledge();
  const list = state.knowledgeCategory === 'all'
    ? all
    : all.filter((k) => (k.category || null) === state.knowledgeCategory);
  const box = $('#knowledgeList');
  box.innerHTML = '';
  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = `<div class="empty-ill">📝</div><div class="empty-text">${state.knowledgeCategory === 'all' ? '还没有穿搭技巧，点右上角 ⋯ 新建第一条吧' : '该分类下暂无知识'}</div>`;
    box.appendChild(empty);
    return;
  }
  list.forEach((it) => {
    const catName = categoryMap[it.category] || '未分类';
    const el = document.createElement('div');
    el.className = 'k-item';
    el.innerHTML = `<span class="k-dot"></span><div class="k-main"><p class="k-title">${escapeHtml(it.title) || '（无标题）'}</p><p class="k-sub"><span class="k-cat">${escapeHtml(catName)}</span>${escapeHtml(it.content).slice(0, 30) || '（无内容）'}</p></div><span class="k-arrow">›</span>`;
    el.onclick = () => openKnowledgeEdit(it.id);
    box.appendChild(el);
  });
}

// 知识列表顶部分类标签
function renderCatTabs() {
  const box = $('#catTabs');
  if (!box) return;
  box.innerHTML = '';
  const mk = (key, label) => {
    const b = document.createElement('button');
    b.className = 'season-tab' + (state.knowledgeCategory === key ? ' active' : '');
    b.textContent = label;
    b.onclick = () => { state.knowledgeCategory = key; renderKnowledge(); };
    box.appendChild(b);
  };
  mk('all', '全部');
  categories.forEach((c) => mk(c.id, c.name));
}

// 编辑视图中的分类选择器（单选）
function renderCatPicker() {
  const box = $('#catPicker');
  if (!box) return;
  box.innerHTML = '';
  categories.forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cp-item' + (state.editingKnowledgeCategory === c.id ? ' active' : '');
    b.textContent = c.name;
    b.onclick = () => { state.editingKnowledgeCategory = c.id; renderCatPicker(); };
    box.appendChild(b);
  });
}

function openKnowledgeEdit(id) {
  state.editingKnowledgeId = id || null;
  const delBtn = $('#kDelete');
  loadCategories().then(() => {
    if (id) {
      return getAllKnowledge().then((list) => {
        const it = list.find((x) => x.id === id);
        $('#kTitle').value = it ? it.title : '';
        $('#kContent').value = it ? it.content : '';
        state.editingKnowledgeCategory = (it && it.category) || (categories[0] && categories[0].id) || null;
        delBtn.hidden = false;
        delBtn.onclick = () => showConfirm('确定删除该条穿搭知识？删除后无法恢复', async () => {
          await deleteKnowledge(id);
          showView('knowledge');
          await renderKnowledge();
          toast('已删除');
        });
      });
    } else {
      $('#kTitle').value = '';
      $('#kContent').value = '';
      state.editingKnowledgeCategory = (categories[0] && categories[0].id) || null;
      delBtn.hidden = true;
    }
  }).then(() => {
    renderCatPicker();
    showView('knowledge-edit');
  });
}

async function saveKnowledge() {
  const title = $('#kTitle').value.trim();
  const content = $('#kContent').value.trim();
  if (!title) { toast('请填写知识标题'); return; }
  if (!state.editingKnowledgeCategory) { toast('请选择知识分类'); return; }
  const isEdit = !!state.editingKnowledgeId;
  let createdAt = Date.now();
  if (isEdit) {
    const prev = (await getAllKnowledge()).find((x) => x.id === state.editingKnowledgeId);
    if (prev) createdAt = prev.createdAt;
  }
  const item = {
    id: state.editingKnowledgeId || uid(),
    title, content,
    category: state.editingKnowledgeCategory,
    createdAt,
  };
  await putKnowledge(item);
  showView('knowledge');
  await renderKnowledge();
  toast('已保存');
}

function openKnowledgeMenu() {
  showActionSheet([
    { label: '新建穿搭知识', onTap: () => openKnowledgeEdit(null) },
    { label: '管理分类', onTap: openCatManager },
    { label: '导出穿搭知识库', onTap: exportKnowledgeDoc },
  ]);
}

// ---------- 分类管理 ----------
function openCatManager() {
  renderCatManager();
  $('#catMask').hidden = false;
}
function renderCatManager() {
  const box = $('#catList');
  box.innerHTML = '';
  categories.forEach((c) => {
    const row = document.createElement('div');
    row.className = 'cat-row';
    const name = document.createElement('span');
    name.className = 'cat-name';
    name.textContent = c.name;
    const del = document.createElement('button');
    del.className = 'cat-del';
    del.textContent = '删除';
    del.onclick = () => confirmDeleteCategory(c.id, c.name);
    row.appendChild(name);
    row.appendChild(del);
    box.appendChild(row);
  });
}
async function confirmDeleteCategory(id, name) {
  if (categories.length <= 1) { toast('至少保留一个分类'); return; }
  showConfirm(`确定删除分类「${name}」？该分类下的知识将归入「未分类」`, async () => {
    await deleteCategory(id);
    const all = await getAllKnowledge();
    for (const k of all) {
      if (k.category === id) { k.category = null; await putKnowledge(k); }
    }
    await loadCategories();
    renderCatManager();
    renderKnowledge();
    toast('已删除分类');
  });
}
async function addCategory() {
  const input = $('#catNewInput');
  const name = input.value.trim();
  if (!name) { toast('请输入分类名称'); return; }
  if (categories.some((c) => c.name === name)) { toast('分类已存在'); return; }
  const cat = { id: uid(), name, order: categories.length };
  await putCategory(cat);
  input.value = '';
  await loadCategories();
  renderCatManager();
  toast('已添加分类');
}

// ---------- 导出：全部穿搭照片 ZIP ----------
async function exportAllPhotos() {
  const all = await getAllOutfits();

  // 按季节归并（支持一个穿搭属于多个季节，照片进入每个对应文件夹）
  const bySeason = {};
  all.forEach((o) => {
    const seasons = (o.seasons && o.seasons.length) ? o.seasons : [o.season];
    (o.photos || []).forEach((p) => seasons.forEach((s) => {
      (bySeason[s] = bySeason[s] || []).push(p);
    }));
  });
  const folders = Object.keys(bySeason);
  let total = 0;
  folders.forEach((s) => total += bySeason[s].length);
  if (total === 0) { toast('暂无穿搭照片，无需导出'); return; }

  showProgress('正在打包穿搭照片…');
  try {
    // 组装条目（每个季节文件夹内从 1 重新计数，无内容季节自动忽略）
    const meta = [];
    folders.forEach((s) => {
      const folder = FOLDER_NAME[s];
      bySeason[s].forEach((p, i) => {
        const base = sanitize(p.name) || ('photo_' + (meta.length + 1) + '.jpg');
        meta.push({ name: `${folder}/${i + 1}_${base}`, blob: p.blob });
      });
    });

    const realEntries = [];
    for (let i = 0; i < meta.length; i++) {
      const bytes = await blobToBytes(meta[i].blob);
      realEntries.push({ name: meta[i].name, data: bytes });
      updateProgress((i + 1) / meta.length);
      if ((i & 7) === 0) await new Promise((r) => setTimeout(r, 0));
    }

    const blob = await buildZip(realEntries, updateProgress);
    const filename = `穿搭柜_全部穿搭_${fmtStamp()}.zip`;
    hideProgress();
    await shareOrDownload(blob, filename, 'application/zip');
  } catch (err) {
    hideProgress();
    toast('导出失败，请重试');
  }
}

function sanitize(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');
}

// ---------- 导出：穿搭知识库 Word ----------
async function exportKnowledgeDoc() {
  await loadCategories();
  const list = await getAllKnowledge();
  if (list.length === 0) { toast('暂无穿搭技巧内容，无需导出'); return; }
  const enriched = list.map((k) => ({ ...k, categoryLabel: categoryMap[k.category] || '未分类' }));
  const blob = buildWordDoc(enriched);
  const filename = `穿搭柜_穿搭技巧知识库_${fmtStamp()}.doc`;
  await shareOrDownload(blob, filename, 'application/msword');
}

// ---------- 系统分享 / 本地下载 ----------
async function shareOrDownload(blob, filename, mime) {
  const file = new File([blob], filename, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return; // 用户取消
    }
  }
  // 回退：本地下载
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('已保存到本地');
}

// ---------- 公共 ----------
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---------- 事件绑定 ----------
function bindEvents() {
  // 底部导航
  $$('.tab').forEach((t) => {
    t.onclick = () => {
      const v = t.dataset.view;
      if (v === 'create') { enterCreate(); return; }
      if (v === 'wardrobe') { showView('wardrobe'); renderWardrobe(); return; }
      if (v === 'knowledge') { showView('knowledge'); renderKnowledge(); return; }
    };
  });
  $('#createBtn').onclick = enterCreate;
  $('#appbarBack').onclick = () => {
    if (state.view === 'create') {
      state.pendingPhotos.forEach((p) => URL.revokeObjectURL(p.url));
      state.pendingPhotos = []; state.createSeasons = []; state.editingOutfitId = null;
      showView('wardrobe'); renderWardrobe();
    }
    else if (state.view === 'knowledge-edit') {
      if (state.editingKnowledgeId) { showView('knowledge'); renderKnowledge(); }
      else { showView('knowledge'); renderKnowledge(); }
    }
  };

  // 季节标签
  $$('.season-tab').forEach((t) => t.onclick = () => switchSeason(t.dataset.season));

  // 创建：季节多选
  $$('#seasonPicker .sp-item').forEach((b) => {
    b.onclick = () => {
      const s = b.dataset.season;
      const idx = state.createSeasons.indexOf(s);
      if (idx >= 0) state.createSeasons.splice(idx, 1);
      else state.createSeasons.push(s);
      b.classList.toggle('active', state.createSeasons.includes(s));
      $('#seasonHint').textContent = state.createSeasons.length
        ? '已选择：' + state.createSeasons.map((x) => SEASON_LABEL[x]).join('、')
        : '请选择穿搭季节（必填，可多选）';
    };
  });

  // 创建：照片选择
  $('#photoInput').onchange = (e) => { onPickPhotos(e.target.files); e.target.value = ''; };

  // 知识编辑的保存按钮已绑定在 appbar action（showView 中）

  // 分类管理弹窗
  $('#catAddBtn').onclick = addCategory;
  $('#catNewInput').onkeydown = (e) => { if (e.key === 'Enter') addCategory(); };
  $('#catClose').onclick = () => { $('#catMask').hidden = true; };
  $('#catMask').onclick = (e) => { if (e.target === $('#catMask')) $('#catMask').hidden = true; };

  // 下拉刷新（PRD 6.2）：在衣橱/知识列表顶部下拉触发刷新
  const content = $('#content');
  let pullStartY = 0, pullActive = false;
  content.addEventListener('touchstart', (e) => {
    pullActive = (content.scrollTop <= 0);
    if (pullActive) pullStartY = e.touches[0].clientY;
  }, { passive: true });
  content.addEventListener('touchmove', (e) => {
    if (!pullActive || content.scrollTop > 0) return;
    const dy = e.touches[0].clientY - pullStartY;
    if (dy > 12) {
      const pr = $('#pullRefresh');
      pr.classList.add('show');
      pr.textContent = dy > 70 ? '释放立即刷新' : '下拉刷新…';
    }
  }, { passive: true });
  content.addEventListener('touchend', (e) => {
    if (!pullActive) return;
    const dy = e.changedTouches[0].clientY - pullStartY;
    const pr = $('#pullRefresh');
    const wasPull = pr.classList.contains('show');
    pr.classList.remove('show'); pr.textContent = '';
    if (wasPull && dy > 70) doRefresh();
    pullActive = false;
  });

  // 大图查看器：左右滑动切换 / 关闭 / 键盘
  const stage = $('#lbStage');
  let lbStartX = 0, lbStartY = 0;
  stage.addEventListener('touchstart', (e) => {
    lbStartX = e.touches[0].clientX; lbStartY = e.touches[0].clientY;
  }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if ($('#lightbox').hidden) return;
    const dx = e.changedTouches[0].clientX - lbStartX;
    const dy = e.changedTouches[0].clientY - lbStartY;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
      gotoLightbox(lightboxState.index + (dx < 0 ? 1 : -1));
    }
  }, { passive: true });
  $('#lbClose').onclick = closeLightbox;
  $('#lightbox').onclick = (e) => { if (e.target === $('#lightbox')) closeLightbox(); };
  document.addEventListener('keydown', (e) => {
    if ($('#lightbox').hidden) return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowRight') gotoLightbox(lightboxState.index + 1);
    else if (e.key === 'ArrowLeft') gotoLightbox(lightboxState.index - 1);
  });
}

function doRefresh() {
  const pr = $('#pullRefresh');
  pr.classList.add('show');
  pr.innerHTML = '<span class="spinner"></span>刷新中…';
  setTimeout(async () => {
    if (state.view === 'wardrobe') await renderWardrobe();
    else if (state.view === 'knowledge') await renderKnowledge();
    pr.classList.remove('show');
    pr.textContent = '';
    toast('已刷新');
  }, 250);
}

// ---------- 启动 ----------
function init() {
  bindEvents();
  showView('wardrobe');
  renderWardrobe();
  // 注册 Service Worker：支持「添加到主屏幕」后离线启动、秒开（原生般体验）
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 忽略：不影响正常使用 */ });
  }
}

document.addEventListener('DOMContentLoaded', init);
