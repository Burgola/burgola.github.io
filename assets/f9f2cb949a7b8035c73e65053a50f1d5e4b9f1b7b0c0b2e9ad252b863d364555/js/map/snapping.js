// Snapping a drawing to the points of areas and lines already on the map, so that neighbouring
// areas, such as the parts of a village, meet without gaps: a click near one of their points takes
// exactly that point, and two clicks on the same outline follow it between them (editor-drawing.js).

// The outlines and lines of features reaching into a box [west, south, east, north]: rings without
// their closing point, and open lines.
export function outlinesIn(features, [west, south, east, north]) {
    const out = [];
    const add = (id, key, points, closed) => out.push({ id, key: `${id}/${key}`, closed, points: closed ? points.slice(0, -1) : points });
    for (const f of features) {
        const g = f.geometry, b = f.bounds;
        if (!g || !b || b[0] > east || b[2] < west || b[1] > north || b[3] < south) continue;
        if (g.type === 'Polygon') g.coordinates.forEach((ring, i) => add(f.id, i, ring, true));
        else if (g.type === 'MultiPolygon') g.coordinates.forEach((polygon, p) => polygon.forEach((ring, i) => add(f.id, `${p}.${i}`, ring, true)));
        else if (g.type === 'LineString') add(f.id, 0, g.coordinates, false);
        else if (g.type === 'MultiLineString') g.coordinates.forEach((line, i) => add(f.id, i, line, false));
    }
    return out;
}

// The outline point nearest to the pointer, within `pixels` of it on screen: { outline, index,
// point }, or null. `box` is [west, south, east, north] around the pointer, a cheap first filter;
// `project` turns [longitude, latitude] into screen { x, y }.
export function nearestPoint(outlines, pointer, box, project, pixels = 10) {
    let best = null, nearest = pixels * pixels;
    const [west, south, east, north] = box;
    for (const outline of outlines)
        outline.points.forEach((point, index) => {
            if (point[0] < west || point[0] > east || point[1] < south || point[1] > north) return;
            const p = project(point), dx = p.x - pointer.x, dy = p.y - pointer.y, distance = dx * dx + dy * dy;
            if (distance <= nearest) { nearest = distance; best = { outline, index, point }; }
        });
    return best;
}

// The points of an outline strictly between two of its points: along a line, or the shorter way
// round a ring.
export function between(outline, from, to) {
    const { points, closed } = outline, n = points.length;
    if (from === to) return [];
    const walk = step => {
        const out = [];
        for (let i = closed ? (from + step + n) % n : from + step; i !== to; i = closed ? (i + step + n) % n : i + step) out.push(points[i]);
        return out;
    };
    if (!closed) return walk(to > from ? 1 : -1);
    const length = path => {
        let total = 0, previous = points[from];
        for (const p of [...path, points[to]]) {
            total += Math.hypot((p[0] - previous[0]) * Math.cos(p[1] * Math.PI / 180), p[1] - previous[1]);
            previous = p;
        }
        return total;
    };
    const forward = walk(1), backward = walk(-1);
    return length(forward) <= length(backward) ? forward : backward;
}
