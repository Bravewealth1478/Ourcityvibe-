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