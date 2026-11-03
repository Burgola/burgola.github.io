// The selected place in the page address (#map&pos=…&sel=<id>), so that a link opens it. Only
// our own places: a base map label has no lasting id. MapLibre keeps its pos= part and leaves
// the other parts as they are.

const parts = () => location.hash.slice(1).split('&').filter(Boolean);

export function selectedInAddress() {
    const part = parts().find(p => p.startsWith('sel='));
    return part ? decodeURIComponent(part.slice(4)) : null;
}

export function writeSelected(id) {
    const rest = parts().filter(p => !p.startsWith('sel='));
    if (id) rest.push(`sel=${encodeURIComponent(id)}`);
    const hash = rest.length ? `#${rest.join('&')}` : '';
    if (hash !== location.hash) history.replaceState(history.state, '', `${location.pathname}${location.search}${hash}`);
}
