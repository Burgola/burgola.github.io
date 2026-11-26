// Counting visits with Google Analytics, only with the visitor's consent.
//
// A first visit is asked in a bar at the bottom of the page, and Google's script loads only after
// Yes. The answer is kept in this browser; the About page shows it and changes it, and No removes
// Google's cookies again. Nothing is asked or loaded anywhere but on the website itself: not in the
// editor's map, nor in a copy being tried out locally.

import { load, save } from '../core/storage.js';
import { t, onLanguageChange } from '../i18n/i18n.js';

const ID = 'G-TDLPL9N78E';
const HOST = 'burgola.github.io';
const KEY = 'analytics'; // 'yes' or 'no'

let loaded = false;

function start() {
    window[`ga-disable-${ID}`] = false;
    if (loaded) return;
    loaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', ID);
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${ID}`;
    document.head.append(script);
}

function stop() {
    window[`ga-disable-${ID}`] = true;
    const names = document.cookie.split(';').map((c) => c.split('=')[0].trim())
        .filter((name) => name === '_ga' || name.startsWith('_ga_'));
    for (const name of names) {
        for (const domain of ['', `; domain=${location.hostname}`]) {
            document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain}`;
        }
    }
}

// bar: the question at the bottom of the page; choice: its line on the About page.
export function initAnalytics(bar, choice) {
    if (location.hostname !== HOST || globalThis.window?.tbmapEditorOptions) return;
    const state = choice.querySelector('.consent-state');
    const render = () => {
        const answer = load(KEY);
        bar.hidden = answer === 'yes' || answer === 'no';
        state.textContent = t(answer === 'yes' ? 'consent.allowed' : answer === 'no' ? 'consent.refused' : 'consent.unanswered');
    };
    const answer = (yes) => {
        save(KEY, yes ? 'yes' : 'no');
        if (yes) start(); else stop();
        render();
    };
    bar.querySelector('[data-consent="yes"]').addEventListener('click', () => answer(true));
    bar.querySelector('[data-consent="no"]').addEventListener('click', () => answer(false));
    choice.querySelector('button').addEventListener('click', () => { bar.hidden = false; });
    choice.hidden = false;
    onLanguageChange(render);
    render();
    if (load(KEY) === 'yes') start();
}
