// Generado desde senderismo-app/src/lib con scripts/build-web-editor.sh. No editar a mano.
// Lectura de archivos GPX (Wikiloc, Huawei Salud, Strava...) y cálculo de
// distancia, desnivel y tiempos. Sin dependencias: funciona igual en la app
// que en los tests de Node.
export const WAYPOINT_KINDS = {
    fuente: { label: 'Fuente', icon: '💧' },
    cima: { label: 'Cima', icon: '⛰️' },
    collado: { label: 'Collado', icon: '🏞️' },
    mirador: { label: 'Mirador', icon: '👀' },
    refugio: { label: 'Refugio / casa', icon: '🏠' },
    cueva: { label: 'Cueva', icon: '🕳️' },
    patrimonio: { label: 'Ermita, castillo, nevera…', icon: '🏛️' },
    aparcamiento: { label: 'Aparcamiento', icon: '🅿️' },
    foto: { label: 'Foto de grupo', icon: '📸' },
    almuerzo: { label: 'Almuerzo', icon: '🥪' },
    refrigerio: { label: 'Parada de refrigerio', icon: '🍊' },
    singular: { label: 'Punto singular', icon: '⭐' },
    cuidado: { label: '¡Cuidado!', icon: '⚠️' },
    otro: { label: 'Punto de paso', icon: '📍' },
};
/** Tipos para elegir al poner una parada en el editor (los más habituales primero). */
export const STOP_KINDS = [
    'foto',
    'almuerzo',
    'refrigerio',
    'singular',
    'aparcamiento',
    'fuente',
    'cuidado',
    'mirador',
    'cima',
    'otro',
];
const EARTH_RADIUS_M = 6371000;
// Variaciones de altitud menores que esto se consideran ruido del GPS.
const ELEVATION_THRESHOLD_M = 4;
// Ventana para decidir si se estaba andando o parado.
const MOVING_WINDOW_SEC = 30;
const MOVING_MIN_SPEED_MS = 0.25; // ~0,9 km/h
const MAX_TRACK_POINTS = 600;
export function distanceMeters(a, b) {
    const toRad = Math.PI / 180;
    const p1 = a.lat * toRad;
    const p2 = b.lat * toRad;
    const dp = p2 - p1;
    const dl = (b.lon - a.lon) * toRad;
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
function decodeText(raw) {
    if (!raw)
        return null;
    let text = raw.trim();
    const cdata = text.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
    if (cdata) {
        text = cdata[1];
    }
    else {
        text = text
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&amp;/g, '&');
    }
    text = text.trim();
    return text.length ? text : null;
}
function firstTag(xml, tag) {
    const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`));
    return m === null || m === void 0 ? void 0 : m[1];
}
export function parseGpxPoints(xml) {
    var _a;
    const points = [];
    // trkpt (recorridos grabados); si no hay, rtept (rutas planificadas).
    for (const tag of ['trkpt', 'rtept']) {
        const re = new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${tag}>)`, 'g');
        let m;
        while ((m = re.exec(xml))) {
            const attrs = m[1];
            const body = (_a = m[2]) !== null && _a !== void 0 ? _a : '';
            const lat = attrs.match(/\blat\s*=\s*["']([-+\d.eE]+)["']/);
            const lon = attrs.match(/\blon\s*=\s*["']([-+\d.eE]+)["']/);
            if (!lat || !lon)
                continue;
            const eleText = firstTag(body, 'ele');
            const timeText = firstTag(body, 'time');
            const ele = eleText !== undefined ? Number(eleText.trim()) : NaN;
            const time = timeText !== undefined ? Date.parse(timeText.trim()) : NaN;
            points.push({
                lat: Number(lat[1]),
                lon: Number(lon[1]),
                ele: Number.isFinite(ele) ? ele : null,
                time: Number.isFinite(time) ? time : null,
            });
        }
        if (points.length)
            break;
    }
    return points;
}
// Palabras (en castellano, valenciano e inglés) que delatan el tipo de punto.
// Se mira cuál aparece antes: «Coll de la Font» es un collado; «Font del Coll», una fuente.
const KIND_WORDS = [
    ['fuente', ['fuente', 'font', 'fonte', 'manantial', 'nacimiento', 'naixement', 'agua', 'aigua', 'water', 'spring', 'drinking']],
    ['cima', ['cima', 'cim', 'cumbre', 'pico', 'pic', 'puig', 'tossal', 'tossa', 'vertice', 'geodesico', 'summit', 'peak']],
    ['collado', ['collado', 'coll', 'collet', 'puerto', 'port', 'portell', 'portillo', 'pass', 'saddle']],
    ['mirador', ['mirador', 'viewpoint', 'scenic', 'vista', 'vistas', 'panoramica']],
    ['refugio', ['refugio', 'refugi', 'shelter', 'hut', 'lodge', 'casa', 'caseta', 'mas', 'masia', 'cortijo', 'albergue', 'alberg']],
    ['cueva', ['cueva', 'cova', 'cave', 'sima', 'avenc']],
    ['patrimonio', ['ermita', 'castillo', 'castell', 'iglesia', 'esglesia', 'nevera', 'cava', 'pou de neu', 'pozo de nieve', 'molino', 'moli', 'torre', 'ruina', 'ruinas', 'castle', 'church', 'chapel', 'ruins']],
    // Paradas propias (las exporta el editor con su tipo; también las reconoce en otros GPX).
    ['aparcamiento', ['aparcamiento', 'aparcament', 'parking', 'parquing', 'aparcar']],
    ['foto', ['foto', 'fotografia', 'photo']],
    ['almuerzo', ['almuerzo', 'almorzar', 'esmorzar', 'esmorzaret', 'comida', 'dinar', 'lunch', 'picnic']],
    ['refrigerio', ['refrigerio', 'avituallamiento', 'descanso', 'snack']],
    ['singular', ['singular', 'destacado']],
    ['cuidado', ['cuidado', 'peligro', 'precaucion', 'atencion', 'compte', 'perill', 'danger', 'warning', 'caution']],
];
function normalize(text) {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, ' ');
}
/** Tipo de punto según su tipo/símbolo y, si no dicen nada, según su nombre. */
export function classifyWaypoint(name, type, sym) {
    for (const text of [`${type !== null && type !== void 0 ? type : ''} ${sym !== null && sym !== void 0 ? sym : ''}`, name !== null && name !== void 0 ? name : '']) {
        const t = ` ${normalize(text)} `;
        let best = null;
        for (const [kind, words] of KIND_WORDS) {
            for (const w of words) {
                const at = t.indexOf(` ${w} `);
                if (at >= 0 && (!best || at < best.at))
                    best = { kind, at };
            }
        }
        if (best)
            return best.kind;
    }
    return 'otro';
}
/** Km del recorrido más cercano al punto; null si está a más de `maxMeters`. */
export function kmAlongTrack(track, lat, lon, maxMeters = 300) {
    let bestDist = Infinity;
    let bestKm = null;
    for (const p of track) {
        const d = distanceMeters({ lat, lon }, { lat: p[0], lon: p[1] });
        if (d < bestDist) {
            bestDist = d;
            bestKm = p[3];
        }
    }
    return bestDist <= maxMeters && bestKm !== null ? round(bestKm, 1) : null;
}
export function parseWaypoints(xml, track = []) {
    var _a, _b;
    const out = [];
    const re = /<(?:\w+:)?wpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?wpt>)/g;
    let m;
    while ((m = re.exec(xml))) {
        const attrs = m[1];
        const body = (_a = m[2]) !== null && _a !== void 0 ? _a : '';
        const lat = attrs.match(/\blat\s*=\s*["']([-+\d.eE]+)["']/);
        const lon = attrs.match(/\blon\s*=\s*["']([-+\d.eE]+)["']/);
        if (!lat || !lon)
            continue;
        const latN = Number(lat[1]);
        const lonN = Number(lon[1]);
        if (!Number.isFinite(latN) || !Number.isFinite(lonN))
            continue;
        const eleText = firstTag(body, 'ele');
        const ele = eleText !== undefined ? Number(eleText.trim()) : NaN;
        const name = decodeText(firstTag(body, 'name'));
        const note = (_b = decodeText(firstTag(body, 'desc'))) !== null && _b !== void 0 ? _b : decodeText(firstTag(body, 'cmt'));
        out.push({
            name,
            lat: round(latN, 6),
            lon: round(lonN, 6),
            ele: Number.isFinite(ele) ? Math.round(ele) : null,
            kind: classifyWaypoint(name, decodeText(firstTag(body, 'type')), decodeText(firstTag(body, 'sym'))),
            km: track.length ? kmAlongTrack(track, latN, lonN) : null,
            ...(note && note !== name ? { note } : {}),
        });
    }
    // Ordenados como se encuentran andando; los que quedan fuera del recorrido, al final.
    return out.sort((a, b) => { var _a, _b; return ((_a = a.km) !== null && _a !== void 0 ? _a : Infinity) - ((_b = b.km) !== null && _b !== void 0 ? _b : Infinity); });
}
/** Desnivel acumulado ignorando oscilaciones menores que el umbral. */
export function elevationGainLoss(elevations, threshold = ELEVATION_THRESHOLD_M) {
    if (elevations.length < 2)
        return { gain: 0, loss: 0 };
    let gain = 0;
    let loss = 0;
    let ref = elevations[0];
    for (const e of elevations) {
        if (e - ref >= threshold) {
            gain += e - ref;
            ref = e;
        }
        else if (ref - e >= threshold) {
            loss += ref - e;
            ref = e;
        }
    }
    return { gain: Math.round(gain), loss: Math.round(loss) };
}
/** Tiempo en movimiento: se agrupan los puntos en ventanas y se descartan las que van demasiado lentas. */
export function movingSeconds(points) {
    const timed = points.filter((p) => p.time !== null);
    if (timed.length < 2)
        return null;
    let moving = 0;
    let start = timed[0];
    let dist = 0;
    for (let i = 1; i < timed.length; i++) {
        dist += distanceMeters(timed[i - 1], timed[i]);
        const dt = (timed[i].time - start.time) / 1000;
        if (dt >= MOVING_WINDOW_SEC || i === timed.length - 1) {
            if (dt > 0 && dist / dt >= MOVING_MIN_SPEED_MS)
                moving += dt;
            start = timed[i];
            dist = 0;
        }
    }
    return Math.round(moving);
}
/** Reduce el recorrido a como mucho `max` puntos repartidos por distancia, conservando inicio y final. */
export function simplifyTrack(points, max = MAX_TRACK_POINTS) {
    if (!points.length)
        return [];
    const cumulative = [0];
    for (let i = 1; i < points.length; i++) {
        cumulative.push(cumulative[i - 1] + distanceMeters(points[i - 1], points[i]));
    }
    const total = cumulative[cumulative.length - 1];
    const step = total / Math.max(1, max - 1);
    const out = [];
    let next = 0;
    for (let i = 0; i < points.length; i++) {
        if (cumulative[i] >= next || i === points.length - 1) {
            const p = points[i];
            out.push([
                round(p.lat, 6),
                round(p.lon, 6),
                p.ele === null ? null : Math.round(p.ele),
                round(cumulative[i] / 1000, 3),
            ]);
            next = cumulative[i] + step;
        }
    }
    return out;
}
/**
 * Simplificación que conserva la forma (Douglas-Peucker): quita los puntos que se separan menos
 * de `toleranceM` metros de la línea entre sus vecinos. Si aun así quedan más de `max`, se
 * repite con más tolerancia. Los km de cada punto son los del recorrido original.
 */
export function simplifyKeepingShape(points, toleranceM = 2, max = 3000) {
    if (!points.length)
        return [];
    const cumulative = [0];
    for (let i = 1; i < points.length; i++)
        cumulative.push(cumulative[i - 1] + distanceMeters(points[i - 1], points[i]));
    // Proyección local en metros (basta para distancias de una excursión).
    const lat0 = (points[0].lat * Math.PI) / 180;
    const mPerDegLat = 111320;
    const mPerDegLon = 111320 * Math.cos(lat0);
    const xs = points.map((p) => p.lon * mPerDegLon);
    const ys = points.map((p) => p.lat * mPerDegLat);
    const keepFor = (tol) => {
        const keep = new Uint8Array(points.length);
        keep[0] = 1;
        keep[points.length - 1] = 1;
        const stack = [[0, points.length - 1]];
        while (stack.length) {
            const [a, b] = stack.pop();
            if (b - a < 2)
                continue;
            const dx = xs[b] - xs[a];
            const dy = ys[b] - ys[a];
            const len2 = dx * dx + dy * dy;
            let worst = -1;
            let worstD = 0;
            for (let i = a + 1; i < b; i++) {
                let d;
                if (len2 === 0) {
                    d = Math.hypot(xs[i] - xs[a], ys[i] - ys[a]);
                }
                else {
                    const t = Math.max(0, Math.min(1, ((xs[i] - xs[a]) * dx + (ys[i] - ys[a]) * dy) / len2));
                    d = Math.hypot(xs[i] - (xs[a] + t * dx), ys[i] - (ys[a] + t * dy));
                }
                if (d > worstD) {
                    worstD = d;
                    worst = i;
                }
            }
            if (worst >= 0 && worstD > tol) {
                keep[worst] = 1;
                stack.push([a, worst], [worst, b]);
            }
        }
        return keep;
    };
    let tol = toleranceM;
    let keep = keepFor(tol);
    let count = keep.reduce((s, k) => s + k, 0);
    while (count > max) {
        tol *= 1.5;
        keep = keepFor(tol);
        count = keep.reduce((s, k) => s + k, 0);
    }
    const out = [];
    for (let i = 0; i < points.length; i++) {
        if (!keep[i])
            continue;
        const p = points[i];
        out.push([round(p.lat, 6), round(p.lon, 6), p.ele === null ? null : Math.round(p.ele), round(cumulative[i] / 1000, 3)]);
    }
    return out;
}
/** Recalcula los km acumulados de un recorrido (después de editarlo). */
export function withKm(points) {
    const out = [];
    let total = 0;
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (i > 0)
            total += distanceMeters({ lat: points[i - 1][0], lon: points[i - 1][1] }, { lat: p[0], lon: p[1] });
        out.push([round(p[0], 6), round(p[1], 6), p[2] === null ? null : Math.round(p[2]), round(total / 1000, 3)]);
    }
    return out;
}
/**
 * Distancia y desnivel calculados sobre un recorrido ya simplificado (rutas editadas o dibujadas).
 * Sin altitud en la mitad de los puntos o más, el desnivel queda en null.
 */
export function trackStats(track) {
    let distance = 0;
    for (let i = 1; i < track.length; i++) {
        distance += distanceMeters({ lat: track[i - 1][0], lon: track[i - 1][1] }, { lat: track[i][0], lon: track[i][1] });
    }
    const eles = track.map((p) => p[2]).filter((e) => e !== null);
    const hasEle = track.length > 0 && eles.length > track.length / 2;
    const { gain, loss } = elevationGainLoss(eles);
    return {
        distanceKm: round(distance / 1000, 2),
        elevationGain: hasEle ? gain : null,
        elevationLoss: hasEle ? loss : null,
        minEle: hasEle ? Math.round(minOf(eles)) : null,
        maxEle: hasEle ? Math.round(maxOf(eles)) : null,
    };
}
// Bucles en vez de Math.min(...arr): con grabaciones largas el spread desborda la pila.
function minOf(values) {
    let m = Infinity;
    for (const v of values)
        if (v < m)
            m = v;
    return m;
}
function maxOf(values) {
    let m = -Infinity;
    for (const v of values)
        if (v > m)
            m = v;
    return m;
}
function round(n, decimals) {
    const f = 10 ** decimals;
    return Math.round(n * f) / f;
}
export function summarizeGpx(xml) {
    var _a, _b, _c, _d, _e;
    const points = parseGpxPoints(xml);
    if (points.length < 2) {
        throw new Error('El archivo no contiene un recorrido (no se han encontrado puntos GPS).');
    }
    let distance = 0;
    for (let i = 1; i < points.length; i++)
        distance += distanceMeters(points[i - 1], points[i]);
    const elevations = points.map((p) => p.ele).filter((e) => e !== null);
    const hasEle = elevations.length > points.length / 2;
    const { gain, loss } = elevationGainLoss(elevations);
    const times = points.map((p) => p.time).filter((t) => t !== null);
    const startTime = times.length ? minOf(times) : null;
    const endTime = times.length ? maxOf(times) : null;
    const trk = (_b = (_a = firstTag(xml, 'trk')) !== null && _a !== void 0 ? _a : firstTag(xml, 'rte')) !== null && _b !== void 0 ? _b : '';
    const metadata = (_c = firstTag(xml, 'metadata')) !== null && _c !== void 0 ? _c : '';
    const name = (_d = decodeText(firstTag(trk, 'name'))) !== null && _d !== void 0 ? _d : decodeText(firstTag(metadata, 'name'));
    const description = (_e = decodeText(firstTag(trk, 'desc'))) !== null && _e !== void 0 ? _e : decodeText(firstTag(trk, 'cmt'));
    const track = simplifyTrack(points);
    return {
        name,
        description,
        startTime,
        distanceKm: round(distance / 1000, 2),
        durationSec: startTime !== null && endTime !== null ? Math.round((endTime - startTime) / 1000) : null,
        movingSec: movingSeconds(points),
        elevationGain: hasEle ? gain : null,
        elevationLoss: hasEle ? loss : null,
        minEle: hasEle ? Math.round(minOf(elevations)) : null,
        maxEle: hasEle ? Math.round(maxOf(elevations)) : null,
        pointCount: points.length,
        track,
        detailedTrack: simplifyKeepingShape(points),
        waypoints: parseWaypoints(xml, track),
    };
}
