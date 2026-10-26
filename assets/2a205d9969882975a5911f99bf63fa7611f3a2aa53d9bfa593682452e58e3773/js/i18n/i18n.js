// Translations.
//
// Each language is a module in this folder exporting a nested object of
// strings; every key must exist in every language (tools/check_i18n.mjs
// enforces it). Look strings up with t('dotted.key', params):
//
//   t('map.basemap.satellite')                      -> 'Satellite'
//   t('selection.hungarianName', { name: 'Hodos' }) -> 'Hungarian: Hodos'
//   t('selection.naseljaCount', { count: 3 })       -> '3 settlements'
//
// A value that is an object of plural forms (one / two / few / other) is
// chosen by Intl.PluralRules for the current language — Slovenian needs all
// four. {name} placeholders are replaced from params.
//
// Static markup uses attributes instead of code:
//   data-i18n="key"                 sets textContent
//   data-i18n-attr="attr:key;..."   sets attributes (aria-label, title, ...)
// translateDom() applies them, and runs again on every language change.

import en from './en.js';
import sl from './sl.js';
import { load, save } from '../core/storage.js';

export const LANGUAGES = { en, sl };
const FALLBACK = 'en';
const STORAGE_KEY = 'language';

let current = FALLBACK;
const listeners = new Set();

function lookup(strings, key) {
    return key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), strings);
}

function interpolate(text, params) {
    return text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

export function t(key, params = {}) {
    let value = lookup(LANGUAGES[current], key);
    if (value === undefined) value = lookup(LANGUAGES[FALLBACK], key);
    if (value === undefined) return key;

    if (typeof value === 'object' && 'count' in params) {
        const form = new Intl.PluralRules(current).select(params.count);
        value = value[form] ?? value.other;
    }
    return typeof value === 'string' ? interpolate(value, params) : key;
}

export function getLanguage() {
    return current;
}

export function onLanguageChange(listener) {
    listeners.add(listener);
}

export function setLanguage(code) {
    if (!LANGUAGES[code] || code === current) return;
    current = code;
    save(STORAGE_KEY, code);
    applyLanguage();
    for (const listener of listeners) listener(code);
}

export function translateDom(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((el) => {
        el.textContent = t(el.dataset.i18n);
    });
    root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
        for (const pair of el.dataset.i18nAttr.split(';')) {
            const [attr, key] = pair.split(':').map((s) => s.trim());
            if (attr && key) el.setAttribute(attr, t(key));
        }
    });
}

function applyLanguage() {
    document.documentElement.lang = current;
    document.title = t('site.title');
    const description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute('content', t('site.description'));
    translateDom();
}

// Saved choice, else the browser's language if we have it, else English.
export function initI18n() {
    const saved = load(STORAGE_KEY);
    const browser = (navigator.languages || [navigator.language || ''])
        .map((l) => l.toLowerCase().split('-')[0])
        .find((l) => LANGUAGES[l]);
    current = LANGUAGES[saved] ? saved : (browser || FALLBACK);
    applyLanguage();
}
