// Editor de rutas de Senderismo para el ordenador.
// La lógica (km, desnivel, añadir, cortar, paradas, GPX, caminos de BRouter…) es la misma que la de
// la app: está en lib/, compilada desde senderismo-app/src/lib con scripts/build-web-editor.sh.

import { STOP_KINDS, WAYPOINT_KINDS, summarizeGpx, trackStats, withKm } from './lib/gpx.js';
import { gpxFileName, mideSeconds, trackToGpx } from './lib/plans.js';
import {
  addPoint, addStop, applyElevations, attachRoute, brouterUrl, cutAt, deletePoint, elevationUrl, ELEVATION_BATCH,
  extendFrom, metersBetween, missingElevation, movePoint, moveStop, nearestSegment, nearestVertex, parseBrouterRoute,
  pathMeters, removeStop, reversePoints, scaledDistanceKm, stopsForSave, TRAIL_PROFILES, updateStop,
} from './lib/routeEdit.js';

const $ = (id) => document.getElementById(id);
const DRAFT_KEY = 'senderismo-editor-borrador';
const HANDLES_MIN_ZOOM = 15;
const HANDLES_MAX = 400;
const PLAN = '#2F6FA8', START = '#2F6B4F', END = '#B4442F';

// ---------------------------------------------------------------------------
// Estado

let points = [];   // [lat, lon, altitud|null]
let stops = [];    // puntos de paso (paradas)
let original = null; // { distanceKm, geometryKm } del GPX abierto (para los km, como en la app)
let tool = 'anadir';
let followTrails = (localStorage.getItem('editor-seguir-caminos') ?? '1') === '1';
let history = [];
let future = [];
let routing = false;
let dirty = false;

const snapshot = () => ({ points, stops, name: $('name').value, original });

function change(next, { fit = false } = {}) {
  history.push(snapshot());
  if (history.length > 100) history.shift();
  future = [];
  if (next.points) points = next.points;
  if (next.stops) stops = next.stops;
  dirty = true;
  render({ fit });
  scheduleElevations();
  saveDraft();
}

function undo() {
  const prev = history.pop();
  if (!prev) return;
  future.push(snapshot());
  restore(prev);
}

function redo() {
  const next = future.pop();
  if (!next) return;
  history.push(snapshot());
  restore(next);
}

function restore(s) {
  points = s.points; stops = s.stops; original = s.original; $('name').value = s.name;
  dirty = true;
  render();
  scheduleElevations();
  saveDraft();
}

// ---------------------------------------------------------------------------
// Mapa

const LAYERS = {
  'Calles (OpenStreetMap)': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }),
  'Topo (OpenTopoMap)': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 18, maxNativeZoom: 17, subdomains: 'abc',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM · estilo © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)' }),
  'IGN (topográfico)': L.tileLayer('https://www.ign.es/wmts/mapa-raster?request=GetTile&service=WMTS&version=1.0.0&layer=MTN&style=default&TileMatrixSet=GoogleMapsCompatible&TileMatrix={z}&TileCol={x}&TileRow={y}&format=image/jpeg', {
    maxZoom: 18, maxNativeZoom: 17, attribution: '© <a href="https://www.ign.es">Instituto Geográfico Nacional</a>' }),
  'Satélite (PNOA)': L.tileLayer('https://www.ign.es/wmts/pnoa-ma?request=getTile&service=WMTS&version=1.0.0&layer=OI.OrthoimageCoverage&style=default&TileMatrixSet=GoogleMapsCompatible&TileMatrix={z}&TileCol={x}&TileRow={y}&format=image/jpeg', {
    maxZoom: 19, attribution: 'PNOA © <a href="https://www.ign.es">Instituto Geográfico Nacional</a>' }),
};

const map = L.map('map', { doubleClickZoom: false, boxZoom: false }).setView([38.7, -0.47], 12);
map.attributionControl.setPrefix(false);
const savedLayer = localStorage.getItem('editor-capa');
(LAYERS[savedLayer] ?? LAYERS['Topo (OpenTopoMap)']).addTo(map);
L.control.layers(LAYERS, null, { position: 'topright' }).addTo(map);
map.on('baselayerchange', (e) => localStorage.setItem('editor-capa', e.name));
L.control.scale({ imperial: false }).addTo(map);

const renderer = L.canvas({ padding: 0.5 });
const line = L.polyline([], { color: PLAN, weight: 5, opacity: 0.9, lineJoin: 'round', renderer, interactive: false }).addTo(map);
const startM = L.circleMarker([0, 0], { radius: 7, color: '#fff', weight: 2, fillColor: START, fillOpacity: 1, renderer, interactive: false });
const endM = L.circleMarker([0, 0], { radius: 9, color: END, weight: 3, fill: false, renderer, interactive: false });
const handles = L.layerGroup().addTo(map);
const stopsLayer = L.layerGroup().addTo(map);
const here = L.marker([0, 0], { icon: L.divIcon({ className: '', html: '<div class="here"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }), interactive: false, zIndexOffset: 2000 });
let dragging = false;

function metersPerPixel(lat) {
  return (156543.03 * Math.cos((lat * Math.PI) / 180)) / 2 ** map.getZoom();
}

function setHint(text) { $('hint').textContent = text || ''; }

function drawLine() {
  line.setLatLngs(points.map((p) => [p[0], p[1]]));
  if (points.length) startM.setLatLng([points[0][0], points[0][1]]).addTo(map); else map.removeLayer(startM);
  if (points.length > 1) endM.setLatLng([points.at(-1)[0], points.at(-1)[1]]).addTo(map); else map.removeLayer(endM);
}

function drawHandles() {
  if (dragging) return;
  handles.clearLayers();
  if (tool !== 'mover' && tool !== 'quitar') {
    setHint(tool === 'cortar' ? 'Haz clic en la ruta donde quieras cortar'
      : tool === 'parada' ? 'Clic en el mapa para poner una parada; clic en una para cambiarla'
      : points.length ? '' : 'Haz clic en el mapa donde empieza la ruta');
    return;
  }
  if (map.getZoom() < HANDLES_MIN_ZOOM) { setHint('Acércate para ver los puntos'); return; }
  const view = map.getBounds().pad(0.2);
  const idx = [];
  points.forEach((p, i) => { if (view.contains([p[0], p[1]])) idx.push(i); });
  if (idx.length > HANDLES_MAX) { setHint('Acércate más para ver los puntos'); return; }
  setHint(tool === 'mover' ? 'Arrastra un punto para moverlo' : 'Haz clic en un punto para quitarlo');
  for (const i of idx) {
    const icon = L.divIcon({ className: '', html: `<div class="h${tool === 'quitar' ? ' del' : ''}"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] });
    const m = L.marker([points[i][0], points[i][1]], { icon, draggable: tool === 'mover', autoPan: true }).addTo(handles);
    if (tool === 'quitar') {
      m.on('click', () => change({ points: deletePoint(points, i) }));
    } else {
      m.on('dragstart', () => { dragging = true; });
      m.on('drag', (e) => {
        const ll = e.target.getLatLng();
        const pts = points.map((p) => [p[0], p[1]]);
        pts[i] = [ll.lat, ll.lng];
        line.setLatLngs(pts);
      });
      m.on('dragend', (e) => {
        dragging = false;
        const ll = e.target.getLatLng();
        change({ points: movePoint(points, i, ll.lat, ll.lng) });
      });
    }
  }
}

function drawStops() {
  stopsLayer.clearLayers();
  const on = tool === 'parada';
  stops.forEach((w, i) => {
    const icon = L.divIcon({ className: '', html: `<div class="st${on ? ' on' : ''}">${WAYPOINT_KINDS[w.kind]?.icon ?? '📍'}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] });
    const m = L.marker([w.lat, w.lon], { icon, draggable: on, zIndexOffset: 800, title: stopName(w) }).addTo(stopsLayer);
    m.on('click', () => { if (on) editStop(i); else map.panTo([w.lat, w.lon]); });
    if (on) m.on('dragend', (e) => { const ll = e.target.getLatLng(); change({ stops: moveStop(stops, i, ll.lat, ll.lng) }); });
  });
}

function fit() {
  const all = [...points.map((p) => [p[0], p[1]]), ...stops.map((w) => [w.lat, w.lon])];
  if (all.length > 1) map.fitBounds(L.latLngBounds(all), { padding: [40, 40], maxZoom: 16 });
  else if (all.length === 1) map.setView(all[0], 15);
}

map.on('moveend', drawHandles);

// ---------------------------------------------------------------------------
// Clics en el mapa

map.on('click', (e) => {
  const lat = e.latlng.lat, lon = e.latlng.lng;
  const mpp = metersPerPixel(lat);
  if (tool === 'anadir') {
    if (routing) return;
    const onTrackM = Math.max(5, 12 * mpp);
    const hit = nearestSegment(points, lat, lon);
    const onTrack = hit !== null && hit.distM <= onTrackM && hit.t > 0 && hit.t < 1;
    const { where, from } = extendFrom(points, lat, lon);
    if (followTrails && !onTrack && from) addAlongTrail(from, { lat, lon }, where);
    else change({ points: addPoint(points, lat, lon, onTrackM).points });
  } else if (tool === 'cortar') {
    const hit = nearestVertex(points, lat, lon);
    if (!hit || points.length < 3 || hit.distM > Math.max(15, 20 * mpp)) return;
    if (hit.index === 0 || hit.index === points.length - 1) { toast('Eso es un extremo: haz clic más hacia dentro de la ruta.'); return; }
    const at = withKm(points)[hit.index][3];
    modal(`Cortar en el km ${fmt(at, 1)}`, '<p>¿Qué parte quieres quitar?</p>', [
      { text: 'Cancelar' },
      { text: 'Lo de antes', onClick: () => change({ points: cutAt(points, hit.index, 'antes') }) },
      { text: 'Lo de después', primary: true, onClick: () => change({ points: cutAt(points, hit.index, 'despues') }) },
    ]);
  } else if (tool === 'parada') {
    newStop(lat, lon);
  }
});

async function findTrail(from, to) {
  let last = '';
  for (const profile of TRAIL_PROFILES) {
    let res;
    try {
      res = await fetch(brouterUrl(from, to, profile));
    } catch {
      throw new Error('No hay conexión con el servidor de caminos.');
    }
    if (res.ok) return parseBrouterRoute(await res.json());
    last = (await res.text().catch(() => '')).trim();
    if (!/profile/i.test(last)) break;
  }
  throw new Error(/island|not mapped|no track|position/i.test(last)
    ? 'No hay ningún camino conocido hasta ahí (o el punto está lejos de cualquier senda).'
    : `El servidor de caminos no ha podido calcularlo${last ? `: ${last.slice(0, 120)}` : '.'}`);
}

async function addAlongTrail(from, to, where) {
  const straight = () => change({ points: addPoint(points, to.lat, to.lon, 0).points });
  routing = true; $('busy').hidden = false;
  try {
    const route = await findTrail({ lat: from[0], lon: from[1] }, to);
    const direct = metersBetween({ lat: from[0], lon: from[1] }, to);
    const length = pathMeters(route);
    const useIt = () => change({ points: attachRoute(points, route, where) });
    if (length > 2000 && length > direct * 3) {
      modal('El camino da mucha vuelta', `<p>Por las sendas salen <b>${fmt(length / 1000, 1)} km</b>, y en línea recta ${fmt(direct / 1000, 1)} km.</p>`, [
        { text: 'Cancelar' }, { text: 'Línea recta', onClick: straight }, { text: 'Por el camino', primary: true, onClick: useIt },
      ]);
    } else useIt();
  } catch (e) {
    modal('No he encontrado camino', `<p>${esc(e.message)}</p><p>¿Lo añado en línea recta?</p>`, [
      { text: 'Cancelar' }, { text: 'En línea recta', primary: true, onClick: straight },
    ]);
  } finally {
    routing = false; $('busy').hidden = true;
  }
}

// ---------------------------------------------------------------------------
// Paradas

function stopName(w) { return w.name || WAYPOINT_KINDS[w.kind]?.label || 'Parada'; }

function stopForm(w) {
  const kinds = STOP_KINDS.map((k) => `<button type="button" data-kind="${k}" class="${k === w.kind ? 'on' : ''}"><span>${WAYPOINT_KINDS[k].icon}</span>${esc(WAYPOINT_KINDS[k].label)}</button>`).join('');
  return `<div class="kinds">${kinds}</div>
    <div class="field"><label>Nombre (si no, el del tipo)</label><input id="f-name" type="text" value="${esc(w.name ?? '')}"></div>
    <div class="field"><label>Nota</label><textarea id="f-note" placeholder="«A la sombra del pino», «ojo con el desvío»…">${esc(w.note ?? '')}</textarea></div>`;
}

function wireKinds(state) {
  document.querySelectorAll('#modal .kinds button').forEach((b) => b.addEventListener('click', () => {
    state.kind = b.dataset.kind;
    document.querySelectorAll('#modal .kinds button').forEach((x) => x.classList.toggle('on', x === b));
  }));
}

function newStop(lat, lon) {
  const state = { kind: 'foto' };
  modal('Nueva parada', stopForm({ kind: 'foto' }), [
    { text: 'Cancelar' },
    { text: 'Poner parada', primary: true, onClick: () => change({ stops: addStop(stops, lat, lon, state.kind, $('f-name').value, $('f-note').value) }) },
  ]);
  wireKinds(state);
  $('f-name').focus();
}

function editStop(i) {
  const w = stops[i];
  const state = { kind: w.kind };
  modal('Parada', stopForm(w), [
    { text: 'Borrar', danger: true, onClick: () => change({ stops: removeStop(stops, i) }) },
    { text: 'Cancelar' },
    { text: 'Guardar', primary: true, onClick: () => change({ stops: updateStop(stops, i, { kind: state.kind, name: $('f-name').value, note: $('f-note').value }) }) },
  ]);
  wireKinds(state);
}

// ---------------------------------------------------------------------------
// Altitudes de los puntos nuevos (Open-Meteo)

let elevTimer = null;
let elevFailed = false;

function scheduleElevations() {
  clearTimeout(elevTimer);
  elevFailed = false;
  if (!missingElevation(points).length) return;
  elevTimer = setTimeout(fetchElevations, 1000);
}

async function fetchElevations() {
  const asked = missingElevation(points).slice(0, 3000).map((index) => ({ index, lat: points[index][0], lon: points[index][1] }));
  const elevations = [];
  try {
    for (let i = 0; i < asked.length; i += ELEVATION_BATCH) {
      const batch = asked.slice(i, i + ELEVATION_BATCH);
      const res = await fetch(elevationUrl(batch.map((a) => [a.lat, a.lon])));
      if (!res.ok) throw new Error(String(res.status));
      const body = await res.json();
      batch.forEach((_, k) => elevations.push(body.elevation?.[k]));
    }
    points = applyElevations(points, asked, elevations);
    saveDraft();
  } catch {
    elevFailed = true;
  }
  render();
}

// ---------------------------------------------------------------------------
// Pintar: mapa, números, perfil y lista de paradas

function fmt(n, d = 0) { return n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }); }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function duration(sec) {
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}

function render({ fit: doFit = false } = {}) {
  drawLine();
  drawHandles();
  drawStops();
  if (doFit) fit();

  const track = withKm(points);
  const st = trackStats(track);
  const km = scaledDistanceKm(st.distanceKm, original?.distanceKm ?? null, original?.geometryKm ?? null);
  const missing = missingElevation(points).length;
  const has = points.length > 1;
  $('st-km').textContent = has ? `${fmt(km, 2)} km` : '—';
  $('st-up').textContent = has && st.elevationGain !== null ? `+${fmt(st.elevationGain)} m` : '—';
  $('st-down').textContent = has && st.elevationLoss !== null ? `−${fmt(st.elevationLoss)} m` : '—';
  $('st-max').textContent = has && st.maxEle !== null ? `${fmt(st.maxEle)} m` : '—';
  $('st-time').textContent = has ? `≈ ${duration(Math.round(mideSeconds(km, st.elevationGain, st.elevationLoss) / 300) * 300)}` : '—';
  $('st-note').textContent = !has ? '' : missing
    ? (elevFailed ? `${missing} puntos sin altitud (¿sin conexión?): el desnivel puede salir corto.` : 'Calculando altitudes…')
    : 'En la app, la ficha da además el tiempo «a vuestro ritmo».';

  // Los km del perfil y de las paradas, en la misma escala que la distancia de arriba
  // (un GPX de Wikiloc suma algo más que el recorrido simplificado; la app hace lo mismo).
  const ratio = has && st.distanceKm > 0 ? km / st.distanceKm : 1;
  drawProfile(track, ratio);
  drawStopList(track, ratio);
  $('btn-undo').disabled = !history.length;
  $('btn-redo').disabled = !future.length;
  $('btn-reverse').disabled = points.length < 2;
  document.querySelectorAll('.tools button').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
  $('btn-follow').textContent = followTrails ? '🥾 Seguir caminos: sí' : '📏 Línea recta';
  $('btn-follow').classList.toggle('on', followTrails);
  document.body.className = `mode-${tool}`;
  document.title = `${$('name').value || 'Editor de rutas'} · Senderismo`;
}

function drawProfile(track, ratio = 1) {
  const withEle = track.filter((p) => p[2] !== null);
  const box = $('profile');
  if (withEle.length < 2) { box.innerHTML = '<p class="muted small">Aparecerá al dibujar la ruta.</p>'; map.removeLayer(here); return; }
  const W = 300, H = 130, left = 34, bottom = 16, top = 8;
  const total = track.at(-1)[3] || 1;
  const eles = withEle.map((p) => p[2]);
  let min = Math.min(...eles), max = Math.max(...eles);
  if (max - min < 20) { max += 10; min -= 10; }
  const x = (k) => left + (k / total) * (W - left - 4);
  const y = (e) => top + (H - top - bottom) * (1 - (e - min) / (max - min));
  const path = withEle.map((p, i) => `${i ? 'L' : 'M'}${x(p[3]).toFixed(1)},${y(p[2]).toFixed(1)}`).join(' ');
  const area = `${path} L${x(withEle.at(-1)[3]).toFixed(1)},${H - bottom} L${x(withEle[0][3]).toFixed(1)},${H - bottom} Z`;
  const stopMarks = stopsForSave(track, stops).filter((w) => w.km !== null)
    .map((w) => `<text x="${x(w.km)}" y="${top + 10}" font-size="11" text-anchor="middle">${WAYPOINT_KINDS[w.kind]?.icon ?? '📍'}</text>`).join('');
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <path d="${area}" fill="#F7EADB"/><path d="${path}" fill="none" stroke="#C9792B" stroke-width="2"/>
      <text x="2" y="${top + 8}" font-size="10" fill="#68736C">${fmt(max)} m</text>
      <text x="2" y="${H - bottom}" font-size="10" fill="#68736C">${fmt(min)} m</text>
      <text x="${left}" y="${H - 3}" font-size="10" fill="#68736C">0</text>
      <text x="${W - 4}" y="${H - 3}" font-size="10" fill="#68736C" text-anchor="end">${fmt(total * ratio, 1)} km</text>
      ${stopMarks}
      <line id="cursor" x1="0" x2="0" y1="${top}" y2="${H - bottom}" stroke="#1E2A23" stroke-width="1" visibility="hidden"/>
    </svg><div class="readout" id="readout">Pasa el ratón por el perfil para verlo en el mapa.</div>`;
  const svg = box.querySelector('svg');
  svg.addEventListener('mousemove', (ev) => {
    const r = svg.getBoundingClientRect();
    const k = Math.max(0, Math.min(total, ((ev.clientX - r.left) / r.width * W - left) / (W - left - 4) * total));
    let i = track.findIndex((p) => p[3] >= k);
    if (i < 0) i = track.length - 1;
    const p = track[i];
    here.setLatLng([p[0], p[1]]).addTo(map);
    const c = svg.querySelector('#cursor');
    c.setAttribute('x1', x(p[3])); c.setAttribute('x2', x(p[3])); c.setAttribute('visibility', 'visible');
    $('readout').textContent = `km ${fmt(p[3] * ratio, 2)}${p[2] !== null ? ` · ${fmt(p[2])} m` : ''}`;
  });
  svg.addEventListener('mouseleave', () => {
    map.removeLayer(here);
    svg.querySelector('#cursor').setAttribute('visibility', 'hidden');
    $('readout').textContent = 'Pasa el ratón por el perfil para verlo en el mapa.';
  });
}

function drawStopList(track, ratio = 1) {
  const ordered = stops.map((w, i) => ({ w, i, km: stopsForSave(track, [w])[0]?.km ?? null }))
    .sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity));
  $('stops-count').textContent = stops.length ? `(${stops.length})` : '';
  $('stops-empty').hidden = stops.length > 0;
  $('stops').innerHTML = ordered.map(({ w, i, km }) =>
    `<li data-i="${i}" title="Clic: ver y cambiar"><span class="ic">${WAYPOINT_KINDS[w.kind]?.icon ?? '📍'}</span>
      <span class="nm">${esc(stopName(w))}${w.note ? `<br><span class="muted small">${esc(w.note)}</span>` : ''}</span>
      <span class="km">${km !== null ? `km ${fmt(km * ratio, 1)}` : ''}</span></li>`).join('');
  $('stops').querySelectorAll('li').forEach((li) => li.addEventListener('click', () => {
    const i = Number(li.dataset.i);
    map.setView([stops[i].lat, stops[i].lon], Math.max(map.getZoom(), 15));
    editStop(i);
  }));
}

// ---------------------------------------------------------------------------
// Abrir y guardar

function openGpxText(text, fileName) {
  let s;
  try { s = summarizeGpx(text); } catch (e) {
    modal('No se ha podido abrir', `<p>«${esc(fileName)}»: ${esc(e.message)}</p>`, [{ text: 'Vale', primary: true }]);
    return;
  }
  const doOpen = () => {
    history = []; future = [];
    const track = s.detailedTrack?.length ? s.detailedTrack : s.track;
    points = track.map((p) => [p[0], p[1], p[2]]);
    stops = s.waypoints ?? [];
    original = { distanceKm: s.distanceKm, geometryKm: trackStats(track).distanceKm };
    $('name').value = s.name ?? fileName.replace(/\.gpx$/i, '');
    dirty = false;
    tool = 'mover';
    render({ fit: true });
    scheduleElevations();
    saveDraft();
  };
  if (dirty && points.length) {
    modal('Abrir otra ruta', '<p>Se cambiará la ruta que estás dibujando. ¿Has guardado el GPX?</p>', [
      { text: 'Cancelar' }, { text: 'Abrir', primary: true, onClick: doOpen },
    ]);
  } else doOpen();
}

function readFile(file) {
  if (!file) return;
  file.text().then((t) => openGpxText(t, file.name));
}

function saveGpx() {
  const name = $('name').value.trim();
  if (points.length < 2) { modal('Falta recorrido', '<p>La ruta necesita al menos dos puntos.</p>', [{ text: 'Vale', primary: true }]); return; }
  if (!name) { modal('Falta el nombre', '<p>Escribe arriba, a la izquierda, cómo se llama la ruta.</p>', [{ text: 'Vale', primary: true, onClick: () => $('name').focus() }]); return; }
  const track = withKm(points);
  const xml = trackToGpx({ name, track, waypoints: stopsForSave(track, stops) });
  const url = URL.createObjectURL(new Blob([xml], { type: 'application/gpx+xml' }));
  const a = document.createElement('a');
  a.href = url; a.download = gpxFileName(name);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  dirty = false;
  const missing = missingElevation(points).length;
  modal('GPX guardado', `<p>Se ha descargado <b>${esc(gpxFileName(name))}</b>.</p>
    ${missing ? `<p class="muted">Ojo: ${missing} puntos sin altitud; el desnivel puede salir algo corto.</p>` : ''}
    <p>Para tenerla en el móvil: mándatelo (WhatsApp, Drive, correo…), ábrelo o compártelo con <b>Senderismo</b> y elige <b>«Ruta por hacer»</b>.</p>`,
    [{ text: 'Vale', primary: true }]);
}

function newRoute() {
  const doNew = () => {
    history = []; future = []; points = []; stops = []; original = null; $('name').value = ''; dirty = false;
    tool = 'anadir';
    localStorage.removeItem(DRAFT_KEY);
    render();
    $('name').focus();
  };
  if (points.length && dirty) {
    modal('Ruta nueva', '<p>Se borrará la que estás dibujando. ¿Has guardado el GPX?</p>', [
      { text: 'Cancelar' }, { text: 'Empezar de nuevo', danger: true, onClick: doNew },
    ]);
  } else doNew();
}

// Borrador: si se cierra la pestaña, al volver se recupera.
function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ points, stops, original, name: $('name').value, t: Date.now() })); } catch { /* lleno */ }
}

function loadDraft() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { d = null; }
  if (!d || !Array.isArray(d.points) || (!d.points.length && !d.stops?.length)) return false;
  points = d.points; stops = d.stops ?? []; original = d.original ?? null; $('name').value = d.name ?? '';
  render({ fit: true });
  scheduleElevations();
  toast('Se ha recuperado la ruta que estabas dibujando.');
  return true;
}

// ---------------------------------------------------------------------------
// Buscar un sitio (Nominatim, OpenStreetMap)

let searchTimer = null;
$('search').addEventListener('submit', (e) => { e.preventDefault(); search(); });
$('search-q').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(search, 700); });

async function search() {
  const q = $('search-q').value.trim();
  const list = $('search-results');
  if (q.length < 3) { list.innerHTML = ''; return; }
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=6&accept-language=es&countrycodes=es,ad,fr,pt&q=${encodeURIComponent(q)}`);
    const items = await res.json();
    list.innerHTML = items.length ? items.map((it, i) => `<li data-i="${i}">${esc(it.display_name)}</li>`).join('') : '<li class="muted">No se ha encontrado nada.</li>';
    list.querySelectorAll('li[data-i]').forEach((li) => li.addEventListener('click', () => {
      const it = items[Number(li.dataset.i)];
      if (it.boundingbox) {
        const [s, n, w, e] = it.boundingbox.map(Number);
        map.fitBounds([[s, w], [n, e]], { maxZoom: 15 });
      } else map.setView([Number(it.lat), Number(it.lon)], 14);
      list.innerHTML = '';
    }));
  } catch {
    list.innerHTML = '<li class="muted">Sin conexión con el buscador.</li>';
  }
}
document.addEventListener('click', (e) => { if (!$('search').contains(e.target)) $('search-results').innerHTML = ''; });

// ---------------------------------------------------------------------------
// Ventanitas y avisos

function modal(title, html, buttons) {
  $('modal-title').textContent = title;
  $('modal-body').innerHTML = html;
  const box = $('modal-buttons');
  box.innerHTML = '';
  for (const b of buttons) {
    const el = document.createElement('button');
    el.textContent = b.text;
    if (b.primary) el.className = 'primary';
    if (b.danger) el.style.cssText = 'color:#B4442F;border-color:#B4442F;margin-right:auto';
    el.addEventListener('click', () => { $('modal').hidden = true; b.onClick?.(); });
    box.appendChild(el);
  }
  $('modal').hidden = false;
  const primary = box.querySelector('.primary');
  if (primary && !$('modal-body').querySelector('input')) primary.focus();
}

function toast(text) {
  setHint(text);
  setTimeout(() => drawHandles(), 3500);
}

// ---------------------------------------------------------------------------
// Botones, teclado y arrastrar archivos

document.querySelectorAll('.tools button').forEach((b) => b.addEventListener('click', () => { tool = b.dataset.tool; render(); }));
$('btn-follow').addEventListener('click', () => {
  followTrails = !followTrails;
  localStorage.setItem('editor-seguir-caminos', followTrails ? '1' : '0');
  render();
});
$('btn-undo').addEventListener('click', undo);
$('btn-redo').addEventListener('click', redo);
$('btn-reverse').addEventListener('click', () => change({ points: reversePoints(points) }));
$('btn-fit').addEventListener('click', fit);
$('btn-new').addEventListener('click', newRoute);
$('btn-save').addEventListener('click', saveGpx);
$('file').addEventListener('change', (e) => { readFile(e.target.files?.[0]); e.target.value = ''; });
$('name').addEventListener('input', () => { dirty = true; saveDraft(); render(); });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { $('modal').hidden = true; $('search-results').innerHTML = ''; return; }
  const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName ?? '');
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); redo(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveGpx(); return; }
  if (typing || !$('modal').hidden || e.ctrlKey || e.metaKey || e.altKey) return;
  const tools = ['anadir', 'mover', 'quitar', 'cortar', 'parada'];
  if (/^[1-5]$/.test(e.key)) { tool = tools[Number(e.key) - 1]; render(); }
  if (e.key.toLowerCase() === 'c') $('btn-follow').click();
});

let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('drop').hidden = false; });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop').hidden = true; });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; $('drop').hidden = true;
  readFile(e.dataTransfer?.files?.[0]);
});

window.addEventListener('beforeunload', (e) => { if (dirty && points.length) { e.preventDefault(); e.returnValue = ''; } });

// ---------------------------------------------------------------------------

if (!loadDraft()) render();
