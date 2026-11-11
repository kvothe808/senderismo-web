// Generado desde senderismo-app/src/lib con scripts/build-web-editor.sh. No editar a mano.
// Editor de rutas (v0.8, fase 2): operaciones sobre el recorrido. Funciones puras, con tests.
// Ninguna modifica el recorrido que recibe: devuelven uno nuevo (así «Deshacer» es guardar el anterior).
//
// Las distancias de aquí son aproximadas (proyección plana alrededor del punto): de sobra para
// decidir dónde cae un toque en el mapa o para rellenar un tramo. Los km de verdad los calcula
// `trackStats` en gpx.ts.
const M_PER_DEG = 111320;
function toXY(lat0) {
    const k = Math.cos((lat0 * Math.PI) / 180);
    return (lat, lon) => ({ x: lon * M_PER_DEG * k, y: lat * M_PER_DEG });
}
/** Distancia aproximada en metros entre dos puntos cercanos. */
export function metersBetween(a, b) {
    const xy = toXY((a.lat + b.lat) / 2);
    const p = xy(a.lat, a.lon);
    const q = xy(b.lat, b.lon);
    return Math.hypot(p.x - q.x, p.y - q.y);
}
/** Tramo del recorrido más cercano a un punto. null si hay menos de dos puntos. */
export function nearestSegment(points, lat, lon) {
    if (points.length < 2)
        return null;
    const xy = toXY(lat);
    const p = xy(lat, lon);
    let best = null;
    for (let i = 0; i < points.length - 1; i++) {
        const a = xy(points[i][0], points[i][1]);
        const b = xy(points[i + 1][0], points[i + 1][1]);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
        const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
        if (!best || d < best.distM)
            best = { index: i, t, distM: d };
    }
    return best;
}
/** Punto del recorrido más cercano. null si no hay puntos. */
export function nearestVertex(points, lat, lon) {
    let best = null;
    points.forEach((q, i) => {
        const d = metersBetween({ lat, lon }, { lat: q[0], lon: q[1] });
        if (!best || d < best.distM)
            best = { index: i, distM: d };
    });
    return best;
}
/**
 * Puntos intermedios entre `a` y `b` cada `stepM` metros (sin `a` ni `b`), sin altitud: así el
 * modelo del terreno da un perfil con sentido aunque se dibuje con pocos toques.
 */
export function densify(a, b, stepM = 25) {
    const d = metersBetween({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] });
    const n = Math.floor(d / stepM);
    const out = [];
    for (let i = 1; i < n; i++) {
        const t = i / n;
        out.push([round6(a[0] + (b[0] - a[0]) * t), round6(a[1] + (b[1] - a[1]) * t), null]);
    }
    return out;
}
function round6(n) {
    return Math.round(n * 1e6) / 1e6;
}
/**
 * Toque en el mapa con la herramienta «Añadir»:
 * - encima del recorrido (a menos de `onTrackM`): se mete un punto ahí, en medio;
 * - fuera: se alarga la ruta por el extremo más cercano (rellenando el tramo nuevo).
 */
export function addPoint(points, lat, lon, onTrackM) {
    const p = [round6(lat), round6(lon), null];
    if (points.length === 0)
        return { points: [p], where: 'final' };
    if (points.length >= 2) {
        const hit = nearestSegment(points, lat, lon);
        if (hit && hit.distM <= onTrackM && hit.t > 0 && hit.t < 1) {
            const out = points.slice();
            out.splice(hit.index + 1, 0, p);
            return { points: out, where: 'medio' };
        }
    }
    const first = points[0];
    const last = points[points.length - 1];
    const dFirst = metersBetween({ lat, lon }, { lat: first[0], lon: first[1] });
    const dLast = metersBetween({ lat, lon }, { lat: last[0], lon: last[1] });
    if (points.length >= 2 && dFirst < dLast) {
        return { points: [p, ...densify(p, first), ...points], where: 'inicio' };
    }
    return { points: [...points, ...densify(last, p), p], where: 'final' };
}
/** Mueve un punto (pierde la altitud: la del sitio nuevo se pide otra vez). */
export function movePoint(points, index, lat, lon) {
    if (index < 0 || index >= points.length)
        return points;
    const out = points.slice();
    out[index] = [round6(lat), round6(lon), null];
    return out;
}
export function deletePoint(points, index) {
    if (index < 0 || index >= points.length)
        return points;
    return points.filter((_, i) => i !== index);
}
/** «Cortar»: se queda con lo que va desde `index` hasta el final ('antes' quita lo de antes) o al revés. */
export function cutAt(points, index, remove) {
    if (index < 0 || index >= points.length)
        return points;
    return remove === 'antes' ? points.slice(index) : points.slice(0, index + 1);
}
export function reversePoints(points) {
    return points.slice().reverse();
}
/**
 * Km de una ruta editada. El GPX original suma el temblor del GPS (por eso da algo más que el
 * recorrido simplificado): se mantiene esa proporción para que, si solo se toca un poco, los km
 * no bajen de golpe. Entre 1 y 1,15; para una ruta dibujada, 1.
 */
export function scaledDistanceKm(geometryKm, originalKm, originalGeometryKm) {
    if (!originalKm || !originalGeometryKm || originalGeometryKm <= 0)
        return round2(geometryKm);
    const ratio = Math.min(1.15, Math.max(1, originalKm / originalGeometryKm));
    return round2(geometryKm * ratio);
}
function round2(n) {
    return Math.round(n * 100) / 100;
}
/** Posiciones de los puntos que aún no tienen altitud. */
export function missingElevation(points) {
    const out = [];
    points.forEach((p, i) => {
        if (p[2] === null)
            out.push(i);
    });
    return out;
}
// ---------------------------------------------------------------------------
// Altitudes del modelo del terreno de Open-Meteo (gratis, sin clave; hasta 100 puntos por petición).
export const ELEVATION_BATCH = 100;
export function elevationUrl(coords) {
    const lat = coords.map((c) => c[0].toFixed(5)).join(',');
    const lon = coords.map((c) => c[1].toFixed(5)).join(',');
    return `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`;
}
/**
 * Pone las altitudes recibidas en los puntos pedidos. Si mientras llegaban se ha editado la ruta,
 * solo se aplican a los puntos que siguen en la misma posición y en el mismo sitio.
 */
export function applyElevations(points, asked, elevations) {
    const out = points.slice();
    asked.forEach((a, k) => {
        const e = elevations[k];
        const p = out[a.index];
        if (p && p[0] === a.lat && p[1] === a.lon && p[2] === null && typeof e === 'number' && Number.isFinite(e)) {
            out[a.index] = [p[0], p[1], Math.round(e)];
        }
    });
    return out;
}
// ---------------------------------------------------------------------------
// Paradas y puntos propios (foto de grupo, almuerzo, aparcamiento…). Se guardan como puntos de paso.
export function addStop(stops, lat, lon, kind, name, note) {
    return [...stops, { lat: round6(lat), lon: round6(lon), ele: null, km: null, kind, name: clean(name), note: clean(note) }];
}
export function updateStop(stops, index, changes) {
    if (index < 0 || index >= stops.length)
        return stops;
    const out = stops.slice();
    out[index] = { ...out[index], kind: changes.kind, name: clean(changes.name), note: clean(changes.note) };
    return out;
}
/** Al moverla, la altitud y el km se vuelven a calcular al guardar. */
export function moveStop(stops, index, lat, lon) {
    if (index < 0 || index >= stops.length)
        return stops;
    const out = stops.slice();
    out[index] = { ...out[index], lat: round6(lat), lon: round6(lon), ele: null, km: null };
    return out;
}
export function removeStop(stops, index) {
    return stops.filter((_, i) => i !== index);
}
function clean(text) {
    const t = text === null || text === void 0 ? void 0 : text.trim().replace(/\s+/g, ' ');
    return t ? t : null;
}
/**
 * Antes de guardar: el km de cada parada (si está a menos de 300 m del recorrido), la altitud del
 * punto del recorrido más cercano si no la tiene (a menos de 100 m) y ordenadas como se encuentran andando.
 */
export function stopsForSave(track, stops) {
    const placed = stops.map((w) => {
        var _a;
        let best = null;
        let bestD = Infinity;
        for (const p of track) {
            const d = metersBetween({ lat: w.lat, lon: w.lon }, { lat: p[0], lon: p[1] });
            if (d < bestD) {
                bestD = d;
                best = p;
            }
        }
        const km = best && bestD <= 300 ? Math.round(best[3] * 10) / 10 : null;
        const ele = (_a = w.ele) !== null && _a !== void 0 ? _a : (best && bestD <= 100 ? best[2] : null);
        return { ...w, km, ele };
    });
    return placed
        .map((w, i) => ({ w, i }))
        .sort((a, b) => { var _a, _b; return ((_a = a.w.km) !== null && _a !== void 0 ? _a : Infinity) - ((_b = b.w.km) !== null && _b !== void 0 ? _b : Infinity) || a.i - b.i; })
        .map((x) => x.w);
}
// ---------------------------------------------------------------------------
// «Seguir caminos»: el tramo nuevo va por las sendas (BRouter, gratis, datos de OpenStreetMap).
/** Perfil de BRouter para senderismo por montaña (si el servidor no lo tiene, se prueba el siguiente). */
export const TRAIL_PROFILES = ['hiking-mountain', 'trekking'];
export function brouterUrl(from, to, profile) {
    const ll = (p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`;
    return `https://brouter.de/brouter?lonlats=${ll(from)}%7C${ll(to)}&profile=${profile}&alternativeidx=0&format=geojson`;
}
/** Puntos del camino que devuelve BRouter (GeoJSON: [lon, lat, altitud]). Lanza un error si no trae ninguno. */
export function parseBrouterRoute(json) {
    var _a, _b, _c;
    const coords = (_c = (_b = (_a = json === null || json === void 0 ? void 0 : json.features) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.geometry) === null || _c === void 0 ? void 0 : _c.coordinates;
    if (!Array.isArray(coords))
        throw new Error('La respuesta no trae ningún camino.');
    const out = [];
    for (const c of coords) {
        if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number')
            continue;
        const ele = typeof c[2] === 'number' && Number.isFinite(c[2]) ? Math.round(c[2]) : null;
        out.push([round6(c[1]), round6(c[0]), ele]);
    }
    if (out.length < 2)
        throw new Error('La respuesta no trae ningún camino.');
    return out;
}
/** Longitud aproximada en metros de una lista de puntos. */
export function pathMeters(points) {
    let d = 0;
    for (let i = 1; i < points.length; i++) {
        d += metersBetween({ lat: points[i - 1][0], lon: points[i - 1][1] }, { lat: points[i][0], lon: points[i][1] });
    }
    return d;
}
/**
 * ¿Por qué extremo se alarga la ruta con un toque fuera del recorrido? (el más cercano; con un solo
 * punto o ninguno, por el final). Devuelve también el punto desde el que hay que buscar camino.
 */
export function extendFrom(points, lat, lon) {
    if (!points.length)
        return { where: 'final', from: null };
    const first = points[0];
    const last = points[points.length - 1];
    if (points.length >= 2) {
        const dFirst = metersBetween({ lat, lon }, { lat: first[0], lon: first[1] });
        const dLast = metersBetween({ lat, lon }, { lat: last[0], lon: last[1] });
        if (dFirst < dLast)
            return { where: 'inicio', from: first };
    }
    return { where: 'final', from: last };
}
/**
 * Pega el camino encontrado a la ruta. `route` va desde el extremo de la ruta hasta el toque
 * (para el inicio, se le da la vuelta). El primer punto del camino se quita si coincide con el extremo.
 */
export function attachRoute(points, route, where) {
    if (!points.length)
        return route.slice();
    const anchor = where === 'final' ? points[points.length - 1] : points[0];
    let path = route.slice();
    if (path.length && metersBetween({ lat: path[0][0], lon: path[0][1] }, { lat: anchor[0], lon: anchor[1] }) < 1)
        path = path.slice(1);
    return where === 'final' ? [...points, ...path] : [...path.reverse(), ...points];
}
