import { decodeDat } from './DatDecoder.js';

export class DataRepository {
    constructor(base = new URL('../../data/', import.meta.url).href) {
        this.base = base; this.features = new Map(); this.names = new Map(); this.searchFeatures = new Map(); this.requests = new Map(); this.listeners = new Set(); this.generation = 0; this.mapDocument = null;
    }
    async fetch(path, kind) {
        if (this.requests.has(path)) return this.requests.get(path);
        const generation = this.generation;
        const pending = (async () => {
            const response = await fetch(`${this.base}${path}`);
            if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
            const document = await decodeDat(await response.arrayBuffer());
            if (document.kind !== kind) throw new Error(`${path}: incorrect data kind`);
            if (generation !== this.generation) { const error = new Error('This map request belongs to an earlier preview'); error.code = 'STALE_PREVIEW'; throw error; }
            const target = kind === 3 ? this.searchFeatures : this.features;
            for (const feature of document.features) target.set(feature.id, feature);
            for (const name of document.names) this.names.set(name.id, name);
            if (kind === 1) this.mapDocument = document;
            for (const listener of this.listeners) listener(document);
            return document;
        })();
        this.requests.set(path, pending);
        try { return await pending; } catch (error) { if (this.requests.get(path) === pending) this.requests.delete(path); throw error; }
    }
    loadMap() { return this.fetch('map.dat', 1); }
    loadArea(settlementId) { return this.fetch(`areas/${settlementId}.dat`, 2); }
    loadSearch() { return this.fetch('search.dat', 3); }
    async get(id) {
        await this.loadMap();
        if (this.features.has(id)) return this.features.get(id);
        await this.loadSearch();
        const hint = this.searchFeatures.get(id);
        if (hint?.settlementId) await this.loadArea(hint.settlementId);
        return this.features.get(id) || hint || null;
    }
    onChange(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    reset(base = this.base) {
        ++this.generation; this.base = base; this.features.clear(); this.names.clear(); this.searchFeatures.clear(); this.requests.clear(); this.mapDocument = null;
    }
}
export const repository = new DataRepository(globalThis.window?.tbmapEditorOptions?.dataBase || new URL('../../data/', import.meta.url).href);

// Names, applicability, inheritance and lifecycle have already been resolved in
// C++. These helpers format that projection; they never revive a source label.
export function primaryName(feature, language = 'sl') {
    const current = feature.names.filter(n => n.current);
    return current.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))[0] || null;
    function rank(n) { return (n.language === language ? 0 : n.language === 'sl' ? 10 : 20) + (n.role === 0 ? 0 : 2) + (n.subjectId === feature.id ? 0 : 1); }
}
export function title(feature, language = 'sl') {
    return primaryName(feature, language)?.text || (feature.address?.number != null ? `${feature.address.number}${feature.address.suffix}` : feature.building?.number ? `#${feature.building.number}` : '—');
}
