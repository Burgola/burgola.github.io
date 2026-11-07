// The map settings menu (top right, under the zoom buttons): text sizes,
// what is shown, and how soon local names appear. State and defaults:
// view-settings.js.

import { t, onLanguageChange } from '../i18n/i18n.js';
import { getView, setView, resetView, onViewChange, NAMES_ZOOM_STEPS, TEXT_SCALE_STEPS } from './view-settings.js';
import { progressThresholds } from './progress-colors.js';

// Sliders: a view setting moved through a list of steps.
const SLIDERS = {
    textScale: { steps: TEXT_SCALE_STEPS, ends: ['view.smaller', 'view.larger'] },
    namesScale: { steps: TEXT_SCALE_STEPS, ends: ['view.smaller', 'view.larger'] },
    namesZoom: { steps: NAMES_ZOOM_STEPS, ends: ['view.earlier', 'view.later'] },
};

// Sections of the menu: sliders, then rows switched on and off.
const SECTIONS = [
    { title: 'view.text', sliders: ['textScale', 'namesScale'], rows: [] },
    { title: 'view.borders', rows: ['drzava', 'obcine', 'naselja', 'podregije', 'mask'] },
    { title: 'view.houses', rows: ['houseNumbers', 'houseNames'] },
    { title: 'view.names', sliders: ['namesZoom'], rows: ['hamlet', 'relief', 'water', 'field', 'road', 'building', 'region', 'places'] },
    { title: 'view.basemap', rows: ['pois', 'roadNames'] },
    { title: 'view.mapping', rows: ['progress'] },
];

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
        return this.container;
    }

    onRemove() {
        this.container.remove();
    }

    toggle(open = this.menu.hidden) {
        this.menu.hidden = !open;
        this.button.setAttribute('aria-expanded', String(open));
        // No taller than the room below its top: it scrolls inside, the page never does.
        if (open) this.menu.style.maxHeight = `${Math.max(160, innerHeight - this.menu.getBoundingClientRect().top - 12)}px`;
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
        head.append(el('div', 'view-menu-title', t('view.title')), reset);
        const parts = [head];

        for (const section of SECTIONS) {
            parts.push(el('div', 'view-menu-section', t(section.title)));
            for (const key of section.sliders || []) parts.push(this.slider(key));
            for (const key of section.rows) {
                parts.push(this.row(key));
                if (key === 'progress') parts.push(this.progressOptions());
            }
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
        const thresholds = progressThresholds(view);
        this.numbers.progressRed.value = String(thresholds.red);
        this.numbers.progressGreen.value = String(thresholds.green);
        for (const input of Object.values(this.numbers)) input.disabled = !view.progressStages;
        this.thresholdNote.textContent = view.progressStages ? t('view.progressYellow') : t('view.progressStagesOff');
    }
}
