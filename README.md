# Visited Places

An interactive SVG map for tracking visited regions on a single world view.

## Current Map

The app renders one global map. Most regions are countries by default. The sidebar starts with a country selector; choosing a country moves the map to that country, and the subdivision toggle applies to that selected country. Clicking a country or one of its subdivisions on the map also syncs the sidebar selector. Natural Earth admin-1 data is included for broad global coverage, with higher-detail local files for United States states and China provinces.

Click a region to open a local 1-5 level menu. The map-corner legend labels can be edited by the user. The default working labels are:

1. Passed through
2. Short stop
3. Stayed
4. Explored
5. Lived or returned

The map view supports Natural Earth, Equal Earth, Mercator, Equirectangular, and a globe-style 3D orthographic mode. Flat projections can be panned and zoomed; globe mode can be rotated and zoomed.

## Development

```bash
npm install
npm run dev
```

## GitHub Pages

This is a static app. The repository should not commit `dist` or `node_modules`; GitHub Actions builds `dist` and publishes it to Pages.

The workflow uses `BASE_PATH=/${{ github.event.repository.name }}/` so project Pages URLs load Vite assets from the correct subpath.

For a private repository, GitHub Pages must be supported by the account plan. If Pages is not available for the private repository, either upgrade the plan or make the repository public, then enable Pages with GitHub Actions as the source and run the deploy workflow.

## Data

Boundary files are stored in `public/data` so the app can run without calling map data APIs at runtime.

- `countries-110m.json`: `world-atlas`
- `countries-admin0.json`: Natural Earth admin-0 countries
- `admin1-10m.json`: trimmed Natural Earth admin-1 states/provinces
- `states-10m.json`: `us-atlas`
- `china-provinces.json`: Aliyun DataV area boundary data
