# Detroit Blight Dashboard

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

## Tech Stack

- Vanilla HTML/CSS/JavaScript
- [Chart.js](https://www.chartjs.org/) for charts
- [jsPDF](https://github.com/parallax/jsPDF) + [jsPDF-AutoTable](https://github.com/simonbengtsson/jsPDF-AutoTable) for PDF export

## Project Structure

- `index.html` - app layout and script/style includes
- `styles.css` - dashboard styling and responsive UI
- `app.js` - API integration, data transforms, chart rendering, table rendering, PDF export

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
