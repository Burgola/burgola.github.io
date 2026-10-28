// Entry point.
//
//   js/config.js     data sources and map settings
//   js/core/         shared helpers (storage)
//   js/i18n/         translations: i18n.js + one file per language
//   js/ui/           page chrome: navigation, Porabje check box, language switch
//   js/map/          the map, split into features (see map/map.js)

import { initI18n } from './i18n/i18n.js';
import { initNav } from './ui/nav.js';
import { initLanguageSwitch } from './ui/language-switch.js';
import { initPorabjeToggle } from './ui/porabje-toggle.js';
if (window.tbmapEditorOptions) document.documentElement.dataset.nativeEditor = 'true';
import { initMap } from './map/map.js';

initI18n();
initNav();
initPorabjeToggle(document.getElementById('porabje-toggle'));
initLanguageSwitch(document.getElementById('language-switch'));
initMap();
