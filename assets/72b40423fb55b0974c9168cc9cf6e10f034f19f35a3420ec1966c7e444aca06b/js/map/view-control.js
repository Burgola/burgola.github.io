// The map settings menu (top right, under the zoom buttons): text sizes,
// what is shown, and how soon local names appear. State and defaults:
// view-settings.js.

import { t, onLanguageChange } from '../i18n/i18n.js';
import { getView, setView, resetView, onViewChange, NAMES_ZOOM_STEPS, TEXT_SCALE_STEPS } from './view-settings.js';
import { progressThresholds } from './progress-colors.js';
import { onPreloadStatus } from './preload.js';
import { load, save } from '../core/storage.js';

// Sliders: a view setting moved through a list of steps.
const SLIDERS = {
    textScale: { steps: TEXT_SCALE_STEPS, ends: ['view.smaller', 'view.larger'] },
    namesScale: { steps: TEXT_SCALE_STEPS, ends: ['view.smaller', 'view.larger'] },
    namesZoom: { steps: NAMES_ZOOM_STEPS, ends: ['view.earlier', 'view.later'] },
};

// Sections of the menu: sliders, then rows switched on and off.
// Each group folds open and shut (remembered in this browser), says how many of its
// switches are on, and has one switch for all of them. Open at first: only the progress.
const SECTIONS = [
    { id: 'mapping', title: 'view.mapping', rows: ['progress'], open: true },
    { id: 'text', title: 'view.text', sliders: ['textScale', 'namesScale', 'namesZoom'], rows: [] },
    { id: 'names', title: 'view.names', rows: ['hamlet', 'relief', 'water', 'field', 'road', 'building', 'region', 'places'] },
    { id: 'houses', title: 'view.houses', rows: ['houseNumbers', 'houseNames'] },
    { id: 'borders', title: 'view.borders', rows: ['drzava', 'obcine', 'naselja', 'podregije', 'mask'] },
    { id: 'basemap', title: 'view.basemap', rows: ['pois', 'roadNames'] },
    // The editor reads the map from its own disk: nothing to fetch ahead (map.js).
    ...(window.tbmapEditorOptions ? [] : [{ id: 'loading', title: 'view.loading', rows: ['preload'] }]),
];
const OPEN_KEY = 'viewMenuGroupsOpen';
const readOpen = () => {
    try { return JSON.parse(load(OPEN_KEY) || 'null'); } catch { return null; }
};

const el = (tag, className, text) => {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
};

// The slider step nearest to a stored value.
const stepOf = (steps, value) => steps.reduce((best, s, i) =>
    (Math.abs(s - value) < Math.abs(steps[best] - value) ? i : best), 0);

export class ViewControl {
    onAdd() {
        this.container = el('div', 'maplibregl-ctrl maplibregl-ctrl-group view-control');
        this.button = el('button', 'view-control-button');
        this.button.type = 'button';
        this.button.setAttribute('aria-expanded', 'false');
        this.button.append(el('span', 'view-control-icon'));
        this.menu = el('div', 'view-menu');
        this.menu.hidden = true;
        this.container.append(this.button, this.menu);

        this.button.addEventListener('click', () => this.toggle());
        document.addEventListener('pointerdown', (e) => {
            if (!this.menu.hidden && !this.container.contains(e.target)) this.toggle(false);
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !this.menu.hidden) {
                this.toggle(false);
                this.button.focus();
            }
        });
        onLanguageChange(() => this.render());
        onViewChange(() => this.sync());
        this.render();
        if (this.preloadNote) onPreloadStatus(status => { this.preload = status; this.syncPreload(); });
        return this.container;
    }

    onRemove() {
        this.container.remove();
    }

    toggle(open = this.menu.hidden) {
        this.menu.hidden = !open;
        this.button.setAttribute('aria-expanded', String(open));
        // No taller than the room below its top: it scrolls inside, the page never does. On a
        // short screen (a phone on its side) it moves up beside the buttons to find that room.
        // On a narrow phone it is a sheet along the bottom, whose height the style sheet sets.
        if (!open) return;
        this.menu.style.top = '';
        this.menu.style.maxHeight = '';
        if (getComputedStyle(this.menu).position === 'fixed') return;
        const top = this.menu.getBoundingClientRect().top;
        const highest = this.container.closest('.maplibregl-map').getBoundingClientRect().top + 10;
        const wanted = Math.min(this.menu.scrollHeight, innerHeight - highest - 12);
        const up = Math.max(0, Math.min(wanted - (innerHeight - top - 12), top - highest));
        if (up) this.menu.style.top = `${-up}px`;
        this.menu.style.maxHeight = `${Math.max(160, innerHeight - (top - up) - 12)}px`;
    }

    render() {
        this.button.title = t('view.open');
        this.button.setAttribute('aria-label', t('view.open'));
        this.inputs = {};
        this.ranges = {};
        this.numbers = {};

        const head = el('div', 'view-menu-head');
        const reset = el('button', 'view-menu-reset', t('view.reset'));
        reset.type = 'button';
        reset.addEventListener('click', () => resetView());
        const close = el('button', 'view-menu-reset view-menu-close', t('view.close'));
        close.type = 'button';
        close.addEventListener('click', () => { this.toggle(false); this.button.focus(); });
        const actions = el('div', 'view-menu-actions');
        actions.append(reset, close);
        head.append(el('div', 'view-menu-title', t('view.title')), actions);
        const parts = [head];
        this.groups = [];
        this.opened ||= new Set(readOpen() || SECTIONS.filter(s => s.open).map(s => s.id));

        for (const section of SECTIONS) {
            const group = el('div', 'view-menu-group');
            const header = el('div', 'view-menu-group-head');
            const fold = el('button', 'view-menu-group-toggle');
            fold.type = 'button';
            const count = el('span', 'view-menu-group-count');
            fold.append(el('span', 'view-menu-group-arrow'), el('span', 'view-menu-group-title', t(section.title)), count);
            const body = el('div', 'view-menu-group-body');
            const setOpen = (open) => {
                body.hidden = !open;
                fold.setAttribute('aria-expanded', String(open));
                group.classList.toggle('open', open);
            };
            setOpen(this.opened.has(section.id));
            fold.addEventListener('click', () => {
                const open = body.hidden;
                setOpen(open);
                this.opened[open ? 'add' : 'delete'](section.id);
                save(OPEN_KEY, JSON.stringify([...this.opened]));
            });
            header.append(fold);
            // One switch for the whole group, where it has several.
            let all = null;
            if (section.rows.length > 1) {
                const label = el('label', 'view-menu-row view-menu-all');
                all = el('input');
                all.type = 'checkbox';
                all.setAttribute('aria-label', `${t(section.title)}: ${t('view.all')}`);
                all.addEventListener('change', () => setView(Object.fromEntries(section.rows.map(k => [k, all.checked]))));
                label.title = t('view.all');
                label.append(all, el('span', 'view-switch'));
                header.append(label);
            }
            for (const key of section.sliders || []) body.append(this.slider(key));
            for (const key of section.rows) {
                body.append(this.row(key));
                if (key === 'progress') body.append(this.progressOptions());
                if (key === 'preload') body.append(this.preloadNote = el('div', 'view-menu-note view-menu-row-note'));
            }
            group.append(header, body);
            parts.push(group);
            this.groups.push({ section, count, all });
        }
        this.menu.replaceChildren(...parts);
        this.sync();
    }

    // A setting switched on and off.
    row(key) {
        const row = el('label', 'view-menu-row');
        const input = el('input');
        input.type = 'checkbox';
        input.addEventListener('change', () => setView({ [key]: input.checked }));
        row.append(input, el('span', 'view-switch'), el('span', 'view-menu-label', t(`view.${key}`)));
        this.inputs[key] = input;
        return row;
    }

    // Under the progress switch, folded: gradient or stages, muted or vibrant, and where the
    // stages change. The thresholds stay in view when not by stage, disabled, saying why.
    progressOptions() {
        const more = el('details', 'view-menu-more');
        more.open = Boolean(this.progressOpen);
        more.addEventListener('toggle', () => { this.progressOpen = more.open; });
        more.append(el('summary', null, t('view.progressOptions')), this.row('progressStages'), this.row('progressVibrant'));
        const thresholds = el('div', 'view-menu-thresholds');
        for (const key of ['progressRed', 'progressGreen']) {
            const label = el('label', 'view-menu-number');
            const input = el('input');
            input.type = 'number';
            input.min = '0';
            input.max = '100';
            input.step = '1';
            input.inputMode = 'numeric';
            // Kept in order (red under green); what can't be kept shows the value used instead.
            input.addEventListener('change', () => {
                const value = Number(input.value);
                if (input.value === '' || !Number.isFinite(value)) { this.sync(); return; }
                const next = { ...getView(), [key]: value };
                if (key === 'progressRed' && next.progressGreen <= value) next.progressGreen = Math.min(100, Math.round(value) + 1);
                const { red, green } = progressThresholds(next);
                setView({ progressRed: red, progressGreen: green });
                this.sync();
            });
            label.append(el('span', null, t(`view.${key}`)), input, el('span', null, '%'));
            thresholds.append(label);
            this.numbers[key] = input;
        }
        this.thresholdNote = el('div', 'view-menu-note');
        more.append(thresholds, this.thresholdNote);
        return more;
    }

    // e.g. "Names appear: earlier ... later", "All text: smaller ... larger"
    slider(key) {
        const { steps, ends: [low, high] } = SLIDERS[key];
        const wrap = el('div', 'view-menu-slider');
        const label = el('div', 'view-menu-slider-label', t(`view.${key}`));
        const range = el('input');
        range.type = 'range';
        range.min = '0';
        range.max = String(steps.length - 1);
        range.step = '1';
        range.setAttribute('aria-label', t(`view.${key}`));
        range.addEventListener('input', () => setView({ [key]: steps[Number(range.value)] }));
        const ends = el('div', 'view-menu-slider-ends');
        ends.append(el('span', null, t(low)), el('span', null, t(high)));
        wrap.append(label, range, ends);
        this.ranges[key] = range;
        return wrap;
    }

    // Controls show the current settings (also after Reset).
    sync() {
        const view = getView();
        for (const [key, input] of Object.entries(this.inputs)) input.checked = view[key];
        for (const [key, range] of Object.entries(this.ranges)) range.value = String(stepOf(SLIDERS[key].steps, view[key]));
        // Each group: how many of its switches are on; its own switch on when all are, half when some.
        for (const { section, count, all } of this.groups) {
            const on = section.rows.filter(k => view[k]).length;
            count.textContent = !section.rows.length ? ''
                : section.rows.length > 1 ? t('view.count', { on, all: section.rows.length })
                : t(on ? 'view.on' : 'view.off');
            if (all) {
                all.checked = on === section.rows.length;
                all.indeterminate = on > 0 && on < section.rows.length;
            }
        }
        const thresholds = progressThresholds(view);
        this.numbers.progressRed.value = String(thresholds.red);
        this.numbers.progressGreen.value = String(thresholds.green);
        for (const input of Object.values(this.numbers)) input.disabled = !view.progressStages;
        this.thresholdNote.textContent = view.progressStages ? t('view.progressYellow') : t('view.progressStagesOff');
        this.syncPreload();
    }

    // How fetching ahead is going. Where the browser keeps it from happening, the switch is
    // disabled and the note says why.
    syncPreload() {
        if (!this.preloadNote || !this.preload) return;
        const { state, done, total } = this.preload;
        const blocked = state === 'saveData' || state === 'unavailable';
        this.inputs.preload.disabled = blocked;
        this.preloadNote.textContent = state === 'loading'
            ? t('view.preloadLoading', { percent: total ? Math.floor(100 * done / total) : 0 })
            : t(`view.preload${state[0].toUpperCase()}${state.slice(1)}`);
    }
}
