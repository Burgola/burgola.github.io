// localStorage that never throws. Used only for per-visitor conveniences
// (language, map view); it can be unavailable in private windows or with
// blocked site data, and everything must work without it.

const PREFIX = 'tbmap.';

export function load(key, fallback = null) {
    try {
        const value = localStorage.getItem(PREFIX + key);
        return value === null ? fallback : value;
    } catch {
        return fallback;
    }
}

export function save(key, value) {
    try {
        localStorage.setItem(PREFIX + key, value);
    } catch {
        // storage unavailable: the choice just is not remembered
    }
}
