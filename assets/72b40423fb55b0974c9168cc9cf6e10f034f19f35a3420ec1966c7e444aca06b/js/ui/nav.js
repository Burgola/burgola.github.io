// Top bar: hash-routed pages and the phone menu.
//
// One page, hash-routed: #map (default), #about. The map stays
// alive while hidden so switching back does not reload it. The map also
// keeps its position in the hash (#map&pos=zoom/lat/lng), so only the first
// part names the page.

import { t, onLanguageChange } from '../i18n/i18n.js';

const VIEWS = ['map', 'about'];

export function initNav() {
    const nav = document.getElementById('nav');
    const toggle = document.querySelector('.nav-toggle');

    function currentView() {
        const name = location.hash.replace('#', '').split('&')[0];
        return VIEWS.includes(name) ? name : 'map';
    }

    function setMenuOpen(open) {
        nav.classList.toggle('open', open);
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', t(open ? 'nav.closeMenu' : 'nav.openMenu'));
    }

    function showView(name) {
        document.querySelectorAll('[data-view-panel]').forEach((panel) => {
            panel.hidden = panel.dataset.viewPanel !== name;
        });
        nav.querySelectorAll('a[data-view]').forEach((link) => {
            const active = link.dataset.view === name;
            link.classList.toggle('active', active);
            if (active) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        });
        setMenuOpen(false);
    }

    toggle.addEventListener('click', () => setMenuOpen(!nav.classList.contains('open')));
    // The phone menu closes with a tap anywhere else, or Escape.
    document.addEventListener('pointerdown', (e) => {
        if (nav.classList.contains('open') && !nav.contains(e.target) && !toggle.contains(e.target)) setMenuOpen(false);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && nav.classList.contains('open')) { setMenuOpen(false); toggle.focus(); }
    });
    window.addEventListener('hashchange', () => showView(currentView()));
    onLanguageChange(() => setMenuOpen(nav.classList.contains('open')));
    showView(currentView());
}
