// Generado desde senderismo-app/src/lib con scripts/build-web-editor.sh. No editar a mano.
// Rutas por hacer (v0.8): lo que no depende del móvil. Funciones puras, con tests.
//
// - Exportar una ruta a GPX (para llevarla a Wikiloc, al reloj o mandarla por WhatsApp).
// - Tiempo estimado: método MIDE (el de las fichas de los senderos) y «a vuestro ritmo»,
//   calibrado con las salidas del grupo que tienen desnivel.
// ---------------------------------------------------------------------------
// GPX
function xmlText(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
        // Caracteres de control que no admite XML 1.0.
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}
function coord(n) {
    return String(Math.round(n * 1e6) / 1e6);
}
/** GPX 1.1 con el recorrido (<trk>) y los puntos de paso (<wpt>). Lo abren Wikiloc, Huawei Salud, OsmAnd… */
export function trackToGpx({ name, description, track, waypoints }) {
    var _a;
    const lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gpx version="1.1" creator="Senderismo" xmlns="http://www.topografix.com/GPX/1/1">',
        `  <metadata><name>${xmlText(name)}</name></metadata>`,
    ];
    for (const w of waypoints !== null && waypoints !== void 0 ? waypoints : []) {
        lines.push(`  <wpt lat="${coord(w.lat)}" lon="${coord(w.lon)}">`);
        if (w.ele !== null)
            lines.push(`    <ele>${Math.round(w.ele)}</ele>`);
        if (w.name)
            lines.push(`    <name>${xmlText(w.name)}</name>`);
        if ((_a = w.note) === null || _a === void 0 ? void 0 : _a.trim())
            lines.push(`    <desc>${xmlText(w.note.trim())}</desc>`);
        lines.push(`    <type>${w.kind}</type>`);
        lines.push('  </wpt>');
    }
    lines.push('  <trk>', `    <name>${xmlText(name)}</name>`);
    if (description === null || description === void 0 ? void 0 : description.trim())
        lines.push(`    <desc>${xmlText(description.trim())}</desc>`);
    lines.push('    <trkseg>');
    for (const p of track) {
        lines.push(p[2] === null
            ? `      <trkpt lat="${coord(p[0])}" lon="${coord(p[1])}"/>`
            : `      <trkpt lat="${coord(p[0])}" lon="${coord(p[1])}"><ele>${Math.round(p[2])}</ele></trkpt>`);
    }
    lines.push('    </trkseg>', '  </trk>', '</gpx>', '');
    return lines.join('\n');
}
/**
 * «Pla de la Casa / Cuatretondeta» -> «Pla-de-la-Casa-Cuatretondeta.gpx». Sin tildes, espacios ni
 * símbolos: así no da problemas ni en las carpetas del móvil ni al mandarlo por WhatsApp o correo.
 */
export function gpxFileName(name) {
    const clean = name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60)
        .replace(/-+$/, '');
    return `${clean || 'ruta'}.gpx`;
}
// ---------------------------------------------------------------------------
// Tiempo estimado
/** Método MIDE: 5 km/h en llano, 400 m/h subiendo, 600 m/h bajando; el mayor + la mitad del menor. Sin paradas. */
export function mideSeconds(distanceKm, gain, loss) {
    const horizontal = distanceKm / 5;
    const up = gain !== null && gain !== void 0 ? gain : 0;
    const down = loss !== null && loss !== void 0 ? loss : up; // sin dato de bajada, como en una ida y vuelta
    const vertical = up / 400 + down / 600;
    const hours = Math.max(horizontal, vertical) + Math.min(horizontal, vertical) / 2;
    return Math.round(hours * 3600);
}
/**
 * Ritmo real del grupo, comparando el tiempo total de las salidas que tienen desnivel con lo que
 * diría el MIDE. Mediana, para que una salida rara (un GPX cortado, un día de lluvia) no lo mueva.
 * Hacen falta al menos 3 salidas; si no, null.
 */
export function groupPace(hikes) {
    var _a;
    const ratios = [];
    for (const h of hikes) {
        if (h.elevationGain === null || h.distanceKm < 3 || h.durationSec <= 0)
            continue;
        const mide = mideSeconds(h.distanceKm, h.elevationGain, (_a = h.elevationLoss) !== null && _a !== void 0 ? _a : null);
        if (mide <= 0)
            continue;
        const r = h.durationSec / mide;
        if (r > 0.5 && r < 3)
            ratios.push(r); // fuera de esto, la grabación está mal
    }
    if (ratios.length < 3)
        return null;
    ratios.sort((a, b) => a - b);
    const mid = Math.floor(ratios.length / 2);
    const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
    return { factor: Math.round(median * 100) / 100, sample: ratios.length };
}
/** Redondea a los 5 minutos más cercanos (una estimación no merece más precisión). */
export function roundTo5Min(sec) {
    return Math.round(sec / 300) * 300;
}
