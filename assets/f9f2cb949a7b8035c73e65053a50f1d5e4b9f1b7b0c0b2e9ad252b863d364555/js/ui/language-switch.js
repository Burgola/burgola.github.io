// EN | SL buttons in the top bar (and Prekmurian's once it is offered), built from i18n's languages.

import { LANGUAGES, getLanguage, setLanguage, onLanguageChange, languageName } from '../i18n/i18n.js';

export function initLanguageSwitch(container) {
    const buttons = Object.keys(LANGUAGES).map((code) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.lang = code;
        button.textContent = languageName(code, true);
        button.title = languageName(code);
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
