// The Porabje check box next to the language switch: shows or hides Porabje, the Slovene
// villages across the border in Hungary, everywhere on the map at once (view.porabje,
// map/regions.js).

import { getView, setView, onViewChange } from '../map/view-settings.js';

export function initPorabjeToggle(input) {
    if (!input) return;
    const render = view => { input.checked = view.porabje !== false; };
    input.addEventListener('change', () => setView({ porabje: input.checked }));
    onViewChange(render);
    render(getView());
}
