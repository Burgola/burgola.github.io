// English. Every key here must also exist in sl.js (tools/check_i18n.mjs).
export default {
    meta: {
        name: 'English',
        short: 'EN',
    },
    site: {
        brand: 'Burgola Prekmurje Map',
        title: 'Burgola Prekmurje Map',
        description: 'Interactive map of Prekmurje',
    },
    nav: {
        map: 'Map',
        about: 'About',
        openMenu: 'Open menu',
        closeMenu: 'Close menu',
        language: 'Language',
        porabje: 'Porabje',
        porabjeHint: 'Show Porabje, the Slovene villages across the border in Hungary',
    },
    about: {
        title: 'About',
        body: 'Burgola Prekmurje Map is an interactive map of Prekmurje: its municipalities, villages, houses and the local names of its hills, fields and farms. More is coming soon.',
    },
    // "Designed by <Vladimir Januš> and Tim Bunderla" — the names and the
    // link are in index.html and js/map/map.js.
    // The search box (map/search.js)
    search: {
        label: 'Search the map',
        placeholder: 'Search places, houses, names…',
        loading: 'Loading…',
        none: 'Nothing found',
        clear: 'Clear',
        coordinates: 'Coordinates',
        // a house's (or former house's) number before the houses were numbered again
        oldNumber: 'old no. {number}',
    },
    // The map settings menu (map/view-control.js)
    view: {
        open: 'Map settings',
        title: 'Map settings',
        reset: 'Reset',
        borders: 'Borders',
        drzava: 'State border',
        obcine: 'Municipalities',
        naselja: 'Settlements',
        podregije: 'Subregions and groups of villages',
        mask: 'Dim outside Prekmurje',
        houses: 'Houses',
        houseNumbers: 'House numbers',
        houseNames: 'House names',
        names: 'Local names',
        namesZoom: 'Names appear when zoomed in',
        earlier: 'sooner',
        later: 'later',
        text: 'Text size',
        textScale: 'All text',
        namesScale: 'Local and house names',
        smaller: 'smaller',
        larger: 'larger',
        hamlet: 'Hamlets',
        relief: 'Hills and valleys',
        water: 'Waters',
        field: 'Field names',
        building: 'Farms, churches, castles',
        region: 'Regions',
        places: 'Our places',
        mapping: 'Mapping',
        progress: 'Progress of the villages (green / yellow / red)',
    },
    // The village progress shading and its legend (map/progress.js)
    progress: {
        title: 'Progress of the villages',
        none: 'not started',
        half: 'half',
        all: 'done',
        what: 'Share of the village\'s houses whose names are all checked, or that are confirmed to have no house name.',
        loading: 'Loading…',
    },
    // The aerial photo's status line (map/aerial.js, map/tile-cache.js)
    aerial: {
        slow: {
            one: 'The aerial photo is loading slowly (1 piece still coming from GURS)…',
            other: 'The aerial photo is loading slowly ({count} pieces still coming from GURS)…',
        },
        retrying: 'The aerial photo server had a problem, trying again… {why}',
        missing: {
            one: '1 piece of the aerial photo is missing. {why} It is asked for again every 15 seconds.',
            other: '{count} pieces of the aerial photo are missing. {why} They are asked for again every 15 seconds.',
        },
        retry: 'Try again now',
        error: {
            timeout: 'The GURS photo server did not answer within {detail}.',
            offline: 'This computer is offline.',
            http: 'The GURS photo server answered with an error ({detail}).',
            wms: 'The GURS photo server sent an error instead of the photo: {detail}',
            network: 'The GURS photo server cannot be reached ({detail}).',
        },
    },
    // Who did what, each followed by a name (index.html, map credits)
    credits: {
        site: 'Website and tools',
        mapping: 'Mapping and upkeep',
    },
    map: {
        basemap: {
            label: 'Map type',
            map: 'Map',
            satellite: 'Satellite',
        },
        loading: 'Loading map…',
        error: {
            title: 'The map could not be loaded.',
            body: 'Please try again later.',
        },
    },
    selection: {
        obcina: 'Municipality',
        naselje: 'Settlement',
        hungarianName: 'Hungarian: {name}',
        naseljaCount: {
            one: '{count} settlement',
            other: '{count} settlements',
        },
        naseljaLabel: 'Settlements',
        selectObcina: 'Municipality {name}',
        selectNaselje: 'Settlement {name}',
        zoomTo: 'Zoom to',
        close: 'Close',
    },
    house: {
        kind: 'House',
        oldNumber: 'Old house number',
        // an old house number with the year (or years) it was used
        oldNumberIn: 'Old house number ({year})',
        post: 'Post office',
        community: {
            ks: 'Local community',
            cs: 'District community',
            vs: 'Village community',
        },
        school: 'School district',
        adminUnit: 'Administrative unit',
        coordinates: 'Coordinates',
        building: 'Building',
        cadastralMunicipality: 'Cadastral municipality',
        buildingNumber: 'Building number',
        yearBuilt: 'Year built',
        floors: 'Floors',
        dwellings: 'Dwellings',
        businessPremises: 'Business premises',
        typeLabel: 'Type',
        structureLabel: 'Structure',
        electricity: 'Electricity',
        water: 'Water supply',
        sewage: 'Sewerage',
        gas: 'Gas',
        otherAddresses: 'Other addresses in this building',
        // GURS building register codes (tools/build_houses.mjs lists them)
        type: {
            0: 'No data',
            1: 'Detached building',
            2: 'End-terrace building',
            3: 'Mid-terrace building',
        },
        structure: {
            0: 'No data',
            1: 'Brick',
            2: 'Concrete, reinforced concrete',
            3: 'Stone',
            4: 'Wood',
            5: 'Mixed materials',
            6: 'Steel frame',
            7: 'Prefabricated',
            8: 'Other material',
        },
        connection: {
            0: 'No data',
            1: 'Yes',
            2: 'No',
        },
    },
    names: {
        name: 'Name',
        houseName: 'House name',
        // shown under a mapper's name when the official one differs
        govName: 'Official name',
        variants: 'Also called',
        noName: 'No known name',
        // a settlement's, municipality's or street's former name (mapper data)
        oldName: 'Old name',
        oldNameIn: 'Old name ({year})',
        variantsShow: { one: 'Show 1 name', other: 'Show {count} names' },
        status: {
            confirmed: 'Confirmed',
            confirmedGov: 'Confirmed (GURS)',
            // a house without a name nobody has checked yet
            unchecked: 'Unconfirmed',
            gov: 'Unconfirmed (GURS)',
            // only seen in the editor client, which still shows hidden names
            hidden: 'Hidden',
        },
        // GURS Register of Geographical Names types (tools/build_names.mjs)
        type: {
            1103: 'Hamlet',
            1104: 'Part of settlement',
            1201: 'House name',
            1202: 'Church',
            1203: 'Castle, manor',
            1205: 'Notable building',
            2101: 'River',
            2102: 'Stream',
            2103: 'Spring',
            2201: 'Lake, pond',
            3101: 'Hills',
            3102: 'Hill',
            3103: 'Valley',
            3104: 'Slope',
            4102: 'Area',
            4201: 'Field name',
            other: 'Place name',
        },
    },
    // Streets (map/streets.js)
    street: {
        kind: 'Street',
        houses: 'Houses on this street',
        houseCount: 'Houses',
    },
    place: {
        kind: {
            hill: 'Hill',
            field: 'Field',
            forest: 'Forest',
            water: 'Water',
            other: 'Place',
            // a house that is no longer there
            house: 'Former house',
        },
        // a former house with no known name, by its old number
        numberTitle: 'No. {number}',
    },
};
