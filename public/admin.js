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
  loadSources();
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
      <div class="event-controls"><button class="small-button accent" type="button" data-toggle-links>Tracked links</button><button class="small-button" type="button" data-edit="${escapeHtml(event.id)}">Edit</button>${event.status === "active" ? `<button class="small-button" type="button" data-archive="${escapeHtml(event.id)}">Archive</button>` : ""}</div>
      <div class="links-panel" hidden>${linkButtons}</div>
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
    <div class="source-info"><div><h3>${escapeHtml(source.name)}</h3><p>${escapeHtml(source.source_type.toUpperCase())} · ${escapeHtml(source.country_scope)} · ${escapeHtml((source.country_codes || []).join(", ") || "All countries")}</p><a href="${escapeHtml(source.base_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.base_url)}</a></div><span class="source-state ${source.enabled ? "enabled" : ""}">${source.enabled ? "Enabled" : "Disabled"}</span></div>
    <div class="source-actions"><button class="small-button accent" type="button" data-source-run="${escapeHtml(source.id)}" ${source.enabled ? "" : "disabled"}>Collect now</button><button class="small-button" type="button" data-source-edit="${escapeHtml(source.id)}">Edit</button><button class="small-button" type="button" data-source-toggle="${escapeHtml(source.id)}" data-enabled="${source.enabled ? "true" : "false"}">${source.enabled ? "Disable" : "Enable"}</button></div>
    ${source.last_error ? `<p class="source-error">Last collection error: ${escapeHtml(source.last_error)}</p>` : ""}
  </article>`).join("");
}
async function runCollection(sourceId = null) {
  const button = sourceId
    ? document.querySelector('[data-source-run="' + sourceId + '"]')
    : document.querySelector("#collectAllBtn");
  const messageNode = document.querySelector("#collectionMessage");
  if (button) button.disabled = true;
  message(messageNode, sourceId ? "Collecting from selected source…" : "Collecting from enabled sources…");
  document.querySelector("#collectionResults").innerHTML = "";
  try {
    const data = await api("/api/admin?action=collect", { method: "POST", body: JSON.stringify(sourceId ? { source_id: sourceId } : {}) });
    const results = data.results || [];
    document.querySelector("#collectionResults").innerHTML = results.map(item => `<article class="collection-result">
      <strong>${escapeHtml(item.source_name)}</strong><span class="source-state ${item.status === "succeeded" ? "enabled" : ""}">${escapeHtml(item.status)}</span>
      <p>${item.items_seen} seen · ${item.items_created} new · ${item.items_updated} refreshed · ${item.duplicates_found} duplicates</p>
      ${item.error ? `<p class="source-error">${escapeHtml(item.error)}</p>` : ""}
    </article>`).join("");
    const total = results.reduce((sum, item) => sum + item.items_created, 0);
    message(messageNode, "Collection finished. " + total + " new candidate(s) added to review.", true);
    await loadSources();
  } catch (error) { message(messageNode, error.message); }
  finally { if (button) button.disabled = false; }
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