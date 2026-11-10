// The colours of the village progress shading (resolved-map.js) and its legend, from the map
// settings: a gradient from red through yellow to green, or three stages with thresholds the
// visitor sets, in muted or vibrant colours.

import { VIEW_DEFAULTS } from './view-settings.js';

const PALETTES = {
    muted: { red: '#d93025', yellow: '#f2b705', green: '#1e8e3e', opacity: 0.24, text: ['#ffffff', '#ffffff', '#ffffff'] },
    vibrant: { red: '#ff1f3d', yellow: '#ffd400', green: '#00d65b', opacity: 0.46, text: ['#ffffff', '#1d1d20', '#1d1d20'] },
};

// The stage thresholds in whole percent, kept in order: red under `red`, yellow up to `green`,
// green from `green` to 100.
export function progressThresholds(view) {
    const whole = (value, fallback) => (Number.isFinite(value) ? Math.round(value) : fallback);
    const red = Math.min(99, Math.max(0, whole(view.progressRed, VIEW_DEFAULTS.progressRed)));
    const green = Math.min(100, Math.max(red + 1, whole(view.progressGreen, VIEW_DEFAULTS.progressGreen)));
    return { red, green };
}

export function progressStyle(view) {
    const vibrant = view.progressVibrant ?? VIEW_DEFAULTS.progressVibrant;
    const stages = view.progressStages ?? VIEW_DEFAULTS.progressStages;
    const palette = PALETTES[vibrant ? 'vibrant' : 'muted'];
    const { red, green } = progressThresholds(view);
    // p is the share done, 0 to 1. A stage starts at its threshold: 10 % is already yellow,
    // matching the label, which rounds down.
    const color = stages
        ? ['step', ['get', 'p'], palette.red, red / 100, palette.yellow, green / 100, palette.green]
        : ['interpolate', ['linear'], ['get', 'p'], 0, palette.red, 0.5, palette.yellow, 1, palette.green];
    // The labels' text, readable on their colour: dark on the bright yellow and green.
    const [onRed, onYellow, onGreen] = palette.text;
    const text = stages
        ? ['step', ['get', 'p'], onRed, red / 100, onYellow, green / 100, onGreen]
        : ['step', ['get', 'p'], onRed, 0.3, onYellow, 0.75, onGreen];
    const legend = stages
        ? `linear-gradient(to right,${palette.red} 0 ${red}%,${palette.yellow} ${red}% ${green}%,${palette.green} ${green}% 100%)`
        : `linear-gradient(to right,${palette.red},${palette.yellow},${palette.green})`;
    return { palette, stages, red, green, color, text, legend };
}
