# Detroit Dashboard

A modern single-page dashboard for exploring Detroit blight tickets by property address using the ArcGIS FeatureServer API.

## Features

- Search by address (example: `567 KITCHENER`)
- KPI cards for:
  - Total tickets
  - Open balance due
  - Tickets in collections
  - Latest ticket date
- Disposition breakdown chart
- Yearly judgment trend chart
- Detailed ticket table with:
  - Ticket number
  - Ordinance
  - Disposition
  - Payment status
  - Property owner name
  - Inspector
- Export current view to PDF report
- **Street-level imagery** via [Mapillary](https://www.mapillary.com/) Graph API (**most recent** capture **within ~50 m** of the address, preferring the same Mapillary `sequence` / drive as the nearest frame—avoids picking a newer photo far away on another block)

## Mapillary setup (street photos)

1. Create an app and copy a **Client Token** from [Mapillary Developers](https://www.mapillary.com/dashboard/developers).
2. Put the token in `config.js`:

```js
window.MAPILLARY_ACCESS_TOKEN = "YOUR_CLIENT_TOKEN";
```

You can start from `config.example.js`. Do **not** commit real tokens to a public repository.

The app calls `https://graph.mapillary.com/images` with a small bounding box around the address coordinates, then loads full image metadata (including thumbnail URLs) via `GET https://graph.mapillary.com/{image_id}`. Requests use the `access_token` query parameter so the browser can make simple CORS-safe GETs (avoiding `Authorization` preflight issues). See [Mapillary API documentation](https://www.mapillary.com/developer/api-documentation) for details.

**Links:** The Graph API **`id`** is the web app’s **`pKey`**. The primary **Open in Mapillary** control builds the same style of URL as manual browsing: **`lat`**, **`lng`**, **`z`**, and **`pKey`**, using your **searched address** coordinates so the map matches ArcGIS (similar to [this pattern](https://www.mapillary.com/app/user/codgis?lat=42.443806425760386&lng=-82.98837681730902&z=18.159112379901295&pKey=192761682711429)). Set optional **`MAPILLARY_APP_BASE`** in `config.js` (e.g. `https://www.mapillary.com/app/user/codgis`) if you want contributor-scoped paths. Frames farther than **`MAPILLARY_MAX_DISTANCE_FROM_ADDRESS_M`** (default 125 m) from the search point are not shown.

## Tech Stack

- Vanilla HTML/CSS/JavaScript
- [Chart.js](https://www.chartjs.org/) for charts
- [jsPDF](https://github.com/parallax/jsPDF) + [jsPDF-AutoTable](https://github.com/simonbengtsson/jsPDF-AutoTable) for PDF export
- [Mapillary Graph API](https://www.mapillary.com/developer/api-documentation) for street-level thumbnails (optional)

## Project Structure

- `index.html` - app layout and script/style includes
- `styles.css` - dashboard styling and responsive UI
- `app.js` - API integration, data transforms, chart rendering, table rendering, PDF export, Mapillary imagery
- `config.js` - optional Mapillary Client Token (`MAPILLARY_ACCESS_TOKEN`)
- `config.example.js` - example token config

## Getting Started

1. Start a local static server from the project root:

```bash
python3 -m http.server 8000
```

2. Open:

```text
http://localhost:8000
```

## API Example

The dashboard queries this ArcGIS endpoint pattern:

```text
https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/blight_tickets/FeatureServer/0/query?where=address%20%3D%20%27567%20KITCHENER%27&outFields=*&outSR=4326&f=json
```

## Notes

- Address search is normalized to uppercase in the app before querying.
- PDF export contains the currently loaded address, KPI snapshot, and visible ticket rows.
- Mapillary search uses **ArcGIS feature `geometry`** first (`x`/`y` in WGS84 when `outSR=4326`), then attribute `latitude`/`longitude` if geometry is missing. Those can differ; using geometry keeps Mapillary aligned with the map you see in the API.
