// Files kept in this browser between visits (Cache Storage: localStorage, storage.js, holds
// only short text): the aerial photo's tiles (map/tile-cache.js), the base map's tiles and
// fonts (map/basemap-tiles.js) and our data (data/DataRepository.js). A file kept is not
// fetched again, so the map draws what it has shown before without the network, and what
// map/preload.js fetched ahead it draws without the network at all.
//
// A store is named for its kind and version, tbmap-<kind>-<version>: the version changes with
// the files (a new base map, newly published data), and opening a store deletes its kind's
// other versions. Where Cache Storage cannot be used (plain http, some private windows,
// storage blocked or full) nothing is kept and everything still works: each file is fetched
// when it is needed.

export class FileStore {
    // Without a version nothing is kept: get() only fetches.
    constructor(kind, version) {
        this.pending = new Map(); // url -> Promise, while it is read or fetched
        this.opened = version && typeof caches !== 'undefined'
            ? open(`tbmap-${kind}-${version}`, `tbmap-${kind}-`)
            : Promise.resolve(null);
    }

    // Whether this browser keeps the files.
    async keeps() {
        return Boolean(await this.opened);
    }

    // The file at url (absolute), kept or else fetched and kept; null where the site has none.
    // Callers asking for the same file meanwhile share one answer, so it is theirs to read and
    // not to hand over (a buffer given to MapLibre may be emptied): copy it first.
    get(url) {
        url = new URL(url).href;
        let pending = this.pending.get(url);
        if (!pending) {
            pending = this.load(url).finally(() => this.pending.delete(url));
            this.pending.set(url, pending);
        }
        return pending;
    }

    // For fetching ahead: the file at url kept, if the site has it. Done once it is written, so
    // that writes never queue up (the browser makes them one at a time, and reading a kept
    // file, for the map, waits for those before it); throws where it cannot be kept.
    async keep(url) {
        url = new URL(url).href;
        if (this.pending.has(url) || await this.match(url)) return;
        const response = await fetch(url, { priority: 'low' });
        if (response.status === 404) return;
        if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
        if (!(await this.put(url, response))) throw new Error(`${url}: not kept (storage full?)`);
    }

    async load(url) {
        const kept = await this.match(url);
        if (kept) {
            try {
                return await kept.arrayBuffer();
            } catch {
                // unreadable after all: fetched again below
            }
        }
        const response = await fetch(url);
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
        this.put(url, response.clone());
        return response.arrayBuffer();
    }

    // The kept response for url, or null.
    async match(url) {
        try {
            return (await (await this.opened)?.match(url)) || null;
        } catch {
            return null;
        }
    }

    // Keeps a response for url; false where it cannot (storage full or blocked).
    async put(url, response) {
        try {
            const store = await this.opened;
            if (!store) return false;
            await store.put(url, response);
            return true;
        } catch {
            return false;
        }
    }

    async delete(url) {
        try {
            await (await this.opened)?.delete(url);
        } catch {
            // already gone, or storage blocked
        }
    }

    // The addresses kept, oldest first.
    async urls() {
        try {
            return (await (await this.opened)?.keys() || []).map(request => request.url);
        } catch {
            return [];
        }
    }
}

async function open(name, kind) {
    try {
        for (const other of await caches.keys())
            if (other.startsWith(kind) && other !== name) caches.delete(other).catch(() => {});
        return await caches.open(name);
    } catch {
        return null;
    }
}
