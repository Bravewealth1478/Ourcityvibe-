const loginPanel = document.querySelector("#loginPanel");
const dashboardPanel = document.querySelector("#dashboardPanel");
const loginForm = document.querySelector("#loginForm");
const loginMessage = document.querySelector("#loginMessage");
const logoutBtn = document.querySelector("#logoutBtn");
const eventForm = document.querySelector("#eventForm");
const formMessage = document.querySelector("#formMessage");
const eventsList = document.querySelector("#eventsList");
const saveBtn = document.querySelector("#saveBtn");
const sourceNames = ["instagram", "tiktok", "whatsapp", "x", "facebook"];
let stopCollectionRequested = false;
let collectionRunning = false;

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}
function message(node, text, success = false) {
  node.textContent = text;
  node.classList.toggle("success", success);
}
function showDashboard() {
  loginPanel.hidden = true;
  dashboardPanel.hidden = false;
  logoutBtn.hidden = false;
  loadEvents();
  loadReports();
  loadSources();
  loadCandidates();
}
function showLogin() {
  loginPanel.hidden = false;
  dashboardPanel.hidden = true;
  logoutBtn.hidden = true;
}
function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
}
function formatDate(value) {
  if (!value) return "Date not set";
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

let latestReport = null;
function reportTable(rows, columns, emptyText = "No activity in this period.") {
  if (!rows || !rows.length) return '<p class="muted">' + escapeHtml(emptyText) + '</p>';
  return '<div class="report-scroll"><table><thead><tr>' + columns.map(col => '<th>' + escapeHtml(col.label) + '</th>').join("") + '</tr></thead><tbody>' +
    rows.map(row => '<tr>' + columns.map(col => '<td>' + escapeHtml(col.render ? col.render(row) : row[col.key] ?? "—") + '</td>').join("") + '</tr>').join("") +
    '</tbody></table></div>';
}
async function loadReports() {
  const days = document.querySelector("#reportDays")?.value || "30";
  const status = document.querySelector("#reportsMessage");
  if (!status) return;
  message(status, "Loading report data…");
  try {
    const { report } = await api("/api/admin?action=reports&days=" + encodeURIComponent(days));
    latestReport = report;
    const totals = report.totals || {};
    document.querySelector("#reportKpis").innerHTML = [
      ["Genuine clicks", totals.genuine_clicks],
      ["Visitor-days", totals.visitor_days],
      ["Bot / preview clicks", totals.bot_clicks],
      ["Events with clicks", totals.events_with_clicks]
    ].map(([label, value]) => '<div class="report-kpi"><span>' + escapeHtml(label) + '</span><strong>' + Number(value || 0).toLocaleString() + '</strong></div>').join("");
    document.querySelector("#reportDaily").innerHTML = reportTable(report.daily, [
      { key: "day", label: "Date" }, { key: "genuine_clicks", label: "Clicks" }, { key: "bot_clicks", label: "Bots" }
    ]);
    document.querySelector("#reportSources").innerHTML = reportTable(report.by_source, [
      { key: "source", label: "Source" }, { key: "genuine_clicks", label: "Clicks" }
    ]);
    document.querySelector("#reportEvents").innerHTML = reportTable((report.by_event || []).slice(0, 10), [
      { key: "title", label: "Event" }, { key: "city", label: "City" }, { key: "genuine_clicks", label: "Clicks" }
    ]);
    document.querySelector("#reportCountries").innerHTML = reportTable(report.by_country, [
      { key: "country", label: "Country" }, { key: "genuine_clicks", label: "Clicks" }
    ]);
    document.querySelector("#reportDevices").innerHTML = reportTable(report.by_device, [
      { key: "device_type", label: "Device" }, { key: "genuine_clicks", label: "Clicks" }
    ]);
    message(status, "Updated " + new Date(report.generated_at).toLocaleString() + ". Bot and preview traffic is excluded from genuine click totals.", true);
  } catch (error) {
    latestReport = null;
    message(status, "Reports could not be loaded: " + error.message);
  }
}
function exportReportsCsv() {
  if (!latestReport) { message(document.querySelector("#reportsMessage"), "Load a report before exporting."); return; }
  const rows = [["section","label","detail","genuine_clicks","bot_clicks","visitor_days","status"]];
  const add = (section, items, labelKey, detailKey) => (items || []).forEach(item => rows.push([
    section, item[labelKey] ?? "", detailKey ? (item[detailKey] ?? "") : "",
    item.genuine_clicks ?? "", item.bot_clicks ?? "", item.visitor_days ?? "", item.status ?? ""
  ]));
  add("event", latestReport.by_event, "title", "city");
  add("source", latestReport.by_source, "source");
  add("country", latestReport.by_country, "country");
  add("device", latestReport.by_device, "device_type");
  add("daily", latestReport.daily, "day");
  const csv = rows.map(row => row.map(value => '"' + String(value ?? "").replace(/"/g, '""') + '"').join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ourcityvibe-report-" + latestReport.days + "days.csv";
  document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}

function clearForm() {
  eventForm.reset();
  document.querySelector("#eventId").value = "";
  document.querySelector("#formTitle").textContent = "Add an event";
  saveBtn.textContent = "Save event";
  document.querySelector("#cancelEditBtn").hidden = true;
  message(formMessage, "");
}
function renderEvents(events) {
  document.querySelector("#eventCount").textContent = String(events.length);
  if (!events.length) {
    eventsList.innerHTML = '<div class="empty-state">No events yet. Add your first event using the form.</div>';
    return;
  }
  eventsList.innerHTML = events.map((event) => {
    const base = location.origin + "/go/" + encodeURIComponent(event.slug);
    const linkButtons = sourceNames.map((src) => `<div class="link-copy"><span>${src}</span><button type="button" data-copy="${base}?src=${src}">Copy</button></div>`).join("");
    return `<article class="event-item" data-event-id="${escapeHtml(event.id)}">
      <div class="event-top"><div><h3>${escapeHtml(event.title)}</h3><div class="event-meta">${escapeHtml(event.city || "City not set")} · ${escapeHtml(event.platform)} · ${formatDate(event.event_date)}</div><div class="event-meta">/${escapeHtml(event.slug)} · ${escapeHtml(event.status)}</div></div></div>
      <div class="event-stats">${Number(event.genuine_clicks || 0).toLocaleString()} genuine clicks <span style="color:#a6b5ab">·</span> ${Number(event.unique_visitors || 0).toLocaleString()} visitor-days</div>
      <div class="event-controls"><button class="small-button accent" type="button" data-toggle-links>Tracked links</button>${event.status === "active" ? `<button class="small-button accent" type="button" data-promo-open="${escapeHtml(event.id)}">Promotional captions</button>` : ""}<button class="small-button" type="button" data-edit="${escapeHtml(event.id)}">Edit</button>${event.status === "active" ? `<button class="small-button" type="button" data-archive="${escapeHtml(event.id)}">Archive</button>` : ""}</div>
      <div class="links-panel" hidden>${linkButtons}</div>
      <div class="promo-panel" id="promo-${escapeHtml(event.id)}" hidden><p class="muted">Generate and edit social captions. Nothing is posted automatically.</p><label>Affiliate disclosure (optional)</label><input class="promo-disclosure" maxlength="500" placeholder="Add disclosure text if this promotion uses an affiliate link"><div class="promo-actions"><button class="small-button accent" type="button" data-promo-generate="${escapeHtml(event.id)}">Generate captions</button></div><p class="message promo-message" role="status"></p><label>Social post caption</label><textarea class="promo-caption" maxlength="5000" rows="6"></textarea><label>WhatsApp Status / Stories version</label><textarea class="promo-short-caption" maxlength="1500" rows="3"></textarea><div class="promo-actions"><button class="primary-button" type="button" data-promo-save="${escapeHtml(event.id)}">Save draft</button><button class="small-button" type="button" data-promo-approve="${escapeHtml(event.id)}">Approve captions</button></div><p class="muted promo-status"></p></div>
    </article>`;
  }).join("");
}
function clearSourceForm() {
  document.querySelector("#sourceForm").reset();
  document.querySelector("#sourceId").value = "";
  document.querySelector("#sourceSaveBtn").textContent = "Add source";
  document.querySelector("#sourceCancelBtn").hidden = true;
  message(document.querySelector("#sourceMessage"), "");
}
function renderSources(sources) {
  document.querySelector("#sourceCount").textContent = String(sources.length);
  const node = document.querySelector("#sourcesList");
  if (!sources.length) { node.innerHTML = '<div class="empty-state">No discovery sources have been added yet.</div>'; return; }
  node.innerHTML = sources.map((source) => `<article class="source-item" data-source-id="${escapeHtml(source.id)}">
    <div class="source-info"><div><h3>${escapeHtml(source.name)}</h3><p>${escapeHtml(source.source_type.toUpperCase())} · ${escapeHtml(source.country_scope)} · ${escapeHtml((source.country_codes || []).join(", ") || "All countries")}</p><a href="${escapeHtml(source.base_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.base_url)}</a></div><span class="source-state ${source.enabled && source.credential_ready ? "enabled" : ""}">${!source.enabled ? "Disabled" : source.credential_ready ? "Ready" : "Needs API key"}</span></div>
    <div class="source-actions"><button class="small-button accent" type="button" data-source-run="${escapeHtml(source.id)}" ${source.enabled && source.source_type !== "manual" ? "" : "disabled"}>Collect now</button><button class="small-button" type="button" data-source-edit="${escapeHtml(source.id)}">Edit</button><button class="small-button" type="button" data-source-toggle="${escapeHtml(source.id)}" data-enabled="${source.enabled ? "true" : "false"}">${source.enabled ? "Disable" : "Enable"}</button></div>
    ${source.enabled && source.last_error ? `<p class="source-error">Last collection error: ${escapeHtml(source.last_error)}</p>` : ""}
    ${source.enabled && !source.credential_ready ? `<p class="muted">Add ${escapeHtml(source.credential_name)} in Vercel to activate this provider.</p>` : ""}
  </article>`).join("");
}
async function runCollection(sourceId = null) {
  if (collectionRunning) return;
  collectionRunning = true;
  stopCollectionRequested = false;
  const button = sourceId
    ? document.querySelector('[data-source-run="' + sourceId + '"]')
    : document.querySelector("#fetchEventsBtn");
  const stopButton = document.querySelector("#stopFetchBtn");
  const messageNode = document.querySelector("#collectionMessage");
  const summaryNode = document.querySelector("#fetchSummary");
  if (button) button.disabled = true;
  if (stopButton) { stopButton.hidden = false; stopButton.disabled = false; stopButton.textContent = "Stop after current source"; }
  document.querySelector("#collectionResults").innerHTML = "";
  const allResults = [];
  let offset = 0;
  const totalSources = sourceId ? 1 : Number(document.querySelector("#sourceCount")?.textContent || 0);
  try {
    let more = true;
    while (more && !stopCollectionRequested) {
      const position = allResults.length + 1;
      const status = sourceId ? "Collecting selected source…" : "Fetching source " + position + " of " + totalSources + "…";
      if (summaryNode) summaryNode.textContent = status;
      message(messageNode, status);
      const payload = sourceId ? { source_id: sourceId } : { offset };
      const data = await api("/api/admin?action=collect", { method: "POST", body: JSON.stringify(payload) });
      const results = data.results || [];
      allResults.push(...results);
      document.querySelector("#collectionResults").innerHTML = allResults.map(item => `<article class="collection-result">
        <strong>${escapeHtml(item.source_name)}</strong><span class="source-state ${item.status === "succeeded" ? "enabled" : ""}">${escapeHtml(item.status)}</span>
        <p>${item.items_seen} seen · ${item.items_created} new · ${item.items_updated} refreshed · ${item.duplicates_found} duplicates</p>
        ${item.error ? `<p class="source-error">${escapeHtml(item.error)}</p>` : ""}
        ${item.note ? `<p class="muted">${escapeHtml(item.note)}</p>` : ""}
      </article>`).join("");
      more = !sourceId && results.length === 1;
      offset += results.length;
      if (!results.length) more = false;
    }
    const total = allResults.reduce((sum, item) => sum + item.items_created, 0);
    const failed = allResults.filter(item => item.status === "failed").length;
    const skipped = allResults.filter(item => item.status === "skipped").length;
    const stopped = stopCollectionRequested && more;
    const finalText = stopped
      ? "Stopped after " + allResults.length + " source(s). " + total + " new candidate(s) added. Click Fetch Events to continue."
      : "Finished. " + allResults.length + " source(s) checked, " + total + " new candidate(s) added to review." + (skipped ? " " + skipped + " source(s) waiting for API credentials." : "") + (failed ? " " + failed + " source(s) reported errors." : "");
    message(messageNode, finalText, !failed && !stopped);
    if (summaryNode) summaryNode.textContent = finalText;
    await Promise.all([loadSources(), loadCandidates()]);
  } catch (error) {
    message(messageNode, "Collection stopped because the request failed: " + error.message);
    if (summaryNode) summaryNode.textContent = "Collection stopped. " + allResults.length + " source(s) completed before the request failed.";
  } finally {
    collectionRunning = false;
    if (button) button.disabled = false;
    if (stopButton) stopButton.hidden = true;
  }
}
function renderCandidates(candidates) {
  document.querySelector("#candidateCount").textContent = String(candidates.length);
  const node = document.querySelector("#candidatesList");
  if (!candidates.length) { node.innerHTML = '<div class="empty-state">No pending candidates. Run your enabled discovery sources to find events.</div>'; return; }
  node.innerHTML = candidates.map(candidate => {
    const source = candidate.event_sources || {};
    return `<article class="candidate-item" data-candidate-id="${escapeHtml(candidate.id)}">
      <div class="candidate-top">
        <div><h3>${escapeHtml(candidate.title)}</h3><p>${escapeHtml([candidate.city,candidate.region,candidate.country].filter(Boolean).join(", ") || "Location not provided")} · ${escapeHtml(formatDate(candidate.event_date))}</p>
        <p class="candidate-source">From ${escapeHtml(source.name || "Unknown source")} · ${escapeHtml(source.source_type || "source")}</p></div>
        <span class="source-state enabled">Pending review</span>
      </div>
      ${candidate.image_url ? `<img class="candidate-image" src="${escapeHtml(candidate.image_url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}
      ${candidate.description ? `<p class="candidate-description">${escapeHtml(candidate.description)}</p>` : ""}
      <div class="candidate-meta">${escapeHtml([candidate.venue_name,candidate.organizer_name].filter(Boolean).join(" · ") || "Venue and organiser not provided")}</div>
      ${candidate.source_url ? `<a class="candidate-link" href="${escapeHtml(candidate.source_url)}" target="_blank" rel="noopener noreferrer">View source listing</a>` : ""}
      <label class="candidate-ticket-label" for="candidate-ticket-${escapeHtml(candidate.id)}">Ticket or official event URL</label>
      <input class="candidate-ticket-input" id="candidate-ticket-${escapeHtml(candidate.id)}" type="url" value="${escapeHtml(candidate.ticket_url || "")}" placeholder="https://..." inputmode="url">
      <div class="candidate-actions"><button class="primary-button" type="button" data-candidate-approve="${escapeHtml(candidate.id)}">Approve and create tracked event</button><button class="small-button" type="button" data-candidate-reject="${escapeHtml(candidate.id)}">Reject</button></div>
    </article>`;
  }).join("");
}
async function loadCandidates() {
  const node = document.querySelector("#candidatesList");
  node.innerHTML = '<p class="muted">Loading review queue…</p>';
  try { const data = await api("/api/admin?action=candidates&status=pending"); renderCandidates(data.candidates || []); }
  catch (error) { node.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; }
}
async function loadSources() {
  const node = document.querySelector("#sourcesList");
  node.innerHTML = '<p class="muted">Loading sources…</p>';
  try { const data = await api("/api/admin?action=sources"); renderSources(data.sources || []); }
  catch (error) { node.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; }
}
async function loadEvents() {
  eventsList.innerHTML = '<p class="muted">Loading events…</p>';
  try {
    const data = await api("/api/admin?action=events");
    renderEvents(data.events || []);
  } catch (error) {
    eventsList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}
loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = loginForm.querySelector("button");
  button.disabled = true;
  message(loginMessage, "Signing in…");
  try {
    await api("/api/admin?action=login", { method: "POST", body: JSON.stringify({ password: document.querySelector("#password").value }) });
    loginForm.reset();
    showDashboard();
  } catch (error) {
    message(loginMessage, error.message);
  } finally { button.disabled = false; }
});
logoutBtn.addEventListener("click", async () => {
  try { await api("/api/admin?action=logout", { method: "POST", body: "{}" }); } catch {}
  showLogin();
});
eventForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveBtn.disabled = true;
  message(formMessage, "Saving event…");
  const id = document.querySelector("#eventId").value;
  const payload = {
    title: document.querySelector("#title").value.trim(),
    ticket_url: document.querySelector("#ticketUrl").value.trim(),
    platform: document.querySelector("#platform").value,
    city: document.querySelector("#city").value.trim() || null,
    event_date: document.querySelector("#eventDate").value ? new Date(document.querySelector("#eventDate").value).toISOString() : null,
    image_url: document.querySelector("#imageUrl").value.trim() || null,
  };
  try {
    await api("/api/admin?action=" + (id ? "update" : "create"), { method: "POST", body: JSON.stringify(id ? { ...payload, id } : payload) });
    clearForm();
    message(formMessage, "Event saved.", true);
    await loadEvents();
  } catch (error) { message(formMessage, error.message); }
  finally { saveBtn.disabled = false; }
});
document.querySelector("#sourceForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("#sourceSaveBtn");
  const id = document.querySelector("#sourceId").value;
  button.disabled = true;
  message(document.querySelector("#sourceMessage"), "Saving source…");
  const payload = {
    name: document.querySelector("#sourceName").value.trim(),
    source_type: document.querySelector("#sourceType").value,
    base_url: document.querySelector("#sourceUrl").value.trim(),
    country_scope: document.querySelector("#sourceScope").value,
    country_codes: document.querySelector("#sourceCountries").value.split(",").map(x => x.trim().toUpperCase()).filter(Boolean),
    config: document.querySelector("#sourceConfig").value.trim() || "{}",
  };
  try {
    await api("/api/admin?action=" + (id ? "source-update" : "source-create"), { method: "POST", body: JSON.stringify(id ? { ...payload, id } : payload) });
    clearSourceForm();
    message(document.querySelector("#sourceMessage"), "Source saved.", true);
    await loadSources();
  } catch (error) { message(document.querySelector("#sourceMessage"), error.message); }
  finally { button.disabled = false; }
});
document.querySelector("#collectAllBtn").addEventListener("click", () => runCollection());
document.querySelector("#fetchEventsBtn").addEventListener("click", () => runCollection());
document.querySelector("#stopFetchBtn").addEventListener("click", () => { stopCollectionRequested = true; document.querySelector("#stopFetchBtn").disabled = true; document.querySelector("#stopFetchBtn").textContent = "Stopping…"; });
document.querySelector("#refreshCandidatesBtn").addEventListener("click", loadCandidates);
document.querySelector("#refreshReportsBtn").addEventListener("click", loadReports);
document.querySelector("#reportDays").addEventListener("change", loadReports);
document.querySelector("#exportReportsBtn").addEventListener("click", exportReportsCsv);
document.querySelector("#candidatesList").addEventListener("click", async (event) => {
  const approve = event.target.closest("[data-candidate-approve]");
  const reject = event.target.closest("[data-candidate-reject]");
  if (approve) {
    const id = approve.dataset.candidateApprove;
    const card = approve.closest(".candidate-item");
    const ticket_url = card.querySelector(".candidate-ticket-input").value.trim();
    approve.disabled = true;
    try {
      const data = await api("/api/admin?action=candidate-approve", { method: "POST", body: JSON.stringify({ id, ticket_url }) });
      message(document.querySelector("#collectionMessage"), "Approved. Tracked event created: /go/" + data.event.slug, true);
      await Promise.all([loadCandidates(), loadEvents()]);
    } catch (error) { alert(error.message); approve.disabled = false; }
    return;
  }
  if (reject) {
    if (!confirm("Reject this discovered event?")) return;
    reject.disabled = true;
    try {
      await api("/api/admin?action=candidate-reject", { method: "POST", body: JSON.stringify({ id: reject.dataset.candidateReject }) });
      await loadCandidates();
    } catch (error) { alert(error.message); reject.disabled = false; }
  }
});

document.querySelector("#sourceCancelBtn").addEventListener("click", clearSourceForm);
document.querySelector("#sourcesList").addEventListener("click", async (event) => {
  const edit = event.target.closest("[data-source-edit]");
  if (edit) {
    try {
      const { sources } = await api("/api/admin?action=sources");
      const source = (sources || []).find(item => item.id === edit.dataset.sourceEdit);
      if (!source) throw new Error("Source not found.");
      document.querySelector("#sourceId").value = source.id;
      document.querySelector("#sourceName").value = source.name;
      document.querySelector("#sourceType").value = source.source_type;
      document.querySelector("#sourceUrl").value = source.base_url;
      document.querySelector("#sourceScope").value = source.country_scope;
      document.querySelector("#sourceCountries").value = (source.country_codes || []).join(", ");
      document.querySelector("#sourceConfig").value = JSON.stringify(source.config || {}, null, 2);
      document.querySelector("#sourceSaveBtn").textContent = "Update source";
      document.querySelector("#sourceCancelBtn").hidden = false;
      document.querySelector("#sourceForm").scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (error) { alert(error.message); }
    return;
  }
  const run = event.target.closest("[data-source-run]");
  if (run) { await runCollection(run.dataset.sourceRun); return; }
  const toggle = event.target.closest("[data-source-toggle]");
  if (toggle) {
    try {
      await api("/api/admin?action=source-toggle", { method: "POST", body: JSON.stringify({ id: toggle.dataset.sourceToggle, enabled: toggle.dataset.enabled !== "true" }) });
      await loadSources();
    } catch (error) { alert(error.message); }
  }
});
document.querySelector("#cancelEditBtn").addEventListener("click", clearForm);
document.querySelector("#refreshBtn").addEventListener("click", loadEvents);
eventsList.addEventListener("click", async (event) => {
  const copy = event.target.closest("[data-copy]");
  if (copy) {
    try { await navigator.clipboard.writeText(copy.dataset.copy); copy.textContent = "Copied"; }
    catch { copy.textContent = "Copy failed"; }
    return;
  }
  const toggle = event.target.closest("[data-toggle-links]");
  if (toggle) {
    const panel = toggle.closest(".event-item").querySelector(".links-panel");
    panel.hidden = !panel.hidden;
    return;
  }
  const promoOpen = event.target.closest("[data-promo-open]");
  if (promoOpen) {
    const id = promoOpen.dataset.promoOpen, panel = document.querySelector("#promo-" + CSS.escape(id));
    panel.hidden = !panel.hidden;
    if (!panel.hidden) { try { const data = await api("/api/admin?action=promo-caption&id=" + encodeURIComponent(id)); const draft = data.draft; if (draft) { panel.querySelector(".promo-caption").value = draft.caption || ""; panel.querySelector(".promo-short-caption").value = draft.short_caption || ""; panel.querySelector(".promo-disclosure").value = draft.affiliate_disclosure || ""; panel.querySelector(".promo-status").textContent = draft.status === "approved" ? "Approved by you." : "Saved draft."; } } catch (error) { message(panel.querySelector(".promo-message"), error.message); } }
    return;
  }
  const promoGenerate = event.target.closest("[data-promo-generate]");
  if (promoGenerate) {
    const panel = promoGenerate.closest(".promo-panel"); promoGenerate.disabled = true; message(panel.querySelector(".promo-message"), "Generating captions…");
    try { const data = await api("/api/admin?action=promo-generate", { method: "POST", body: JSON.stringify({ id: promoGenerate.dataset.promoGenerate, affiliate_disclosure: panel.querySelector(".promo-disclosure").value }) }); const draft = data.draft; panel.querySelector(".promo-caption").value = draft.caption || ""; panel.querySelector(".promo-short-caption").value = draft.short_caption || ""; panel.querySelector(".promo-disclosure").value = draft.affiliate_disclosure || ""; panel.querySelector(".promo-status").textContent = "Draft generated. Edit before saving or approving."; message(panel.querySelector(".promo-message"), "Captions generated. Review them before use.", true); } catch (error) { message(panel.querySelector(".promo-message"), error.message); }
    finally { promoGenerate.disabled = false; } return;
  }
  const promoSave = event.target.closest("[data-promo-save], [data-promo-approve]");
  if (promoSave) {
    const panel = promoSave.closest(".promo-panel"), approve = promoSave.hasAttribute("data-promo-approve"); promoSave.disabled = true;
    try { await api("/api/admin?action=promo-save", { method: "POST", body: JSON.stringify({ id: promoSave.dataset.promoSave || promoSave.dataset.promoApprove, caption: panel.querySelector(".promo-caption").value, short_caption: panel.querySelector(".promo-short-caption").value, affiliate_disclosure: panel.querySelector(".promo-disclosure").value, approve }) }); panel.querySelector(".promo-status").textContent = approve ? "Approved by you. Ready to copy and publish manually." : "Draft saved."; message(panel.querySelector(".promo-message"), approve ? "Captions approved." : "Draft saved.", true); } catch (error) { message(panel.querySelector(".promo-message"), error.message); }
    finally { promoSave.disabled = false; } return;
  }
  const edit = event.target.closest("[data-edit]");
  if (edit) {
    try {
      const { event: item } = await api("/api/admin?action=event&id=" + encodeURIComponent(edit.dataset.edit));
      document.querySelector("#eventId").value = item.id;
      document.querySelector("#title").value = item.title;
      document.querySelector("#ticketUrl").value = item.ticket_url;
      document.querySelector("#platform").value = item.platform;
      document.querySelector("#city").value = item.city || "";
      document.querySelector("#eventDate").value = item.event_date ? new Date(item.event_date).toISOString().slice(0,16) : "";
      document.querySelector("#imageUrl").value = item.image_url || "";
      document.querySelector("#formTitle").textContent = "Edit event";
      saveBtn.textContent = "Update event";
      document.querySelector("#cancelEditBtn").hidden = false;
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) { alert(error.message); }
    return;
  }
  const archive = event.target.closest("[data-archive]");
  if (archive && confirm("Archive this event? Its tracking link will stop redirecting.")) {
    try {
      await api("/api/admin?action=archive", { method: "POST", body: JSON.stringify({ id: archive.dataset.archive }) });
      await loadEvents();
    } catch (error) { alert(error.message); }
  }
});
(async () => {
  try { await api("/api/admin?action=me"); showDashboard(); }
  catch { showLogin(); }
})();