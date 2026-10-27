// The card that describes whatever is selected. It knows nothing about
// houses or municipalities — each kind hands it a VIEW, already translated:
//
//   {
//     kind:     'Settlement',                     small caps line
//     title:    'Domanjševci',
//     subtitles: ['Hungarian: Domonkosfa'],       optional lines under the title
//     note:     'text' | { sl, en } | null        the mapper's note (data/mapper)
//     rows:     [{ label, value, select?, badge? }],  label: value pairs;
//                                                 badge { text, tone } e.g. a
//                                                 name's confirmed / gov status;
//                                                 or { label, fold: { summary,
//                                                 items } }: a list that opens
//     sections: [{ title, rows, fold? }],         more rows under a heading;
//                                                 fold: 'key' = it opens and
//                                                 closes, remembered per key
//     list:     { title, items: [{ label, select }] },   chips, e.g. settlements
//     actions:  [{ label, select }],              buttons next to "Zoom to"
//   }
//
// `select` is { kind, id }: clicking it selects that thing instead.
// Markup skeleton lives in index.html (#selection-panel).

import { t, getLanguage } from '../../i18n/i18n.js';
import { load, save } from '../../core/storage.js';
const localized = (value,language) => typeof value === 'string' ? value : value?.[language] ?? value?.sl ?? value?.en ?? Object.values(value || {})[0] ?? '';

export function createSelectionPanel(root) {
    const el = {
        kind: root.querySelector('.sp-kind'),
        name: root.querySelector('.sp-name'),
        subtitles: root.querySelector('.sp-subtitles'),
        note: root.querySelector('.sp-note'),
        body: root.querySelector('.sp-body'),
        actions: root.querySelector('.sp-actions'),
        zoom: root.querySelector('.sp-zoom'),
        close: root.querySelector('.sp-close'),
    };
    const handlers = { close: () => {}, zoom: () => {}, select: () => {} };

    el.close.addEventListener('click', () => handlers.close());
    el.zoom.addEventListener('click', () => handlers.zoom());

    const node = (tag, className, text) => {
        const n = document.createElement(tag);
        if (className) n.className = className;
        if (text != null) n.textContent = text;
        return n;
    };

    function linkTo(label, select, className = 'sp-link') {
        const b = node('button', className, label);
        b.type = 'button';
        b.addEventListener('click', () => handlers.select(select.kind, select.id));
        return b;
    }

    // Something that opens and closes. Open or closed is the visitor's
    // setting (per key, kept in this browser): it stays as they last left
    // it from one thing to the next. Closed until they open it.
    function fold(summary, summaryClass, content, key) {
        const details = node('details', 'sp-fold');
        details.open = load(`panel.${key}`) === 'open';
        details.append(node('summary', summaryClass, summary), content);
        details.addEventListener('toggle', () => save(`panel.${key}`, details.open ? 'open' : 'closed'));
        return details;
    }

    function rowsList(rows) {
        const dl = node('dl', 'sp-rows');
        for (const row of rows) {
            if (row.fold) {
                if (!row.fold.items.length) continue;
                const list = node('ul', 'sp-fold-list');
                for (const item of row.fold.items) list.append(node('li', null, item));
                dl.append(node('dt', null, row.label));
                const dd = node('dd');
                dd.append(fold(row.fold.summary, 'sp-fold-summary', list, 'variants'));
                dl.append(dd);
                continue;
            }
            if (row.value == null || row.value === '') continue;
            dl.append(node('dt', null, row.label));
            const dd = node('dd');
            dd.append(row.select ? linkTo(String(row.value), row.select) : String(row.value));
            if (row.badge) dd.append(' ', node('span', `sp-badge sp-badge-${row.badge.tone}`, row.badge.text));
            dl.append(dd);
        }
        return dl;
    }

    function render(view) {
        el.kind.textContent = view.kind || '';
        el.name.textContent = view.title || '';

        el.subtitles.replaceChildren(...(view.subtitles || []).filter(Boolean).map((s) => node('div', null, s)));

        const noteText = localized(view.note, getLanguage());
        el.note.replaceChildren(...(noteText ? [node('div', 'sp-note-text', noteText)] : []));
        el.note.hidden = !noteText;

        el.body.replaceChildren();
        if (view.rows?.length) el.body.append(rowsList(view.rows));
        for (const section of view.sections || []) {
            const rows = rowsList(section.rows);
            if (!rows.childElementCount) continue;
            if (section.fold) el.body.append(fold(section.title, 'sp-section', rows, section.fold));
            else el.body.append(node('h3', 'sp-section', section.title), rows);
        }
        if (view.list?.items.length) {
            el.body.append(node('h3', 'sp-section', view.list.title));
            const chips = node('div', 'sp-chips');
            for (const item of view.list.items) chips.append(linkTo(item.label, item.select, 'sp-chip'));
            el.body.append(chips);
        }

        el.actions.replaceChildren(el.zoom);
        el.zoom.textContent = t('selection.zoomTo');
        for (const action of view.actions || []) el.actions.append(linkTo(action.label, action.select, 'sp-action'));

        root.scrollTop = 0;
    }

    return {
        show(view) {
            render(view);
            root.hidden = false;
        },
        hide() {
            root.hidden = true;
        },
        // Height the panel covers at the bottom of the map when it is shown
        // as a phone sheet (see style.css), else 0.
        sheetHeight() {
            if (root.hidden || !matchMedia('(max-width: 640px)').matches) return 0;
            return root.offsetHeight;
        },
        onClose(fn) { handlers.close = fn; },
        onZoom(fn) { handlers.zoom = fn; },
        onSelect(fn) { handlers.select = fn; },
    };
}
