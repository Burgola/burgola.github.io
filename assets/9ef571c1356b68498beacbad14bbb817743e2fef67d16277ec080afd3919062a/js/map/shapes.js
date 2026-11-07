// Right-angled shapes for drawing buildings (editor-drawing.js): a rectangle from one wall and how
// deep it is, a corner put square to the wall before it, an outline with its corners made square,
// and a shape moved or turned. Shapes are worked out on a flat plane around them, in metres, where
// a right angle is one on the ground and on the map.

const RAD = Math.PI / 180, METRES = 111320;

// A flat plane around `origin` ([longitude, latitude]): x east and y north, in metres.
export function localPlane(origin) {
    const across = Math.cos(origin[1] * RAD) * METRES;
    return {
        to: p => [(p[0] - origin[0]) * across, (p[1] - origin[1]) * METRES],
        from: ([x, y]) => [origin[0] + x / across, origin[1] + y / METRES],
    };
}

// The rectangle with one wall from a to b, reaching as far from that wall as c: its four corners in
// order, or null when it would have no area. A square on c's side when `square`.
export function rectangle(a, b, c, square = false) {
    const plane = localPlane(a), [bx, by] = plane.to(b), [cx, cy] = plane.to(c);
    const length = Math.hypot(bx, by);
    if (!length) return null;
    const nx = -by / length, ny = bx / length;
    let depth = cx * nx + cy * ny;
    if (square) depth = (depth < 0 ? -1 : 1) * length;
    if (Math.abs(depth) < 1e-6) return null;
    return [a, b, plane.from([bx + nx * depth, by + ny * depth]), plane.from([nx * depth, ny * depth])];
}

// `point` moved square to the wall from `before` to `corner`, when the angle it makes at `corner`
// is within `tolerance` degrees of a right angle; otherwise `point` itself.
export function squareCorner(before, corner, point, tolerance = 12) {
    const plane = localPlane(corner), [px, py] = plane.to(before), [qx, qy] = plane.to(point);
    const lp = Math.hypot(px, py), lq = Math.hypot(qx, qy);
    if (!lp || !lq || Math.abs((px * qx + py * qy) / (lp * lq)) > Math.sin(tolerance * RAD)) return point;
    const nx = -py / lp, ny = px / lp, d = qx * nx + qy * ny;
    return plane.from([nx * d, ny * d]);
}

// The outline (its corners in order, not closed) with square corners: each wall within
// `tolerance` degrees of the outline's main direction, or of square to it, is made exactly so,
// walls that then run straight on become one, and each corner is where its two walls meet. Walls
// further off keep their direction. Null when fewer than three walls would remain.
export function squareCorners(ring, tolerance = 20) {
    const n = ring.length;
    if (n < 3) return null;
    const plane = localPlane(ring[0]), points = ring.map(plane.to);
    // The main direction: the walls' directions folded into a quarter turn, the longest counting most.
    let sx = 0, sy = 0;
    for (let i = 0; i < n; i++) {
        const [x1, y1] = points[i], [x2, y2] = points[(i + 1) % n];
        const angle = Math.atan2(y2 - y1, x2 - x1), length = Math.hypot(x2 - x1, y2 - y1);
        sx += length * Math.cos(4 * angle); sy += length * Math.sin(4 * angle);
    }
    const main = Math.atan2(sy, sx) / 4, cos = Math.cos(main), sin = Math.sin(main);
    const turned = points.map(([x, y]) => [x * cos + y * sin, -x * sin + y * cos]);
    // Each wall along (h) or across (v) the main direction, or neither (null).
    const walls = [];
    for (let i = 0; i < n; i++) {
        const p = turned[i], q = turned[(i + 1) % n], angle = Math.atan2(q[1] - p[1], q[0] - p[0]);
        const off = Math.abs(Math.atan(Math.tan(angle))), along = off <= tolerance * RAD, across = Math.PI / 2 - off <= tolerance * RAD;
        const kind = along ? 'h' : across ? 'v' : null;
        const last = walls.at(-1);
        if (kind && last?.kind === kind) last.points.push(q);
        else walls.push({ kind, points: [p, q] });
    }
    if (walls.length > 1 && walls[0].kind && walls[0].kind === walls.at(-1).kind)
        walls[0].points = [...walls.pop().points, ...walls[0].points.slice(1)];
    if (walls.length < 3) return null;
    // Each wall's line: a point on it and its direction.
    const mean = (wall, axis) => wall.points.reduce((sum, p) => sum + p[axis], 0) / wall.points.length;
    const lines = walls.map(wall => wall.kind === 'h' ? { at: [0, mean(wall, 1)], d: [1, 0] }
        : wall.kind === 'v' ? { at: [mean(wall, 0), 0], d: [0, 1] }
        : { at: wall.points[0], d: [wall.points.at(-1)[0] - wall.points[0][0], wall.points.at(-1)[1] - wall.points[0][1]] });
    const corners = walls.map((wall, i) => {
        const a = lines[(i + walls.length - 1) % walls.length], b = lines[i];
        const cross = a.d[0] * b.d[1] - a.d[1] * b.d[0];
        // Walls running the same way meet where they were drawn.
        if (Math.abs(cross) < 1e-9 * Math.hypot(...a.d) * Math.hypot(...b.d)) return wall.points[0];
        const t = ((b.at[0] - a.at[0]) * b.d[1] - (b.at[1] - a.at[1]) * b.d[0]) / cross;
        return [a.at[0] + t * a.d[0], a.at[1] + t * a.d[1]];
    });
    return corners.map(([x, y]) => plane.from([x * cos - y * sin, x * sin + y * cos]));
}

// The middle of a shape's corners.
export function centreOf(points) {
    return [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length];
}

// The shape moved as far as `from` is from `to`.
export function moved(points, from, to) {
    const plane = localPlane(from), [dx, dy] = plane.to(to);
    return points.map(p => { const q = localPlane(p); return q.from([dx, dy]); });
}

// The shape turned about `centre` as far as `from` is turned to `to`, seen from the centre.
export function turned(points, centre, from, to) {
    const plane = localPlane(centre), [ax, ay] = plane.to(from), [bx, by] = plane.to(to);
    if (!Math.hypot(ax, ay) || !Math.hypot(bx, by)) return points;
    const angle = Math.atan2(by, bx) - Math.atan2(ay, ax), cos = Math.cos(angle), sin = Math.sin(angle);
    return points.map(p => { const [x, y] = plane.to(p); return plane.from([x * cos - y * sin, x * sin + y * cos]); });
}

// Whether a point is inside a ring of corners.
export function inside(point, ring) {
    let within = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > point[1]) !== (yj > point[1]) && point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi) within = !within;
    }
    return within;
}
