const API_ROOT =
  "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/blight_tickets/FeatureServer/0/query";
const SALES_API_ROOT =
  "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/assessor_property_sales_view/FeatureServer/0/query";
const TAX_API_ROOT =
  "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/tentative_assessment_roll_2026/FeatureServer/0/query";
const MAPILLARY_GRAPH = "https://graph.mapillary.com";

/** Only consider imagery within this distance (m) of the address for “same street” / recency pick. */
const MAPILLARY_MAX_STREET_DISTANCE_M = 50;

/** Never show a frame whose capture is farther than this from the ArcGIS search point (avoids “wrong street” ~300m away). */
const MAPILLARY_MAX_DISTANCE_FROM_ADDRESS_M = 333;

/** Fields for list + detail requests (sequence groups images from one drive = same street). */
const MAPILLARY_IMAGE_FIELDS =
  "id,captured_at,geometry,computed_geometry,sequence,thumb_256_url,thumb_1024_url,thumb_2048_url";

/**
 * Optional web app path (e.g. contributor view). Set `window.MAPILLARY_APP_BASE` in config.js.
 * Example: `"https://www.mapillary.com/app/user/codgis"`
 */
function getMapillaryAppBaseUrl() {
  if (typeof window === "undefined") return "https://www.mapillary.com/app/";
  const b = String(window.MAPILLARY_APP_BASE || "").trim();
  if (!b) return "https://www.mapillary.com/app/";
  try {
    return new URL(b).toString();
  } catch {
    return "https://www.mapillary.com/app/";
  }
}

/**
 * Mapillary web app query params. Manual browsing often produces URLs like:
 * `...?lat=...&lng=...&z=...&pKey=...` — map center + photo id together (see Mapillary app).
 * - With **`pKey`**: pass **`lat`/`lng`/`z`** from your **searched address** so the map matches ArcGIS.
 * - Map-only: omit `pKey`.
 */
function buildMapillaryAppUrl({ pKey, lat, lng, zoom = 18, focus }) {
  const url = new URL(getMapillaryAppBaseUrl());
  const key = pKey != null && String(pKey).trim() !== "" ? String(pKey).trim() : "";
  if (typeof lat === "number" && typeof lng === "number" && !Number.isNaN(lat) && !Number.isNaN(lng)) {
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lng", String(lng));
    url.searchParams.set("z", String(zoom));
  }
  if (focus) url.searchParams.set("focus", focus);
  if (key) url.searchParams.set("pKey", key);
  return url.toString();
}

/** Graph API image id (used as web `pKey`) — string so very large numeric ids aren’t rounded by JSON. */
function getMapillaryImageKey(image) {
  if (!image || image.id == null) return "";
  return String(image.id).trim();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Keeps the sidebar “Mapillary” link in sync with map position (property point until an image loads). */
function updateMapillaryInfoLink(lat, lng, zoom = 17) {
  const a = els.mapillaryInfoLink;
  if (!a) return;
  if (typeof lat === "number" && typeof lng === "number" && !Number.isNaN(lat) && !Number.isNaN(lng)) {
    a.href = buildMapillaryAppUrl({ lat, lng, zoom });
  } else {
    a.href = "https://www.mapillary.com/";
  }
}

const els = {
  form: document.querySelector("#search-form"),
  input: document.querySelector("#address-input"),
  exportBtn: document.querySelector("#export-btn"),
  status: document.querySelector("#status"),
  body: document.querySelector("#ticket-body"),
  salesStatus: document.querySelector("#sales-status"),
  salesBody: document.querySelector("#sales-body"),
  taxStatus: document.querySelector("#tax-status"),
  taxBody: document.querySelector("#tax-body"),
  taxAssessedTentative: document.querySelector("#tax-assessed-tentative"),
  taxAssessedCurrent: document.querySelector("#tax-assessed-current"),
  taxAssessedPrevious: document.querySelector("#tax-assessed-previous"),
  taxStatusValue: document.querySelector("#tax-status-value"),
  total: document.querySelector("#kpi-total"),
  balance: document.querySelector("#kpi-balance"),
  collections: document.querySelector("#kpi-collections"),
  latest: document.querySelector("#kpi-latest"),
  mapillaryStatus: document.querySelector("#mapillary-status"),
  mapillaryBody: document.querySelector("#mapillary-body"),
  mapillaryInfoLink: document.querySelector("#mapillary-info-link"),
};

let mapillaryRequestSeq = 0;

let dispositionChart;
let yearChart;
let currentRows = [];

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function setStatus(message) {
  els.status.textContent = message;
}

function setSalesStatus(message) {
  els.salesStatus.textContent = message;
}

function setTaxStatus(message) {
  els.taxStatus.textContent = message;
}

function setMapillaryStatus(message) {
  els.mapillaryStatus.textContent = message;
}

function getMapillaryToken() {
  return (typeof window !== "undefined" && String(window.MAPILLARY_ACCESS_TOKEN || "").trim()) || "";
}

/**
 * ArcGIS FeatureServer returns the real map location on `geometry` (e.g. `{ x: lng, y: lat }` in
 * WGS84 when `outSR=4326`). Attribute fields `latitude` / `longitude` can disagree — use geometry first.
 */
function lngLatFromArcgisGeometry(geometry) {
  if (!geometry || typeof geometry !== "object") return null;
  if (
    typeof geometry.x === "number" &&
    typeof geometry.y === "number" &&
    !Number.isNaN(geometry.x) &&
    !Number.isNaN(geometry.y)
  ) {
    return { lng: geometry.x, lat: geometry.y };
  }
  if (geometry.type === "Point" && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2) {
    const lng = Number(geometry.coordinates[0]);
    const lat = Number(geometry.coordinates[1]);
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) return { lng, lat };
  }
  return null;
}

function lngLatFromAttributeRow(row) {
  if (!row) return null;
  const lat = row.latitude;
  const lng = row.longitude;
  if (lat != null && lng != null && !Number.isNaN(Number(lat)) && !Number.isNaN(Number(lng))) {
    return { lat: Number(lat), lng: Number(lng) };
  }
  return null;
}

/** Prefer each feature’s `geometry`, then `attributes` lat/lng (blight rows first, then sales). */
function extractCoordinatesFromFeatures(blightFeatures, salesFeatures) {
  const blight = Array.isArray(blightFeatures) ? blightFeatures : [];
  const sales = Array.isArray(salesFeatures) ? salesFeatures : [];

  for (const f of blight) {
    const g = lngLatFromArcgisGeometry(f.geometry);
    if (g) return { lat: g.lat, lng: g.lng };
    const a = lngLatFromAttributeRow(f.attributes);
    if (a) return a;
  }
  for (const f of sales) {
    const g = lngLatFromArcgisGeometry(f.geometry);
    if (g) return { lat: g.lat, lng: g.lng };
    const a = lngLatFromAttributeRow(f.attributes);
    if (a) return a;
  }
  return null;
}

function distMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getImageLngLat(image) {
  // Prefer CV-corrected position (usually on the road); raw geometry can sit off the street.
  const g = image.computed_geometry || image.geometry;
  if (!g) return null;
  if (typeof g.x === "number" && typeof g.y === "number" && !Number.isNaN(g.x) && !Number.isNaN(g.y)) {
    return { lng: g.x, lat: g.y };
  }
  const coords = g.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  return { lng: Number(coords[0]), lat: Number(coords[1]) };
}

/** Map / deep links should use the image capture position when `pKey` is set, or the map centers on the address while the photo is elsewhere. */
function getCoordsForMapillaryApp(image, fallbackLat, fallbackLng) {
  const p = getImageLngLat(image);
  if (p && !Number.isNaN(p.lat) && !Number.isNaN(p.lng)) {
    return { lat: p.lat, lng: p.lng };
  }
  return { lat: fallbackLat, lng: fallbackLng };
}

function normalizeCapturedAtMs(value) {
  const n = Number(value);
  if (!n || Number.isNaN(n)) return 0;
  // API may return seconds or milliseconds
  return n < 1e12 ? Math.round(n * 1000) : n;
}

function getSequenceId(image) {
  if (!image || image.sequence == null) return null;
  const s = image.sequence;
  if (typeof s === "string") return s;
  if (typeof s === "object" && s.id != null) return String(s.id);
  return null;
}

/**
 * Prefer **most recent** image **near the address** (same “street” proxy):
 * 1) Among captures within {@link MAPILLARY_MAX_STREET_DISTANCE_M} m, take the closest to the property
 *    as an anchor, then the newest image on the same Mapillary `sequence` (one drive along a street).
 * 2) If `sequence` is missing, newest within that distance band (tie-break: closer).
 * 3) If nothing falls within the street band, pick the **closest** capture only if within
 *    {@link MAPILLARY_MAX_DISTANCE_FROM_ADDRESS_M} (otherwise return null — don’t show a frame 300m away).
 */
function pickBestMapillaryImage(images, plat, plng) {
  if (!images || !images.length) return null;

  const scored = images
    .map((img) => {
      const point = getImageLngLat(img);
      if (!point) return null;
      const dist = distMeters(plat, plng, point.lat, point.lng);
      const capturedAt = normalizeCapturedAtMs(img.captured_at);
      return { img, dist, capturedAt, seqId: getSequenceId(img) };
    })
    .filter(Boolean);

  if (!scored.length) {
    return [...images].sort(
      (a, b) => normalizeCapturedAtMs(b.captured_at) - normalizeCapturedAtMs(a.captured_at)
    )[0];
  }

  const local = scored.filter((x) => x.dist <= MAPILLARY_MAX_STREET_DISTANCE_M);
  if (local.length) {
    local.sort((a, b) => a.dist - b.dist);
    const anchor = local[0];
    const pool =
      anchor.seqId != null ? local.filter((x) => x.seqId === anchor.seqId) : local;
    pool.sort((a, b) => {
      if (b.capturedAt !== a.capturedAt) return b.capturedAt - a.capturedAt;
      return a.dist - b.dist;
    });
    return pool[0].img;
  }

  scored.sort((a, b) => a.dist - b.dist);
  const nearest = scored[0];
  if (nearest.dist > MAPILLARY_MAX_DISTANCE_FROM_ADDRESS_M) return null;
  return nearest.img;
}

/**
 * Mapillary list/search often omits thumb_* URLs — fetch single image for full fields.
 * Use access_token as query param (not Authorization header) so the browser can make a "simple"
 * GET without a CORS preflight that some origins block.
 */
async function fetchMapillaryImageDetails(id, token) {
  const fields = MAPILLARY_IMAGE_FIELDS;
  const params = new URLSearchParams({
    fields,
    access_token: token,
  });
  const sid = encodeURIComponent(String(id));
  const res = await fetch(`${MAPILLARY_GRAPH}/${sid}?${params.toString()}`);
  if (!res.ok) return null;
  const json = await res.json();
  if (json && json.error) return null;
  if (json && json.id) return json;
  if (json && json.data) {
    if (Array.isArray(json.data) && json.data[0]) return json.data[0];
    if (json.data.id) return json.data;
  }
  return null;
}

/**
 * Mapillary /images bbox must be < 0.01 square degrees (see API docs). Sparse areas often return
 * zero results for a tiny box — retry with larger pads up to that limit.
 */
async function fetchMapillaryImagesWithBboxExpansion(lat, lng, token) {
  const fields = MAPILLARY_IMAGE_FIELDS;
  const padsDeg = [0.003, 0.006, 0.012, 0.024, 0.045];

  for (const pad of padsDeg) {
    const minLon = lng - pad;
    const minLat = lat - pad;
    const maxLon = lng + pad;
    const maxLat = lat + pad;
    const lonSpan = maxLon - minLon;
    const latSpan = maxLat - minLat;
    if (lonSpan * latSpan >= 0.0099) continue;

    const bbox = `${minLon},${minLat},${maxLon},${maxLat}`;
    const params = new URLSearchParams({
      bbox,
      fields,
      limit: "200",
      access_token: token,
    });
    const response = await fetch(`${MAPILLARY_GRAPH}/images?${params.toString()}`);
    if (!response.ok) continue;
    const payload = await response.json();
    if (payload.error) continue;
    const rows = Array.isArray(payload.data) ? payload.data : [];
    if (rows.length) {
      return { rows, padDeg: pad, bbox };
    }
  }
  return { rows: [], padDeg: null, bbox: null };
}

function renderMapillaryPlaceholder(html) {
  els.mapillaryBody.innerHTML = `<p class="empty-row mapillary-placeholder">${html}</p>`;
}

function renderMapillaryImage(image, plat, plng, accessToken) {
  const thumbRaw =
    image.thumb_2048_url || image.thumb_1024_url || image.thumb_256_url || "";
  const point = getImageLngLat(image);
  const distM = point ? Math.round(distMeters(plat, plng, point.lat, point.lng)) : null;
  const capMs = normalizeCapturedAtMs(image.captured_at);
  const capLabel = capMs
    ? new Date(capMs).toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "Unknown date";
  const cap = getCoordsForMapillaryApp(image, plat, plng);
  const imageKey = getMapillaryImageKey(image);
  const openInMapillaryHref = imageKey
    ? buildMapillaryAppUrl({ pKey: imageKey, lat: plat, lng: plng, zoom: 18 })
    : buildMapillaryAppUrl({ lat: plat, lng: plng, zoom: 18, focus: "map" });
  const mapAtPropertyHref = buildMapillaryAppUrl({
    lat: plat,
    lng: plng,
    zoom: 18,
    focus: "map",
  });
  const mapAtCaptureHref = buildMapillaryAppUrl({
    lat: cap.lat,
    lng: cap.lng,
    zoom: 19,
    focus: "map",
  });
  const pKeyOnlyHref = imageKey ? buildMapillaryAppUrl({ pKey: imageKey }) : "";

  els.mapillaryBody.innerHTML = `
    <div class="mapillary-layout">
      <div class="mapillary-img-wrap">
        ${
          thumbRaw
            ? `<img id="mapillary-photo" alt="Mapillary street-level photo near property" loading="lazy" />`
            : `<p class="empty-row mapillary-placeholder" style="padding:1rem">No preview URL returned for this image.</p>`
        }
      </div>
      <div class="mapillary-meta">
        <div><strong>Capture</strong>: ${capLabel}</div>
        ${
          distM != null
            ? `<div><strong>Approx. distance</strong>: ${distM.toLocaleString()} m from address point</div>`
            : ""
        }
        <div class="mapillary-actions mapillary-actions--stack">
          <a href="${openInMapillaryHref}" target="_blank" rel="noopener noreferrer">Open in Mapillary</a>
          <a href="${mapAtPropertyHref}" target="_blank" rel="noopener noreferrer" class="mapillary-link-secondary">Map at address (no photo id)</a>
          <a href="${mapAtCaptureHref}" target="_blank" rel="noopener noreferrer" class="mapillary-link-secondary">Map at photo position</a>
          ${
            pKeyOnlyHref
              ? `<a href="${pKeyOnlyHref}" target="_blank" rel="noopener noreferrer" class="mapillary-link-secondary">pKey only</a>`
              : ""
          }
          <span class="data-note" style="margin:0">© Mapillary contributors</span>
        </div>
        <p class="data-note" style="margin:0.35rem 0 0">
          Graph API image id: <code>${escapeHtml(imageKey) || "—"}</code> (<code>pKey</code>). <strong>Open in Mapillary</strong> uses the same pattern as the web app: <code>lat</code>, <code>lng</code>, <code>z</code>, and <code>pKey</code>, centered on your <strong>searched address</strong>. Optional base path: <code>MAPILLARY_APP_BASE</code> in <code>config.js</code> (e.g. <code>/app/user/codgis</code>).
        </p>
      </div>
    </div>
  `;

  const imgEl = document.getElementById("mapillary-photo");
  if (imgEl && thumbRaw) {
    let triedToken = false;
    imgEl.src = thumbRaw;
    imgEl.addEventListener("error", function onMapillaryImgError() {
      if (!accessToken || triedToken) return;
      triedToken = true;
      const sep = thumbRaw.includes("?") ? "&" : "?";
      imgEl.src = `${thumbRaw}${sep}access_token=${encodeURIComponent(accessToken)}`;
    });
  }
}

async function loadMapillarySection(coords) {
  const mySeq = ++mapillaryRequestSeq;
  const isCurrent = () => mySeq === mapillaryRequestSeq;

  setMapillaryStatus("Loading...");
  if (!coords) {
    if (!isCurrent()) return;
    updateMapillaryInfoLink(null, null);
    setMapillaryStatus("No coordinates");
    renderMapillaryPlaceholder(
      "No latitude/longitude on file for this address (from blight or sales data). Cannot search Mapillary."
    );
    return;
  }

  const { lat, lng } = coords;
  updateMapillaryInfoLink(lat, lng);

  const token = getMapillaryToken();
  if (!token) {
    if (!isCurrent()) return;
    setMapillaryStatus("Token required");
    renderMapillaryPlaceholder(
      'Add your Mapillary <strong>Client Token</strong> to <code>config.js</code> as <code>MAPILLARY_ACCESS_TOKEN</code>. Get one at <a href="https://www.mapillary.com/dashboard/developers" target="_blank" rel="noopener noreferrer">mapillary.com/dashboard/developers</a>.'
    );
    return;
  }

  try {
    const { rows, padDeg } = await fetchMapillaryImagesWithBboxExpansion(lat, lng, token);
    if (!isCurrent()) return;

    let best = pickBestMapillaryImage(rows, lat, lng);
    if (!best) {
      if (!isCurrent()) return;
      const mapillaryMapUrl = buildMapillaryAppUrl({ lat, lng, zoom: 17, focus: "map" });
      if (rows.length > 0) {
        setMapillaryStatus("No frame within range");
        renderMapillaryPlaceholder(
          `Mapillary returned images in the area, but none within <strong>${MAPILLARY_MAX_DISTANCE_FROM_ADDRESS_M} m</strong> of your search point (we avoid showing a frame on another block). Open the map at your address: <a href="${mapillaryMapUrl}" target="_blank" rel="noopener noreferrer">Mapillary — map at searched address</a>.`
        );
      } else {
        setMapillaryStatus("No imagery nearby");
        const approxKm = padDeg != null ? (padDeg * 111).toFixed(1) : "?";
        renderMapillaryPlaceholder(
          `No Mapillary images in the search area around this point (tried up to ~${approxKm} km half-width). Coverage can be sparse — try a major street nearby or confirm coordinates on the map in <a href="${mapillaryMapUrl}" target="_blank" rel="noopener noreferrer">Mapillary</a>.`
        );
      }
      updateMapillaryInfoLink(lat, lng, 17);
      return;
    }

    const details = await fetchMapillaryImageDetails(best.id, token);
    if (!isCurrent()) return;

    const merged = { ...best, ...(details || {}) };
    renderMapillaryImage(merged, lat, lng, token);
    updateMapillaryInfoLink(lat, lng, 18);
    setMapillaryStatus(padDeg != null ? `Loaded (~${(padDeg * 111).toFixed(1)} km search)` : "Loaded");
  } catch (err) {
    console.error(err);
    if (!isCurrent()) return;
    setMapillaryStatus("Failed");
    renderMapillaryPlaceholder(
      "Could not load Mapillary imagery (check token, network, or browser CORS). See browser console for details."
    );
  }
}

function formatDate(value) {
  if (!value) return "-";
  const isEpoch = typeof value === "number";
  const date = new Date(isEpoch ? value : `${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function toNumber(value) {
  return Number(value || 0);
}

function paymentPillClass(paymentStatus, balanceDue) {
  const status = (paymentStatus || "").toUpperCase();
  if (status.includes("PAID")) return "ok";
  if (toNumber(balanceDue) > 0) return "danger";
  return "warn";
}

function buildUrl(address) {
  const where = `address = '${address.replace(/'/g, "''")}'`;
  const params = new URLSearchParams({
    where,
    outFields: "*",
    outSR: "4326",
    f: "json",
  });
  return `${API_ROOT}?${params.toString()}`;
}

function buildSalesUrl(address) {
  const where = `address = '${address.replace(/'/g, "''")}'`;
  const params = new URLSearchParams({
    where,
    outFields: "*",
    outSR: "4326",
    f: "json",
  });
  return `${SALES_API_ROOT}?${params.toString()}`;
}

function buildTaxUrl(address) {
  const where = `address = '${address.replace(/'/g, "''")}'`;
  const params = new URLSearchParams({
    where,
    outFields: "*",
    outSR: "4326",
    f: "json",
  });
  return `${TAX_API_ROOT}?${params.toString()}`;
}

function aggregateData(features) {
  const attrs = features.map((item) => item.attributes || {});
  const total = attrs.length;
  const totalBalance = attrs.reduce((sum, row) => sum + toNumber(row.amt_balance_due), 0);
  const inCollections = attrs.filter((row) =>
    String(row.collection_status || "").toLowerCase().includes("collection")
  ).length;

  const latest = attrs
    .map((row) => row.ticket_issued_date || row.ticket_updated_at)
    .filter(Boolean)
    .map((value) => (typeof value === "number" ? value : Date.parse(`${value}T00:00:00`)))
    .filter((value) => !Number.isNaN(value))
    .sort((a, b) => b - a)[0];

  const byDisposition = attrs.reduce((acc, row) => {
    const key = row.disposition || "Unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const byYear = attrs.reduce((acc, row) => {
    const source = row.ticket_issued_date || row.judgment_date;
    if (!source) return acc;
    const year =
      typeof source === "string" ? source.slice(0, 4) : String(new Date(source).getFullYear());
    if (!year || year === "NaN") return acc;
    acc[year] = (acc[year] || 0) + toNumber(row.amt_judgment);
    return acc;
  }, {});

  return { attrs, total, totalBalance, inCollections, latest, byDisposition, byYear };
}

function renderKpis(summary) {
  els.total.textContent = summary.total.toLocaleString();
  els.balance.textContent = currency.format(summary.totalBalance);
  els.collections.textContent = summary.inCollections.toLocaleString();
  els.latest.textContent = summary.latest ? formatDate(summary.latest) : "-";
}

function renderTable(rows) {
  if (!rows.length) {
    currentRows = [];
    els.body.innerHTML =
      '<tr><td colspan="9" class="empty-row">No tickets found for this address</td></tr>';
    return;
  }

  const sorted = [...rows].sort((a, b) => {
    const da = Date.parse(`${a.ticket_issued_date || "1900-01-01"}T00:00:00`);
    const db = Date.parse(`${b.ticket_issued_date || "1900-01-01"}T00:00:00`);
    return db - da;
  });
  currentRows = sorted;

  els.body.innerHTML = sorted
    .map((row) => {
      const pillClass = paymentPillClass(row.payment_status, row.amt_balance_due);
      return `
      <tr>
        <td>${row.ticket_number || "-"}</td>
        <td>${formatDate(row.ticket_issued_date)}</td>
        <td>${row.ordinance_description || row.ordinance_law || "-"}</td>
        <td>${row.disposition || "-"}</td>
        <td>${currency.format(toNumber(row.amt_judgment))}</td>
        <td>${currency.format(toNumber(row.amt_balance_due))}</td>
        <td><span class="pill ${pillClass}">${row.payment_status || "Unknown"}</span></td>
        <td>${row.property_owner_name || "-"}</td>
        <td>${row.inspector_name || "-"}</td>
      </tr>
    `;
    })
    .join("");
}

function renderSalesTable(rows) {
  if (!rows.length) {
    els.salesBody.innerHTML =
      '<tr><td colspan="4" class="empty-row">No transaction records found for this address</td></tr>';
    return;
  }

  const sorted = [...rows].sort((a, b) => {
    const da = Date.parse(`${a.sale_date || "1900-01-01"}T00:00:00`);
    const db = Date.parse(`${b.sale_date || "1900-01-01"}T00:00:00`);
    return db - da;
  });

  els.salesBody.innerHTML = sorted
    .map(
      (row) => `
      <tr>
        <td>${formatDate(row.sale_date)}</td>
        <td>${row.grantor || "-"}</td>
        <td>${row.grantee || "-"}</td>
        <td>${toNumber(row.amt_sale_price) > 0 ? currency.format(toNumber(row.amt_sale_price)) : "-"}</td>
      </tr>
    `
    )
    .join("");
}

function renderTaxSection(rows) {
  if (!rows.length) {
    els.taxAssessedTentative.textContent = "-";
    els.taxAssessedCurrent.textContent = "-";
    els.taxAssessedPrevious.textContent = "-";
    els.taxStatusValue.textContent = "-";
    els.taxBody.innerHTML =
      '<tr><td colspan="6" class="empty-row">No tax record found for this address</td></tr>';
    return;
  }

  const row = rows[0];
  els.taxAssessedTentative.textContent = currency.format(toNumber(row.amt_assessed_value_tentative));
  els.taxAssessedCurrent.textContent = currency.format(toNumber(row.amt_assessed_value));
  els.taxAssessedPrevious.textContent = currency.format(toNumber(row.amt_assessed_value_previous));
  els.taxStatusValue.textContent = row.tax_status_description || row.tax_status || "-";

  els.taxBody.innerHTML = `
    <tr>
      <td>${row.taxpayer_1 || "-"}</td>
      <td>${row.taxpayer_2 || "-"}</td>
      <td>${row.taxpayer_address || "-"}</td>
      <td>${row.taxpayer_city || "-"}</td>
      <td>${row.taxpayer_state || "-"}</td>
      <td>${row.taxpayer_zip_code || "-"}</td>
    </tr>
  `;
}

function exportPdf() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    setStatus("PDF library did not load.");
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const address = els.input.value.trim().toUpperCase() || "UNKNOWN_ADDRESS";
  const generatedAt = new Date().toLocaleString("en-US");

  doc.setFontSize(18);
  doc.text("Detroit Dashboard Report", 40, 42);
  doc.setFontSize(11);
  doc.text(`Address: ${address}`, 40, 64);
  doc.text(`Generated: ${generatedAt}`, 40, 80);

  doc.setFontSize(10);
  doc.text(
    `Total Tickets: ${els.total.textContent}    Open Balance Due: ${els.balance.textContent}    In Collections: ${els.collections.textContent}    Latest Ticket: ${els.latest.textContent}`,
    40,
    100
  );

  if (!currentRows.length) {
    doc.setFontSize(12);
    doc.text("No ticket data available for this address.", 40, 130);
  } else {
    const bodyRows = currentRows.map((row) => [
      row.ticket_number || "-",
      formatDate(row.ticket_issued_date),
      row.ordinance_description || row.ordinance_law || "-",
      row.disposition || "-",
      currency.format(toNumber(row.amt_judgment)),
      currency.format(toNumber(row.amt_balance_due)),
      row.payment_status || "Unknown",
      row.property_owner_name || "-",
      row.inspector_name || "-",
    ]);

    doc.autoTable({
      startY: 118,
      head: [
        [
          "Ticket #",
          "Issued Date",
          "Ordinance",
          "Disposition",
          "Judgment",
          "Balance Due",
          "Payment Status",
          "Property Owner",
          "Inspector",
        ],
      ],
      body: bodyRows,
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [25, 35, 65] },
      theme: "grid",
    });
  }

  const safeAddress = address.replace(/[^A-Z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  doc.save(`detroit-dashboard-${safeAddress || "address"}.pdf`);
  setStatus("PDF exported.");
}

function destroyCharts() {
  if (dispositionChart) dispositionChart.destroy();
  if (yearChart) yearChart.destroy();
}

function renderCharts(summary) {
  const dispositionLabels = Object.keys(summary.byDisposition);
  const dispositionValues = Object.values(summary.byDisposition);
  const yearLabels = Object.keys(summary.byYear).sort();
  const yearValues = yearLabels.map((year) => summary.byYear[year]);

  const dispositionCtx = document.querySelector("#disposition-chart");
  const yearCtx = document.querySelector("#year-chart");

  destroyCharts();

  dispositionChart = new Chart(dispositionCtx, {
    type: "doughnut",
    data: {
      labels: dispositionLabels,
      datasets: [
        {
          data: dispositionValues,
          backgroundColor: ["#67e8f9", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#93c5fd"],
          borderWidth: 0,
        },
      ],
    },
    options: {
      plugins: {
        legend: { labels: { color: "#dbe6ff" } },
      },
    },
  });

  yearChart = new Chart(yearCtx, {
    type: "bar",
    data: {
      labels: yearLabels,
      datasets: [
        {
          label: "Total Judgment Amount",
          data: yearValues,
          backgroundColor: "#67e8f9",
          borderRadius: 8,
        },
      ],
    },
    options: {
      scales: {
        x: {
          ticks: { color: "#c4d3f7" },
          grid: { color: "rgba(158, 176, 216, 0.18)" },
        },
        y: {
          ticks: {
            color: "#c4d3f7",
            callback: (val) => currency.format(val),
          },
          grid: { color: "rgba(158, 176, 216, 0.18)" },
        },
      },
      plugins: {
        legend: { labels: { color: "#dbe6ff" } },
      },
    },
  });
}

async function loadAddress(address) {
  setStatus("Loading...");
  setSalesStatus("Loading...");
  setTaxStatus("Loading...");
  setMapillaryStatus("Loading...");
  const url = buildUrl(address.trim().toUpperCase());
  const salesUrl = buildSalesUrl(address.trim().toUpperCase());
  const taxUrl = buildTaxUrl(address.trim().toUpperCase());

  let blightAttrs = [];
  let salesRows = [];
  let blightFeatures = [];
  let saleFeatures = [];

  try {
    const [blightResult, salesResult, taxResult] = await Promise.allSettled([
      fetch(url),
      fetch(salesUrl),
      fetch(taxUrl),
    ]);

    if (blightResult.status === "fulfilled" && blightResult.value.ok) {
      const data = await blightResult.value.json();
      const features = Array.isArray(data.features) ? data.features : [];
      blightFeatures = features;
      const summary = aggregateData(features);
      blightAttrs = summary.attrs;
      renderKpis(summary);
      renderCharts(summary);
      renderTable(summary.attrs);
      setStatus(`Loaded ${summary.total.toLocaleString()} ticket(s)`);
    } else {
      setStatus("Failed to load blight tickets.");
      els.body.innerHTML =
        '<tr><td colspan="9" class="empty-row">Error loading data for this address</td></tr>';
    }

    if (salesResult.status === "fulfilled" && salesResult.value.ok) {
      const salesData = await salesResult.value.json();
      saleFeatures = Array.isArray(salesData.features) ? salesData.features : [];
      salesRows = saleFeatures.map((item) => item.attributes || {});
      renderSalesTable(salesRows);
      setSalesStatus(`Loaded ${salesRows.length.toLocaleString()} transaction(s)`);
    } else {
      setSalesStatus("Failed to load transactions.");
      els.salesBody.innerHTML =
        '<tr><td colspan="4" class="empty-row">Error loading transaction records</td></tr>';
    }

    if (taxResult.status === "fulfilled" && taxResult.value.ok) {
      const taxData = await taxResult.value.json();
      const taxFeatures = Array.isArray(taxData.features) ? taxData.features : [];
      const taxRows = taxFeatures.map((item) => item.attributes || {});
      renderTaxSection(taxRows);
      setTaxStatus(taxRows.length ? "Loaded tax record" : "No tax record found");
    } else {
      setTaxStatus("Failed to load tax record.");
      renderTaxSection([]);
      els.taxBody.innerHTML =
        '<tr><td colspan="6" class="empty-row">Error loading tax information</td></tr>';
    }

    await loadMapillarySection(extractCoordinatesFromFeatures(blightFeatures, saleFeatures));
  } catch (error) {
    console.error(error);
    setStatus("Failed to load data. Check network/API and try again.");
    setSalesStatus("Failed to load transactions.");
    setTaxStatus("Failed to load tax record.");
    setMapillaryStatus("Failed");
    mapillaryRequestSeq += 1;
    updateMapillaryInfoLink(null, null);
    renderMapillaryPlaceholder("Something went wrong loading Mapillary imagery.");
  }
}

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const address = els.input.value.trim();
  if (!address) return;
  loadAddress(address);
});

els.exportBtn.addEventListener("click", exportPdf);

loadAddress(els.input.value);
