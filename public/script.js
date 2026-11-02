// QueueLess backend hosted on Render. Keep the /api suffix.
const API = "https://queueless-r6qm.onrender.com/api";

const $ = id => document.getElementById(id);

const NEXT_STATUSES = {
  Waiting: ["Serving", "Cancelled"],
  Serving: ["Completed", "Cancelled"],
  Completed: [],
  Cancelled: []
};

const state = {
  queues: [],
  tokens: [],
  stats: null,
  queueFilter: "",
  statusFilter: "",
  search: "",
  editingQueueId: "",
  openQueueId: "",
  activeView: "dashboard"
};

let toastTimer = null;

/* ----------------------------- Utilities ----------------------------- */

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function formatShortTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function queueIdOf(token) {
  if (!token || !token.queue) return "";
  return typeof token.queue === "object"
    ? String(token.queue._id || "")
    : String(token.queue);
}

function queueOf(token) {
  if (!token || !token.queue) return null;
  if (typeof token.queue === "object") return token.queue;
  return state.queues.find(queue => queue._id === String(token.queue)) || null;
}

function statusBadge(status) {
  const className = String(status || "").toLowerCase();
  return `<span class="badge ${escapeHtml(className)}">${escapeHtml(status)}</span>`;
}

function positionLabel(token) {
  if (token.status === "Waiting") {
    return token.queuePosition === null || token.queuePosition === undefined
      ? "-"
      : `#${token.queuePosition}`;
  }
  if (token.status === "Serving") return "Serving";
  return "-";
}

function waitLabel(token) {
  if (token.status === "Waiting") {
    return token.estimatedWaitMinutes === null ||
      token.estimatedWaitMinutes === undefined
      ? "-"
      : `${token.estimatedWaitMinutes} min`;
  }
  if (token.status === "Serving") return "Now";
  return "-";
}

function statusSelect(token) {
  const options = [token.status, ...(NEXT_STATUSES[token.status] || [])];
  const disabled = options.length === 1;

  return `
    <select
      class="status-select"
      data-token-status="${escapeHtml(token._id)}"
      aria-label="Update status for token ${token.tokenNumber}"
      title="${disabled ? "This token is in a final status" : "Change token status"}"
      ${disabled ? "disabled" : ""}
    >
      ${options.map(status =>
        `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`
      ).join("")}
    </select>
  `;
}

function setConnection(mode, text) {
  const dot = $("connectionDot");
  dot.classList.remove("online", "offline");

  if (mode === "online") dot.classList.add("online");
  if (mode === "offline") dot.classList.add("offline");

  $("connectionText").textContent = text;
}

function toast(message, type = "info") {
  const element = $("toast");
  element.textContent = message;
  element.className = `toast show ${type}`;

  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    element.classList.remove("show");
  }, 3600);
}

function setMessage(elementId, text, isError = false) {
  const element = $(elementId);
  element.textContent = text;
  element.classList.toggle("error", Boolean(isError));
}

function setBusy(button, busy, label) {
  if (!button) return;
  button.disabled = busy;
  if (label) button.textContent = label;
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });

  const body = await response.json().catch(() => ({
    success: false,
    message: `Unexpected server response (${response.status}).`
  }));

  if (!response.ok || body.success === false) {
    const error = new Error(
      body.message || `Request failed with status ${response.status}.`
    );
    error.status = response.status;
    error.code = body.code;
    error.body = body;
    throw error;
  }

  return body;
}

/* ----------------------------- Rendering ----------------------------- */

function renderStats() {
  const totals = state.stats ? state.stats.totals : null;

  $("statQueues").textContent = totals ? totals.queues : "-";
  $("statWaiting").textContent = totals ? totals.waiting : "-";
  $("statServing").textContent = totals ? totals.serving : "-";
  $("statCompleted").textContent = totals ? totals.completed : "-";

  $("statQueuesSub").textContent = totals ? `${totals.activeQueues} active` : "No data";
  $("statWaitingSub").textContent = totals ? "Customers in line" : "No data";
  $("statServingSub").textContent = totals ? "Currently with staff" : "No data";
  $("statCompletedSub").textContent = totals
    ? `${totals.completedToday} completed today`
    : "No data";
}

function renderRecentTokens() {
  const root = $("recentTokens");
  const tokens = state.stats && state.stats.recentTokens
    ? state.stats.recentTokens
    : state.tokens.slice(0, 8);

  if (!tokens.length) {
    root.innerHTML = `
      <div class="empty-state">
        No tokens yet. Issue the first digital token to start tracking customers.
        <br><button class="btn btn-small" type="button" data-view="tokens">Issue a token</button>
      </div>
    `;
    return;
  }

  root.innerHTML = tokens.map(token => {
    const queue = queueOf(token);
    const queueName = queue ? queue.name : "Unknown queue";
    const position = token.status === "Waiting"
      ? ` · position ${token.queuePosition}`
      : "";

    return `
      <div class="recent-row">
        <div class="token-number">#${escapeHtml(token.tokenNumber)}</div>
        <div class="token-main">
          <strong>${escapeHtml(token.customerName)}</strong>
          <span>${escapeHtml(queueName)}${position}${token.customerContact
            ? ` · ${escapeHtml(token.customerContact)}`
            : ""}</span>
        </div>
        <div class="recent-meta">
          ${statusBadge(token.status)}
          <time>${escapeHtml(formatShortTime(token.issuedAt))}</time>
        </div>
      </div>
    `;
  }).join("");
}

function renderQueueSnapshot() {
  const root = $("queueSnapshot");
  const queues = [...state.queues]
    .sort((a, b) =>
      (b.activeTokens || 0) - (a.activeTokens || 0) ||
      (b.waitingCount || 0) - (a.waitingCount || 0)
    )
    .slice(0, 6);

  if (!queues.length) {
    root.innerHTML = `
      <div class="empty-state">
        No queues yet. Create your first queue to start serving customers.
        <br><button class="btn btn-small" type="button" data-view="queues">Create a queue</button>
      </div>
    `;
    return;
  }

  root.innerHTML = queues.map(queue => `
    <div class="snapshot-row">
      <div>
        <strong>${escapeHtml(queue.name)}</strong>
        <span>${queue.waitingCount || 0} waiting · ${queue.servingCount || 0} serving${queue.isActive ? "" : " · inactive"}</span>
      </div>
      <button
        class="btn btn-small"
        type="button"
        data-call-next="${escapeHtml(queue._id)}"
        ${queue.isActive ? "" : "disabled"}
      >Call next</button>
    </div>
  `).join("");
}

function renderQueueOptions() {
  const activeQueues = state.queues.filter(queue => queue.isActive);

  const tokenSelect = $("tokenQueue");
  const previousTokenQueue = tokenSelect.value;

  tokenSelect.innerHTML = activeQueues.length
    ? `<option value="">Select a queue</option>${activeQueues.map(queue => (
        `<option value="${escapeHtml(queue._id)}">${escapeHtml(queue.name)} — ${escapeHtml(queue.serviceDescription)}</option>`
      )).join("")}`
    : `<option value="">No active queues</option>`;

  tokenSelect.disabled = activeQueues.length === 0;

  if (activeQueues.some(queue => queue._id === previousTokenQueue)) {
    tokenSelect.value = previousTokenQueue;
  }

  const filterSelect = $("filterQueue");
  const previousFilter = state.queueFilter;

  filterSelect.innerHTML = `
    <option value="">All queues</option>
    ${state.queues.map(queue => (
      `<option value="${escapeHtml(queue._id)}">${escapeHtml(queue.name)}${queue.isActive ? "" : " (inactive)"}</option>`
    )).join("")}
  `;

  if (state.queues.some(queue => queue._id === previousFilter)) {
    filterSelect.value = previousFilter;
  } else {
    state.queueFilter = "";
    filterSelect.value = "";
  }

  $("filterStatus").value = state.statusFilter;
}

function renderQueues() {
  const root = $("queuesList");
  $("queueListCount").textContent =
    `${state.queues.length} ${state.queues.length === 1 ? "queue" : "queues"}`;

  if (!state.queues.length) {
    root.innerHTML = `
      <div class="empty-state">
        No queues yet. Use the form to create your first service queue.
      </div>
    `;
    return;
  }

  root.innerHTML = state.queues.map(queue => `
    <article class="queue-card">
      <div class="queue-card-top">
        <div>
          <div class="queue-card-heading">
            <h4>${escapeHtml(queue.name)}</h4>
            <span class="pill ${queue.isActive ? "" : "inactive"}">${queue.isActive ? "Active" : "Inactive"}</span>
          </div>
          <p>${escapeHtml(queue.serviceDescription)}</p>
        </div>
      </div>

      <div class="queue-stats">
        <div class="queue-stat"><span>Waiting</span><strong>${queue.waitingCount || 0}</strong></div>
        <div class="queue-stat"><span>Serving</span><strong>${queue.servingCount || 0}</strong></div>
        <div class="queue-stat"><span>Completed</span><strong>${queue.completedCount || 0}</strong></div>
        <div class="queue-stat"><span>Cancelled</span><strong>${queue.cancelledCount || 0}</strong></div>
      </div>

      <p class="queue-meta">~${queue.averageServiceMinutes} min per customer · next token #${queue.nextTokenNumber}</p>

      <div class="queue-actions">
        <button class="btn btn-small" type="button" data-view-queue="${escapeHtml(queue._id)}">View details</button>
        <button class="btn btn-small" type="button" data-edit-queue="${escapeHtml(queue._id)}">Edit</button>
        <button class="btn btn-small" type="button" data-toggle-queue="${escapeHtml(queue._id)}" data-active="${queue.isActive}">${queue.isActive ? "Deactivate" : "Activate"}</button>
        <button class="btn btn-small btn-danger" type="button" data-delete-queue="${escapeHtml(queue._id)}">Delete</button>
      </div>
    </article>
  `).join("");
}
function getFilteredTokens() {
  let tokens = [...state.tokens];

  if (state.queueFilter) {
    tokens = tokens.filter(token => queueIdOf(token) === state.queueFilter);
  }

  if (state.statusFilter) {
    tokens = tokens.filter(token => token.status === state.statusFilter);
  }

  const search = state.search.trim().toLowerCase();
  if (search) {
    tokens = tokens.filter(token => {
      const queue = queueOf(token);
      const haystack = [
        token.tokenNumber,
        `#${token.tokenNumber}`,
        token.customerName,
        token.customerContact,
        queue ? queue.name : ""
      ].join(" ").toLowerCase();

      return haystack.includes(search);
    });
  }

  return tokens;
}

function renderTokens() {
  const root = $("tokensList");
  const tokens = getFilteredTokens();

  $("tokenListCount").textContent =
    `${tokens.length} ${tokens.length === 1 ? "token" : "tokens"}`;

  if (!state.tokens.length) {
    root.innerHTML = `
      <div class="empty-state">
        No tokens have been issued yet. Choose a queue and generate the first token.
        <br><button class="btn btn-small" type="button" data-focus-token-form>Issue a token</button>
      </div>
    `;
    return;
  }

  if (!tokens.length) {
    root.innerHTML = `
      <div class="empty-state">
        No tokens match the current filters.
        <br><button class="btn btn-small" type="button" data-clear-filters>Clear filters</button>
      </div>
    `;
    return;
  }

  root.innerHTML = tokens.map(token => {
    const queue = queueOf(token);
    const queueName = queue ? queue.name : "Unknown queue";

    return `
      <div class="token-row">
        <div class="token-number">#${escapeHtml(token.tokenNumber)}</div>
        <div class="token-main">
          <strong>${escapeHtml(token.customerName)}</strong>
          <span>${escapeHtml(queueName)}${token.customerContact ? ` · ${escapeHtml(token.customerContact)}` : ""} · ${escapeHtml(formatDateTime(token.issuedAt))}</span>
        </div>
        <div class="token-position">
          <span>Position</span>
          <strong>${escapeHtml(positionLabel(token))}</strong>
        </div>
        <div class="token-wait">
          <span>Est. wait</span>
          <strong>${escapeHtml(waitLabel(token))}</strong>
        </div>
        <div class="token-status">
          ${statusBadge(token.status)}
          ${statusSelect(token)}
        </div>
        <div class="token-actions">
          <button class="btn btn-small btn-danger" type="button" data-delete-token="${escapeHtml(token._id)}" title="Delete token">Delete</button>
        </div>
      </div>
    `;
  }).join("");
}

function renderAll() {
  renderStats();
  renderRecentTokens();
  renderQueueSnapshot();
  renderQueueOptions();
  renderQueues();
  renderTokens();

  if (state.openQueueId) {
    if (state.queues.some(queue => queue._id === state.openQueueId)) {
      openQueueModal(state.openQueueId);
    } else {
      closeModal();
    }
  }
}

function renderLoadError(message) {
  ["statQueues", "statWaiting", "statServing", "statCompleted"].forEach(id => {
    $(id).textContent = "-";
  });

  ["statQueuesSub", "statWaitingSub", "statServingSub", "statCompletedSub"].forEach(id => {
    $(id).textContent = "No data";
  });

  $("dashboardUpdated").textContent = "Live data unavailable";

  const errorMarkup = `
    <div class="error-state">
      Could not load data: ${escapeHtml(message)}
      <br><button class="btn btn-small" type="button" data-retry>Try again</button>
    </div>
  `;

  $("recentTokens").innerHTML = errorMarkup;
  $("queueSnapshot").innerHTML = errorMarkup;
  $("queuesList").innerHTML = errorMarkup;
  $("tokensList").innerHTML = errorMarkup;
}

/* ----------------------------- Data loading ----------------------------- */

async function loadData(options = {}) {
  const { showToast = false } = options;
  setConnection("pending", "Syncing...");

  try {
    const [statsResponse, queuesResponse, tokensResponse] = await Promise.all([
      apiRequest("/dashboard/stats"),
      apiRequest("/queues"),
      apiRequest("/tokens?limit=500")
    ]);

    state.stats = statsResponse.data;
    state.queues = queuesResponse.data;
    state.tokens = tokensResponse.data;

    setConnection("online", "API connected");
    renderAll();

    $("dashboardUpdated").textContent =
      `Updated ${new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      })}`;

    if (showToast) toast("Data refreshed.", "success");
  } catch (error) {
    setConnection("offline", "API unavailable");
    renderLoadError(error.message);
    toast(error.message, "error");
  }
}

/* ----------------------------- Views and modal ----------------------------- */

function switchView(view) {
  if (!["dashboard", "queues", "tokens"].includes(view)) return;

  state.activeView = view;

  document.querySelectorAll(".view").forEach(section => {
    section.classList.toggle("active", section.id === `view-${view}`);
  });

  document.querySelectorAll(".nav-link").forEach(button => {
    button.classList.toggle("active", button.dataset.view === view);
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openQueueModal(queueId) {
  const queue = state.queues.find(item => item._id === queueId);
  if (!queue) return;

  state.openQueueId = queueId;

  const tokens = state.tokens
    .filter(token => queueIdOf(token) === queueId)
    .sort((a, b) => {
      const order = {
        Serving: 0,
        Waiting: 1,
        Completed: 2,
        Cancelled: 3
      };

      return (order[a.status] - order[b.status]) ||
        (a.tokenNumber - b.tokenNumber);
    });

  $("queueModalTitle").textContent = queue.name;

  $("queueModalBody").innerHTML = `
    <p class="detail-description">${escapeHtml(queue.serviceDescription)}</p>

    <div class="detail-grid">
      <div class="detail-item"><span>Status</span><strong>${queue.isActive ? "Active" : "Inactive"}</strong></div>
      <div class="detail-item"><span>Average service</span><strong>${queue.averageServiceMinutes} min</strong></div>
      <div class="detail-item"><span>Next token</span><strong>#${queue.nextTokenNumber}</strong></div>
      <div class="detail-item"><span>Waiting</span><strong>${queue.waitingCount || 0}</strong></div>
      <div class="detail-item"><span>Serving</span><strong>${queue.servingCount || 0}</strong></div>
      <div class="detail-item"><span>Completed</span><strong>${queue.completedCount || 0}</strong></div>
    </div>

    <div class="modal-actions">
      <button class="btn btn-small" type="button" data-call-next="${escapeHtml(queue._id)}" ${queue.isActive ? "" : "disabled"}>Call next</button>
      <button class="btn btn-small btn-light" type="button" data-issue-for="${escapeHtml(queue._id)}" ${queue.isActive ? "" : "disabled"}>Issue token</button>
      <button class="btn btn-small btn-light" type="button" data-edit-queue="${escapeHtml(queue._id)}">Edit</button>
      <button class="btn btn-small btn-ghost" type="button" data-toggle-queue="${escapeHtml(queue._id)}" data-active="${queue.isActive}">${queue.isActive ? "Deactivate" : "Activate"}</button>
      <button class="btn btn-small btn-danger" type="button" data-delete-queue="${escapeHtml(queue._id)}">Delete</button>
    </div>

    <div class="modal-token-list">
      <h3>Tokens (${tokens.length})</h3>
      ${tokens.length ? tokens.map(token => `
        <div class="recent-row">
          <div class="token-number">#${escapeHtml(token.tokenNumber)}</div>
          <div class="token-main">
            <strong>${escapeHtml(token.customerName)}</strong>
            <span>${escapeHtml(token.customerContact || "No contact")} · ${escapeHtml(formatDateTime(token.issuedAt))}</span>
          </div>
          <div class="recent-meta">
            ${statusBadge(token.status)}
            <time>${token.status === "Waiting" ? `Position #${token.queuePosition}` : token.status === "Serving" ? "Now serving" : ""}</time>
          </div>
        </div>
      `).join("") : `<div class="empty-state">No tokens in this queue yet.</div>`}
    </div>
  `;

  $("queueModal").classList.remove("hidden");
  $("queueModal").setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeModal() {
  state.openQueueId = "";
  $("queueModal").classList.add("hidden");
  $("queueModal").setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

/* ----------------------------- Queue actions ----------------------------- */

function resetQueueForm() {
  state.editingQueueId = "";

  $("editingQueueId").value = "";
  $("queueForm").reset();
  $("serviceMinutes").value = 5;
  $("queueFormTitle").textContent = "Create a queue";
  $("queueSubmit").textContent = "Create queue";
  $("cancelQueueEdit").classList.add("hidden");
}

function startEditQueue(queueId) {
  const queue = state.queues.find(item => item._id === queueId);
  if (!queue) return;

  closeModal();
  switchView("queues");

  state.editingQueueId = queue._id;
  $("editingQueueId").value = queue._id;
  $("queueName").value = queue.name;
  $("serviceDescription").value = queue.serviceDescription;
  $("serviceMinutes").value = queue.averageServiceMinutes;
  $("queueFormTitle").textContent = "Edit queue";
  $("queueSubmit").textContent = "Save changes";
  $("cancelQueueEdit").classList.remove("hidden");
  setMessage("queueMessage", "");

  $("queueForm").scrollIntoView({
    behavior: "smooth",
    block: "center"
  });

  $("queueName").focus({ preventScroll: true });
}

async function deleteQueue(queueId) {
  const queue = state.queues.find(item => item._id === queueId);
  if (!queue) return;

  const confirmed = window.confirm(
    `Delete "${queue.name}"? This action cannot be undone.`
  );

  if (!confirmed) return;

  try {
    await apiRequest(`/queues/${encodeURIComponent(queueId)}`, {
      method: "DELETE"
    });

    toast("Queue deleted successfully.", "success");
    closeModal();
    await loadData();
  } catch (error) {
    toast(error.message, "error");
  }
}

async function toggleQueue(queueId, currentlyActive) {
  try {
    await apiRequest(`/queues/${encodeURIComponent(queueId)}`, {
      method: "PATCH",
      body: {
        isActive: !currentlyActive
      }
    });

    toast(
      currentlyActive ? "Queue deactivated." : "Queue activated.",
      "success"
    );

    await loadData();
  } catch (error) {
    toast(error.message, "error");
  }
}

async function callNext(queueId) {
  try {
    const response = await apiRequest(
      `/queues/${encodeURIComponent(queueId)}/call-next`,
      { method: "POST" }
    );

    toast(
      response.message || "Next token called successfully.",
      "success"
    );

    await loadData();
  } catch (error) {
    toast(error.message, "error");
  }
}

async function updateTokenStatus(select, flushModal) {
  const tokenId = select.dataset.statusToken;
  const status = select.value;

  if (!tokenId || !status) return;

  select.disabled = true;

  try {
    await apiRequest(`/tokens/${encodeURIComponent(tokenId)}/status`, {
      method: "PATCH",
      body: { status }
    });

    toast("Token status updated.", "success");
    await loadData();
  } catch (error) {
    toast(error.message, "error");
    await loadData();
  } finally {
    select.disabled = false;
  }
}

async function deleteToken(tokenId) {
  const token = state.tokens.find(item => item._id === tokenId);
  if (!token) return;

  const confirmed = window.confirm(
    `Delete token #${token.tokenNumber}?`
  );

  if (!confirmed) return;

  try {
    await apiRequest(`/tokens/${encodeURIComponent(tokenId)}`, {
      method: "DELETE"
    });

    toast("Token deleted successfully.", "success");
    await loadData();
  } catch (error) {
    toast(error.message, "error");
  }
}

function flushModal() {
  if (state.openQueueId) {
    openQueueModal(state.openQueueId);
  }
}



/* ----------------------------- Queue form ----------------------------- */

$("queueForm").addEventListener("submit", async event => {
  event.preventDefault();

  const form = event.currentTarget;
  if (!form.reportValidity()) return;

  const button = $("queueSubmit");
  const wasEditing = Boolean(state.editingQueueId);

  const payload = {
    name: $("queueName").value.trim(),
    serviceDescription: $("serviceDescription").value.trim(),
    averageServiceMinutes: Number($("serviceMinutes").value)
  };

  setMessage("queueMessage", "");
  setBusy(button, true, "Saving...");

  try {
    if (wasEditing) {
      await apiRequest(`/queues/${encodeURIComponent(state.editingQueueId)}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      toast("Queue updated.", "success");
    } else {
      await apiRequest("/queues", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      toast("Queue created.", "success");
    }

    resetQueueForm();
    setMessage(
      "queueMessage",
      `Queue ${wasEditing ? "updated" : "created"} successfully.`
    );
    await loadData();
  } catch (error) {
    setMessage("queueMessage", error.message, true);
    toast(error.message, "error");
  } finally {
    setBusy(button, false, state.editingQueueId ? "Save changes" : "Create queue");
  }
});

$("cancelQueueEdit").addEventListener("click", () => {
  resetQueueForm();
  setMessage("queueMessage", "");
});

/* ----------------------------- Token form ----------------------------- */

$("tokenForm").addEventListener("submit", async event => {
  event.preventDefault();

  const form = event.currentTarget;
  if (!form.reportValidity()) return;

  const button = $("tokenSubmit");
  const selectedQueueId = $("tokenQueue").value;

  const payload = {
    customerName: $("customerName").value.trim(),
    customerContact: $("customerContact").value.trim(),
    queueId: selectedQueueId
  };

  setMessage("tokenMessage", "");
  setBusy(button, true, "Generating...");

  try {
    const response = await apiRequest("/tokens", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    const token = response.data;
    const waitText =
      token.estimatedWaitMinutes === null ||
      token.estimatedWaitMinutes === undefined
        ? ""
        : ` Estimated wait ~${token.estimatedWaitMinutes} min.`;

    $("customerName").value = "";
    $("customerContact").value = "";

    setMessage(
      "tokenMessage",
      `Token #${token.tokenNumber} issued. Queue position ${token.queuePosition}.${waitText}`
    );
    toast(`Token #${token.tokenNumber} generated.`, "success");

    await loadData();

    if (state.queues.some(queue => queue._id === selectedQueueId && queue.isActive)) {
      $("tokenQueue").value = selectedQueueId;
    }
  } catch (error) {
    setMessage("tokenMessage", error.message, true);
    toast(error.message, "error");
  } finally {
    setBusy(button, false, "Generate token");
  }
});

/* ----------------------------- Refresh buttons ----------------------------- */

$("refreshDashboard").addEventListener("click", () =>
  loadData({ showToast: true })
);

$("refreshQueues").addEventListener("click", () =>
  loadData({ showToast: true })
);

$("refreshTokens").addEventListener("click", () =>
  loadData({ showToast: true })
);

/* ----------------------------- Filters ----------------------------- */

$("filterQueue").addEventListener("change", event => {
  state.queueFilter = event.target.value;
  renderTokens();
});

$("filterStatus").addEventListener("change", event => {
  state.statusFilter = event.target.value;
  renderTokens();
});

$("filterSearch").addEventListener("input", event => {
  state.search = event.target.value;
  renderTokens();
});

$("tokensList").addEventListener("change", event => {
  const select = event.target.closest("[data-token-status]");
  if (!select) return;
  updateTokenStatus(select, flushModal);
});

/* ----------------------------- Click actions ----------------------------- */

document.addEventListener("click", async event => {
  const target = event.target;

  if (target.closest("[data-close-modal]")) {
    closeModal();
    return;
  }

  const viewTrigger = target.closest("[data-view]");
  if (viewTrigger) {
    event.preventDefault();
    switchView(viewTrigger.dataset.view);
    return;
  }

  if (target.closest("[data-retry]")) {
    loadData();
    return;
  }

  if (target.closest("[data-clear-filters]")) {
    state.queueFilter = "";
    state.statusFilter = "";
    state.search = "";

    $("filterQueue").value = "";
    $("filterStatus").value = "";
    $("filterSearch").value = "";

    renderTokens();
    return;
  }

  if (target.closest("[data-focus-token-form]")) {
    $("customerName").focus();
    return;
  }

  const issueButton = target.closest("[data-issue-for]");
  if (issueButton) {
    const queueId = issueButton.dataset.issueFor;

    closeModal();
    switchView("tokens");

    state.queueFilter = queueId;
    $("filterQueue").value = queueId;
    $("tokenQueue").value = queueId;

    renderTokens();
    $("customerName").focus();
    return;
  }

  const callNextButton = target.closest("[data-call-next]");
  if (callNextButton) {
    try {
      await callNext(callNextButton.dataset.callNext);
    } catch (error) {
      toast(error.message, "error");
    }
    return;
  }

  const viewQueueButton = target.closest("[data-view-queue]");
  if (viewQueueButton) {
    openQueueModal(viewQueueButton.dataset.viewQueue);
    return;
  }

  const editQueueButton = target.closest("[data-edit-queue]");
  if (editQueueButton) {
    startEditQueue(editQueueButton.dataset.editQueue);
    return;
  }

  const toggleQueueButton = target.closest("[data-toggle-queue]");
  if (toggleQueueButton) {
    try {
      await toggleQueue(
        toggleQueueButton.dataset.toggleQueue,
        toggleQueueButton.dataset.active === "true"
      );
      flushModal();
    } catch (error) {
      toast(error.message, "error");
    }
    return;
  }

  const deleteQueueButton = target.closest("[data-delete-queue]");
  if (deleteQueueButton) {
    try {
      await deleteQueue(deleteQueueButton.dataset.deleteQueue);
    } catch (error) {
      toast(error.message, "error");
    }
    return;
  }

  const deleteTokenButton = target.closest("[data-delete-token]");
  if (deleteTokenButton) {
    try {
      await deleteToken(deleteTokenButton.dataset.deleteToken);
    } catch (error) {
      toast(error.message, "error");
    }
  }
});

/* ----------------------------- Keyboard actions ----------------------------- */

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && state.openQueueId) {
    closeModal();
  }
});

/* ----------------------------- Start ----------------------------- */

setConnection("pending", "Connecting...");
loadData();
