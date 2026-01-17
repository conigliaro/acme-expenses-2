// Starter kit (Vanilla JS) — Bridge v1 (createAppsBridgeV1)
// Notes:
// - allowedParentOrigin MUST be the exact host origin (never "*").
// - The host validates event.origin and event.source.
// - Requests are correlated by requestId + have timeouts.

function normalizeAllowedOrigin(input) {
  const raw = (input || "").trim();
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  return url.origin;
}

function isBridgeV1ErrorCode(x) {
  return x === "MISSING_PERMISSION" || x === "NOT_AUTHED" || x === "UNKNOWN";
}

function isAppMode(x) {
  return x === "embedded" || x === "standalone";
}

// Minimal embedded version of the official helper in the host repo:
// apps/web/src/features/apps/bridge/apps-bridge-v1.ts
function createAppsBridgeV1(opts) {
  const allowedOrigin = normalizeAllowedOrigin(opts?.allowedParentOrigin);
  if (!allowedOrigin) {
    throw new Error(
      "[apps-bridge-v1] allowedParentOrigin is required (must be a valid http/https URL origin)"
    );
  }

  const parentWin = opts?.parentWindow ?? window.parent;
  const defaultTimeoutMs = Math.max(500, opts?.defaultTimeoutMs ?? 8000);

  const pending = new Map();
  let destroyed = false;

  function newRequestId() {
    const g = globalThis;
    if (g?.crypto?.randomUUID) return g.crypto.randomUUID();
    return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  function safeParseMessage(data) {
    if (!data || typeof data !== "object") return null;

    const type = data.type;
    if (typeof type !== "string") return null;

    if (type === "HOST_CONTEXT") {
      const payload = data.payload;
      if (!payload || typeof payload !== "object") return null;
      if (payload.v !== 1) return null;

      const app = payload.app;
      const platform = payload.platform;
      if (!app || typeof app !== "object") return null;
      if (!platform || typeof platform !== "object") return null;

      if (typeof app.id !== "string") return null;
      if (typeof app.kind !== "string") return null;
      if (!isAppMode(app.mode)) return null;

      if (!isAppMode(platform.mode)) return null;
      if (typeof platform.host !== "string") return null;
      if (typeof platform.isDevHost !== "boolean") return null;
      if (typeof platform.isMobile !== "boolean") return null;

      if (!Array.isArray(payload.permissions)) return null;
      if (!payload.permissions.every((p) => typeof p === "string")) return null;

      if (typeof payload.isAuthed !== "boolean") return null;

      if ("requestId" in data && data.requestId != null && typeof data.requestId !== "string") {
        return null;
      }

      return data;
    }

    if (type === "RESULT") {
      if (typeof data.requestId !== "string") return null;
      return data;
    }

    if (type === "ERROR") {
      if (typeof data.requestId !== "string") return null;
      const err = data.error;
      if (!err || typeof err !== "object") return null;
      if (!isBridgeV1ErrorCode(err.code)) return null;
      if (typeof err.message !== "string") return null;
      return data;
    }

    return null;
  }

  function postToHost(msg) {
    parentWin.postMessage(msg, allowedOrigin);
  }

  function request(msg, timeoutMs) {
    if (destroyed) return Promise.reject(new Error("[apps-bridge-v1] bridge destroyed"));

    const requestId = newRequestId();
    const tms = Math.max(500, timeoutMs ?? defaultTimeoutMs);

    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`[apps-bridge-v1] request timeout (${tms}ms) type=${msg.type}`));
      }, tms);

      pending.set(requestId, { resolve, reject, timer });
      postToHost({ ...msg, requestId });
    });
  }

  function onMessage(event) {
    if (event.origin !== allowedOrigin) return;
    if (event.source !== parentWin) return;

    const parsed = safeParseMessage(event.data);
    if (!parsed) return;

    if (parsed.type === "HOST_CONTEXT") {
      const reqId = parsed.requestId;
      if (reqId && pending.has(reqId)) {
        const p = pending.get(reqId);
        window.clearTimeout(p.timer);
        pending.delete(reqId);
        p.resolve(parsed.payload);
      }
      return;
    }

    if (parsed.type === "RESULT") {
      const p = pending.get(parsed.requestId);
      if (!p) return;
      window.clearTimeout(p.timer);
      pending.delete(parsed.requestId);
      p.resolve(parsed.result);
      return;
    }

    if (parsed.type === "ERROR") {
      const p = pending.get(parsed.requestId);
      if (!p) return;
      window.clearTimeout(p.timer);
      pending.delete(parsed.requestId);

      const err = parsed.error;
      const e = new Error(err.message);
      e.code = err.code;
      p.reject(e);
      return;
    }
  }

  window.addEventListener("message", onMessage);

  function ready(requestId) {
    postToHost({ type: "APP_READY", requestId });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    window.removeEventListener("message", onMessage);
    for (const [id, p] of pending.entries()) {
      window.clearTimeout(p.timer);
      p.reject(new Error("[apps-bridge-v1] destroyed"));
      pending.delete(id);
    }
  }

  return {
    ready,
    getHostContext: (opts2) => request({ type: "REQUEST_HOST_CONTEXT" }, opts2?.timeoutMs),
    createExpense: (payload, opts2) => request({ type: "CREATE_EXPENSE", payload }, opts2?.timeoutMs),
    createIncome: (payload, opts2) => request({ type: "CREATE_INCOME", payload }, opts2?.timeoutMs),
    listTransactionsMonth: (payload, opts2) => request({ type: "LIST_TRANSACTIONS_MONTH", payload }, opts2?.timeoutMs),
    getTransactionRangeDetails: (payload, opts2) => request({ type: "GET_TRANSACTION_RANGE_DETAILS", payload }, opts2?.timeoutMs),
    listCategories: (payload, opts2) => request({ type: "LIST_CATEGORIES", payload: payload ?? {} }, opts2?.timeoutMs),
    createPaymentPlan: (payload, opts2) => request({ type: "CREATE_PAYMENT_PLAN", payload }, opts2?.timeoutMs),
    listPaymentPlans: (opts2) => request({ type: "LIST_PAYMENT_PLANS" }, opts2?.timeoutMs),
    createIncomePlan: (payload, opts2) => request({ type: "CREATE_INCOME_PLAN", payload }, opts2?.timeoutMs),
    listIncomePlans: (opts2) => request({ type: "LIST_INCOME_PLANS" }, opts2?.timeoutMs),
    listOverduePayments: (payload, opts2) => request({ type: "LIST_OVERDUE_PAYMENTS", payload: payload ?? {} }, opts2?.timeoutMs),
    destroy,
  };
}

const out = document.getElementById("out");
const hostOriginEl = document.getElementById("hostOrigin");
const actionEl = document.getElementById("action");
const timeoutEl = document.getElementById("timeoutMs");
const fieldsEl = document.getElementById("fields");
const btnRun = document.getElementById("btnRun");

function write(status, payload) {
  const safe = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  out.textContent = status + "\n" + safe;
}

function readTimeoutMs() {
  const raw = String(timeoutEl?.value ?? "").trim();
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 500) return undefined;
  return n;
}

const ACTIONS = [
  {
    id: "getHostContext",
    label: "getHostContext",
    fields: [],
  },
  {
    id: "createExpense",
    label: "createExpense",
    fields: [
      { id: "amount", label: "amount", kind: "number", placeholder: "12.34" },
      { id: "currencyCode", label: "currencyCode (optional)", kind: "text", placeholder: "EUR" },
      { id: "note", label: "note (optional)", kind: "text", placeholder: "From starter kit" },
      { id: "occurredAt", label: "occurredAt (optional ISO)", kind: "text", placeholder: "2026-01-01T10:00:00.000Z" },
      { id: "categoryId", label: "categoryId (optional)", kind: "text", placeholder: "" },
    ],
  },
  {
    id: "createIncome",
    label: "createIncome",
    fields: [
      { id: "amount", label: "amount", kind: "number", placeholder: "450.00" },
      { id: "currencyCode", label: "currencyCode (optional)", kind: "text", placeholder: "EUR" },
      { id: "note", label: "note (optional)", kind: "text", placeholder: "Salary" },
      { id: "occurredAt", label: "occurredAt (optional ISO)", kind: "text", placeholder: "" },
      { id: "categoryId", label: "categoryId (optional)", kind: "text", placeholder: "" },
    ],
  },
  {
    id: "listTransactionsMonth",
    label: "listTransactionsMonth",
    fields: [
      { id: "month", label: "month", kind: "number", placeholder: "1" },
      { id: "year", label: "year (optional)", kind: "number", placeholder: "2026" },
      {
        id: "type",
        label: "type (optional)",
        kind: "select",
        options: ["", "EXPENSE", "INCOME"],
      },
      { id: "categoryId", label: "categoryId (optional)", kind: "text", placeholder: "" },
      { id: "cursor", label: "cursor (optional)", kind: "text", placeholder: "" },
    ],
  },
  {
    id: "getTransactionRangeDetails",
    label: "getTransactionRangeDetails",
    fields: [
      { id: "start", label: "start (ISO)", kind: "text", placeholder: "2026-01-01T00:00:00.000Z" },
      { id: "end", label: "end (ISO)", kind: "text", placeholder: "2026-01-31T23:59:59.999Z" },
      { id: "type", label: "type", kind: "select", options: ["EXPENSE", "INCOME"] },
      { id: "currencyCode", label: "currencyCode (optional)", kind: "text", placeholder: "EUR" },
    ],
  },
  {
    id: "listCategories",
    label: "listCategories",
    fields: [
      { id: "type", label: "type (optional)", kind: "select", options: ["", "BOTH", "EXPENSE", "INCOME"] },
      { id: "includeCounts", label: "includeCounts", kind: "checkbox" },
    ],
  },
  {
    id: "createPaymentPlan",
    label: "createPaymentPlan",
    fields: [
      { id: "title", label: "title", kind: "text", placeholder: "Internet" },
      { id: "amount", label: "amount", kind: "number", placeholder: "29.99" },
      { id: "currencyCode", label: "currencyCode", kind: "text", placeholder: "EUR" },
      { id: "cadence", label: "cadence", kind: "select", options: ["MONTHLY", "WEEKLY", "YEARLY", "CUSTOM"] },
      { id: "startDate", label: "startDate (YYYY-MM-DD)", kind: "text", placeholder: "2026-01-01" },
      { id: "autopostTransaction", label: "autopostTransaction (optional)", kind: "checkbox" },
    ],
  },
  {
    id: "listPaymentPlans",
    label: "listPaymentPlans",
    fields: [],
  },
  {
    id: "createIncomePlan",
    label: "createIncomePlan",
    fields: [
      { id: "title", label: "title", kind: "text", placeholder: "Ingreso recurrente" },
      { id: "amount", label: "amount", kind: "number", placeholder: "1000" },
      { id: "currencyCode", label: "currencyCode", kind: "text", placeholder: "EUR" },
      { id: "frequency", label: "frequency", kind: "select", options: ["WEEKLY", "BIWEEKLY", "MONTHLY", "YEARLY"] },
      { id: "startDate", label: "startDate (YYYY-MM-DD)", kind: "text", placeholder: "2026-01-01" },
      { id: "isPaused", label: "isPaused (optional)", kind: "checkbox" },
    ],
  },
  {
    id: "listIncomePlans",
    label: "listIncomePlans",
    fields: [],
  },
  {
    id: "listOverduePayments",
    label: "listOverduePayments",
    fields: [
      { id: "limit", label: "limit (optional)", kind: "number", placeholder: "20" },
      { id: "lookbackDays", label: "lookbackDays (optional)", kind: "number", placeholder: "60" },
    ],
  },
  {
    id: "destroy",
    label: "destroy (cleanup)",
    fields: [],
  },
];

function renderActions() {
  actionEl.innerHTML = "";
  for (const a of ACTIONS) {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.textContent = a.label;
    actionEl.appendChild(opt);
  }
}

function renderFields(actionId) {
  const action = ACTIONS.find((a) => a.id === actionId) ?? ACTIONS[0];
  fieldsEl.innerHTML = "";

  for (const f of action.fields) {
    const wrapper = document.createElement("div");
    const label = document.createElement("label");
    label.setAttribute("for", "field_" + f.id);
    label.textContent = f.label;
    wrapper.appendChild(label);

    if (f.kind === "select") {
      const sel = document.createElement("select");
      sel.id = "field_" + f.id;
      for (const v of f.options ?? []) {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = v || "(none)";
        sel.appendChild(opt);
      }
      wrapper.appendChild(sel);
    } else if (f.kind === "checkbox") {
      const input = document.createElement("input");
      input.id = "field_" + f.id;
      input.type = "checkbox";
      input.style.height = "18px";
      input.style.width = "18px";
      wrapper.appendChild(input);
    } else {
      const input = document.createElement("input");
      input.id = "field_" + f.id;
      input.type = f.kind === "number" ? "number" : "text";
      if (f.kind === "number") {
        input.step = "0.01";
        input.inputMode = "decimal";
      }
      if (f.placeholder) input.placeholder = f.placeholder;
      wrapper.appendChild(input);
    }

    fieldsEl.appendChild(wrapper);
  }
}

function getFieldValue(id) {
  const el = document.getElementById("field_" + id);
  if (!el) return undefined;
  if (el instanceof HTMLInputElement && el.type === "checkbox") return el.checked;
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) return String(el.value ?? "").trim();
  return undefined;
}

function omitEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    if (typeof v === "string" && !v.trim()) continue;
    out[k] = v;
  }
  return out;
}

let bridge = null;
let bridgeReady = false;

function ensureBridge() {
  if (bridge) return bridge;

  const hostOriginRaw = String(hostOriginEl.value ?? "").trim();
  if (!hostOriginRaw || hostOriginRaw === "<PUT_HOST_ORIGIN_HERE>") {
    throw new Error("Set hostOrigin to the exact host origin (e.g. https://mybudgetsocial.com).");
  }

  bridge = createAppsBridgeV1({
    allowedParentOrigin: hostOriginRaw,
    defaultTimeoutMs: readTimeoutMs() ?? 8000,
  });

  if (!bridgeReady) {
    bridge.ready();
    bridgeReady = true;
  }

  return bridge;
}

async function run() {
  const actionId = String(actionEl.value ?? "");
  const timeoutMs = readTimeoutMs();

  if (actionId === "destroy") {
    if (bridge) bridge.destroy();
    bridge = null;
    bridgeReady = false;
    return { ok: true, destroyed: true };
  }

  const b = ensureBridge();

  if (actionId === "getHostContext") {
    // Example: custom timeout
    return b.getHostContext({ timeoutMs: timeoutMs ?? 8000 });
  }

  if (actionId === "createExpense") {
    const amount = Number(getFieldValue("amount"));
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid amount (must be > 0)");
    const payload = omitEmpty({
      amount,
      currencyCode: getFieldValue("currencyCode") || undefined,
      note: getFieldValue("note") || undefined,
      occurredAt: getFieldValue("occurredAt") || undefined,
      categoryId: getFieldValue("categoryId") || undefined,
    });
    return b.createExpense(payload);
  }

  if (actionId === "createIncome") {
    const amount = Number(getFieldValue("amount"));
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid amount (must be > 0)");
    const payload = omitEmpty({
      amount,
      currencyCode: getFieldValue("currencyCode") || undefined,
      note: getFieldValue("note") || undefined,
      occurredAt: getFieldValue("occurredAt") || undefined,
      categoryId: getFieldValue("categoryId") || undefined,
    });
    return b.createIncome(payload);
  }

  if (actionId === "listTransactionsMonth") {
    const month = String(getFieldValue("month") || "").trim();
    if (!month) throw new Error("month is required");
    const payload = omitEmpty({
      month,
      year: getFieldValue("year") || undefined,
      type: getFieldValue("type") || undefined,
      categoryId: getFieldValue("categoryId") || undefined,
      cursor: getFieldValue("cursor") || undefined,
    });
    // Example: custom timeout
    return b.listTransactionsMonth(payload, { timeoutMs: timeoutMs ?? 12000 });
  }

  if (actionId === "getTransactionRangeDetails") {
    const payload = omitEmpty({
      start: getFieldValue("start"),
      end: getFieldValue("end"),
      type: getFieldValue("type") || "EXPENSE",
      currencyCode: getFieldValue("currencyCode") || undefined,
    });
    if (!payload.start || !payload.end) throw new Error("start and end are required");
    return b.getTransactionRangeDetails(payload);
  }

  if (actionId === "listCategories") {
    const payload = omitEmpty({
      type: getFieldValue("type") || undefined,
      includeCounts: Boolean(getFieldValue("includeCounts")),
    });
    return b.listCategories(payload);
  }

  if (actionId === "createPaymentPlan") {
    const amount = Number(getFieldValue("amount"));
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid amount (must be > 0)");
    const payload = omitEmpty({
      title: getFieldValue("title"),
      amount,
      currencyCode: getFieldValue("currencyCode") || "EUR",
      cadence: getFieldValue("cadence") || "MONTHLY",
      startDate: getFieldValue("startDate"),
      autopostTransaction: Boolean(getFieldValue("autopostTransaction")),
    });
    if (!payload.title || !payload.startDate) throw new Error("title and startDate are required");
    return b.createPaymentPlan(payload);
  }

  if (actionId === "listPaymentPlans") {
    return b.listPaymentPlans();
  }

  if (actionId === "createIncomePlan") {
    const amount = Number(getFieldValue("amount"));
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid amount (must be > 0)");
    const payload = omitEmpty({
      title: getFieldValue("title"),
      amount,
      currencyCode: getFieldValue("currencyCode") || "EUR",
      frequency: getFieldValue("frequency") || "MONTHLY",
      startDate: getFieldValue("startDate"),
      isPaused: Boolean(getFieldValue("isPaused")),
    });
    if (!payload.title || !payload.startDate) throw new Error("title and startDate are required");
    return b.createIncomePlan(payload);
  }

  if (actionId === "listIncomePlans") {
    return b.listIncomePlans();
  }

  if (actionId === "listOverduePayments") {
    const payload = omitEmpty({
      limit: getFieldValue("limit") || undefined,
      lookbackDays: getFieldValue("lookbackDays") || undefined,
    });
    return b.listOverduePayments(payload);
  }

  throw new Error("Unsupported action: " + actionId);
}

renderActions();
renderFields(ACTIONS[0].id);
actionEl.addEventListener("change", () => renderFields(actionEl.value));

btnRun.addEventListener("click", async () => {
  btnRun.disabled = true;
  write("PENDING", { action: actionEl.value });
  try {
    const result = await run();
    write("OK", result);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    const payload = {
      code: e.code,
      message: e.message,
      stack: e.stack,
    };
    write("ERROR", payload);
  } finally {
    btnRun.disabled = false;
  }
});
