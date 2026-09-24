/* ======================================================================
   CLIENT PORTAL API CLIENT
   Talks to the real dashboard app under /api/dashboard/ — the same
   Django app + models ClientsPage.jsx's admin side uses. A logged-in
   client authenticates with a normal DRF auth token (issued at
   portal-login) and every endpoint here scopes itself to that client
   server-side (see dashboard/views.py get_queryset overrides) — there
   is no client-supplied "which client am I" parameter anywhere that
   isn't re-checked against the token on the backend.

   Set VITE_API_BASE_URL in your frontend .env to your Django host,
   e.g. VITE_API_BASE_URL=http://localhost:8000 — falls back to same
   origin ("") which works fine if you serve the SPA behind the same
   domain/reverse proxy as the API.
====================================================================== */

const rawPortalBase = import.meta.env?.VITE_API_BASE_URL || "http://127.0.0.1:8000/api";
const hostBase = rawPortalBase.replace(/\/api\/?$/, "").replace(/\/$/, "");
const BASE = `${hostBase}/api/dashboard`;

async function request(path, { method = "GET", token, body, isForm } = {}) {
  const headers = {};
  if (token) headers["Authorization"] = `Token ${token}`;
  if (body && !isForm) headers["Content-Type"] = "application/json";

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    // no body — fine (e.g. a 204)
  }

  if (!res.ok) {
    const err = new Error(data?.detail || firstFieldError(data) || "Something went wrong. Please try again.");
    err.status = res.status; // lets callers tell a 429 (throttled) / 423 (locked) apart from a plain bad login
    throw err;
  }
  return data;
}

function firstFieldError(data) {
  if (!data || typeof data !== "object") return null;
  for (const key of Object.keys(data)) {
    const v = data[key];
    if (Array.isArray(v) && v.length) return v[0];
  }
  return null;
}

/* ----------------------------------------------------------------
   Normalizing: dashboard.Client's real shape (id, name [= company],
   contact_person [= the person's name], industry, avatar/avatar_url,
   manager_name, outstanding, nested projects with nested modules, ...)
   doesn't 1:1 match the flat shape ClientPortal.jsx's UI expects
   (profilePic, manager, joined, invoices, activity, moduleRequests all
   inline on one object) — this assembles that shape from a handful of
   parallel calls so the rest of the frontend doesn't need to change.
---------------------------------------------------------------- */
const STATUS_LABELS = { pending: "Pending", submitted: "Submitted", partial: "Partial", paid: "Paid" };

function normalizeClient(raw, { invoices = [], activity = [], moduleRequests = [] } = {}) {
  return {
    id: raw.id,
    name: raw.contact_person || raw.name,
    company: raw.name,
    email: raw.email,
    phone: raw.phone,
    industry: raw.industry,
    status: raw.status,
    manager: raw.manager_name || "",
    joined: raw.created_at ? raw.created_at.slice(0, 10) : "",
    profilePic: raw.avatar || raw.avatar_url || null,
    outstanding: Number(raw.outstanding || 0),
    projects: (raw.projects || []).map((p) => ({
      id: p.id,
      name: p.name,
      project_type: p.project_type,
      status: p.status,
      budget: Number(p.budget || 0),
      spent: Number(p.spent || 0),
      progress: p.module_count ? Math.round((p.modules_done / p.module_count) * 100) : 0,
      moduleCount: p.module_count,
      modulesDone: p.modules_done,
      // FIX (Final Deliverable block always empty on the Client Portal):
      // the backend now sends this project's completed_zip as
      // `deliverableZip` (see dashboard/serializers.py's
      // ClientProjectSummarySerializer.get_deliverableZip) in exactly
      // the {id, name, url} shape FinalDeliverableBlock / useResolvedAttachments
      // expect — this was never read through to the normalized shape
      // ClientPortal.jsx actually renders from, so `p.deliverableZip` was
      // always undefined and the block never rendered at all (not even
      // as a locked card), regardless of payment status.
      deliverableZip: p.deliverableZip || null,
      modules: (p.modules || []).map((m) => ({
        id: m.id,
        name: m.name,
        status: m.status,
        unlocked: m.unlocked,
        done: m.status === "Completed",
        locked: !m.unlocked,
        // FIX (module attachments never reached the Client Portal): the
        // backend now sends each module's live/staging link + every
        // uploaded ModuleFile as a flat `attachments` array (see
        // dashboard/serializers.py's _module_attachments) — already in
        // the exact {id, type, name, url} shape GatedModuleAttachments /
        // AttachmentGallery expect, so it's passed straight through.
        attachments: m.attachments || [],
        // FIX (sub-task breakdown never reached the Client Portal): a
        // sub-task (e.g. Development's Frontend/Backend/...) is now a
        // real child Module row (see projects.Module.parent), nested
        // here under `subModules` — same shape ClientPortal.jsx's
        // GatedModuleAttachments already renders per sub-task.
        subModules: (m.subModules || []).map((s) => ({
          id: s.id,
          name: s.name,
          status: s.status,
          unlocked: s.unlocked,
          done: s.status === "Completed",
          locked: !s.unlocked,
          // Same fix, one level deep — a sub-task's own attachments.
          attachments: s.attachments || [],
        })),
      })),
    })),
    invoices: invoices.map((i) => ({
      id: i.id,
      // FIX (Billing tab showed blank/broken invoices): this used to
      // stop at the bare milestone/amount/status fields the old backend
      // Invoice model had — everything the actual UI renders (invoice
      // number, issue/due date, paid-so-far amount, the full branded
      // document InvoiceDocumentPreview needs) was silently undefined.
      // Now maps 1:1 onto every field the real Invoice model stores
      // (see dashboard/models.py) — same shape ClientsPage.jsx's own
      // local ledger already uses, so InvoiceDocumentPreview (shared by
      // both the admin page and this portal) renders identically here.
      number: i.number || "",
      issueDate: i.issue_date || (i.created_at ? i.created_at.slice(0, 10) : ""),
      dueDate: i.due_date || "",
      milestone: i.milestone_number,
      milestoneTotal: i.milestone_total,
      percent: Number(i.percent || 0),
      amount: Number(i.amount || 0),
      paidAmount: Number(i.paid_amount || 0),
      status: STATUS_LABELS[i.status] || i.status, // "Pending" | "Submitted" | "Partial" | "Paid" — matches the UI's own comparisons
      projectName: i.project_name || "",
      project: i.project,
      note: i.note,
      billTo: i.bill_to && Object.keys(i.bill_to).length ? i.bill_to : null,
      lineItems: Array.isArray(i.line_items) ? i.line_items : [],
      poNumber: i.po_number || "",
      paymentMethod: i.payment_method || "",
      transactionRef: i.transaction_ref || "",
      amountReceived: Number(i.amount_received || 0),
      discount: Number(i.discount || 0),
      subtotal: i.subtotal != null ? Number(i.subtotal) : Number(i.amount || 0),
      grandTotal: i.grand_total != null ? Number(i.grand_total) : Number(i.amount || 0),
      approvedBy: i.approved_by || "",
      designation: i.designation || "",
      approvalDate: i.approval_date || "",
      paymentProof: i.payment_proof ? { dataUrl: i.payment_proof, fileName: "payment-proof", submittedAt: i.submitted_at } : null,
      paidAt: i.paid_at,
    })),
    activity: activity.map((a) => ({
      id: a.id,
      text: a.text,
      time: a.created_at,
    })),
    moduleRequests: moduleRequests.map((r) => ({
      id: r.id,
      moduleName: r.module_name,
      projectName: r.project_name,
      module: r.module,
      project: r.project,
      note: r.note,
      attachment: r.attachment,
      attachmentLink: r.attachment_link,
      status: r.status,
      requestedAt: r.requested_at,
    })),
  };
}

async function hydrate(token, rawClient) {
  const [invoicesRes, activityRes, requestsRes] = await Promise.all([
    request(`/invoices/?client=${rawClient.id}`, { token }).catch(() => []),
    request(`/activity/?client=${rawClient.id}`, { token }).catch(() => []),
    request(`/module-requests/?client=${rawClient.id}`, { token }).catch(() => []),
  ]);
  return normalizeClient(rawClient, {
    invoices: invoicesRes.results || invoicesRes,
    activity: activityRes.results || activityRes,
    moduleRequests: requestsRes.results || requestsRes,
  });
}

/** POST {clientId, email, password} -> real DRF token + the raw Client row,
 *  then hydrated into the flat shape the rest of the app expects. The
 *  password is the one an admin generated via "Generate Portal Access". */
export async function login(clientId, email, password) {
  const { token, client } = await request("/clients/portal-login/", {
    method: "POST",
    body: { id: clientId, email, password },
  });
  const full = await hydrate(token, client);
  return { token, client: full };
}

/** Re-fetches everything for the already-logged-in client — used for
 *  onRefresh() after any write, and on window focus. */
export async function fetchMe(token) {
  // The client only ever has ONE row visible to them (see
  // ClientViewSet.get_queryset), so /clients/ IS "me".
  const clients = await request("/clients/", { token });
  const list = clients.results || clients;
  const client = Array.isArray(list) ? list[0] : null;
  if (!client) throw new Error("Session expired — please log in again.");
  return hydrate(token, client);
}

export function logout() {
  // Nothing to call server-side — the token stays valid (same as a
  // staff logout); the frontend just forgets it.
  return Promise.resolve();
}

/** Upload a payment screenshot for one invoice. `file` is a raw File. */
export function submitPaymentProof(token, invoiceId, file) {
  const form = new FormData();
  form.append("payment_proof", file);
  return request(`/invoices/${invoiceId}/submit-payment/`, { method: "POST", token, body: form, isForm: true });
}

/** Ask to start an EXISTING (locked) module. */
export function requestExistingModule(token, clientId, moduleId) {
  return request("/module-requests/", { method: "POST", token, body: { client: clientId, module: moduleId } });
}

/** Ask for a brand-new module that isn't in the project's plan yet.
 *  `attachmentFile` (File) and `attachmentLink` (string) are both optional. */
export function requestCustomModule(token, { clientId, projectId, moduleName, note, attachmentFile, attachmentLink }) {
  const form = new FormData();
  form.append("client", clientId);
  form.append("project", projectId);
  form.append("custom_module_name", moduleName);
  if (note) form.append("note", note);
  if (attachmentFile) form.append("attachment", attachmentFile);
  if (attachmentLink) form.append("attachment_link", attachmentLink);
  return request("/module-requests/", { method: "POST", token, body: form, isForm: true });
}

/** Set (file) or clear (no file) the client's own profile picture. */
export function updateProfilePic(token, clientId, file) {
  const form = file ? new FormData() : undefined;
  if (file) form.append("photo", file);
  return request(`/clients/${clientId}/profile-pic/`, {
    method: file ? "PATCH" : "DELETE",
    token,
    body: form,
    isForm: true,
  });
}

export function fetchMessages(token, clientId) {
  return request(`/messages/?client=${clientId}`, { token }).then((r) => r.results || r);
}

export function sendMessage(token, clientId, text) {
  return request("/messages/", { method: "POST", token, body: { client: clientId, text } });
}

export function sendSupportRequest(token, subject, message) {
  return request("/support/", { method: "POST", token, body: { subject, message } });
}

/* ----------------------------------------------------------------
   DOCUMENTS — dashboard.Document (client portal side)
   The server scopes every request to the logged-in client's own
   documents automatically — no client id needed on the URL.
---------------------------------------------------------------- */

/** Fetch all documents belonging to the currently logged-in client. */
export function fetchDocuments(token) {
  return request("/documents/", { token }).then((r) => r.results || r);
}

/** Upload a new document as the logged-in client.
 *  `file`      — a File/Blob (required)
 *  `projectId` — optional Project pk to associate with the document
 */
export function uploadDocument(token, file, projectId) {
  const form = new FormData();
  form.append("file", file);
  form.append("file_name", file.name);
  // No 'client' field — the server reads it from the token session.
  if (projectId) form.append("project", String(projectId));
  return request("/documents/", { method: "POST", token, body: form, isForm: true });
}

/** Delete one of the logged-in client's documents by id. */
export function deleteDocument(token, documentId) {
  return request(`/documents/${documentId}/`, { method: "DELETE", token });
}