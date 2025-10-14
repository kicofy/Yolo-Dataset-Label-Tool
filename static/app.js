const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function toast(msg, ms = 1200) {
  let t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 200); }, ms);
}

function fetchJSON(url, opts = {}) {
  return fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts })
    .then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
}

async function postForm(url, formData) {
  const r = await fetch(url, { method: 'POST', body: formData });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

const state = {
  images: [],
  currentId: null,
  labels: [],
  boxes: [], // for current image, absolute pixel boxes
  selectedIndices: new Set(),
  isDrawing: false,
  drawStart: null,
  activeLabelId: 0,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  hoverIndex: -1,
  hoverCorner: null,
};

const ui = {
  thumbs: $('#thumbs'),
  img: $('#image'),
  canvas: $('#canvas'),
  overlay: $('#overlay'),
  labelSelect: $('#label-select'),
  newLabelName: $('#new-label-name'),
  addLabelBtn: $('#btn-add-label'),
  refreshBtn: $('#btn-refresh'),
  uploadImages: $('#upload-images'),
  uploadZip: $('#upload-zip'),
  exportBtn: $('#btn-export'),
  boxList: $('#box-list'),
};

const ctx = ui.canvas.getContext('2d');
const octx = ui.overlay.getContext('2d');

function computeCanvasLayout() {
  const wrap = $('.canvas-wrap');
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  ui.canvas.width = w;
  ui.canvas.height = h;
  ui.overlay.width = w;
  ui.overlay.height = h;
  if (!ui.img.naturalWidth) return;
  const iw = ui.img.naturalWidth, ih = ui.img.naturalHeight;
  const scale = Math.min(w / iw, h / ih);
  const dw = iw * scale, dh = ih * scale;
  state.scale = scale;
  state.offsetX = (w - dw) / 2;
  state.offsetY = (h - dh) / 2;
  // Position and size the image to match layout exactly
  ui.img.style.left = state.offsetX + 'px';
  ui.img.style.top = state.offsetY + 'px';
  ui.img.style.width = (iw * scale) + 'px';
  ui.img.style.height = (ih * scale) + 'px';
}

function absToCanvas(box) {
  return {
    x: state.offsetX + box.x * state.scale,
    y: state.offsetY + box.y * state.scale,
    width: box.width * state.scale,
    height: box.height * state.scale,
  };
}

function canvasToAbs(x, y) {
  return {
    x: Math.round((x - state.offsetX) / state.scale),
    y: Math.round((y - state.offsetY) / state.scale),
  };
}

function draw() {
  ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
  for (let i = 0; i < state.boxes.length; i++) {
    const b = state.boxes[i];
    const c = absToCanvas(b);
    const isSel = state.selectedIndices.has(i);
    ctx.lineWidth = isSel ? 3 : 2;
    ctx.strokeStyle = isSel ? '#29ccb1' : '#5b8cff';
    ctx.strokeRect(c.x, c.y, c.width, c.height);
    // handle
    ctx.fillStyle = isSel ? '#29ccb1' : '#5b8cff';
    const s = 6;
    ctx.fillRect(c.x - s, c.y - s, s*2, s*2);
    ctx.fillRect(c.x + c.width - s, c.y - s, s*2, s*2);
    ctx.fillRect(c.x - s, c.y + c.height - s, s*2, s*2);
    ctx.fillRect(c.x + c.width - s, c.y + c.height - s, s*2, s*2);
  }
}

function drawCrosshair(px, py) {
  octx.clearRect(0, 0, ui.overlay.width, ui.overlay.height);
  if (px == null || py == null) return;
  // Crosshair lines
  octx.strokeStyle = 'rgba(255,255,255,0.5)';
  octx.lineWidth = 1;
  octx.beginPath();
  octx.moveTo(px, 0); octx.lineTo(px, ui.overlay.height);
  octx.moveTo(0, py); octx.lineTo(ui.overlay.width, py);
  octx.stroke();
  // Coordinate tooltip in image pixel space
  const a = canvasToAbs(px, py);
  const label = `(${a.x}, ${a.y})`;
  const pad = 4;
  const margin = 8;
  octx.font = '12px Inter, system-ui, sans-serif';
  const tw = octx.measureText(label).width + pad * 2;
  const th = 18;
  // Place at bottom-right of the displayed image area to avoid blocking content
  const iw = ui.img.naturalWidth || 1;
  const ih = ui.img.naturalHeight || 1;
  const left = state.offsetX;
  const top = state.offsetY;
  const right = left + iw * state.scale;
  const bottom = top + ih * state.scale;
  let bx = Math.min(ui.overlay.width - tw - margin, Math.max(0, right - tw - margin));
  let by = Math.min(ui.overlay.height - th - margin, Math.max(0, bottom - th - margin));
  octx.fillStyle = 'rgba(0,0,0,0.7)';
  octx.fillRect(bx, by, tw, th);
  octx.fillStyle = '#fff';
  octx.fillText(label, bx + pad, by + th - 5);
}

function drawHoverLabel(boxIndex) {
  octx.clearRect(0, 0, ui.overlay.width, ui.overlay.height);
  if (boxIndex == null || boxIndex < 0) return;
  const b = state.boxes[boxIndex];
  const c = absToCanvas(b);
  const name = labelName(b.classId);
  const pad = 6;
  octx.font = '12px Inter, system-ui, sans-serif';
  const tw = octx.measureText(name).width + pad * 2;
  const th = 18;
  let bx = Math.max(0, Math.min(ui.overlay.width - tw, c.x));
  let by = Math.max(0, c.y - th - 6);
  octx.fillStyle = 'rgba(0,0,0,0.75)';
  octx.fillRect(bx, by, tw, th);
  octx.fillStyle = '#fff';
  octx.fillText(name, bx + pad, by + th - 5);
}

function updateBoxList() {
  ui.boxList.innerHTML = '';
  state.boxes.forEach((b, i) => {
    const el = document.createElement('div');
    el.className = 'box-item';
    el.innerHTML = `<div><strong>#${i}</strong> <span class="meta">${labelName(b.classId)} | ${b.x},${b.y} ${b.width}x${b.height}</span></div>
      <div class="actions"><button data-k="focus">Focus</button><button data-k="del">Delete</button></div>`;
    el.querySelector('[data-k="focus"]').onclick = () => { state.selectedIndices = new Set([i]); draw(); };
    el.querySelector('[data-k="del"]').onclick = () => { deleteBox(i); };
    ui.boxList.appendChild(el);
  });
}

function labelName(id) { return state.labels.find(l => l.id === id)?.name ?? String(id); }

function renderThumbs() {
  ui.thumbs.innerHTML = '';
  state.images.forEach(img => {
    const tpl = document.getElementById('thumb-item');
    const node = tpl.content.firstElementChild.cloneNode(true);
    const im = node.querySelector('img');
    im.src = img.url;
    node.onclick = () => openImage(img.id);
    if (state.currentId === img.id) node.classList.add('active');
    ui.thumbs.appendChild(node);
    im.onload = () => drawThumbCanvas(node, img);
  });
}

function drawThumbCanvas(node, img) {
  const c = node.querySelector('.thumb-canvas');
  const ctx2 = c.getContext('2d');
  const im = node.querySelector('img');
  // Use the actual rendered image box size
  const rect = im.getBoundingClientRect();
  const nrect = node.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  c.width = w; c.height = h;
  // Position the canvas to overlay the image region inside the node
  const left = rect.left - nrect.left;
  const top = rect.top - nrect.top;
  c.style.left = left + 'px';
  c.style.top = top + 'px';
  ctx2.clearRect(0, 0, w, h);
  if (!img.thumbBoxes || !img.thumbBoxes.length) return;
  img.thumbBoxes.forEach(b => {
    ctx2.strokeStyle = '#29ccb1';
    ctx2.lineWidth = 2;
    ctx2.strokeRect(b.x * w, b.y * h, b.width * w, b.height * h);
  });
}

async function loadImages() {
  const data = await fetchJSON('/api/images');
  state.images = data.images;
  renderThumbs();
  if (!state.currentId && state.images.length) openImage(state.images[0].id);
}

async function loadLabels() {
  const data = await fetchJSON('/api/labels');
  state.labels = data.labels;
  ui.labelSelect.innerHTML = state.labels.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
  if (state.labels.length) {
    state.activeLabelId = state.labels[0].id;
    ui.labelSelect.value = state.activeLabelId;
  }
}

async function addLabel() {
  const name = ui.newLabelName.value.trim();
  if (!name) return;
  const res = await fetchJSON('/api/labels', { method: 'POST', body: JSON.stringify({ name }) });
  if (!state.labels.some(l => l.id === res.id)) state.labels.push({ id: res.id, name: res.name });
  ui.labelSelect.innerHTML = state.labels.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
  ui.labelSelect.value = res.id;
  state.activeLabelId = res.id;
  ui.newLabelName.value = '';
}

async function openImage(id) {
  state.currentId = id;
  const img = state.images.find(i => i.id === id);
  if (!img) return;
  ui.img.src = img.url;
  await ui.img.decode().catch(() => {});
  computeCanvasLayout();
  window.requestAnimationFrame(draw);
  const ann = await fetchJSON('/api/annotations/' + encodeURIComponent(id)).catch(() => ({ boxes: [] }));
  state.boxes = ann.boxes || [];
  state.selectedIndices.clear();
  draw();
  updateBoxList();
  renderThumbs();
}

async function saveAnnotations() {
  if (!state.currentId) return;
  await fetchJSON('/api/annotations/' + encodeURIComponent(state.currentId), {
    method: 'PUT',
    body: JSON.stringify({ boxes: state.boxes }),
  }).catch(() => {});
  // Update current image thumbBoxes locally for immediate feedback
  const iw = ui.img.naturalWidth || 1;
  const ih = ui.img.naturalHeight || 1;
  const entry = state.images.find(i => i.id === state.currentId);
  if (entry) {
    entry.thumbBoxes = state.boxes.slice(0, 20).map(b => ({
      classId: b.classId,
      x: b.x / iw,
      y: b.y / ih,
      width: b.width / iw,
      height: b.height / ih,
    }));
  }
}

function deleteBox(i) {
  state.boxes.splice(i, 1);
  state.selectedIndices.clear();
  draw();
  updateBoxList();
  saveAnnotations();
}

function pointerPos(e) {
  const r = ui.canvas.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  return { x, y };
}

let drag = null; // { type: 'move'|'resize'|'pan'|'draw', index, start, boxStart, corner }

function hitTestHandle(c, x, y, s=6) {
  const handles = [
    { corner: 'tl', px: c.x, py: c.y },
    { corner: 'tr', px: c.x + c.width, py: c.y },
    { corner: 'bl', px: c.x, py: c.y + c.height },
    { corner: 'br', px: c.x + c.width, py: c.y + c.height },
  ];
  for (const h of handles) {
    if (Math.abs(x - h.px) <= s*2 && Math.abs(y - h.py) <= s*2) return h.corner;
  }
  return null;
}

function hitTestEdge(c, x, y, t=6) {
  const onX = x >= c.x - t && x <= c.x + c.width + t;
  const onY = y >= c.y - t && y <= c.y + c.height + t;
  if (!onX || !onY) return false;
  const nearLeft = Math.abs(x - c.x) <= t;
  const nearRight = Math.abs(x - (c.x + c.width)) <= t;
  const nearTop = Math.abs(y - c.y) <= t;
  const nearBottom = Math.abs(y - (c.y + c.height)) <= t;
  return nearLeft || nearRight || nearTop || nearBottom;
}

function cornerToCursor(corner) {
  if (corner === 'tl' || corner === 'br') return 'nwse-resize';
  if (corner === 'tr' || corner === 'bl') return 'nesw-resize';
  return 'default';
}

function getHoverInfo(px, py) {
  const idx = findBoxAt(px, py);
  if (idx < 0) return { index: -1, corner: null, onEdge: false };
  const c = absToCanvas(state.boxes[idx]);
  const corner = hitTestHandle(c, px, py);
  if (corner) return { index: idx, corner, onEdge: false };
  const onEdge = hitTestEdge(c, px, py, 6);
  return { index: idx, corner: null, onEdge };
}

function findBoxAt(x, y) {
  for (let i = state.boxes.length - 1; i >= 0; i--) {
    const c = absToCanvas(state.boxes[i]);
    if (x >= c.x && x <= c.x + c.width && y >= c.y && y <= c.y + c.height) return i;
  }
  return -1;
}

ui.canvas.addEventListener('pointerdown', (e) => {
  if (!state.currentId) return;
  ui.canvas.setPointerCapture(e.pointerId);
  const p = pointerPos(e);
  const hover = getHoverInfo(p.x, p.y);
  if (hover.index >= 0) {
    state.selectedIndices = new Set([hover.index]);
    if (hover.corner) {
      drag = { type: 'resize', index: hover.index, start: p, corner: hover.corner, boxStart: { ...state.boxes[hover.index] } };
    } else {
      drag = { type: 'move', index: hover.index, start: p, boxStart: state.boxes.map(b => ({ ...b })) };
    }
  } else {
    // draw new box
    drag = { type: 'draw', start: p };
    state.isDrawing = true;
    state.drawStart = p;
  }
  draw();
});

ui.canvas.addEventListener('pointermove', (e) => {
  const p = pointerPos(e);
  const hover = getHoverInfo(p.x, p.y);
  state.hoverIndex = hover.index;
  state.hoverCorner = hover.corner;
  if (drag && drag.type === 'move') {
    const dx = (p.x - drag.start.x) / state.scale;
    const dy = (p.y - drag.start.y) / state.scale;
    const indices = state.selectedIndices.size ? [...state.selectedIndices] : [drag.index];
    for (const i of indices) {
      const b = state.boxes[i];
      const startB = drag.boxStart[i];
      b.x = Math.round(startB.x + dx);
      b.y = Math.round(startB.y + dy);
    }
    draw();
  } else if (drag && drag.type === 'resize') {
    const b = { ...drag.boxStart };
    const delta = { x: (p.x - drag.start.x) / state.scale, y: (p.y - drag.start.y) / state.scale };
    if (drag.corner === 'tl') { b.x += delta.x; b.y += delta.y; b.width -= delta.x; b.height -= delta.y; }
    if (drag.corner === 'tr') { b.y += delta.y; b.width += delta.x; b.height -= delta.y; }
    if (drag.corner === 'bl') { b.x += delta.x; b.width -= delta.x; b.height += delta.y; }
    if (drag.corner === 'br') { b.width += delta.x; b.height += delta.y; }
    state.boxes[drag.index] = { ...b };
    draw();
  } else if (drag && drag.type === 'draw') {
    draw();
    ctx.setLineDash([6,4]);
    ctx.strokeStyle = '#29ccb1';
    ctx.lineWidth = 2;
    ctx.strokeRect(drag.start.x, drag.start.y, p.x - drag.start.x, p.y - drag.start.y);
    ctx.setLineDash([]);
  } else {
    // No dragging: update overlay for hover (hide crosshair on box)
    if (hover.index >= 0) {
      drawHoverLabel(hover.index);
    } else {
      drawCrosshair(p.x, p.y);
    }
    // Update cursor
    if (hover.corner) ui.canvas.style.cursor = cornerToCursor(hover.corner);
    else if (hover.index >= 0 || hover.onEdge) ui.canvas.style.cursor = 'move';
    else ui.canvas.style.cursor = 'crosshair';
  }
});

// crosshair tracking driven by main canvas so overlay won't intercept events
ui.canvas.addEventListener('pointerleave', () => { drawCrosshair(null, null); ui.canvas.style.cursor = 'default'; state.hoverIndex = -1; state.hoverCorner = null; });

ui.canvas.addEventListener('pointerup', async (e) => {
  if (!drag) return;
  const p = pointerPos(e);
  if (drag.type === 'draw') {
    const a0 = canvasToAbs(drag.start.x, drag.start.y);
    const a1 = canvasToAbs(p.x, p.y);
    const x = Math.min(a0.x, a1.x);
    const y = Math.min(a0.y, a1.y);
    const w = Math.abs(a0.x - a1.x);
    const h = Math.abs(a0.y - a1.y);
    if (w >= 2 && h >= 2) {
      state.boxes.push({ classId: state.activeLabelId, x, y, width: w, height: h });
      state.selectedIndices = new Set([state.boxes.length - 1]);
      draw();
      updateBoxList();
      await saveAnnotations();
      toast('Saved');
    }
  } else if (drag.type === 'move' || drag.type === 'resize') {
    // clamp will happen server side; just save
    await saveAnnotations();
  }
  drag = null;
  state.isDrawing = false;
  state.drawStart = null;
  renderThumbs();
});

ui.labelSelect.addEventListener('change', () => {
  state.activeLabelId = Number(ui.labelSelect.value);
});

ui.addLabelBtn.addEventListener('click', async () => {
  try { await addLabel(); toast('Label added'); } catch (e) { toast('Failed to add'); }
});

ui.refreshBtn.addEventListener('click', () => { loadImages(); });

ui.uploadImages.addEventListener('change', async (e) => {
  const files = e.target.files;
  if (!files || !files.length) return;
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  try {
    await postForm('/api/upload/images', fd);
    toast('Uploaded successfully');
    await loadImages();
  } catch (err) { toast('Upload failed'); }
  e.target.value = '';
});

ui.uploadZip.addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  const fd = new FormData();
  fd.append('file', f);
  try {
    await postForm('/api/upload/zip', fd);
    toast('ZIP uploaded');
    await loadImages();
  } catch (err) { toast('Upload failed'); }
  e.target.value = '';
});

ui.exportBtn.addEventListener('click', async () => {
  const a = document.createElement('a');
  a.href = '/api/export';
  a.click();
});

window.addEventListener('resize', () => { computeCanvasLayout(); draw(); });
// Also redraw thumbs on resize, as their rendered size may change
window.addEventListener('resize', () => { renderThumbs(); });

// init
(async function init() {
  await Promise.all([loadLabels(), loadImages()]);
})();


