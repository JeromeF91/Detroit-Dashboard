const API_ROOT =
  "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/blight_tickets/FeatureServer/0/query";

const els = {
  form: document.querySelector("#search-form"),
  input: document.querySelector("#address-input"),
  exportBtn: document.querySelector("#export-btn"),
  status: document.querySelector("#status"),
  body: document.querySelector("#ticket-body"),
  total: document.querySelector("#kpi-total"),
  balance: document.querySelector("#kpi-balance"),
  collections: document.querySelector("#kpi-collections"),
  latest: document.querySelector("#kpi-latest"),
};

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
  doc.text("Detroit Blight Dashboard Report", 40, 42);
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
  doc.save(`blight-dashboard-${safeAddress || "address"}.pdf`);
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
  const url = buildUrl(address.trim().toUpperCase());

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const features = Array.isArray(data.features) ? data.features : [];
    const summary = aggregateData(features);
    renderKpis(summary);
    renderCharts(summary);
    renderTable(summary.attrs);

    setStatus(`Loaded ${summary.total.toLocaleString()} ticket(s)`);
  } catch (error) {
    console.error(error);
    setStatus("Failed to load data. Check network/API and try again.");
    els.body.innerHTML =
      '<tr><td colspan="9" class="empty-row">Error loading data for this address</td></tr>';
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
