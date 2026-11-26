// Translations.
//
// Each language is a module in this folder exporting a nested object of
// strings; every key must exist in en.js and sl.js (tools/check_i18n.mjs
// enforces it). Look strings up with t('dotted.key', params):
//
//   t('map.basemap.satellite')                      -> 'Satellite'
//   t('selection.numberedName', { number: 4 })      -> 'Name 4'
//   t('aerial.slow', { count: 3 })                  -> '... (3 pieces still coming)...'
//
// A value that is an object of plural forms (one / two / few / other) is
// chosen by Intl.PluralRules for the current language — Slovenian needs all
// four. {name} placeholders are replaced from params.
//
// Prekmurian (prk.js) is written in the editor, text by text (Translate the
// website into Prekmurian), and is not edited here. A text it has no
// translation for yet is shown in Slovenian, and it uses Slovenian's plural
// forms and place names. The website offers it once a mapper has turned it on
// there; the editor's map shows it while it is being written.
//
// Static markup uses attributes instead of code:
//   data-i18n="key"                 sets textContent
//   data-i18n-attr="attr:key;..."   sets attributes (aria-label, title, ...)
// translateDom() applies them, and runs again on every language change.

import en from './en.js';
import sl from './sl.js';
import prekmurian from './prk.js';
import { load, save } from '../core/storage.js';

const editor = Boolean(globalThis.window?.tbmapEditorOptions);
// Every language's strings, also one the website does not offer (yet).
const STRINGS = { en, sl, prk: nest(prekmurian.texts) };
// Where a language's missing texts come from, whose plural forms it uses and whose names it shows.
const BASE = { prk: 'sl' };
// The page's lang attribute: Prekmurian has no code of its own, so it is Slovenian, privately marked.
const TAGS = { prk: 'sl-x-prk' };
// The languages the website offers, in its language buttons.
export const LANGUAGES = prekmurian.shown || editor ? STRINGS : { en, sl };
const FALLBACK = 'en';
const STORAGE_KEY = 'language';

let current = FALLBACK;
const listeners = new Set();

// prk.js keeps each text under its dotted key ('view.title'); the others nest them.
function nest(flat = {}) {
    const root = {};
    for (const [key, value] of Object.entries(flat)) {
        const parts = key.split('.');
        let node = root;
        for (const part of parts.slice(0, -1)) node = node[part] = typeof node[part] === 'object' ? node[part] : {};
        node[parts.at(-1)] = value;
    }
    return root;
}

function lookup(strings, key) {
    return key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), strings);
}

function interpolate(text, params) {
    return text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

export function t(key, params = {}) {
    let value;
    for (const language of [current, BASE[current], FALLBACK]) {
        if (language && value === undefined) value = lookup(STRINGS[language], key);
    }
    if (value === undefined) return key;

    if (typeof value === 'object' && 'count' in params) {
        const form = new Intl.PluralRules(getNameLanguage()).select(params.count);
        value = value[form] ?? value.other;
    }
    return typeof value === 'string' ? interpolate(value, params) : key;
}

export function getLanguage() {
    return current;
}

// The language whose names (of places, streets, notes) a page in this language shows.
export function getNameLanguage() {
    return BASE[current] || current;
}

// A language's own name and its short button label.
export function languageName(code, short = false) {
    return lookup(STRINGS[code], short ? 'meta.short' : 'meta.name') ?? code.toUpperCase();
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

// The editor's preview: a language's texts as they are being written, shown at once.
export function setTexts(code, flat) {
    if (!(code in BASE)) return;
    STRINGS[code] = nest(flat);
    if (code !== current) return;
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
    document.documentElement.lang = TAGS[current] || current;
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
        .find((l) => LANGUAGES[l] && !BASE[l]);
    current = LANGUAGES[saved] ? saved : (browser || FALLBACK);
    applyLanguage();
}
