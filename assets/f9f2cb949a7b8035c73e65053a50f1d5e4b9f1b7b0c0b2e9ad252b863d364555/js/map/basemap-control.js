// Map / Satellite switch, styled like the built-in MapLibre controls.

import { t, onLanguageChange } from '../i18n/i18n.js';

const MODES = [['map', 'map.basemap.map'], ['aerial', 'map.basemap.satellite']];

export class BasemapControl {
    constructor(initialMode, onChange) {
        this.mode = initialMode;
        this.onChange = onChange;
    }

    onAdd() {
        this.container = document.createElement('div');
        this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group basemap-toggle';
        this.container.setAttribute('role', 'group');
        this.buttons = MODES.map(([mode, key]) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.addEventListener('click', () => this.select(mode));
            this.container.append(button);
            return { mode, key, button };
        });
        onLanguageChange(() => this.render());
        this.render();
        return this.container;
    }

    onRemove() {
        this.container.remove();
    }

    select(mode) {
        if (mode === this.mode) return;
        this.mode = mode;
        this.render();
        this.onChange(mode);
    }

    render() {
        this.container.setAttribute('aria-label', t('map.basemap.label'));
        for (const { mode, key, button } of this.buttons) {
            const active = mode === this.mode;
            button.textContent = t(key);
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
        }
    }
}
