// The current TBMap binary contract. PublicDat.cpp writes these fields in this
// order. There is deliberately no format negotiation or alternate data reader.
export const FeatureKind = Object.freeze({ municipality: 1, settlement: 2, street: 3, building: 4, address: 5, site: 6, group: 7 });
export const NameRole = Object.freeze({ preferred: 0, alternative: 1, historical: 2 });
export const Outcome = Object.freeze({ unreviewed: 0, confirmed: 1, uncertain: 2, disputed: 3, rejected: 4, unreadable: 5 });
export const SourceStatus = Object.freeze({ local: 0, present: 1, absent: 2, unavailable: 3 });
const MAX_BYTES = 256 * 1024 * 1024;
const utf8 = new TextDecoder('utf-8', { fatal: true });

class Reader {
    constructor(bytes) { this.bytes = bytes; this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); this.offset = 0; }
    require(size) { if (!Number.isSafeInteger(size) || size < 0 || this.offset + size > this.bytes.length) throw new Error('Truncated TBMap data'); }
    u8() { this.require(1); return this.view.getUint8(this.offset++); }
    u16() { this.require(2); const v = this.view.getUint16(this.offset, true); this.offset += 2; return v; }
    u32() { this.require(4); const v = this.view.getUint32(this.offset, true); this.offset += 4; return v; }
    i32() { this.require(4); const v = this.view.getInt32(this.offset, true); this.offset += 4; return v; }
    f64() { this.require(8); const v = this.view.getFloat64(this.offset, true); this.offset += 8; if (!Number.isFinite(v)) throw new Error('Non-finite TBMap coordinate'); return v; }
    raw(size) { this.require(size); const v = this.bytes.subarray(this.offset, this.offset + size); this.offset += size; return v; }
    blob() { return this.raw(this.u32()); }
    count() { const v = this.u32(); if (v > 1000000) throw new Error('Invalid TBMap record count'); return v; }
    enum(max) { const v = this.u8(); if (v > max) throw new Error('Invalid TBMap enum'); return v; }
    id(optional = false) {
        const bytes = this.raw(16);
        if (bytes.every(v => v === 0)) { if (optional) return null; throw new Error('Missing TBMap identity'); }
        const hex = [...bytes].map(v => v.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    integer() { const n = this.i32(); return n === -2147483648 ? null : n; }
    end() { if (this.offset !== this.bytes.length) throw new Error('Unexpected TBMap section bytes'); }
}
function geometry(bytes) {
    if (!bytes.length) return null;
    const r = new Reader(bytes), kind = r.enum(5), count = r.count(), polygons = [];
    if (!kind || !count || count > 100000) throw new Error('Invalid TBMap geometry');
    let total = 0;
    for (let p = 0; p < count; ++p) {
        const rings = [], ringCount = r.count();
        if (!ringCount || ringCount > 100000) throw new Error('Invalid TBMap rings');
        for (let i = 0; i < ringCount; ++i) {
            const points = r.count(), ring = [];
            total += points;
            if (!points || total > 5000000) throw new Error('Invalid TBMap geometry size');
            r.require(points * 16);
            for (let j = 0; j < points; ++j) {
                const x = r.f64(), y = r.f64();
                if (Math.abs(x) > 180 || Math.abs(y) > 90) throw new Error('Coordinates outside WGS84');
                ring.push([x, y]);
            }
            if ((kind === 3 || kind === 4) && (points < 4 || ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1])) throw new Error('Unclosed TBMap polygon');
            rings.push(ring);
        }
        polygons.push(rings);
    }
    r.end();
    if (kind === 1) {
        if (count !== 1 || polygons[0].length !== 1 || polygons[0][0].length !== 1) throw new Error('Invalid point');
        return { type: 'Point', coordinates: polygons[0][0][0] };
    }
    if (kind === 2 || kind === 5) {
        if ((kind === 2 && count !== 1) || polygons.some(p => p.length !== 1 || p[0].length < 2)) throw new Error('Invalid line');
        return { type: kind === 2 ? 'LineString' : 'MultiLineString', coordinates: kind === 2 ? polygons[0][0] : polygons.map(p => p[0]) };
    }
    if (kind === 3 && count !== 1) throw new Error('Invalid polygon');
    return { type: kind === 3 ? 'Polygon' : 'MultiPolygon', coordinates: kind === 3 ? polygons[0] : polygons };
}
const review = r => ({ outcome: r.enum(5), stale: !!r.enum(1) });
function notes(r, string) {
    const result = Object.create(null), count = r.u16();
    for (let i = 0; i < count; ++i) {
        const language = string(r), text = string(r);
        if (Object.hasOwn(result, language)) throw new Error('Duplicate localized note');
        result[language] = text;
    }
    return result;
}

export async function decodeDat(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length < 98 || bytes.length > MAX_BYTES) throw new Error('Invalid TBMap file size');
    const payload = bytes.subarray(0, -32);
    const checksum = new Uint8Array(await crypto.subtle.digest('SHA-256', payload));
    if (!checksum.every((b, i) => b === bytes[bytes.length - 32 + i])) throw new Error('TBMap checksum mismatch');
    const header = new Reader(bytes);
    if (utf8.decode(header.raw(8)) !== 'TBMAPDAT') throw new Error('Invalid TBMap signature');
    const kind = header.enum(3);
    if (!kind || header.u32() !== bytes.length || header.u8() !== 4) throw new Error('Invalid TBMap directory');
    const sections = [];
    let end = 66;
    for (let tag = 1; tag <= 4; ++tag) {
        if (header.u8() !== tag) throw new Error('Invalid TBMap section order');
        const offset = header.u32(), length = header.u32(), count = header.count();
        if (offset !== end || offset + length > bytes.length - 32) throw new Error('Invalid TBMap section range');
        sections.push({ reader: new Reader(bytes.subarray(offset, offset + length)), count });
        end = offset + length;
    }
    if (end !== bytes.length - 32) throw new Error('Unreferenced TBMap bytes');
    const strings = [], text = sections[0];
    for (let i = 0; i < text.count; ++i) strings.push(utf8.decode(text.reader.blob()));
    text.reader.end();
    if (!strings.length || strings[0] !== '') throw new Error('Missing TBMap empty string');
    const string = r => { const index = r.u32(); if (index >= strings.length) throw new Error('Invalid TBMap string index'); return strings[index]; };
    const names = [], useIds = new Set(), nameSection = sections[1], n = nameSection.reader;
    for (let i = 0; i < nameSection.count; ++i) {
        const value = { id: n.id(), nameId: n.id(), subjectId: n.id(), text: string(n), language: string(n), official: string(n), role: n.enum(2), current: !!n.enum(1), source: n.enum(3), textReview: review(n), attachmentReview: review(n), from: string(n) || null, until: string(n) || null, period: string(n), notes: notes(n, string) };
        if (!value.text.trim() || !value.language || useIds.has(value.id)) throw new Error('Invalid or duplicate name use');
        useIds.add(value.id); names.push(value);
    }
    n.end();
    const features = [], featureIds = new Set(), featureSection = sections[2], f = featureSection.reader;
    for (let i = 0; i < featureSection.count; ++i) {
        const value = { id: f.id(), kind: f.enum(7), existence: f.enum(2), source: f.enum(3), category: f.i32(), settlementId: f.id(true), municipalityId: f.id(true), legacyKind: string(f), legacyId: string(f), geometry: geometry(f.blob()), position: null, bounds: null };
        if (featureIds.has(value.id) || !value.kind) throw new Error('Invalid or duplicate feature');
        featureIds.add(value.id);
        if (f.enum(1)) { value.position = [f.f64(), f.f64()]; if (Math.abs(value.position[0]) > 180 || Math.abs(value.position[1]) > 90) throw new Error('Invalid label location'); }
        if (f.enum(1)) { value.bounds = [f.f64(), f.f64(), f.f64(), f.f64()]; const [w, s, e, n] = value.bounds; if (w > e || s > n || w < -180 || e > 180 || s < -90 || n > 90) throw new Error('Invalid feature bounds'); }
        value.locationQuality = f.enum(3); value.locationReview = review(f); value.existenceReview = review(f); value.noNameReview = review(f); value.detailsReview = review(f);
        value.progress = { total: f.count(), done: f.count(), attention: f.count() };
        if (value.progress.done > value.progress.total || value.progress.attention > value.progress.total - value.progress.done) throw new Error('Invalid naming progress counts');
        value.members = []; const memberCount = f.count();
        for (let m = 0; m < memberCount; ++m) value.members.push(f.id());
        value.names = []; const nameCount = f.count(), links = new Set();
        for (let n = 0; n < nameCount; ++n) { const index = f.u32(); if (index >= names.length || links.has(index)) throw new Error('Invalid or duplicate name link'); links.add(index); value.names.push(names[index]); }
        value.notes = notes(f, string); value.oldNumbers = []; const oldCount = f.count();
        for (let o = 0; o < oldCount; ++o) value.oldNumbers.push({ id: f.id(), number: string(f), settlement: string(f), period: string(f) });
        value.address = null;
        if (f.enum(1)) value.address = { settlementId: f.id(), buildingId: f.id(true), streetId: f.id(true), number: f.integer(), suffix: string(f), postalCode: string(f), postalName: string(f), communityKind: string(f), community: string(f), schoolDistrict: string(f), administrativeUnit: string(f) };
        value.building = null;
        if (f.enum(1)) {
            const b = { cadastralCode: string(f), cadastralName: string(f), number: string(f), type: string(f), structure: string(f), year: f.integer(), floors: f.integer(), dwellings: f.integer(), businessPremises: f.integer(), utilities: Object.create(null) };
            const utilityCount = f.enum(4);
            for (let u = 0; u < utilityCount; ++u) { const key = f.enum(3); if (Object.hasOwn(b.utilities, key)) throw new Error('Duplicate utility'); b.utilities[key] = string(f); }
            value.building = b;
        }
        features.push(value);
    }
    f.end();
    const metadata = sections[3];
    if (metadata.count !== 1) throw new Error('Invalid TBMap metadata count');
    const attribution = string(metadata.reader), boundary = geometry(metadata.reader.blob());
    metadata.reader.end();
    return { kind, features, names, attribution, boundary };
}
