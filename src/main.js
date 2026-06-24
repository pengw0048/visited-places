import * as d3 from "d3";
import { feature as topojsonFeature } from "topojson-client";
import "./styles.css";

const LEVELS = [
  { value: 1, label: "Passed through", color: "#87d7c6" },
  { value: 2, label: "Short stop", color: "#a9d86e" },
  { value: 3, label: "Stayed", color: "#ffd166" },
  { value: 4, label: "Explored", color: "#f8963f" },
  { value: 5, label: "Lived or returned", color: "#d65a6f" },
];

const DATA_BASE_URL = `${import.meta.env.BASE_URL}data/`;

const VIEW_MODES = {
  naturalEarth: { label: "Natural Earth" },
  equalEarth: { label: "Equal Earth" },
  mercator: { label: "Mercator" },
  equirectangular: { label: "Equirectangular" },
  globe: { label: "Globe 3D" },
};

const DATASETS = {
  global: {
    label: "World",
    unit: "regions",
    optionLabel: "World detail map",
    projection: "naturalEarth",
    globeCenter: [0, 20],
    graticule: true,
  },
};

const SOURCE_DATASETS = {
  countries: {
    url: `${DATA_BASE_URL}countries-admin0.json`,
    kind: "geojson",
    sourceType: "country",
  },
  globalAdmin1: {
    url: `${DATA_BASE_URL}admin1-10m.json`,
    kind: "geojson",
    sourceType: "admin1",
  },
  usStates: {
    url: `${DATA_BASE_URL}states-10m.json`,
    kind: "topojson",
    objectName: "states",
    sourceType: "usState",
    detailIso: "US",
  },
  chinaProvinces: {
    url: `${DATA_BASE_URL}china-provinces.json`,
    kind: "geojson",
    sourceType: "chinaProvince",
    detailIso: "CN",
  },
};

const HIGH_DETAIL_COUNTRIES = {
  US: { sourceKey: "usStates", label: "United States", defaultEnabled: true },
  CN: { sourceKey: "chinaProvinces", label: "China", countryIsoIds: new Set(["CN", "TW"]), defaultEnabled: true },
};

const STORAGE_KEYS = {
  dataset: "visitedPlaces:selectedDataset",
  viewMode: "visitedPlaces:viewMode",
  detailCountries: "visitedPlaces:detailCountries",
  levelLabels: "visitedPlaces:levelLabels",
  levels: "visitedPlaces:levels",
};

const URL_DATA_PARAM = "data";
const urlUserData = loadUrlUserData();

const state = {
  datasetKey: getStoredDatasetKey(),
  viewMode: getStoredViewMode(),
  detailCountries: urlUserData?.detailCountries ?? getStoredDetailCountries(),
  selectedDetailCountry: "US",
  placeMenuOpen: false,
  levelLabels: urlUserData?.levelLabels ?? loadStoredLevelLabels(),
  levels: urlUserData?.levels ?? loadStoredLevels(),
  datasets: new Map(),
  sourceData: new Map(),
  detailOptions: [],
  selectedId: null,
  menuRegionId: null,
  currentProjection: null,
  currentPath: null,
  currentSize: { width: 1, height: 1 },
  zoomTransform: d3.zoomIdentity,
  globeRotation: getDefaultGlobeRotation(),
  globeZoom: 1,
  globeDrag: null,
};

const app = document.querySelector("#app");

app.innerHTML = `
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true"></span>
      <div>
        <strong>Visited Places</strong>
        <span>personal map tracker</span>
      </div>
    </div>
  </header>

  <main class="workspace">
    <aside class="sidebar" aria-label="Map controls">
      <section class="control-group panel-section">
        <div class="section-heading">
          <span>Map Settings</span>
        </div>
        <label class="field-label" for="placeSearchInput">Country or region</label>
        <div class="place-combobox" id="placeCombobox">
          <input
            id="placeSearchInput"
            class="search-field"
            type="search"
            autocomplete="off"
            role="combobox"
            aria-expanded="false"
            aria-controls="placeOptions"
            placeholder="Search countries, states, provinces..."
          />
          <div class="place-options" id="placeOptions" role="listbox" hidden></div>
        </div>
        <label class="toggle-row">
          <span>Show subdivisions for this country</span>
          <input type="checkbox" id="detailCountryToggle" />
        </label>

        <label class="field-label" for="viewModeSelect">Projection</label>
        <select id="viewModeSelect" class="select-field"></select>
      </section>

      <section class="stats-grid" aria-label="Current map stats">
        <div>
          <span id="visitedCount">0</span>
          <small>marked</small>
        </div>
        <div>
          <span id="coverage">0%</span>
          <small>coverage</small>
        </div>
        <div>
          <span id="averageLevel">-</span>
          <small>average</small>
        </div>
      </section>

      <section class="control-group panel-section">
        <button class="text-button danger-button" type="button" id="clearCurrentButton">Clear marks</button>
      </section>
    </aside>

    <section class="map-panel" aria-label="Interactive map">
      <div class="map-header">
        <div>
          <span id="mapEyebrow"></span>
          <h1 id="mapTitle"></h1>
        </div>
        <output class="status-line" id="statusLine" aria-live="polite" hidden></output>
      </div>
      <div class="map-frame" id="mapFrame">
        <svg id="mapSvg" role="img" aria-labelledby="mapTitle"></svg>
        <div class="map-legend" id="mapLegend" aria-label="Level legend"></div>
        <div class="level-menu" id="levelMenu" hidden></div>
        <div class="tooltip" id="tooltip" hidden></div>
      </div>
    </section>
  </main>
`;

const els = {
  viewModeSelect: document.querySelector("#viewModeSelect"),
  placeCombobox: document.querySelector("#placeCombobox"),
  placeSearchInput: document.querySelector("#placeSearchInput"),
  placeOptions: document.querySelector("#placeOptions"),
  detailCountryToggle: document.querySelector("#detailCountryToggle"),
  clearCurrentButton: document.querySelector("#clearCurrentButton"),
  visitedCount: document.querySelector("#visitedCount"),
  coverage: document.querySelector("#coverage"),
  averageLevel: document.querySelector("#averageLevel"),
  mapEyebrow: document.querySelector("#mapEyebrow"),
  mapTitle: document.querySelector("#mapTitle"),
  statusLine: document.querySelector("#statusLine"),
  mapFrame: document.querySelector("#mapFrame"),
  mapSvg: document.querySelector("#mapSvg"),
  mapLegend: document.querySelector("#mapLegend"),
  levelMenu: document.querySelector("#levelMenu"),
  tooltip: document.querySelector("#tooltip"),
};

const svg = d3.select(els.mapSvg);
const viewport = svg.append("g").attr("class", "viewport");
viewport.append("path").attr("class", "sphere");
viewport.append("path").attr("class", "graticule");
viewport.append("g").attr("class", "regions");

const zoomBehavior = d3
  .zoom()
  .scaleExtent([1, 8])
  .filter((event) => !isGlobeMode() && !event.ctrlKey && (event.type === "wheel" || event.button === 0))
  .on("zoom", (event) => {
    state.zoomTransform = event.transform;
    viewport.attr("transform", state.zoomTransform);
  });

const globeDragBehavior = d3
  .drag()
  .filter((event) => isGlobeMode() && !event.ctrlKey && event.button === 0)
  .on("start", (event) => {
    hideTooltip();
    state.globeDrag = {
      x: event.x,
      y: event.y,
      rotation: [...state.globeRotation],
    };
    els.mapFrame.classList.add("is-dragging");
  })
  .on("drag", (event) => {
    if (!state.globeDrag) return;

    const degreesPerPixel = 0.34 / Math.sqrt(state.globeZoom);
    const dx = event.x - state.globeDrag.x;
    const dy = event.y - state.globeDrag.y;
    state.globeRotation = [
      state.globeDrag.rotation[0] + dx * degreesPerPixel,
      clamp(state.globeDrag.rotation[1] - dy * degreesPerPixel, -85, 85),
      0,
    ];
    renderMap();
  })
  .on("end", () => {
    state.globeDrag = null;
    els.mapFrame.classList.remove("is-dragging");
  });

svg.call(zoomBehavior).on("dblclick.zoom", null);
svg.call(globeDragBehavior);
svg.on(
  "wheel.globe",
  (event) => {
    if (!isGlobeMode()) return;
    event.preventDefault();
    hideTooltip();
    state.globeZoom = clamp(state.globeZoom * Math.pow(1.0016, -event.deltaY), 0.75, 5);
    renderMap();
  },
  { passive: false },
);

buildStaticControls();
bindEvents();

const resizeObserver = new ResizeObserver(() => {
  renderMap();
});
resizeObserver.observe(els.mapFrame);

switchDataset(state.datasetKey).then(syncUrlData);

function buildStaticControls() {
  els.viewModeSelect.innerHTML = Object.entries(VIEW_MODES)
    .map(([key, mode]) => `<option value="${key}">${mode.label}</option>`)
    .join("");
  els.viewModeSelect.value = state.viewMode;
  renderDetailControls();
  renderMapLegend();
}

function renderDetailControls() {
  if (!state.detailOptions.length) {
    els.placeSearchInput.value = "Loading countries...";
    els.placeSearchInput.disabled = true;
    closePlaceMenu({ resetInput: false });
    els.detailCountryToggle.checked = false;
    els.detailCountryToggle.disabled = true;
    return;
  }

  if (!state.detailOptions.some((option) => option.iso === state.selectedDetailCountry)) {
    state.selectedDetailCountry = state.detailOptions[0].iso;
  }

  els.placeSearchInput.disabled = false;
  if (!state.placeMenuOpen || document.activeElement !== els.placeSearchInput) {
    syncPlaceSearchLabel();
  }
  renderPlaceOptions();
  els.detailCountryToggle.disabled = false;
  els.detailCountryToggle.checked = Boolean(state.detailCountries[state.selectedDetailCountry]);
}

function renderMapLegend() {
  els.mapLegend.innerHTML = `
    <div class="legend-title">Legend</div>
    ${LEVELS.map(
      (level) => `
        <label class="map-legend-row">
          <span class="legend-swatch" style="background: ${level.color}"></span>
          <strong>${level.value}</strong>
          <input
            data-level-label="${level.value}"
            value="${escapeHtml(getLevelLabel(level.value))}"
            aria-label="Level ${level.value} label"
          />
        </label>
      `,
    ).join("")}
  `;
}

function bindEvents() {
  els.viewModeSelect.addEventListener("change", (event) => {
    switchViewMode(event.target.value);
  });

  els.placeSearchInput.addEventListener("focus", () => {
    openPlaceMenu();
    els.placeSearchInput.select();
  });

  els.placeSearchInput.addEventListener("input", () => {
    openPlaceMenu();
  });

  els.placeSearchInput.addEventListener("keydown", (event) => {
    handlePlaceSearchKeydown(event);
  });

  els.placeOptions.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });

  els.placeOptions.addEventListener("click", (event) => {
    const option = event.target.closest("[data-place-option]");
    if (!option) return;
    selectPlaceOption(option.dataset.placeType, option.dataset.placeId);
  });

  els.detailCountryToggle.addEventListener("change", (event) => {
    switchDetailCountry(state.selectedDetailCountry, event.target.checked);
  });

  els.mapLegend.addEventListener("input", (event) => {
    const input = event.target.closest("[data-level-label]");
    if (!input) return;
    const level = Number(input.dataset.levelLabel);
    state.levelLabels[level] = input.value;
    saveLevelLabels();
    renderOpenLevelMenu();
  });

  els.levelMenu.addEventListener("click", (event) => handleLevelMenuClick(event));

  els.mapFrame.addEventListener("click", (event) => {
    if (event.target.closest(".level-menu") || event.target.closest(".map-legend")) return;
    if (!event.target.closest(".region")) {
      clearSelectedRegion();
    }
  });

  els.clearCurrentButton.addEventListener("click", () => {
    const dataset = DATASETS[state.datasetKey];
    const confirmed = window.confirm(`Clear all marked ${dataset.unit} for ${dataset.label}?`);
    if (!confirmed) return;
    state.levels[state.datasetKey] = {};
    state.selectedId = null;
    hideLevelMenu();
    saveLevels();
    renderAll();
    announce(`Cleared ${dataset.label}`);
  });

  document.addEventListener("click", (event) => {
    if (els.placeCombobox.contains(event.target)) return;
    closePlaceMenu();
  });
}

async function switchDataset(datasetKey, options = {}) {
  if (!DATASETS[datasetKey]) return;

  state.datasetKey = datasetKey;
  state.selectedId = null;
  closePlaceMenu({ resetInput: false });
  hideTooltip();
  writeLocalStorage(STORAGE_KEYS.dataset, datasetKey);

  await ensureDataset(datasetKey);

  resetFlatZoomState();
  state.globeRotation = getDefaultGlobeRotation(datasetKey);
  state.globeZoom = 1;
  renderAll();

  if (options.resetView) {
    resetView(false);
  }
}

function switchViewMode(viewMode) {
  if (!VIEW_MODES[viewMode]) return;

  state.viewMode = viewMode;
  closePlaceMenu();
  hideTooltip();
  els.viewModeSelect.value = viewMode;
  writeLocalStorage(STORAGE_KEYS.viewMode, viewMode);
  resetFlatZoomState();
  state.globeRotation = getDefaultGlobeRotation(state.datasetKey);
  state.globeZoom = 1;
  renderAll();
  announce(VIEW_MODES[viewMode].label);
}

async function switchDetailCountry(detailKey, enabled) {
  if (!detailKey) return;

  state.detailCountries[detailKey] = enabled;
  state.selectedId = null;
  closePlaceMenu();
  hideLevelMenu();
  hideTooltip();
  saveDetailCountries();
  state.datasets.delete(state.datasetKey);
  await ensureDataset(state.datasetKey);
  renderDetailControls();
  renderAll();
  zoomToCountry(detailKey);
  const label = getDetailOptionLabel(detailKey);
  announce(`${label}: ${enabled ? "detail on" : "detail off"}`);
}

function selectCountry(countryIso, options = {}) {
  if (!countryIso || !hasDetailOption(countryIso)) return;

  state.selectedDetailCountry = countryIso;
  closePlaceMenu({ resetInput: false });

  if (options.clearSelection) {
    state.selectedId = null;
    hideLevelMenu();
    hideTooltip();
  }

  renderDetailControls();
  syncPlaceSearchLabel();
  renderMapHeader();

  if (options.clearSelection) {
    renderMap();
  }

  if (options.zoom) {
    zoomToCountry(countryIso);
  }

  if (options.announce) {
    announce(`Country: ${getDetailOptionLabel(countryIso)}`);
  }
}

function syncSelectedCountryFromFeature(feature) {
  const countryIso = getDetailCountryKey(feature?.properties?.countryIso);
  if (!countryIso || countryIso === state.selectedDetailCountry || !hasDetailOption(countryIso)) return;

  state.selectedDetailCountry = countryIso;
  renderDetailControls();
  renderMapHeader();
}

async function ensureDataset(datasetKey) {
  if (state.datasets.has(datasetKey)) return state.datasets.get(datasetKey);

  const sourceEntries = await loadSourceEntries();
  updateDetailOptions(sourceEntries);
  renderDetailControls();

  const normalizedFeatures = sourceEntries
    .flatMap(({ sourceKey, source, features }) =>
      features
        .filter((feature) => feature && feature.geometry && shouldIncludeFeature(feature, source))
        .map((feature) => prepareFeature(feature, sourceKey))
        .map((feature) => normalizeFeature(feature, source)),
    )
    .sort((a, b) => a.properties.displayName.localeCompare(b.properties.displayName));

  const loaded = {
    features: normalizedFeatures,
    collection: {
      type: "FeatureCollection",
      features: normalizedFeatures,
    },
  };

  state.datasets.set(datasetKey, loaded);
  return loaded;
}

async function loadSourceEntries() {
  if (state.sourceData.size) return [...state.sourceData.values()];

  const entries = await Promise.all(
    Object.entries(SOURCE_DATASETS).map(async ([sourceKey, source]) => {
      const raw = await d3.json(source.url);
      const features =
        source.kind === "topojson"
          ? topojsonFeature(raw, raw.objects[source.objectName]).features
          : raw.features;
      return { sourceKey, source, features };
    }),
  );

  for (const entry of entries) {
    state.sourceData.set(entry.sourceKey, entry);
  }

  return entries;
}

function updateDetailOptions(sourceEntries) {
  const countries = new Map();

  for (const { source, features } of sourceEntries) {
    if (source.sourceType !== "admin1") continue;
    for (const feature of features) {
      const iso = getFeatureCountryIso(feature, source);
      const label = feature.properties?.admin;
      if (iso && label && !countries.has(iso)) countries.set(iso, label);
    }
  }

  for (const [iso, detail] of Object.entries(HIGH_DETAIL_COUNTRIES)) {
    countries.set(iso, detail.label);
  }

  state.detailOptions = [...countries.entries()]
    .map(([iso, label]) => ({ iso, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function normalizeFeature(feature, source) {
  const properties = { ...feature.properties };
  const rawId = feature.id ?? properties.adcode ?? properties.name;
  const id = `${source.sourceType}:${String(rawId)}`;
  const displayName = getDisplayName(properties, source.sourceType, id);
  const countryIso = getFeatureCountryIso(feature, source);

  return {
    ...feature,
    id,
    properties: {
      ...properties,
      regionId: id,
      rawRegionId: String(rawId),
      sourceType: source.sourceType,
      countryIso,
      displayName,
      searchText:
        `${displayName} ${properties.name ?? ""} ${properties.admin ?? ""} ${countryIso ?? ""} ${source.sourceType} ${rawId}`.toLowerCase(),
    },
  };
}

function shouldIncludeFeature(feature, source) {
  const countryIso = getFeatureCountryIso(feature, source);

  if (source.sourceType === "country") {
    return !isDetailEnabledForCountry(countryIso);
  }

  if (source.sourceType === "admin1") {
    if (!isDetailEnabledForCountry(countryIso)) return false;
    return !getHighDetailCountryForIso(countryIso);
  }

  if (source.detailIso && !state.detailCountries[source.detailIso]) return false;

  return !(source.sourceType === "chinaProvince" && String(feature.properties?.adcode) === "100000_JD");
}

function getFeatureCountryIso(feature, source) {
  if (source.sourceType === "country") return feature.properties?.iso_a2 ?? feature.id;
  if (source.sourceType === "chinaProvince") return "CN";
  if (source.sourceType === "usState") return "US";
  return feature.properties?.iso_a2 ?? null;
}

function isDetailEnabledForCountry(countryIso) {
  if (!countryIso) return false;
  return Boolean(state.detailCountries[getDetailCountryKey(countryIso)]);
}

function getDetailCountryKey(countryIso) {
  return getHighDetailCountryForIso(countryIso) ?? countryIso;
}

function getHighDetailCountryForIso(countryIso) {
  if (!countryIso) return null;
  if (HIGH_DETAIL_COUNTRIES[countryIso]) return countryIso;
  for (const [iso, detail] of Object.entries(HIGH_DETAIL_COUNTRIES)) {
    if (detail.countryIsoIds?.has(countryIso)) return iso;
  }
  return null;
}

function getDetailOptionLabel(countryIso) {
  if (!countryIso) return "Country";
  const option = state.detailOptions.find((item) => item.iso === countryIso);
  if (option) return option.label;
  if (HIGH_DETAIL_COUNTRIES[countryIso]) return HIGH_DETAIL_COUNTRIES[countryIso].label;
  return countryIso;
}

function hasDetailOption(countryIso) {
  return state.detailOptions.some((item) => item.iso === countryIso);
}

function prepareFeature(feature, sourceKey) {
  if (sourceKey !== "chinaProvinces") return feature;

  return {
    ...feature,
    geometry: reverseGeoJsonRings(feature.geometry),
  };
}

function reverseGeoJsonRings(geometry) {
  if (!geometry) return geometry;

  if (geometry.type === "Polygon") {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map(reverseRing),
    };
  }

  if (geometry.type === "MultiPolygon") {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((polygon) => polygon.map(reverseRing)),
    };
  }

  if (geometry.type === "GeometryCollection") {
    return {
      ...geometry,
      geometries: geometry.geometries.map(reverseGeoJsonRings),
    };
  }

  return geometry;
}

function reverseRing(ring) {
  return [...ring].reverse();
}

function getDisplayName(properties, sourceType, fallback) {
  const name =
    String(properties.name || properties.NAME || "").trim() ||
    (properties.adchar === "JD" ? "南海诸岛" : fallback);

  if (sourceType === "country" && name === "United States of America") {
    return "United States";
  }

  return name;
}

function renderAll() {
  renderMapHeader();
  renderStats();
  renderMap();
  renderMapLegend();
}

function renderMapHeader() {
  const dataset = DATASETS[state.datasetKey];
  const countryLabel = getDetailOptionLabel(state.selectedDetailCountry);
  const detailLabel = isDetailEnabledForCountry(state.selectedDetailCountry) ? "Subdivisions" : "Country level";

  els.mapEyebrow.textContent = `${dataset.optionLabel} / ${VIEW_MODES[state.viewMode].label} / ${detailLabel}`;
  els.mapTitle.textContent = countryLabel || dataset.label;
}

function renderStats() {
  const loaded = state.datasets.get(state.datasetKey);
  if (!loaded) return;

  const levels = getCurrentLevels();
  const marked = Object.values(levels).filter((level) => level > 0);
  const total = loaded.features.length;
  const average = marked.length
    ? marked.reduce((sum, level) => sum + level, 0) / marked.length
    : 0;

  els.visitedCount.textContent = String(marked.length);
  const coveragePercent = (marked.length / total) * 100;
  els.coverage.textContent =
    marked.length > 0 && coveragePercent < 1 ? "<1%" : `${Math.round(coveragePercent)}%`;
  els.averageLevel.textContent = marked.length ? average.toFixed(1) : "-";
}

function openPlaceMenu() {
  state.placeMenuOpen = true;
  els.placeSearchInput.setAttribute("aria-expanded", "true");
  renderPlaceOptions();
}

function closePlaceMenu(options = {}) {
  state.placeMenuOpen = false;
  els.placeSearchInput.setAttribute("aria-expanded", "false");
  els.placeOptions.hidden = true;

  if (options.resetInput !== false) {
    syncPlaceSearchLabel();
  }
}

function syncPlaceSearchLabel() {
  els.placeSearchInput.value = getPlaceInputLabel();
}

function getPlaceInputLabel() {
  const selected = getSelectedFeature();
  return selected?.properties.displayName ?? getDetailOptionLabel(state.selectedDetailCountry);
}

function renderPlaceOptions() {
  if (!state.placeMenuOpen) {
    els.placeOptions.hidden = true;
    return;
  }

  const options = getPlaceOptions(els.placeSearchInput.value).slice(0, 24);
  els.placeOptions.hidden = false;

  if (!options.length) {
    els.placeOptions.innerHTML = `<div class="empty-state compact">No matching places.</div>`;
    return;
  }

  els.placeOptions.innerHTML = options
    .map(
      (option) => `
        <button
          class="place-option ${option.selected ? "is-selected" : ""}"
          type="button"
          role="option"
          data-place-option
          data-place-type="${escapeHtml(option.type)}"
          data-place-id="${escapeHtml(option.id)}"
          aria-selected="${option.selected ? "true" : "false"}"
        >
          <span>${escapeHtml(option.label)}</span>
          <small>${escapeHtml(option.meta)}</small>
        </button>
      `,
    )
    .join("");
}

function getPlaceOptions(query) {
  const loaded = state.datasets.get(state.datasetKey);
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  const countries = state.detailOptions.map((option) => ({
    type: "country",
    id: option.iso,
    label: option.label,
    meta: isDetailEnabledForCountry(option.iso) ? "Country / subdivisions on" : "Country",
    searchText: `${option.label} ${option.iso} country`.toLowerCase(),
    selected: !state.selectedId && option.iso === state.selectedDetailCountry,
  }));

  const regions =
    loaded?.features
      .filter((feature) => feature.properties.sourceType !== "country")
      .map((feature) => {
        const country = getDetailOptionLabel(getDetailCountryKey(feature.properties.countryIso));
        const level = getRegionLevel(feature.properties.regionId);

        return {
          type: "region",
          id: feature.properties.regionId,
          label: feature.properties.displayName,
          meta: `${getRegionKindLabel(feature)} / ${country}${level ? ` / Level ${level}` : ""}`,
          searchText: feature.properties.searchText,
          selected: feature.properties.regionId === state.selectedId,
        };
      }) ?? [];

  return [...countries, ...regions].filter((option) =>
    terms.length ? terms.every((term) => option.searchText.includes(term)) : true,
  );
}

function handlePlaceSearchKeydown(event) {
  if (event.key === "Escape") {
    closePlaceMenu();
    els.placeSearchInput.blur();
    return;
  }

  if (event.key !== "Enter") return;

  const option = els.placeOptions.querySelector("[data-place-option]");
  if (!option || els.placeOptions.hidden) return;

  event.preventDefault();
  selectPlaceOption(option.dataset.placeType, option.dataset.placeId);
}

function selectPlaceOption(type, id) {
  if (type === "country") {
    selectCountry(id, { zoom: true, clearSelection: true, announce: true });
    closePlaceMenu({ resetInput: false });
    syncPlaceSearchLabel();
    return;
  }

  if (type === "region") {
    closePlaceMenu({ resetInput: false });
    selectRegion(id, { focusMap: true, openMenu: true });
    syncPlaceSearchLabel();
  }
}

function renderLevelButtons(activeLevel) {
  return LEVELS.map(
    (level) => `
      <button
        class="mini-level ${activeLevel === level.value ? "is-active" : ""}"
        type="button"
        data-level="${level.value}"
        aria-label="Set level ${level.value}: ${getLevelLabel(level.value)}"
        title="${getLevelLabel(level.value)}"
        style="--level-color: ${level.color}"
      >
        ${level.value}
      </button>
    `,
  ).join("");
}

function renderMap() {
  const loaded = state.datasets.get(state.datasetKey);
  if (!loaded) return;

  const width = Math.max(320, els.mapFrame.clientWidth);
  const height = Math.max(360, els.mapFrame.clientHeight);
  const dataset = DATASETS[state.datasetKey];
  const projectionMode = getResolvedProjectionMode();
  const projection = createProjection(dataset, loaded.collection, width, height);
  const path = d3.geoPath(projection);

  state.currentProjection = projection;
  state.currentPath = path;
  state.currentSize = { width, height };

  els.mapFrame.classList.toggle("is-globe", isGlobeMode());
  svg.attr("viewBox", `0 0 ${width} ${height}`);
  viewport.attr("transform", isGlobeMode() ? d3.zoomIdentity : state.zoomTransform);

  viewport
    .select(".sphere")
    .datum({ type: "Sphere" })
    .attr("d", path)
    .attr("display", shouldShowSphere(projectionMode) ? null : "none");

  viewport
    .select(".graticule")
    .datum(d3.geoGraticule10())
    .attr("d", path)
    .attr("display", dataset.graticule || isGlobeMode() ? null : "none");

  const regions = viewport
    .select(".regions")
    .selectAll("path.region")
    .data(loaded.features, (feature) => feature.properties.regionId);

  regions
    .join(
      (enter) =>
        enter
          .append("path")
          .attr("class", "region")
          .attr("tabindex", 0)
          .attr("role", "button")
          .on("click", (event, feature) => {
            event.stopPropagation();
            selectRegion(feature.properties.regionId, {
              focusMap: false,
              openMenu: true,
              point: d3.pointer(event, els.mapFrame),
            });
          })
          .on("keydown", (event, feature) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              selectRegion(feature.properties.regionId, { focusMap: false, openMenu: true });
            }
          })
          .on("pointerenter", showTooltip)
          .on("pointermove", moveTooltip)
          .on("pointerleave", hideTooltip),
      (update) => update,
      (exit) => exit.remove(),
    )
    .attr("d", path)
    .attr("fill", (feature) => getFillColor(getRegionLevel(feature.properties.regionId)))
    .attr("aria-label", (feature) => {
      const level = getRegionLevel(feature.properties.regionId);
      return `${feature.properties.displayName}, ${level ? `level ${level}` : "unmarked"}`;
    })
    .classed("is-marked", (feature) => getRegionLevel(feature.properties.regionId) > 0)
    .classed("is-selected", (feature) => state.selectedId === feature.properties.regionId);
}

function createProjection(dataset, collection, width, height) {
  const padding = Math.max(22, Math.min(width, height) * 0.045);
  const extent = [
    [padding, padding],
    [width - padding, height - padding],
  ];
  const projectionMode = getResolvedProjectionMode();

  if (projectionMode === "globe") {
    const scale = Math.min(width, height) * 0.46 * state.globeZoom;
    return d3
      .geoOrthographic()
      .rotate(state.globeRotation)
      .translate([width / 2, height / 2])
      .scale(scale)
      .clipAngle(90)
      .precision(0.5);
  }

  const projection =
    projectionMode === "albersUsa"
      ? d3.geoAlbersUsa()
      : projectionMode === "mercator"
        ? d3.geoMercator()
        : projectionMode === "equirectangular"
          ? d3.geoEquirectangular()
        : projectionMode === "equalEarth"
          ? d3.geoEqualEarth()
        : d3.geoNaturalEarth1();

  return projection.fitExtent(extent, collection);
}

function getResolvedProjectionMode() {
  return state.viewMode;
}

function shouldShowSphere(projectionMode) {
  return projectionMode === "globe" || projectionMode === "naturalEarth" || projectionMode === "equalEarth";
}

function setRegionLevel(regionId, level) {
  const levels = getCurrentLevels();
  const normalizedLevel = normalizeLevel(level);

  if (normalizedLevel) {
    levels[regionId] = normalizedLevel;
  } else {
    delete levels[regionId];
  }

  saveLevels();
  renderAll();
  renderOpenLevelMenu();

  const selected = getFeatureById(regionId);
  if (selected) {
    announce(
      normalizedLevel
        ? `${selected.properties.displayName}: level ${normalizedLevel}`
        : `${selected.properties.displayName}: cleared`,
    );
  }
}

function selectRegion(regionId, options = {}) {
  const feature = getFeatureById(regionId);

  if (!feature) return;

  syncSelectedCountryFromFeature(feature);
  state.selectedId = regionId;
  state.menuRegionId = options.openMenu ? regionId : state.menuRegionId;
  renderDetailControls();
  renderMapHeader();
  renderMap();

  if (options.focusMap) {
    zoomToFeature(regionId);
  }

  if (options.openMenu) {
    openLevelMenu(regionId, options.point);
  }
}

function clearSelectedRegion() {
  if (!state.selectedId && !state.menuRegionId && els.levelMenu.hidden) return;

  state.selectedId = null;
  hideLevelMenu();
  hideTooltip();
  renderDetailControls();
  renderMap();
}

function zoomToFeature(regionId) {
  const feature = getFeatureById(regionId);
  focusGeoObject(feature);
}

function zoomToCountry(countryIso) {
  const features = getCountryFocusFeatures(countryIso);
  if (!features.length) return;

  focusGeoObject(features.length === 1 ? features[0] : { type: "FeatureCollection", features });
}

function getCountryFocusFeatures(countryIso) {
  const loaded = state.datasets.get(state.datasetKey);
  const countryKey = getDetailCountryKey(countryIso);
  if (!loaded || !countryKey) return [];

  return loaded.features.filter((feature) => getDetailCountryKey(feature.properties.countryIso) === countryKey);
}

function focusGeoObject(geoObject) {
  if (!geoObject || !state.currentPath) return;

  if (isGlobeMode()) {
    const [longitude, latitude] = d3.geoCentroid(geoObject);
    if (Number.isFinite(longitude) && Number.isFinite(latitude)) {
      state.globeRotation = [-longitude, -latitude, 0];
      state.globeZoom = Math.max(state.globeZoom, 1.9);
      renderMap();
    }
    return;
  }

  const bounds = state.currentPath.bounds(geoObject);
  const [[x0, y0], [x1, y1]] = bounds;
  const dx = x1 - x0;
  const dy = y1 - y0;

  if (!Number.isFinite(dx) || !Number.isFinite(dy) || dx <= 0 || dy <= 0) return;

  const { width, height } = state.currentSize;
  const scale = Math.min(7, Math.max(1, 0.78 / Math.max(dx / width, dy / height)));
  const translate = [width / 2 - (scale * (x0 + x1)) / 2, height / 2 - (scale * (y0 + y1)) / 2];
  const transform = d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale);

  svg.transition().duration(450).call(zoomBehavior.transform, transform);
}

function resetView(announceChange) {
  hideTooltip();

  if (isGlobeMode()) {
    state.globeRotation = getDefaultGlobeRotation(state.datasetKey);
    state.globeZoom = 1;
    renderMap();
    if (announceChange) announce("View reset");
    return;
  }

  svg.transition().duration(350).call(zoomBehavior.transform, d3.zoomIdentity);
  if (announceChange) announce("View reset");
}

function resetFlatZoomState() {
  state.zoomTransform = d3.zoomIdentity;
  svg.call(zoomBehavior.transform, d3.zoomIdentity);
}

function getSelectedFeature() {
  if (!state.selectedId) return null;
  return getFeatureById(state.selectedId);
}

function getFeatureById(regionId) {
  const loaded = state.datasets.get(state.datasetKey);
  return loaded?.features.find((feature) => feature.properties.regionId === regionId) ?? null;
}

function getRegionKindLabel(feature) {
  const labels = {
    admin1: "Subdivision",
    country: "Country",
    usState: "U.S. state",
    chinaProvince: "China province",
  };

  return labels[feature.properties.sourceType] ?? "Region";
}

function getCurrentLevels() {
  if (!state.levels[state.datasetKey]) {
    state.levels[state.datasetKey] = {};
  }
  return state.levels[state.datasetKey];
}

function getRegionLevel(regionId) {
  return normalizeLevel(getCurrentLevels()[regionId]) ?? 0;
}

function getFillColor(level) {
  return LEVELS.find((item) => item.value === level)?.color ?? "var(--region-fill)";
}

function openLevelMenu(regionId, point) {
  const feature = getFeatureById(regionId);
  if (!feature) return;

  state.menuRegionId = regionId;
  renderOpenLevelMenu();
  positionLevelMenu(point ?? getFeatureMenuPoint(feature));
  els.levelMenu.hidden = false;
}

function renderOpenLevelMenu() {
  if (!state.menuRegionId) return;

  const feature = getFeatureById(state.menuRegionId);
  if (!feature) {
    hideLevelMenu();
    return;
  }

  const currentLevel = getRegionLevel(feature.properties.regionId);
  els.levelMenu.innerHTML = `
    <div class="level-menu-heading">
      <span>${escapeHtml(getRegionKindLabel(feature))}</span>
      <strong>${escapeHtml(feature.properties.displayName)}</strong>
    </div>
    <div class="level-menu-buttons">
      ${renderLevelButtons(currentLevel)}
    </div>
    <button class="ghost-button level-clear-button" type="button" data-clear-level>Clear</button>
  `;
}

function handleLevelMenuClick(event) {
  if (!state.menuRegionId) return;

  const levelButton = event.target.closest("[data-level]");
  if (levelButton) {
    setRegionLevel(state.menuRegionId, Number(levelButton.dataset.level));
    hideLevelMenu();
    return;
  }

  if (event.target.closest("[data-clear-level]")) {
    setRegionLevel(state.menuRegionId, 0);
    hideLevelMenu();
  }
}

function getFeatureMenuPoint(feature) {
  if (!state.currentPath) return [state.currentSize.width / 2, state.currentSize.height / 2];

  const [x, y] = state.currentPath.centroid(feature);
  if (Number.isFinite(x) && Number.isFinite(y)) return [x, y];

  return [state.currentSize.width / 2, state.currentSize.height / 2];
}

function positionLevelMenu(point) {
  els.levelMenu.hidden = false;
  const [rawX, rawY] = point;
  const menuRect = els.levelMenu.getBoundingClientRect();
  const frameRect = els.mapFrame.getBoundingClientRect();
  const x = clamp(rawX + 12, 12, frameRect.width - menuRect.width - 12);
  const y = clamp(rawY + 12, 12, frameRect.height - menuRect.height - 12);

  els.levelMenu.style.transform = `translate(${x}px, ${y}px)`;
}

function hideLevelMenu() {
  state.menuRegionId = null;
  els.levelMenu.hidden = true;
}

function showTooltip(event, feature) {
  els.tooltip.hidden = false;
  moveTooltip(event, feature);
}

function moveTooltip(event, feature) {
  const level = getRegionLevel(feature.properties.regionId);
  const levelLabel = level ? getLevelLabel(level) : "Unmarked";
  els.tooltip.innerHTML = `
    <strong>${escapeHtml(feature.properties.displayName)}</strong>
    <span>${level ? `Level ${level}: ${levelLabel}` : "Unmarked"}</span>
  `;

  const frameRect = els.mapFrame.getBoundingClientRect();
  const tooltipRect = els.tooltip.getBoundingClientRect();
  const x = Math.min(event.clientX - frameRect.left + 14, frameRect.width - tooltipRect.width - 12);
  const y = Math.min(event.clientY - frameRect.top + 14, frameRect.height - tooltipRect.height - 12);

  els.tooltip.style.transform = `translate(${Math.max(12, x)}px, ${Math.max(12, y)}px)`;
  els.tooltip.hidden = false;
}

function hideTooltip() {
  els.tooltip.hidden = true;
}

function loadUrlUserData() {
  const encoded = new URLSearchParams(window.location.hash.slice(1)).get(URL_DATA_PARAM);
  if (!encoded) return null;

  try {
    const payload = decodeUrlPayload(encoded);
    const detailSource = {};

    for (const countryIso of Array.isArray(payload.d) ? payload.d : []) {
      const detailKey = normalizeDetailCountryKey(countryIso);
      if (detailKey) detailSource[detailKey] = true;
    }

    for (const countryIso of Array.isArray(payload.x) ? payload.x : []) {
      const detailKey = normalizeDetailCountryKey(countryIso);
      if (detailKey) detailSource[detailKey] = false;
    }

    return {
      detailCountries: sanitizeDetailCountries(detailSource),
      levelLabels: sanitizeLevelLabels(payload.l ?? {}),
      levels: sanitizeImportedMaps({ global: payload.m ?? {} }),
    };
  } catch {
    return null;
  }
}

function syncUrlData() {
  const payload = getUrlPayload();
  const params = new URLSearchParams(window.location.hash.slice(1));

  if (Object.keys(payload).length > 1) {
    params.set(URL_DATA_PARAM, encodeUrlPayload(payload));
  } else {
    params.delete(URL_DATA_PARAM);
  }

  const nextHash = params.toString();
  const nextUrl = `${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ""}`;
  window.history.replaceState(null, "", nextUrl);
}

function getUrlPayload() {
  const payload = { v: 1 };
  const defaults = getDefaultDetailCountries();
  const enabledDetails = [];
  const disabledDetails = [];

  for (const [countryIso, enabled] of Object.entries(state.detailCountries).sort(([a], [b]) => a.localeCompare(b))) {
    const defaultEnabled = defaults[countryIso] ?? false;
    if (enabled && !defaultEnabled) enabledDetails.push(countryIso);
    if (!enabled && defaultEnabled) disabledDetails.push(countryIso);
  }

  const marks = Object.fromEntries(
    Object.entries(state.levels.global ?? {})
      .filter(([, level]) => normalizeLevel(level))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  const labels = Object.fromEntries(
    LEVELS.map((level) => [level.value, state.levelLabels[level.value]])
      .filter(([level, label]) => String(label ?? "").trim() && label !== LEVELS.find((item) => item.value === level)?.label)
      .sort(([a], [b]) => Number(a) - Number(b)),
  );

  if (enabledDetails.length) payload.d = enabledDetails;
  if (disabledDetails.length) payload.x = disabledDetails;
  if (Object.keys(marks).length) payload.m = marks;
  if (Object.keys(labels).length) payload.l = labels;

  return payload;
}

function encodeUrlPayload(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";

  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.slice(index, index + 8192));
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeUrlPayload(value) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function sanitizeImportedMaps(maps) {
  const sanitized = {};

  for (const key of Object.keys(DATASETS)) {
    sanitized[key] = {};
    const source = maps?.[key] ?? {};

    for (const [regionId, level] of Object.entries(source)) {
      const normalizedLevel = normalizeLevel(level);
      if (normalizedLevel) {
        sanitized[key][regionId] = normalizedLevel;
      }
    }
  }

  return sanitized;
}

function loadStoredLevels() {
  try {
    return sanitizeImportedMaps(JSON.parse(localStorage.getItem(STORAGE_KEYS.levels) ?? "{}"));
  } catch {
    return {};
  }
}

function saveLevels() {
  writeLocalStorage(STORAGE_KEYS.levels, JSON.stringify(state.levels));
  syncUrlData();
}

function getStoredDetailCountries() {
  try {
    return sanitizeDetailCountries(JSON.parse(localStorage.getItem(STORAGE_KEYS.detailCountries) ?? "{}"));
  } catch {
    return sanitizeDetailCountries({});
  }
}

function sanitizeDetailCountries(source) {
  const sanitized = getDefaultDetailCountries();

  for (const [key, value] of Object.entries(source ?? {})) {
    const detailKey = normalizeDetailCountryKey(key);
    if (detailKey && typeof value === "boolean") sanitized[detailKey] = value;
  }

  return sanitized;
}

function normalizeDetailCountryKey(value) {
  const countryIso = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(countryIso) ? countryIso : null;
}

function getDefaultDetailCountries() {
  const defaults = {};

  for (const [countryIso, detail] of Object.entries(HIGH_DETAIL_COUNTRIES)) {
    defaults[countryIso] = detail.defaultEnabled;
  }

  return defaults;
}

function saveDetailCountries() {
  writeLocalStorage(STORAGE_KEYS.detailCountries, JSON.stringify(state.detailCountries));
  syncUrlData();
}

function loadStoredLevelLabels() {
  try {
    return sanitizeLevelLabels(JSON.parse(localStorage.getItem(STORAGE_KEYS.levelLabels) ?? "{}"));
  } catch {
    return sanitizeLevelLabels({});
  }
}

function sanitizeLevelLabels(source) {
  const labels = {};

  for (const level of LEVELS) {
    const stored = String(source?.[level.value] ?? "").trim();
    labels[level.value] = stored || level.label;
  }

  return labels;
}

function saveLevelLabels() {
  writeLocalStorage(STORAGE_KEYS.levelLabels, JSON.stringify(state.levelLabels));
  syncUrlData();
}

function getLevelLabel(level) {
  return state.levelLabels[level] || LEVELS.find((item) => item.value === level)?.label || `Level ${level}`;
}

function getStoredDatasetKey() {
  const stored = readLocalStorage(STORAGE_KEYS.dataset);
  return DATASETS[stored] ? stored : "global";
}

function getStoredViewMode() {
  const stored = readLocalStorage(STORAGE_KEYS.viewMode);
  return VIEW_MODES[stored] ? stored : "globe";
}

function readLocalStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The URL remains the source of truth when local storage is unavailable.
  }
}

function getDefaultGlobeRotation() {
  const [longitude, latitude] = DATASETS.global.globeCenter;
  return [-longitude, -latitude, 0];
}

function isGlobeMode() {
  return getResolvedProjectionMode() === "globe";
}

function normalizeLevel(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 5 ? number : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function announce(message) {
  els.statusLine.textContent = message;
  els.statusLine.hidden = !message;
  window.clearTimeout(announce.timeout);
  announce.timeout = window.setTimeout(() => {
    els.statusLine.textContent = "";
    els.statusLine.hidden = true;
  }, 2400);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
