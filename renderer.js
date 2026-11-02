'use strict';

const PAGE_WIDTH = 900;
const canvas = document.getElementById('canvas');
const canvasWrap = document.getElementById('canvas-wrap');

const uid = () => Math.random().toString(36).slice(2, 10);
const _measureCanvas = document.createElement('canvas');
const _measureCtx = _measureCanvas.getContext('2d');

const state = {
  project: null,
  tool: 'brush',
  brush: { color: '#000', size: 4, opacity: 1, dash: 'solid', startCap: 'none', endCap: 'none' },
  shape: { shape: 'rect', color: '#000', size: 2, opacity: 1, dash: 'solid' },
  text: { font: 'sans-serif', size: 18, bold: false, italic: false, underline: false, align: 'left', color: '#000', bg: null },
  eraser: { size: 20, mode: 'erase' },
  fill: { color: '#000' },
  timerErase: { enabled: false, seconds: 5 },
  selection: null,
  selectMode: 1,
  pendingTable: null,
  selectedCell: null,
};

let dragState = null;
let tempObj = null;
const imageCache = {};

// ------- utils -------
function getImage(src) {
  if (imageCache[src]) return imageCache[src];
  const img = new Image();
  img._ready = false;
  img.onload = () => {
    img._ready = true;
    renderPage(currentPage());
    scheduleThumb(currentPage());
  };
  img.src = src;
  imageCache[src] = img;
  return img;
}

function currentPage() { return state.project?.pages[state.project.currentPageId] || null; }
function getGroup(id) { return state.project.groups.find(g => g.id === id); }

function dashArray(dash, size) {
  const s = Math.max(1, size);
  switch (dash) {
    case 'dashed': return [s * 3, s * 2];
    case 'dotted': return [1, s * 2];
    case 'dashdot': return [s * 3, s * 2, 1, s * 2];
    default: return [];
  }
}

function hexToRgb(hex) {
  hex = hex.replace('#','');
  if (hex.length === 3) hex = hex.split('').map(c => c+c).join('');
  const n = parseInt(hex, 16);
  return { r: (n>>16)&255, g: (n>>8)&255, b: n&255 };
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 1800);
}

function sanitizeFilename(s) {
  return (s || 'page').replace(/[\\/:*?"<>|]/g, '_').slice(0, 100);
}

// ------- draw -------
function drawObject(ctx, o) {
  switch (o.type) {
    case 'stroke': return drawStroke(ctx, o);
    case 'line':   return drawLine(ctx, o);
    case 'shape':  return drawShape(ctx, o);
    case 'text':   return drawText(ctx, o);
    case 'image':  return drawImage(ctx, o);
    case 'table':  return drawTable(ctx, o);
    case 'fill':   return drawFill(ctx, o);
  }
}

function drawStroke(ctx, o) {
  if (!o.points || o.points.length === 0) return;
  ctx.save();
  ctx.globalAlpha = o.opacity ?? 1;
  ctx.strokeStyle = o.color;
  ctx.fillStyle = o.color;
  ctx.lineWidth = o.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(dashArray(o.dash, o.size));
  if (o.points.length === 1) {
    ctx.beginPath();
    ctx.arc(o.points[0].x, o.points[0].y, o.size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(o.points[0].x, o.points[0].y);
  for (let i = 1; i < o.points.length; i++) ctx.lineTo(o.points[i].x, o.points[i].y);
  ctx.stroke();
  ctx.setLineDash([]);
  const n = o.points.length;
  if (o.startCap && o.startCap !== 'none') drawCap(ctx, o.startCap, o.points[1], o.points[0], o.size);
  if (o.endCap && o.endCap !== 'none') drawCap(ctx, o.endCap, o.points[n - 2], o.points[n - 1], o.size);
  ctx.restore();
}

function drawCap(ctx, type, prev, p, size) {
  const ang = Math.atan2(p.y - prev.y, p.x - prev.x);
  ctx.save();
  ctx.setLineDash([]);
  ctx.translate(p.x, p.y);
  ctx.rotate(ang);
  const s = Math.max(size * 2.5, 6);
  switch (type) {
    case 'square': ctx.fillRect(-s/2, -s/2, s, s); break;
    case 'circle': ctx.beginPath(); ctx.arc(0, 0, s/2, 0, Math.PI*2); ctx.fill(); break;
    case 'arrow': {
      const a = s * 1.6;
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(-a, -a/2.5); ctx.lineTo(-a, a/2.5);
      ctx.closePath(); ctx.fill(); break;
    }
  }
  ctx.restore();
}

function drawLine(ctx, o) {
  ctx.save();
  ctx.globalAlpha = o.opacity ?? 1;
  ctx.strokeStyle = o.color;
  ctx.fillStyle = o.color;
  ctx.lineWidth = o.size;
  ctx.lineCap = 'round';
  ctx.setLineDash(dashArray(o.dash, o.size));
  ctx.beginPath();
  ctx.moveTo(o.x1, o.y1);
  ctx.lineTo(o.x2, o.y2);
  ctx.stroke();
  ctx.setLineDash([]);
  if (o.startCap && o.startCap !== 'none') {
    drawCap(ctx, o.startCap, { x: o.x2, y: o.y2 }, { x: o.x1, y: o.y1 }, o.size);
  }
  if (o.endCap && o.endCap !== 'none') {
    drawCap(ctx, o.endCap, { x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }, o.size);
  }
  ctx.restore();
}

function drawShape(ctx, o) {
  if (o.w <= 0 || o.h <= 0) return;
  ctx.save();
  ctx.globalAlpha = o.opacity ?? 1;
  ctx.strokeStyle = o.color;
  ctx.fillStyle = o.color;
  ctx.lineWidth = o.size;
  ctx.setLineDash(dashArray(o.dash, o.size));
  const { x, y, w, h } = o;
  const cx = x + w / 2, cy = y + h / 2;
  ctx.beginPath();
  switch (o.shape) {
    case 'circle':
    case 'center-circle':
      ctx.arc(cx, cy, Math.min(w, h) / 2, 0, Math.PI * 2); break;
    case 'square': {
      const s = Math.min(w, h);
      ctx.rect(x, y, s, s); break;
    }
    case 'rect': ctx.rect(x, y, w, h); break;
    case 'tri-eq':
      ctx.moveTo(cx, y); ctx.lineTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.closePath(); break;
    case 'tri-right':
      ctx.moveTo(x, y); ctx.lineTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.closePath(); break;
    case 'semicircle':
      ctx.arc(cx, y + h, w / 2, Math.PI, 0); ctx.closePath(); break;
  }
  ctx.stroke();
  if (o.shape === 'center-circle') {
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(2, o.size), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function recomputeTextSize(o) {
  _measureCtx.font = `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${o.size}px ${o.font}`;
  const lines = (o.text || '').split('\n');
  let maxW = 0;
  for (const ln of lines) maxW = Math.max(maxW, _measureCtx.measureText(ln).width);
  o.w = maxW + 8;
  o.h = o.size * 1.25 * lines.length + 4;
}

function drawText(ctx, o) {
  ctx.save();
  ctx.globalAlpha = o.opacity ?? 1;
  if (o.rotation) {
    ctx.translate(o.x + o.w / 2, o.y + o.h / 2);
    ctx.rotate((o.rotation * Math.PI) / 180);
    ctx.translate(-(o.x + o.w / 2), -(o.y + o.h / 2));
  }
  if (o.bg) {
    ctx.fillStyle = o.bg;
    ctx.fillRect(o.x, o.y, o.w, o.h);
  }
  const style = `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${o.size}px ${o.font}`;
  ctx.font = style;
  ctx.fillStyle = o.color || '#000';
  ctx.textBaseline = 'top';
  ctx.textAlign = o.align === 'center' ? 'center' : o.align === 'right' ? 'right' : 'left';
  const tx = o.align === 'center' ? o.x + o.w / 2 : o.align === 'right' ? o.x + o.w : o.x;
  let y = o.y;
  for (const line of (o.text || '').split('\n')) {
    ctx.fillText(line, tx, y);
    if (o.underline) {
      const m = ctx.measureText(line);
      const ux = o.align === 'center' ? tx - m.width / 2 : o.align === 'right' ? tx - m.width : tx;
      ctx.beginPath();
      ctx.moveTo(ux, y + o.size);
      ctx.lineTo(ux + m.width, y + o.size);
      ctx.strokeStyle = o.color || '#000';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    y += o.size * 1.25;
  }
  ctx.restore();
}

function drawImage(ctx, o) {
  const img = getImage(o.src);
  if (!img._ready) return;
  ctx.save();
  ctx.globalAlpha = o.opacity ?? 1;
  if (o.rotation) {
    ctx.translate(o.x + o.w / 2, o.y + o.h / 2);
    ctx.rotate((o.rotation * Math.PI) / 180);
    ctx.translate(-(o.x + o.w / 2), -(o.y + o.h / 2));
  }
  ctx.drawImage(img, o.x, o.y, o.w, o.h);
  ctx.restore();
}

function drawFill(ctx, o) {
  const img = getImage(o.src);
  if (!img._ready) return;
  ctx.drawImage(img, o.x, o.y, o.w, o.h);
}

function cellAt(o, r, c) {
  for (const m of (o.merges || [])) {
    if (r >= m.r && r < m.r + m.rh && c >= m.c && c < m.c + m.cw) return m;
  }
  return { r, c, rh: 1, cw: 1 };
}

function drawTable(ctx, o) {
  ctx.save();
  ctx.globalAlpha = o.opacity ?? 1;
  ctx.strokeStyle = o.color || '#333';
  ctx.lineWidth = o.size || 1;
  ctx.setLineDash([]);
  const hEdges = new Set(), vEdges = new Set();
  for (let r = 0; r < o.rows; r++) {
    for (let c = 0; c < o.cols; c++) {
      const cell = cellAt(o, r, c);
      const { r: cr, c: cc, rh, cw } = cell;
      if (r === cr) for (let i = 0; i < cw; i++) hEdges.add(`${cr},${cc + i}`);
      if (r === cr + rh - 1) for (let i = 0; i < cw; i++) hEdges.add(`${cr + rh},${cc + i}`);
      if (c === cc) for (let i = 0; i < rh; i++) vEdges.add(`${cr + i},${cc}`);
      if (c === cc + cw - 1) for (let i = 0; i < rh; i++) vEdges.add(`${cr + i},${cc + cw}`);
    }
  }
  ctx.beginPath();
  for (const e of hEdges) {
    const [r, c] = e.split(',').map(Number);
    const y = o.y + r * o.cellH;
    ctx.moveTo(o.x + c * o.cellW, y);
    ctx.lineTo(o.x + (c + 1) * o.cellW, y);
  }
  for (const e of vEdges) {
    const [r, c] = e.split(',').map(Number);
    const x = o.x + c * o.cellW;
    ctx.moveTo(x, o.y + r * o.cellH);
    ctx.lineTo(x, o.y + (r + 1) * o.cellH);
  }
  ctx.stroke();
  ctx.restore();
}

// ------- hit testing -------
function bboxOf(o) {
  if (o.type === 'stroke') {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of o.points) {
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    }
    const pad = (o.size || 1) / 2;
    return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
  }
  if (o.type === 'line') {
    return { x: Math.min(o.x1, o.x2), y: Math.min(o.y1, o.y2), w: Math.abs(o.x2 - o.x1), h: Math.abs(o.y2 - o.y1) };
  }
  if (o.type === 'table') {
    return { x: o.x, y: o.y, w: o.cols * o.cellW, h: o.rows * o.cellH };
  }
  return { x: o.x, y: o.y, w: o.w, h: o.h };
}

function segDist(a, b, p) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function hitTest(o, x, y) {
  if (o.type === 'stroke') {
    const r = Math.max(4, (o.size || 1) / 2 + 2);
    for (let i = 1; i < o.points.length; i++) {
      if (segDist(o.points[i - 1], o.points[i], { x, y }) < r) return true;
    }
    if (o.points.length === 1 && Math.hypot(o.points[0].x - x, o.points[0].y - y) < r) return true;
    return false;
  }
  if (o.type === 'line') {
    return segDist({ x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }, { x, y }) < Math.max(4, (o.size || 1) / 2 + 2);
  }
  const b = bboxOf(o);
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

function hitTestStack(page, x, y) {
  for (let i = page.objects.length - 1; i >= 0; i--) {
    const o = page.objects[i];
    if (state.selectMode === 1 && o.type === 'image' && o.isBackdrop) continue;
    if (hitTest(o, x, y)) return o;
  }
  return null;
}

// ------- resize handles -------
function canResize(o) {
  return o.type === 'image' || o.type === 'shape';
}

function handlePositions(b) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  return {
    nw: [b.x, b.y], n: [cx, b.y], ne: [b.x + b.w, b.y],
    w:  [b.x, cy],                  e: [b.x + b.w, cy],
    sw: [b.x, b.y + b.h], s: [cx, b.y + b.h], se: [b.x + b.w, b.y + b.h],
  };
}

function hitResizeHandle(o, x, y) {
  if (!canResize(o)) return null;
  const b = bboxOf(o);
  const pad = 8;
  for (const [k, [hx, hy]] of Object.entries(handlePositions(b))) {
    if (Math.abs(x - hx) <= pad && Math.abs(y - hy) <= pad) return k;
  }
  return null;
}

function handleCursor(h) {
  if (h === 'nw' || h === 'se') return 'nwse-resize';
  if (h === 'ne' || h === 'sw') return 'nesw-resize';
  if (h === 'n' || h === 's') return 'ns-resize';
  if (h === 'e' || h === 'w') return 'ew-resize';
  return '';
}

function applyResize(o, orig, handle, dx, dy, shift) {
  let x = orig.x, y = orig.y, w = orig.w, h = orig.h;
  if (handle.includes('w')) { x = orig.x + dx; w = orig.w - dx; }
  if (handle.includes('e')) { w = orig.w + dx; }
  if (handle.includes('n')) { y = orig.y + dy; h = orig.h - dy; }
  if (handle.includes('s')) { h = orig.h + dy; }
  if (w < 10) w = 10;
  if (h < 10) h = 10;

  const lockAspect = shift || (o.type === 'image' && o._keepAspect !== false);
  if (lockAspect && orig.w > 0 && orig.h > 0) {
    const aspect = orig.w / orig.h;
    if (handle === 'nw' || handle === 'ne' || handle === 'sw' || handle === 'se') {
      if (Math.abs(w / orig.w - 1) > Math.abs(h / orig.h - 1)) h = w / aspect;
      else w = h * aspect;
      if (handle.includes('w')) x = orig.x + orig.w - w;
      if (handle.includes('n')) y = orig.y + orig.h - h;
    } else if (handle === 'n' || handle === 's') {
      w = h * aspect;
      x = orig.x + (orig.w - w) / 2;
    } else if (handle === 'e' || handle === 'w') {
      h = w / aspect;
      y = orig.y + (orig.h - h) / 2;
    }
  }

  o.x = x; o.y = y; o.w = w; o.h = h;
}

// ------- priorities & insertion -------
function priorityOf(obj, group) {
  if (obj.type === 'image' && obj.isBackdrop) return group.priority.back;
  if (obj.type === 'image') return group.priority.image;
  if (obj.type === 'text') return group.priority.text;
  return group.priority.ink;
}

function insertByPriority(page, obj) {
  const group = getGroup(page.groupId);
  const p = priorityOf(obj, group);
  let idx = page.objects.length;
  for (let i = 0; i < page.objects.length; i++) {
    if (priorityOf(page.objects[i], group) > p) { idx = i; break; }
  }
  page.objects.splice(idx, 0, obj);
}

function resortGroupObjects(group) {
  const pages = Object.values(state.project.pages).filter(p => p.groupId === group.id);
  for (const page of pages) {
    pushUndo(page);
    page.objects.sort((a, b) => priorityOf(a, group) - priorityOf(b, group));
  }
  markDirty();
  renderAll();
  toast('Объекты пересортированы');
}

// ------- page render -------
function drawResizeHandles(ctx, b) {
  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#06f';
  ctx.lineWidth = 1;
  for (const [, [x, y]] of Object.entries(handlePositions(b))) {
    ctx.fillRect(x - 4, y - 4, 8, 8);
    ctx.strokeRect(x - 4, y - 4, 8, 8);
  }
  ctx.restore();
}

function renderPage(page) {
  if (!page) {
    canvas.width = PAGE_WIDTH; canvas.height = 400;
    canvas.style.width = PAGE_WIDTH + 'px';
    canvas.style.height = '400px';
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }
  canvas.width = PAGE_WIDTH;
  canvas.height = page.height;
  canvas.style.width = PAGE_WIDTH + 'px';
  canvas.style.height = page.height + 'px';
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const o of page.objects) drawObject(ctx, o);
  if (tempObj) drawObject(ctx, tempObj);
  if (state.selection) {
    const o = page.objects.find(x => x.id === state.selection);
    if (o) {
      const b = bboxOf(o);
      ctx.save();
      ctx.strokeStyle = '#06f';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.strokeRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4);
      ctx.restore();
      if (canResize(o)) drawResizeHandles(ctx, b);
    }
  }
  if (state.selectedCell && state.selectedCell.objId) {
    const o = page.objects.find(x => x.id === state.selectedCell.objId);
    if (o && o.type === 'table') {
      const { r, c } = state.selectedCell;
      ctx.save();
      ctx.strokeStyle = '#f80';
      ctx.lineWidth = 2;
      ctx.strokeRect(o.x + c * o.cellW, o.y + r * o.cellH, o.cellW, o.cellH);
      ctx.restore();
    }
  }
}

// ------- history -------
function makeSnapshot(page) {
  return JSON.stringify({ height: page.height, objects: page.objects });
}

function pushUndo(page) {
  page.undo.push(makeSnapshot(page));
  if (page.undo.length > 100) page.undo.shift();
  page.redo.length = 0;
  markDirty();
}

function restoreSnapshot(page, snap) {
  const data = JSON.parse(snap);
  page.height = data.height;
  page.objects = data.objects;
}

function undo() {
  const page = currentPage();
  if (!page || page.undo.length === 0) return;
  page.redo.push(makeSnapshot(page));
  restoreSnapshot(page, page.undo.pop());
  cancelTimersForPage(page);
  state.selection = null;
  state.selectedCell = null;
  markDirty();
  renderAll();
}

function redo() {
  const page = currentPage();
  if (!page || page.redo.length === 0) return;
  page.undo.push(makeSnapshot(page));
  restoreSnapshot(page, page.redo.pop());
  state.selection = null;
  state.selectedCell = null;
  markDirty();
  renderAll();
}

function cancelTimersForPage(page) {
  if (page._timers) {
    for (const t of page._timers) clearTimeout(t);
    page._timers = [];
  }
}

// ------- autoerase timers -------
function scheduleErase(page, obj, startedAt) {
  if (!state.timerErase.enabled) return;
  const remaining = Math.max(0, state.timerErase.seconds * 1000 - (Date.now() - startedAt));
  if (!page._timers) page._timers = [];
  const t = setTimeout(() => {
    const idx = page.objects.indexOf(obj);
    if (idx >= 0) {
      page.objects.splice(idx, 1);
      markDirty();
      renderAll();
    }
  }, remaining);
  page._timers.push(t);
}

// ------- project / pages / groups -------
let dirty = false;
function markDirty() { dirty = true; }

function newProject() {
  const groupId = uid();
  const pageId = uid();
  return {
    path: null,
    groups: [{
      id: groupId, name: 'Группа 1', collapsed: false, showPriority: false,
      priority: { back: 0, ink: 1, image: 2, text: 3 },
    }],
    pages: { [pageId]: { id: pageId, groupId, height: 1200, objects: [], undo: [], redo: [], _timers: [] } },
    pageOrder: [pageId],
    currentPageId: pageId,
  };
}

function addPageAfter() {
  const cur = currentPage();
  const groupId = cur ? cur.groupId : state.project.groups[0].id;
  const id = uid();
  state.project.pages[id] = { id, groupId, height: 1200, objects: [], undo: [], redo: [], _timers: [] };
  if (cur) {
    const idx = state.project.pageOrder.indexOf(cur.id);
    state.project.pageOrder.splice(idx + 1, 0, id);
  } else state.project.pageOrder.push(id);
  state.project.currentPageId = id;
  state.selection = null;
  markDirty();
  renderAll();
}

function delCurrentPage() {
  if (state.project.pageOrder.length <= 1) { toast('Последнюю страницу удалить нельзя'); return; }
  const cur = currentPage();
  if (!cur) return;
  cancelTimersForPage(cur);
  const idx = state.project.pageOrder.indexOf(cur.id);
  state.project.pageOrder.splice(idx, 1);
  delete state.project.pages[cur.id];
  state.project.currentPageId = state.project.pageOrder[Math.max(0, idx - 1)];
  state.selection = null;
  state.selectedCell = null;
  markDirty();
  renderAll();
}

function gotoPrev() {
  const idx = state.project.pageOrder.indexOf(state.project.currentPageId);
  if (idx > 0) {
    state.project.currentPageId = state.project.pageOrder[idx - 1];
    state.selection = null; state.selectedCell = null;
    renderAll();
  }
}
function gotoNext() {
  const idx = state.project.pageOrder.indexOf(state.project.currentPageId);
  if (idx < state.project.pageOrder.length - 1) {
    state.project.currentPageId = state.project.pageOrder[idx + 1];
    state.selection = null; state.selectedCell = null;
    renderAll();
  }
}

function addGroup() {
  const id = uid();
  state.project.groups.push({
    id, name: 'Новая группа', collapsed: false, showPriority: false,
    priority: { back: 0, ink: 1, image: 2, text: 3 },
  });
  markDirty();
  renderLeftPanel();
}

// ------- options bar -------
const optionsbar = document.getElementById('optionsbar');

function mkBtn(text, onClick, opts = {}) {
  const b = document.createElement('button');
  b.textContent = text;
  if (opts.title) b.title = opts.title;
  if (opts.active) b.classList.add('active');
  b.addEventListener('click', onClick);
  return b;
}

function mkRange(min, max, value, step, onInput) {
  const wrap = document.createElement('span');
  wrap.style.display = 'inline-flex';
  wrap.style.alignItems = 'center';
  wrap.style.gap = '4px';

  const r = document.createElement('input');
  r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = value;
  r.style.width = '100px';

  const n = document.createElement('input');
  n.type = 'number'; n.min = min; n.max = max; n.step = step; n.value = value;
  n.style.width = '56px';
  n.style.background = '#2b2d30';
  n.style.color = '#ddd';
  n.style.border = '1px solid #3a3d41';
  n.style.borderRadius = '4px';
  n.style.padding = '2px 4px';
  n.style.font = 'inherit';

  const clamp = (v) => Math.max(min, Math.min(max, Number(v)));
  const sync = (v) => {
    const c = clamp(v);
    if (isNaN(c)) return;
    r.value = c;
    n.value = c;
    onInput(c);
  };
  r.addEventListener('input', () => sync(r.value));
  n.addEventListener('input', () => { if (n.value !== '') sync(n.value); });
  n.addEventListener('change', () => { if (n.value === '') { n.value = r.value; } else sync(n.value); });

  wrap.append(r, n);
  return wrap;
}

function mkLabel(text) {
  const s = document.createElement('span');
  s.className = 'lbl'; s.textContent = text;
  return s;
}

function mkSelect(options, current, onChange) {
  const s = document.createElement('select');
  for (const o of options) {
    const opt = document.createElement('option');
    if (Array.isArray(o)) { opt.value = o[0]; opt.textContent = o[1]; }
    else { opt.value = o; opt.textContent = o; }
    if (String(current) === opt.value) opt.selected = true;
    s.appendChild(opt);
  }
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

function mkColorPicker(current, onPick, opts = {}) {
  const wrap = document.createElement('span');
  wrap.style.display = 'inline-flex';
  wrap.style.alignItems = 'center';
  wrap.style.gap = '3px';
  wrap.style.flexWrap = 'wrap';

  const COLORS = ['#000000', '#e53935', '#43a047', '#1e88e5', '#fdd835', '#8e24aa'];
  for (const c of COLORS) {
    const b = document.createElement('button');
    b.className = 'color' + (current.toLowerCase() === c ? ' active' : '');
    b.style.background = c;
    b.title = c;
    b.addEventListener('click', () => onPick(c, 'solid'));
    wrap.appendChild(b);
  }
  if (opts.dashed) {
    for (const c of COLORS) {
      const b = document.createElement('button');
      b.className = 'color dash';
      b.style.background = c;
      b.title = c + ' (пунктир)';
      b.addEventListener('click', () => onPick(c, 'dashed'));
      wrap.appendChild(b);
    }
  }
  const ci = document.createElement('input');
  ci.type = 'color';
  ci.value = current;
  ci.title = 'Палитра / пипетка';
  ci.style.width = '28px';
  ci.style.height = '22px';
  ci.style.padding = '0';
  ci.style.border = '1px solid #3a3d41';
  ci.style.borderRadius = '4px';
  ci.style.background = 'transparent';
  ci.style.cursor = 'pointer';
  ci.addEventListener('input', () => onPick(ci.value, opts.dashed ? 'dashed' : 'solid'));
  wrap.appendChild(ci);
  return wrap;
}

function mkCheckbox(label, checked, onChange) {
  const lbl = document.createElement('label');
  lbl.style.display = 'inline-flex';
  lbl.style.alignItems = 'center';
  lbl.style.gap = '4px';
  lbl.style.cursor = 'pointer';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = !!checked;
  cb.addEventListener('change', () => onChange(cb.checked));
  lbl.append(cb, document.createTextNode(label));
  return lbl;
}

function capSelectObj(cur, onChange) {
  return mkSelect([['none','—'],['square','■'],['circle','●'],['arrow','▶']], cur, onChange);
}

function objectPropertyEditors(page, o) {
  let undoPushed = false;
  const beginEdit = () => { if (!undoPushed) { pushUndo(page); undoPushed = true; } };
  const endEdit = () => { undoPushed = false; };
  const refresh = () => { markDirty(); renderPage(page); scheduleThumb(page); };
  const atomic = (fn) => { pushUndo(page); fn(); refresh(); renderOptionsBar(); };

  const liveRange = (min, max, val, step, apply) => {
    const span = mkRange(min, max, val, step, v => { beginEdit(); apply(v); refresh(); });
    const r = span.querySelector('input[type=range]');
    const n = span.querySelector('input[type=number]');
    if (r) r.addEventListener('change', endEdit);
    if (n) n.addEventListener('change', endEdit);
    return span;
  };

  const els = [];

  if (o.type === 'text') {
    els.push(
      mkBtn('✎ Изменить текст', () => {
        const active = document.querySelector('.text-editor');
        if (active) active.blur();
        setTimeout(() => openTextEditor(null, o), 0);
      }, { title: 'Открыть редактор для правки текста' }),
      mkLabel('Шрифт'),
      mkSelect(['sans-serif','serif','monospace','Arial','Times New Roman','Courier New'],
        o.font, v => atomic(() => { o.font = v; recomputeTextSize(o); })),
      mkLabel('Размер'),
      liveRange(8, 96, o.size, 1, v => { o.size = v; recomputeTextSize(o); }),
      mkBtn('Ж', () => atomic(() => { o.bold = !o.bold; recomputeTextSize(o); }), { active: o.bold }),
      mkBtn('К', () => atomic(() => { o.italic = !o.italic; recomputeTextSize(o); }), { active: o.italic }),
      mkBtn('Ч', () => atomic(() => { o.underline = !o.underline; recomputeTextSize(o); }), { active: o.underline }),
      mkBtn('≡L', () => atomic(() => o.align = 'left'), { active: o.align === 'left' }),
      mkBtn('≡C', () => atomic(() => o.align = 'center'), { active: o.align === 'center' }),
      mkBtn('≡R', () => atomic(() => o.align = 'right'), { active: o.align === 'right' }),
      mkLabel('Цвет'),
      mkColorPicker(o.color, c => atomic(() => o.color = c)),
      mkLabel('Фон'),
      mkColorPicker(o.bg || '#ffffff', c => atomic(() => o.bg = c)),
    );
    if (o.bg) els.push(mkBtn('Без фона', () => atomic(() => o.bg = null)));
    els.push(mkLabel('Прозр.'), liveRange(0.05, 1, o.opacity ?? 1, 0.05, v => o.opacity = v));

  } else if (o.type === 'stroke' || o.type === 'line') {
    els.push(
      mkLabel('Цвет'),
      mkColorPicker(o.color, c => atomic(() => o.color = c)),
      mkLabel('Толщина'),
      liveRange(1, 80, o.size || 1, 1, v => o.size = v),
      mkLabel('Прозр.'),
      liveRange(0.05, 1, o.opacity ?? 1, 0.05, v => o.opacity = v),
      mkLabel('Пунктир'),
      mkSelect([['solid','—'],['dashed','---'],['dotted','···'],['dashdot','-·-']],
        o.dash || 'solid', v => atomic(() => o.dash = v)),
      mkLabel('Начало'),
      capSelectObj(o.startCap || 'none', v => atomic(() => o.startCap = v)),
      mkLabel('Конец'),
      capSelectObj(o.endCap || 'none', v => atomic(() => o.endCap = v)),
    );

  } else if (o.type === 'shape') {
    els.push(
      mkLabel('Тип'),
      mkSelect([
        ['circle','Окружность'], ['center-circle','Окр. с центром'],
        ['square','Квадрат'], ['rect','Прямоугольник'],
        ['tri-eq','Прав. треугольник'], ['tri-right','Прямоуг. треугольник'],
        ['semicircle','Полукруг'],
      ], o.shape, v => atomic(() => o.shape = v)),
      mkLabel('Цвет'),
      mkColorPicker(o.color, c => atomic(() => o.color = c)),
      mkLabel('Толщина'),
      liveRange(1, 40, o.size || 1, 1, v => o.size = v),
      mkLabel('Прозр.'),
      liveRange(0.05, 1, o.opacity ?? 1, 0.05, v => o.opacity = v),
      mkLabel('Пунктир'),
      mkSelect([['solid','—'],['dashed','---'],['dotted','···']],
        o.dash || 'solid', v => atomic(() => o.dash = v)),
      mkLabel('Ширина'),
      liveRange(1, 5000, o.w, 1, v => o.w = v),
      mkLabel('Высота'),
      liveRange(1, 5000, o.h, 1, v => o.h = v),
    );

  } else if (o.type === 'image') {
    els.push(
      mkLabel('Прозр.'),
      liveRange(0.05, 1, o.opacity ?? 1, 0.05, v => o.opacity = v),
      mkLabel('Ширина'),
      liveRange(10, 5000, o.w, 1, v => o.w = v),
      mkLabel('Высота'),
      liveRange(10, 5000, o.h, 1, v => o.h = v),
      mkCheckbox('Сохранять пропорции', o._keepAspect !== false, (checked) => {
        pushUndo(page);
        o._keepAspect = checked;
        markDirty();
      }),
      mkBtn(o.isBackdrop ? 'Подложка ✓' : 'Сделать подложкой', () => {
        pushUndo(page);
        o.isBackdrop = !o.isBackdrop;
        const idx = page.objects.indexOf(o);
        page.objects.splice(idx, 1);
        if (o.isBackdrop) {
          const firstNonBackdrop = page.objects.findIndex(x => !(x.type === 'image' && x.isBackdrop));
          if (firstNonBackdrop < 0) page.objects.push(o);
          else page.objects.splice(firstNonBackdrop, 0, o);
          state.selectMode = 2;
        } else {
          insertByPriority(page, o);
        }
        markDirty();
        renderAll();
      }, { active: !!o.isBackdrop }),
    );

  } else if (o.type === 'table') {
    els.push(
      mkLabel('Цвет линий'),
      mkColorPicker(o.color || '#333333', c => atomic(() => o.color = c)),
      mkLabel('Толщина'),
      liveRange(1, 10, o.size || 1, 1, v => o.size = v),
      mkLabel('Ячейка W'),
      liveRange(10, 200, o.cellW, 1, v => { o.cellW = v; if (o._square) o.cellH = v; }),
      mkLabel('H'),
      liveRange(10, 200, o.cellH, 1, v => { o.cellH = v; if (o._square) o.cellW = v; }),
      mkBtn('Квадратные', () => {
        pushUndo(page);
        o._square = !o._square;
        if (o._square) { const s = Math.max(o.cellW, o.cellH); o.cellW = s; o.cellH = s; }
        markDirty(); renderPage(page); renderOptionsBar();
      }, { active: !!o._square }),
    );
  }

  return els.filter(Boolean);
}

function renderOptionsBar() {
  optionsbar.innerHTML = '';
  const t = state.tool;
  const page = currentPage();

  if (t === 'brush') {
    optionsbar.append(
      mkColorPicker(state.brush.color, (c, dash) => {
        state.brush.color = c;
        if (dash === 'dashed') state.brush.dash = 'dashed';
        renderOptionsBar();
      }, { dashed: true }),
      mkLabel('Размер'),
      mkRange(1, 80, state.brush.size, 1, v => { state.brush.size = v; }),
      mkLabel('Прозр.'),
      mkRange(0.05, 1, state.brush.opacity, 0.05, v => { state.brush.opacity = v; }),
      mkLabel('Пунктир'),
      mkSelect([['solid','—'],['dashed','---'],['dotted','···'],['dashdot','-·-']],
        state.brush.dash, v => state.brush.dash = v),
      mkLabel('Начало'),
      capSelectObj(state.brush.startCap, v => state.brush.startCap = v),
      mkLabel('Конец'),
      capSelectObj(state.brush.endCap, v => state.brush.endCap = v),
      mkBtn('Режим 2 (эскиз)', () => {
        state.brush.opacity = state.brush.opacity < 0.6 ? 1 : 0.3;
        renderOptionsBar();
      }, { active: state.brush.opacity < 0.6 }),
    );
  } else if (t === 'line') {
    optionsbar.append(
      mkColorPicker(state.brush.color, c => { state.brush.color = c; renderOptionsBar(); }),
      mkLabel('Толщина'),
      mkRange(1, 40, state.brush.size, 1, v => state.brush.size = v),
      mkLabel('Прозр.'),
      mkRange(0.05, 1, state.brush.opacity, 0.05, v => state.brush.opacity = v),
      mkLabel('Пунктир'),
      mkSelect([['solid','—'],['dashed','---'],['dotted','···']],
        state.brush.dash, v => state.brush.dash = v),
      mkLabel('Начало'),
      capSelectObj(state.brush.startCap, v => state.brush.startCap = v),
      mkLabel('Конец'),
      capSelectObj(state.brush.endCap, v => state.brush.endCap = v),
    );
  } else if (t === 'shape') {
    optionsbar.append(
      mkLabel('Фигура'),
      mkSelect([
        ['circle','Окружность'], ['center-circle','Окр. с центром'],
        ['square','Квадрат'], ['rect','Прямоугольник'],
        ['tri-eq','Прав. треугольник'], ['tri-right','Прямоуг. треугольник'],
        ['semicircle','Полукруг'],
      ], state.shape.shape, v => state.shape.shape = v),
      mkColorPicker(state.shape.color, c => { state.shape.color = c; renderOptionsBar(); }),
      mkLabel('Толщина'),
      mkRange(1, 40, state.shape.size, 1, v => state.shape.size = v),
      mkLabel('Прозр.'),
      mkRange(0.05, 1, state.shape.opacity, 0.05, v => state.shape.opacity = v),
      mkLabel('Пунктир'),
      mkSelect([['solid','—'],['dashed','---'],['dotted','···']],
        state.shape.dash, v => state.shape.dash = v),
    );
  } else if (t === 'text') {
    optionsbar.append(
      mkLabel('Шрифт'),
      mkSelect(['sans-serif','serif','monospace','Arial','Times New Roman','Courier New'],
        state.text.font, v => state.text.font = v),
      mkLabel('Размер'),
      mkRange(8, 96, state.text.size, 1, v => state.text.size = v),
      mkBtn('Ж', () => { state.text.bold = !state.text.bold; renderOptionsBar(); }, { active: state.text.bold }),
      mkBtn('К', () => { state.text.italic = !state.text.italic; renderOptionsBar(); }, { active: state.text.italic }),
      mkBtn('Ч', () => { state.text.underline = !state.text.underline; renderOptionsBar(); }, { active: state.text.underline }),
      mkBtn('≡L', () => { state.text.align = 'left'; renderOptionsBar(); }, { active: state.text.align === 'left' }),
      mkBtn('≡C', () => { state.text.align = 'center'; renderOptionsBar(); }, { active: state.text.align === 'center' }),
      mkBtn('≡R', () => { state.text.align = 'right'; renderOptionsBar(); }, { active: state.text.align === 'right' }),
      mkLabel('Цвет'),
      mkColorPicker(state.text.color, c => { state.text.color = c; renderOptionsBar(); }),
      mkLabel('Фон'),
      mkColorPicker(state.text.bg || '#ffffff', c => { state.text.bg = c; renderOptionsBar(); }),
      state.text.bg ? mkBtn('Без фона', () => { state.text.bg = null; renderOptionsBar(); }) : null,
    );
  } else if (t === 'eraser') {
    optionsbar.append(
      mkLabel('Размер'),
      mkRange(4, 100, state.eraser.size, 1, v => state.eraser.size = v),
      mkBtn('Ластик', () => { state.eraser.mode = 'erase'; renderOptionsBar(); }, { active: state.eraser.mode === 'erase' }),
      mkBtn('Белый карандаш', () => { state.eraser.mode = 'white'; renderOptionsBar(); }, { active: state.eraser.mode === 'white' }),
    );
  } else if (t === 'fill') {
    optionsbar.append(
      mkColorPicker(state.fill.color, c => { state.fill.color = c; renderOptionsBar(); }),
      mkLabel('Нажмите на область, чтобы залить'),
    );
  } else if (t === 'select') {
    optionsbar.append(
      mkBtn('Режим: без подложек', () => { state.selectMode = 1; renderOptionsBar(); }, { active: state.selectMode === 1 }),
      mkBtn('Режим: все', () => { state.selectMode = 2; renderOptionsBar(); }, { active: state.selectMode === 2 }),
    );
    if (state.selection && page) {
      const o = page.objects.find(x => x.id === state.selection);
      if (o) {
        optionsbar.append(
          mkBtn('⬆', () => moveLayer(o, +1), { title: 'Слой выше' }),
          mkBtn('⬇', () => moveLayer(o, -1), { title: 'Слой ниже' }),
          mkBtn('⤒', () => moveLayerTo(o, 'top'), { title: 'На самый верх' }),
          mkBtn('⤓', () => moveLayerTo(o, 'bottom'), { title: 'На самый низ' }),
          mkBtn('Удалить', () => {
            const idx = page.objects.indexOf(o);
            if (idx >= 0) { pushUndo(page); page.objects.splice(idx, 1); }
            state.selection = null; renderAll();
          }),
          mkBtn('Дублировать', () => duplicateObject(o)),
        );
        const editors = objectPropertyEditors(page, o);
        if (editors.length) optionsbar.append(mkLabel('|'), ...editors);
      }
    }
  } else if (t === 'table') {
    if (state.selectedCell && state.selectedCell.objId) {
      const p = currentPage();
      const tbl = p && p.objects.find(x => x.id === state.selectedCell.objId);
      if (tbl && tbl.type === 'table') {
        optionsbar.append(
          mkLabel('Ячейка:'),
          mkBtn('+ Строка',   () => { pushUndo(p); tbl.rows++; renderAll(); }),
          mkBtn('− Строка',   () => { if (tbl.rows > 1) { pushUndo(p); tbl.rows--; renderAll(); } }),
          mkBtn('+ Столбец',  () => { pushUndo(p); tbl.cols++; renderAll(); }),
          mkBtn('− Столбец',  () => { if (tbl.cols > 1) { pushUndo(p); tbl.cols--; renderAll(); } }),
          mkBtn('Объединить →', () => mergeCell(tbl, p, 'right')),
          mkBtn('Объединить ↓', () => mergeCell(tbl, p, 'down')),
        );
      }
    } else {
      optionsbar.append(mkLabel('Кликните по ячейке существующей таблицы или выберите размер новой ниже.'));
      const wrap = document.createElement('div');
      wrap.className = 'table-grid';
      const cells = [];
      for (let r = 1; r <= 9; r++) {
        for (let c = 1; c <= 9; c++) {
          const cell = document.createElement('button');
          cell.className = 'table-cell';
          cell.dataset.r = r; cell.dataset.c = c;
          cell.addEventListener('mouseenter', () => {
            cells.forEach(x => x.classList.toggle('hover', +x.dataset.r <= r && +x.dataset.c <= c));
          });
          cell.addEventListener('click', () => placeTable(r, c));
          cells.push(cell);
          wrap.appendChild(cell);
        }
      }
      optionsbar.append(wrap);
    }
  } else if (t === 'image') {
    optionsbar.append(
      mkBtn('Загрузить файл', async () => {
        if (!window.api) return;
        const src = await window.api.pickImage();
        if (src) addImageObject(src, false);
      }),
      mkBtn('Загрузить как подложку', async () => {
        if (!window.api) return;
        const src = await window.api.pickImage();
        if (src) addImageObject(src, true);
      }),
      mkLabel('Или перетащите файл / Ctrl+V'),
    );
  }
  renderTopbarState();
}

// ------- layers -------
function moveLayer(obj, delta) {
  const page = currentPage(); if (!page) return;
  const idx = page.objects.indexOf(obj);
  const ni = Math.max(0, Math.min(page.objects.length - 1, idx + delta));
  if (ni === idx) return;
  pushUndo(page);
  page.objects.splice(idx, 1);
  page.objects.splice(ni, 0, obj);
  renderAll();
}
function moveLayerTo(obj, where) {
  const page = currentPage(); if (!page) return;
  const idx = page.objects.indexOf(obj);
  if (idx < 0) return;
  pushUndo(page);
  page.objects.splice(idx, 1);
  if (where === 'top') page.objects.push(obj);
  else page.objects.unshift(obj);
  renderAll();
}
function duplicateObject(o) {
  const page = currentPage(); if (!page) return;
  pushUndo(page);
  const copy = JSON.parse(JSON.stringify(o));
  copy.id = uid();
  if (copy.x != null) copy.x += 20;
  if (copy.y != null) copy.y += 20;
  if (copy.points) copy.points = copy.points.map(p => ({ x: p.x + 20, y: p.y + 20 }));
  page.objects.push(copy);
  state.selection = copy.id;
  renderAll();
}

// ------- table helpers -------
function placeTable(rows, cols) {
  const page = currentPage(); if (!page) return;
  pushUndo(page);
  const cellW = 60, cellH = 30;
  const tbl = {
    id: uid(), type: 'table',
    x: 40, y: 40,
    rows, cols, cellW, cellH,
    color: '#333', size: 1, opacity: 1, merges: [],
  };
  insertByPriority(page, tbl);
  state.pendingTable = false;
  state.tool = 'table';
  state.selection = tbl.id;
  state.selectedCell = { objId: tbl.id, r: 0, c: 0 };
  renderAll();
}

function cellAt2(tbl, r, c) {
  for (const m of (tbl.merges || [])) {
    if (r >= m.r && r < m.r + m.rh && c >= m.c && c < m.c + m.cw) return m;
  }
  return { r, c, rh: 1, cw: 1 };
}

function mergeCell(tbl, page, dir) {
  const sel = state.selectedCell; if (!sel) return;
  const { r, c } = sel;
  const a = cellAt2(tbl, r, c);
  const target = dir === 'right' ? cellAt2(tbl, r, c + a.cw) : cellAt2(tbl, r + a.rh, c);
  if (a.r === target.r && a.c === target.c && a.rh === target.rh && a.cw === target.cw) return;
  pushUndo(page);
  const merged = {
    r: Math.min(a.r, target.r), c: Math.min(a.c, target.c),
    rh: Math.max(a.r + a.rh, target.r + target.rh) - Math.min(a.r, target.r),
    cw: Math.max(a.c + a.cw, target.c + target.cw) - Math.min(a.c, target.c),
  };
  tbl.merges = tbl.merges.filter(m => m !== a && m !== target);
  tbl.merges.push(merged);
  renderAll();
}

// ------- image insert -------
function addImageObject(src, asBackdrop) {
  const page = currentPage(); if (!page) return;
  const img = new Image();
  img.onload = () => {
    const maxW = 400;
    const ratio = Math.min(1, maxW / img.naturalWidth);
    pushUndo(page);
    const o = {
      id: uid(), type: 'image',
      x: 40, y: 40,
      w: img.naturalWidth * ratio, h: img.naturalHeight * ratio,
      src, opacity: 1, rotation: 0,
      isBackdrop: !!asBackdrop,
      _keepAspect: true,
    };
    if (asBackdrop) page.objects.unshift(o);
    else insertByPriority(page, o);
    state.selection = o.id;
    state.tool = 'select';
    renderAll();
  };
  img.src = src;
}

// ------- left panel -------
const tabPages = document.getElementById('tab-pages');
const tabBrush = document.getElementById('tab-brush');

function renderLeftPanel() {
  renderPagesTab();
  renderBrushTab();
}

const PRIORITY_TYPES = [
  { key: 'text',  label: 'Текст' },
  { key: 'ink',   label: 'Чернила' },
  { key: 'image', label: 'Картинки' },
  { key: 'back',  label: 'Подложки' },
];

function renderPriorityEditor(group) {
  const wrap = document.createElement('div');
  wrap.style.padding = '4px 8px 6px 24px';
  wrap.style.borderBottom = '1px solid #2b2d30';
  wrap.style.marginBottom = '4px';
  wrap.style.fontSize = '11px';

  const title = document.createElement('div');
  title.textContent = 'Приоритеты (сверху вниз):';
  title.style.color = '#888';
  title.style.marginBottom = '4px';
  wrap.appendChild(title);

  const ordered = [...PRIORITY_TYPES].sort((a, b) => group.priority[b.key] - group.priority[a.key]);

  ordered.forEach((t, i) => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '4px';
    row.style.padding = '1px 0';

    const num = document.createElement('span');
    num.textContent = String(i + 1) + '.';
    num.style.color = '#666';
    num.style.width = '14px';
    row.appendChild(num);

    const lbl = document.createElement('span');
    lbl.textContent = t.label;
    lbl.style.flex = '1';
    row.appendChild(lbl);

    const up = document.createElement('button');
    up.textContent = '↑';
    up.style.padding = '0 5px';
    up.style.fontSize = '10px';
    up.style.lineHeight = '16px';
    up.disabled = i === 0;
    up.addEventListener('click', () => swapPriority(group, t.key, ordered[i - 1].key));
    row.appendChild(up);

    const down = document.createElement('button');
    down.textContent = '↓';
    down.style.padding = '0 5px';
    down.style.fontSize = '10px';
    down.style.lineHeight = '16px';
    down.disabled = i === ordered.length - 1;
    down.addEventListener('click', () => swapPriority(group, t.key, ordered[i + 1].key));
    row.appendChild(down);

    wrap.appendChild(row);
  });

  const applyBtn = document.createElement('button');
  applyBtn.textContent = 'Применить ко всем объектам';
  applyBtn.style.marginTop = '6px';
  applyBtn.style.fontSize = '11px';
  applyBtn.style.padding = '2px 6px';
  applyBtn.addEventListener('click', () => resortGroupObjects(group));
  wrap.appendChild(applyBtn);

  return wrap;
}

function swapPriority(group, keyA, keyB) {
  if (!keyA || !keyB) return;
  const a = group.priority[keyA];
  group.priority[keyA] = group.priority[keyB];
  group.priority[keyB] = a;
  markDirty();
  renderPagesTab();
}

function renderPagesTab() {
  tabPages.innerHTML = '';
  const addGroupBtn = document.createElement('button');
  addGroupBtn.className = 'full-btn';
  addGroupBtn.textContent = '+ Группа';
  addGroupBtn.addEventListener('click', addGroup);
  tabPages.appendChild(addGroupBtn);

  for (const group of state.project.groups) {
    const g = document.createElement('div');
    g.className = 'group';

    const head = document.createElement('div');
    head.className = 'group-header';
    const collapseBtn = document.createElement('button');
    collapseBtn.textContent = group.collapsed ? '▸' : '▾';
    collapseBtn.addEventListener('click', () => { group.collapsed = !group.collapsed; renderPagesTab(); });
    const nameEl = document.createElement('span');
    nameEl.className = 'group-name';
    nameEl.textContent = group.name;
    nameEl.title = 'Двойной клик — переименовать';
    nameEl.addEventListener('dblclick', () => {
      const nn = prompt('Название группы:', group.name);
      if (nn && nn.trim()) { group.name = nn.trim(); markDirty(); renderPagesTab(); }
    });
    const addPageBtn = document.createElement('button');
    addPageBtn.textContent = '+';
    addPageBtn.title = 'Добавить страницу в группу';
    addPageBtn.addEventListener('click', () => {
      const id = uid();
      state.project.pages[id] = { id, groupId: group.id, height: 1200, objects: [], undo: [], redo: [], _timers: [] };
      state.project.pageOrder.push(id);
      state.project.currentPageId = id;
      markDirty(); renderAll();
    });
    const prioBtn = document.createElement('button');
    prioBtn.textContent = '⚙';
    prioBtn.title = 'Приоритеты слоёв группы';
    prioBtn.classList.toggle('active', !!group.showPriority);
    prioBtn.addEventListener('click', () => { group.showPriority = !group.showPriority; renderPagesTab(); });

    head.append(collapseBtn, nameEl, addPageBtn, prioBtn);
    g.appendChild(head);

    if (group.showPriority) g.appendChild(renderPriorityEditor(group));

    if (!group.collapsed) {
      const pagesEl = document.createElement('div');
      pagesEl.className = 'pages';
      const pageIds = state.project.pageOrder.filter(id => state.project.pages[id]?.groupId === group.id);
      let n = 0;
      for (const pid of pageIds) {
        n++;
        const p = state.project.pages[pid];
        const thumb = document.createElement('div');
        thumb.className = 'page-thumb' + (pid === state.project.currentPageId ? ' active' : '');
        const img = document.createElement('img');
        img.alt = '';
        img.src = p._thumb || transparentThumb();
        const num = document.createElement('span');
        num.className = 'page-num';
        num.textContent = n;
        thumb.append(img, num);
        thumb.addEventListener('click', () => {
          state.project.currentPageId = pid;
          state.selection = null; state.selectedCell = null;
          renderAll();
        });
        pagesEl.appendChild(thumb);
        scheduleThumb(p);
      }
      g.appendChild(pagesEl);
    }
    tabPages.appendChild(g);
  }
}

function transparentThumb() {
  const c = document.createElement('canvas');
  c.width = 60; c.height = 80;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 60, 80);
  ctx.strokeStyle = '#ddd'; ctx.strokeRect(0.5, 0.5, 59, 79);
  return c.toDataURL();
}

let thumbQueue = new Set();
let thumbTimer = null;
function scheduleThumb(p) {
  if (!p) return;
  thumbQueue.add(p);
  if (thumbTimer) return;
  thumbTimer = setTimeout(() => {
    for (const page of thumbQueue) {
      try { page._thumb = buildThumb(page); } catch (_) {}
    }
    thumbQueue.clear();
    thumbTimer = null;
    renderPagesTab();
  }, 250);
}

function buildThumb(page) {
  const c = document.createElement('canvas');
  const H = Math.min(page.height, 1200);
  const ratio = 80 / H;
  c.width = Math.max(30, Math.round(PAGE_WIDTH * ratio));
  c.height = 80;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.save();
  ctx.scale(ratio, ratio);
  for (const o of page.objects) drawObject(ctx, o);
  ctx.restore();
  return c.toDataURL();
}

function renderBrushTab() {
  tabBrush.innerHTML = '';
  const opts = state.brush;

  const colorRow = document.createElement('div');
  colorRow.style.marginBottom = '8px';
  colorRow.append(mkColorPicker(opts.color, c => { state.brush.color = c; renderBrushTab(); }, { dashed: true }));
  tabBrush.appendChild(colorRow);

  const sizeRow = document.createElement('div');
  sizeRow.style.marginBottom = '8px';
  sizeRow.append(mkLabel('Толщина '), mkRange(1, 80, opts.size, 1, v => opts.size = v));
  tabBrush.appendChild(sizeRow);

  const opRow = document.createElement('div');
  opRow.style.marginBottom = '8px';
  opRow.append(mkLabel('Прозрачность '), mkRange(0.05, 1, opts.opacity, 0.05, v => opts.opacity = v));
  tabBrush.appendChild(opRow);

  const timerWrap = document.createElement('div');
  timerWrap.style.marginTop = '12px';
  timerWrap.style.borderTop = '1px solid #2b2d30';
  timerWrap.style.paddingTop = '8px';
  const lbl = document.createElement('label');
  lbl.style.display = 'flex'; lbl.style.alignItems = 'center'; lbl.style.gap = '4px';
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.checked = state.timerErase.enabled;
  cb.addEventListener('change', () => state.timerErase.enabled = cb.checked);
  lbl.append(cb, document.createTextNode('Удалять чернила через'));
  timerWrap.appendChild(lbl);
  const secRow = document.createElement('div');
  secRow.style.marginTop = '4px';
  secRow.append(mkRange(1, 600, state.timerErase.seconds, 1, v => state.timerErase.seconds = v), document.createTextNode(' сек.'));
  timerWrap.appendChild(secRow);
  tabBrush.appendChild(timerWrap);
}

// ------- topbar -------
function renderTopbarState() {
  document.querySelectorAll('#topbar [data-tool]').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === state.tool);
  });
  const page = currentPage();
  const u = document.querySelector('#topbar [data-act="undo"]');
  const r = document.querySelector('#topbar [data-act="redo"]');
  if (u) u.disabled = !page || page.undo.length === 0;
  if (r) r.disabled = !page || page.redo.length === 0;
}

document.querySelector('#topbar').addEventListener('click', async e => {
  const btn = e.target.closest('button'); if (!btn) return;
  if (btn.dataset.tool) {
    state.tool = btn.dataset.tool;
    state.selection = null;
    state.selectedCell = null;
    state.pendingTable = false;
    renderAll();
    return;
  }
  const act = btn.dataset.act; if (!act) return;
  switch (act) {
    case 'prev': gotoPrev(); break;
    case 'next': gotoNext(); break;
    case 'undo': undo(); break;
    case 'redo': redo(); break;
    case 'addPage': addPageAfter(); break;
    case 'delPage': delCurrentPage(); break;
    case 'open': await openProject(); break;
    case 'save': await save(false); break;
    case 'exportPng': await exportCurrentPagePNG(); break;
    case 'exportAllPng': await exportAllPagesPNG(); break;
  }
});

// ------- canvas events -------
function canvasCoords(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (canvas.width / r.width),
    y: (e.clientY - r.top) * (canvas.height / r.height),
  };
}

let _strokeStartTime = 0;

canvas.addEventListener('pointerdown', e => {
  const page = currentPage();
  if (!page) return;
  const p = canvasCoords(e);

  if (state.tool === 'brush') {
    if (!state.timerErase.enabled) pushUndo(page);
    const o = {
      id: uid(), type: 'stroke',
      points: [p],
      color: state.brush.color,
      size: state.brush.size,
      opacity: state.brush.opacity,
      dash: state.brush.dash,
      startCap: state.brush.startCap,
      endCap: state.brush.endCap,
    };
    insertByPriority(page, o);
    dragState = { kind: 'draw', obj: o, page };
    _strokeStartTime = Date.now();
    canvas.setPointerCapture(e.pointerId);
    renderPage(page);
  } else if (state.tool === 'line') {
    pushUndo(page);
    const o = {
      id: uid(), type: 'line', x1: p.x, y1: p.y, x2: p.x, y2: p.y,
      color: state.brush.color, size: state.brush.size,
      opacity: state.brush.opacity, dash: state.brush.dash,
      startCap: state.brush.startCap, endCap: state.brush.endCap,
    };
    page.objects.push(o);
    dragState = { kind: 'line', obj: o, page };
    canvas.setPointerCapture(e.pointerId);
    renderPage(page);
  } else if (state.tool === 'shape') {
    pushUndo(page);
    const o = {
      id: uid(), type: 'shape', shape: state.shape.shape,
      x: p.x, y: p.y, w: 0, h: 0,
      color: state.shape.color, size: state.shape.size,
      opacity: state.shape.opacity, dash: state.shape.dash,
    };
    page.objects.push(o);
    dragState = { kind: 'shape', obj: o, page };
    canvas.setPointerCapture(e.pointerId);
    renderPage(page);
  } else if (state.tool === 'eraser') {
    pushUndo(page);
    dragState = { kind: 'erase', page, last: p };
    canvas.setPointerCapture(e.pointerId);
    doErase(page, p, p);
  } else if (state.tool === 'fill') {
    pushUndo(page);
    const obj = floodFill(page, Math.round(p.x), Math.round(p.y), state.fill.color);
    if (obj) { page.objects.push(obj); state.selection = obj.id; }
    renderAll();
  } else if (state.tool === 'text') {
    openTextEditor(p);
  } else if (state.tool === 'select') {
    if (state.selection) {
      const sel = page.objects.find(x => x.id === state.selection);
      if (sel && canResize(sel)) {
        const handle = hitResizeHandle(sel, p.x, p.y);
        if (handle) {
          pushUndo(page);
          dragState = {
            kind: 'resize', page, obj: sel, handle,
            orig: { x: sel.x, y: sel.y, w: sel.w, h: sel.h },
            ox: p.x, oy: p.y,
          };
          canvas.setPointerCapture(e.pointerId);
          return;
        }
      }
    }
    const hit = hitTestStack(page, p.x, p.y);
    if (hit) {
      state.selection = hit.id;
      state.selectedCell = null;
      const pivot =
        hit.type === 'stroke' ? { x: hit.points[0].x, y: hit.points[0].y } :
        hit.type === 'line' ? { x: hit.x1, y: hit.y1 } :
        { x: hit.x, y: hit.y };
      // undo пушится только при первом фактическом сдвиге (чтобы dblclick не плодил записи)
      dragState = {
        kind: 'move', page, obj: hit,
        ox: p.x - pivot.x, oy: p.y - pivot.y,
        pivot,
        orig: JSON.parse(JSON.stringify(hit)),
        moved: false,
      };
      canvas.setPointerCapture(e.pointerId);
      renderAll();
    } else {
      state.selection = null; state.selectedCell = null;
      renderAll();
    }
  } else if (state.tool === 'table') {
    let found = false;
    for (let i = page.objects.length - 1; i >= 0; i--) {
      const o = page.objects[i];
      if (o.type !== 'table') continue;
      const w = o.cols * o.cellW, h = o.rows * o.cellH;
      if (p.x >= o.x && p.x <= o.x + w && p.y >= o.y && p.y <= o.y + h) {
        const c = Math.floor((p.x - o.x) / o.cellW);
        const r = Math.floor((p.y - o.y) / o.cellH);
        if (r >= 0 && r < o.rows && c >= 0 && c < o.cols) {
          state.selectedCell = { objId: o.id, r, c };
          state.selection = o.id;
          found = true;
          renderAll();
          break;
        }
      }
    }
    if (!found) {
      state.pendingTable = true;
      state.selectedCell = null;
      state.selection = null;
      renderOptionsBar();
    }
  }
});

canvas.addEventListener('dblclick', e => {
  if (state.tool !== 'select') return;
  const page = currentPage(); if (!page) return;
  const p = canvasCoords(e);
  for (let i = page.objects.length - 1; i >= 0; i--) {
    const o = page.objects[i];
    if (o.type !== 'text') continue;
    if (hitTest(o, p.x, p.y)) {
      state.selection = o.id;
      renderAll();
      const active = document.querySelector('.text-editor');
      if (active) active.blur();
      setTimeout(() => openTextEditor(null, o), 0);
      return;
    }
  }
});

canvas.addEventListener('pointermove', e => {
  const p = canvasCoords(e);

  if (!dragState) {
    if (state.tool === 'select' && state.selection) {
      const page = currentPage();
      const sel = page && page.objects.find(x => x.id === state.selection);
      if (sel && canResize(sel)) {
        const h = hitResizeHandle(sel, p.x, p.y);
        canvas.style.cursor = h ? handleCursor(h) : 'default';
      } else {
        canvas.style.cursor = 'default';
      }
    } else {
      canvas.style.cursor = 'default';
    }
    return;
  }

  const d = dragState;
  if (d.kind === 'draw') {
    d.obj.points.push(p);
    renderPage(d.page);
  } else if (d.kind === 'line') {
    d.obj.x2 = p.x; d.obj.y2 = p.y;
    renderPage(d.page);
  } else if (d.kind === 'shape') {
    d.obj.w = p.x - d.obj.x;
    d.obj.h = p.y - d.obj.y;
    renderPage(d.page);
  } else if (d.kind === 'erase') {
    doErase(d.page, d.last, p);
    d.last = p;
  } else if (d.kind === 'move') {
    if (!d.moved) { pushUndo(d.page); d.moved = true; }
    const obj = d.obj;
    const nx = p.x - d.ox, ny = p.y - d.oy;
    const dx = nx - d.pivot.x, dy = ny - d.pivot.y;
    if (obj.type === 'stroke') {
      obj.points = d.orig.points.map(pt => ({ x: pt.x + dx, y: pt.y + dy }));
    } else if (obj.type === 'line') {
      obj.x1 = d.orig.x1 + dx; obj.y1 = d.orig.y1 + dy;
      obj.x2 = d.orig.x2 + dx; obj.y2 = d.orig.y2 + dy;
    } else {
      obj.x = nx; obj.y = ny;
    }
    renderPage(d.page);
  } else if (d.kind === 'resize') {
    const dx = p.x - d.ox, dy = p.y - d.oy;
    applyResize(d.obj, d.orig, d.handle, dx, dy, e.shiftKey);
    renderPage(d.page);
  }
});

function endDrag(e) {
  if (!dragState) return;
  const d = dragState;
  dragState = null;

  if (e && e.clientX != null) {
    const p = canvasCoords(e);
    if (d.kind === 'draw') {
      const pts = d.obj.points;
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 0.1) pts.push(p);
    } else if (d.kind === 'line') {
      d.obj.x2 = p.x; d.obj.y2 = p.y;
    } else if (d.kind === 'shape') {
      d.obj.w = p.x - d.obj.x;
      d.obj.h = p.y - d.obj.y;
    }
  }

  if (d.kind === 'shape') {
    if (Math.abs(d.obj.w) < 3 || Math.abs(d.obj.h) < 3) {
      const idx = d.page.objects.indexOf(d.obj);
      if (idx >= 0) d.page.objects.splice(idx, 1);
    } else {
      if (d.obj.w < 0) { d.obj.x += d.obj.w; d.obj.w = -d.obj.w; }
      if (d.obj.h < 0) { d.obj.y += d.obj.h; d.obj.h = -d.obj.h; }
    }
  } else if (d.kind === 'draw') {
    scheduleErase(d.page, d.obj, _strokeStartTime);
  }

  markDirty();
  renderAll();
}

canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// ------- eraser logic -------
function doErase(page, a, b) {
  const r = state.eraser.size / 2;
  const isWhite = state.eraser.mode === 'white';

  if (isWhite) {
    if (!dragState._whiteStroke) {
      const o = {
        id: uid(), type: 'stroke', points: [b],
        color: '#ffffff', size: state.eraser.size, opacity: 1,
        dash: 'solid', startCap: 'none', endCap: 'none',
      };
      page.objects.push(o);
      dragState._whiteStroke = o;
    } else {
      dragState._whiteStroke.points.push(b);
    }
    renderPage(page);
    return;
  }

  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, r / 2)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const cx = a.x + (b.x - a.x) * t;
    const cy = a.y + (b.y - a.y) * t;

    for (let i = page.objects.length - 1; i >= 0; i--) {
      const o = page.objects[i];

      if (o.type === 'stroke') {
        const pieces = splitStrokeByCircle(o, cx, cy, r);
        if (pieces.length === 0) {
          page.objects.splice(i, 1);
        } else if (pieces.length === 1 && pieces[0] === o) {
          // без изменений
        } else {
          page.objects.splice(i, 1, ...pieces.map(pc => ({ ...o, id: uid(), points: pc })));
        }
      } else if (o.type === 'line') {
        const d = segDist({ x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }, { x: cx, y: cy });
        if (d < r + (o.size || 1) / 2) {
          const len = Math.hypot(o.x2 - o.x1, o.y2 - o.y1);
          const segSteps = Math.max(2, Math.ceil(len / 2));
          const pts = [];
          for (let k = 0; k <= segSteps; k++) {
            const tt = k / segSteps;
            pts.push({ x: o.x1 + (o.x2 - o.x1) * tt, y: o.y1 + (o.y2 - o.y1) * tt });
          }
          const tempStroke = { ...o, type: 'stroke', points: pts };
          const pieces = splitStrokeByCircle(tempStroke, cx, cy, r);
          if (pieces.length === 0) {
            page.objects.splice(i, 1);
          } else {
            const objs = pieces.map((pc, idx) => ({
              id: uid(), type: 'stroke', points: pc,
              color: o.color, size: o.size, opacity: o.opacity ?? 1,
              dash: o.dash || 'solid',
              startCap: idx === 0 ? (o.startCap || 'none') : 'none',
              endCap: idx === pieces.length - 1 ? (o.endCap || 'none') : 'none',
            }));
            page.objects.splice(i, 1, ...objs);
          }
        }
      }
    }
  }
  renderPage(page);
}

function splitStrokeByCircle(stroke, cx, cy, r) {
  const pts = stroke.points;
  if (pts.length === 0) return [];
  const pieces = [];
  let cur = [];
  for (const p of pts) {
    const hit = Math.hypot(p.x - cx, p.y - cy) < r + stroke.size / 2;
    if (hit) {
      if (cur.length >= 2) pieces.push(cur);
      cur = [];
    } else {
      cur.push(p);
    }
  }
  if (cur.length >= 2) pieces.push(cur);
  if (pieces.length === 0) return [];
  if (pieces.length === 1 && pieces[0].length === pts.length) return [stroke];
  return pieces;
}

// ------- text editor -------
function openTextEditor(pt, existingText) {
  const page = currentPage(); if (!page) return;

  const existing = document.querySelector('.text-editor');
  if (existing) existing.blur();

  const ta = document.createElement('textarea');
  ta.className = 'text-editor';
  const rect = canvas.getBoundingClientRect();
  const wrapRect = canvasWrap.getBoundingClientRect();

  const baseX = existingText ? existingText.x : pt.x;
  const baseY = existingText ? existingText.y : pt.y;
  const left = rect.left - wrapRect.left + canvasWrap.scrollLeft + baseX;
  const top  = rect.top  - wrapRect.top  + canvasWrap.scrollTop  + baseY;
  ta.style.left = left + 'px';
  ta.style.top  = top  + 'px';
  ta.style.width = Math.max(220, (existingText?.w || 220)) + 'px';
  ta.style.height = Math.max(40, (existingText?.h || 40)) + 'px';

  const font = existingText ? existingText.font : state.text.font;
  const size = existingText ? existingText.size : state.text.size;
  const bold = existingText ? existingText.bold : state.text.bold;
  const italic = existingText ? existingText.italic : state.text.italic;
  const color = existingText ? existingText.color : state.text.color;
  const align = existingText ? existingText.align : state.text.align;

  ta.style.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${font}`;
  ta.style.color = color;
  ta.style.textAlign = align;
  ta.style.background = '#fff';
  ta.value = existingText ? (existingText.text || '') : '';
  canvasWrap.appendChild(ta);

  let focusGained = false;
  let finished = false;

  const finish = () => {
    if (finished) return;
    if (!focusGained) return;
    finished = true;
    const text = ta.value;
    ta.remove();

    if (existingText) {
      if (!text.trim()) {
        pushUndo(page);
        const idx = page.objects.indexOf(existingText);
        if (idx >= 0) page.objects.splice(idx, 1);
        state.selection = null;
        markDirty(); renderAll();
        return;
      }
      if (text === existingText.text) {
        state.selection = existingText.id;
        renderAll();
        return;
      }
      pushUndo(page);
      existingText.text = text;
      recomputeTextSize(existingText);
      state.selection = existingText.id;
      markDirty(); renderAll();
      return;
    }

    if (!text.trim()) { renderPage(page); return; }
    pushUndo(page);
    const lines = text.split('\n');
    _measureCtx.font = `${state.text.italic ? 'italic ' : ''}${state.text.bold ? 'bold ' : ''}${state.text.size}px ${state.text.font}`;
    let maxW = 0;
    for (const ln of lines) maxW = Math.max(maxW, _measureCtx.measureText(ln).width);
    const o = {
      id: uid(), type: 'text',
      x: pt.x, y: pt.y, w: maxW + 8, h: state.text.size * 1.25 * lines.length + 4,
      text,
      font: state.text.font, size: state.text.size,
      bold: state.text.bold, italic: state.text.italic, underline: state.text.underline,
      align: state.text.align, color: state.text.color, bg: state.text.bg,
      opacity: 1, rotation: 0,
    };
    insertByPriority(page, o);
    state.selection = o.id;
    state.tool = 'select';
    markDirty(); renderAll();
  };

  ta.addEventListener('focus', () => { focusGained = true; });
  ta.addEventListener('blur', finish);
  ta.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { ev.preventDefault(); ta.blur(); }
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); ta.blur(); }
  });

  requestAnimationFrame(() => { try { ta.focus(); } catch (_) {} });
}

// ------- flood fill -------
function floodFill(page, sx, sy, hexColor) {
  const W = canvas.width, H = canvas.height;
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return null;
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const octx = off.getContext('2d');
  octx.fillStyle = '#fff'; octx.fillRect(0, 0, W, H);
  for (const o of page.objects) drawObject(octx, o);
  const img = octx.getImageData(0, 0, W, H);
  const data = img.data;
  const { r: tr, g: tg, b: tb } = hexToRgb(hexColor);
  const i0 = (sy * W + sx) * 4;
  const sr = data[i0], sg = data[i0+1], sb = data[i0+2], sa = data[i0+3];
  if (sr === tr && sg === tg && sb === tb) return null;
  const match = (i) =>
    Math.abs(data[i]-sr) <= 16 && Math.abs(data[i+1]-sg) <= 16 &&
    Math.abs(data[i+2]-sb) <= 16 && Math.abs(data[i+3]-sa) <= 16;
  const seen = new Uint8Array(W * H);
  const stack = [[sx, sy]];
  while (stack.length) {
    const [x, y] = stack.pop();
    let nx = x;
    while (nx >= 0 && !seen[y*W+nx] && match((y*W+nx)*4)) nx--;
    nx++;
    let upSpan = false, dnSpan = false;
    while (nx < W && !seen[y*W+nx] && match((y*W+nx)*4)) {
      seen[y*W+nx] = 1;
      if (!upSpan && y > 0 && !seen[(y-1)*W+nx] && match(((y-1)*W+nx)*4)) { stack.push([nx, y-1]); upSpan = true; }
      else if (upSpan && (y === 0 || seen[(y-1)*W+nx] || !match(((y-1)*W+nx)*4))) upSpan = false;
      if (!dnSpan && y < H-1 && !seen[(y+1)*W+nx] && match(((y+1)*W+nx)*4)) { stack.push([nx, y+1]); dnSpan = true; }
      else if (dnSpan && (y === H-1 || seen[(y+1)*W+nx] || !match(((y+1)*W+nx)*4))) dnSpan = false;
      nx++;
    }
  }
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const octx2 = out.getContext('2d');
  const outData = octx2.createImageData(W, H);
  for (let i = 0; i < W*H; i++) {
    if (seen[i]) {
      outData.data[i*4] = tr;
      outData.data[i*4+1] = tg;
      outData.data[i*4+2] = tb;
      outData.data[i*4+3] = 255;
    }
  }
  octx2.putImageData(outData, 0, 0);
  return {
    id: uid(), type: 'fill',
    x: 0, y: 0, w: W, h: H,
    src: out.toDataURL('image/png'),
  };
}

// ------- PNG export -------
function renderPageToCanvas(page) {
  return new Promise((resolve) => {
    const w = PAGE_WIDTH;
    const h = page.height;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);

    // дожидаемся загрузки всех картинок на странице
    const images = page.objects.filter(o => o.type === 'image' || o.type === 'fill');
    const pending = images.filter(o => {
      const img = getImage(o.src);
      return !img._ready;
    });
    if (pending.length === 0) {
      for (const o of page.objects) drawObject(ctx, o);
      resolve(c);
      return;
    }
    let remaining = pending.length;
    const done = () => {
      remaining--;
      if (remaining <= 0) {
        for (const o of page.objects) drawObject(ctx, o);
        resolve(c);
      }
    };
    for (const o of pending) {
      const img = getImage(o.src);
      const prevOnload = img.onload;
      img.onload = () => {
        img._ready = true;
        if (prevOnload) try { prevOnload(); } catch (_) {}
        img.onload = prevOnload;
        done();
      };
    }
  });
}

async function exportCurrentPagePNG() {
  if (!window.api) { toast('Экспорт доступен только в Electron'); return; }
  const page = currentPage();
  if (!page) return;
  const c = await renderPageToCanvas(page);
  const dataURL = c.toDataURL('image/png');
  const num = state.project.pageOrder.indexOf(page.id) + 1;
  const group = getGroup(page.groupId);
  const name = sanitizeFilename(`${group ? group.name : 'page'}-${num}`) + '.png';
  const path = await window.api.savePNG(dataURL, name);
  if (path) toast('Сохранено: ' + path);
}

async function exportAllPagesPNG() {
  if (!window.api) { toast('Экспорт доступен только в Electron'); return; }
  if (!state.project.pageOrder.length) return;
  const dir = await window.api.pickDirectory();
  if (!dir) return;

  let ok = 0, fail = 0;
  const total = state.project.pageOrder.length;
  for (let i = 0; i < total; i++) {
    const pid = state.project.pageOrder[i];
    const page = state.project.pages[pid];
    if (!page) continue;
    try {
      const c = await renderPageToCanvas(page);
      const dataURL = c.toDataURL('image/png');
      const group = getGroup(page.groupId);
      const num = (i + 1).toString().padStart(3, '0');
      const name = sanitizeFilename(`${group ? group.name : 'group'}_${num}.png`);
      await window.api.savePNGToDir(dir, name, dataURL);
      ok++;
      // даём браузеру отдышаться
      if (i % 3 === 2) await new Promise(r => setTimeout(r, 10));
    } catch (e) {
      console.error('export page fail', e);
      fail++;
    }
  }
  toast(`Экспортировано ${ok} из ${total}${fail ? ` (ошибок: ${fail})` : ''} в ${dir}`);
}

// ------- renderAll -------
function renderAll() {
  renderPage(currentPage());
  renderOptionsBar();
  renderLeftPanel();
  renderTopbarState();
}

// ------- file ops -------
function serialize() {
  const out = { groups: state.project.groups, pages: {}, pageOrder: state.project.pageOrder, currentPageId: state.project.currentPageId };
  for (const id in state.project.pages) {
    const p = state.project.pages[id];
    out.pages[id] = { id: p.id, groupId: p.groupId, height: p.height, objects: p.objects, undo: p.undo, redo: p.redo };
  }
  return out;
}
function deserialize(data) {
  const project = { path: null, groups: data.groups, pages: {}, pageOrder: data.pageOrder, currentPageId: data.currentPageId };
  for (const id in data.pages) {
    const p = data.pages[id];
    project.pages[id] = { ...p, _timers: [] };
  }
  for (const g of project.groups) {
    if (g.showPriority === undefined) g.showPriority = false;
  }
  return project;
}

async function save(forceAs = false) {
  if (!window.api) { toast('Сохранение доступно только в Electron'); return; }
  const data = JSON.stringify(serialize());
  if (forceAs || !state.project.path) {
    const path = await window.api.saveProjectAs(data, 'project.DDproj');
    if (!path) return;
    state.project.path = path;
  } else {
    await window.api.saveProject(state.project.path, data);
  }
  dirty = false;
  toast('Сохранено');
}

async function openProject() {
  if (!window.api) return;
  const res = await window.api.openProject();
  if (!res) return;
  try {
    state.project = deserialize(JSON.parse(res.data));
    state.project.path = res.path;
    state.selection = null; state.selectedCell = null;
    dirty = false;
    renderAll();
  } catch (e) {
    toast('Ошибка открытия: ' + e.message);
  }
}

setInterval(async () => {
  if (!state.project || !state.project.path || !dirty) return;
  try { await save(false); } catch (_) {}
}, 30000);

// ------- keyboard -------
document.addEventListener('keydown', e => {
  const ctrl = e.ctrlKey || e.metaKey;
  const code = e.code;
  const inInput = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (ctrl && code === 'KeyZ' && !e.altKey) {
    e.preventDefault(); e.shiftKey ? redo() : undo(); return;
  }
  if (ctrl && code === 'KeyY') { e.preventDefault(); redo(); return; }
  if (ctrl && e.altKey && code === 'KeyZ') { e.preventDefault(); redo(); return; }
  if (ctrl && code === 'KeyS') { e.preventDefault(); save(e.shiftKey); return; }
  if (ctrl && code === 'KeyO') { e.preventDefault(); openProject(); return; }
  if (ctrl && code === 'KeyN') {
    e.preventDefault();
    if (confirm('Создать новый проект?')) { state.project = newProject(); renderAll(); }
    return;
  }
  if (ctrl && code === 'KeyA') {
    const page = currentPage(); if (!page) return;
    e.preventDefault();
    if (page.objects.length) { state.selection = page.objects[page.objects.length - 1].id; renderAll(); }
    return;
  }
  if (ctrl && code === 'KeyD') { e.preventDefault(); state.selection = null; state.selectedCell = null; renderAll(); return; }
  if (ctrl && code === 'Delete') {
    const page = currentPage(); if (!page || !state.selection) return;
    const idx = page.objects.findIndex(x => x.id === state.selection);
    if (idx >= 0) { pushUndo(page); page.objects.splice(idx, 1); state.selection = null; renderAll(); }
    return;
  }
  if (code === 'Delete' || code === 'Backspace') {
    if (inInput) return;
    const page = currentPage(); if (!page || !state.selection) return;
    const idx = page.objects.findIndex(x => x.id === state.selection);
    if (idx >= 0) { e.preventDefault(); pushUndo(page); page.objects.splice(idx, 1); state.selection = null; renderAll(); }
    return;
  }
  if (!ctrl && !e.altKey && !inInput) {
    const map = { KeyB: 'brush', KeyE: 'eraser', KeyT: 'text', KeyL: 'line', KeyV: 'select' };
    if (map[code]) { state.tool = map[code]; renderAll(); return; }
    if (code === 'BracketLeft') { state.brush.size = Math.max(1, state.brush.size - 2); renderOptionsBar(); return; }
    if (code === 'BracketRight') { state.brush.size = Math.min(80, state.brush.size + 2); renderOptionsBar(); return; }
    if (code === 'PageUp') { e.preventDefault(); gotoPrev(); return; }
    if (code === 'PageDown') { e.preventDefault(); gotoNext(); return; }
    if (code === 'Escape') { state.selection = null; state.selectedCell = null; renderAll(); return; }
  }
});

// ------- paste & drop -------
document.addEventListener('paste', async e => {
  if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  const items = e.clipboardData?.items || [];
  for (const it of items) {
    if (it.type.startsWith('image/')) {
      const file = it.getAsFile();
      if (!file) continue;
      const reader = new FileReader();
      reader.onload = () => addImageObject(reader.result, false);
      reader.readAsDataURL(file);
      e.preventDefault();
      return;
    }
  }
});

canvasWrap.addEventListener('dragover', e => { e.preventDefault(); });
canvasWrap.addEventListener('drop', e => {
  e.preventDefault();
  const items = e.dataTransfer?.items || [];
  for (const it of items) {
    if (it.type.startsWith('image/')) {
      const file = it.getAsFile();
      if (!file) continue;
      const reader = new FileReader();
      reader.onload = () => addImageObject(reader.result, false);
      reader.readAsDataURL(file);
      return;
    }
  }
  const f = e.dataTransfer.files?.[0];
  if (f && f.name.endsWith('.DDproj')) {
    const r = new FileReader();
    r.onload = () => {
      try {
        state.project = deserialize(JSON.parse(r.result));
        state.project.path = f.path || null;
        renderAll();
      } catch (err) { toast('Ошибка: ' + err.message); }
    };
    r.readAsText(f);
  }
});

// ------- stretch button -------
document.getElementById('stretchBtn').addEventListener('click', () => {
  const page = currentPage(); if (!page) return;
  pushUndo(page);
  page.height += 300;
  markDirty();
  renderAll();
});

// ------- tabs -------
document.querySelectorAll('#tabs button').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#tabs button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    const which = b.dataset.tab;
    tabPages.classList.toggle('hidden', which !== 'pages');
    tabBrush.classList.toggle('hidden', which !== 'brush');
  });
});

// ------- inject PNG export buttons into topbar -------
(function injectExportButtons() {
  const topbar = document.getElementById('topbar');
  if (!topbar) return;
  // вставляем после кнопки "Сохранить" (или в конец, если её нет)
  const saveBtn = topbar.querySelector('[data-act="save"]');
  const anchor = saveBtn ? saveBtn.nextSibling : null;

  const btnExport = document.createElement('button');
  btnExport.dataset.act = 'exportPng';
  btnExport.textContent = 'PNG лист';
  btnExport.title = 'Экспортировать текущий лист в PNG';

  const btnExportAll = document.createElement('button');
  btnExportAll.dataset.act = 'exportAllPng';
  btnExportAll.textContent = 'PNG все';
  btnExportAll.title = 'Экспортировать все листы в папку';

  if (anchor) {
    topbar.insertBefore(btnExport, anchor);
    topbar.insertBefore(btnExportAll, anchor);
  } else {
    topbar.appendChild(btnExport);
    topbar.appendChild(btnExportAll);
  }
})();

// ------- INIT -------
state.project = newProject();
renderAll();