// EN | SL buttons in the top bar, built from whatever languages i18n has.

import { LANGUAGES, getLanguage, setLanguage, onLanguageChange } from '../i18n/i18n.js';

export function initLanguageSwitch(container) {
    const buttons = Object.entries(LANGUAGES).map(([code, strings]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.lang = code;
        button.textContent = strings.meta.short;
        button.title = strings.meta.name;
        button.addEventListener('click', () => setLanguage(code));
        container.append(button);
        return { code, button };
    });

    function render() {
        for (const { code, button } of buttons) {
            const active = code === getLanguage();
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
        }
    }

    onLanguageChange(render);
    render();
}
