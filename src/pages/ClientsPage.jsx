import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth, getRoleCategory } from "../AuthContext.jsx";
// STEP 2 of the real-backend rollout: plain Client CRUD (dashboard.Client)
// now dual-writes to Postgres alongside the existing localStorage state.
// Projects/Modules/Invoices/ModuleRequests still live in localStorage only
// until Steps 3-4 — see MIGRATIONS.md / GUIDE.md for the full staged plan.
import * as clientsApi from "../api/clientsApi.js";
import { sendMessage as apiSendMessage } from "../messagesApi.js";
import { FLAG_KEYS, syncFlag } from "../userFlags.js";
import {
  Users2,
  Briefcase,
  UserPlus2,
  FolderOpen,
  DollarSign,
  Filter,
  ChevronDown,
  MoreVertical,
  Plus,
  X,
  Search,
  Mail,
  Phone,
  MapPin,
  Building2,
  Pencil,
  Eye,
  Trash2,
  UserCheck,
  UserX,
  FileText,
  Activity as ActivityIcon,
  Users as UsersIcon,
  CheckCircle2,
  Circle,
  Check,
  Copy,
  KeyRound,
  Share2,
  MessageCircle,
  Image as ImageIcon,
  Video,
  Link2,
  Archive,
  File as FileIcon,
  Upload,
  ListChecks,
  Paperclip,
  Wallet,
  Bell,
  Download,
  Building,
  AlertTriangle,
} from "lucide-react";

/* ======================================================================
   INVOICE DOCUMENT — HOPENIX company letterhead (matches the branded PDF
   template exactly: name, address, phone, email, website) plus the fixed
   designation checkboxes shown in the PDF's Approval & Authorization
   section. Used by both GenerateInvoiceModal (the editable form) and
   InvoiceDocumentPreview (the read-only, client-facing render) below, so
   the two always stay visually identical.
====================================================================== */
const HOPENIX_COMPANY = {
  name: "HOPENIX",
  tagline: "TURNING BUSINESSES INTO DIGITAL BRANDS",
  address: "Second Floor, Hashim Plaza, Main GT Road, Pak Town, Kamoke, Gujranwala",
  phone: "+92-3398800004",
  email: "hello.hopenix@gmail.com",
  website: "hopenix.net",
};
const INVOICE_DESIGNATIONS = ["CEO", "MD", "MANAGER", "PM"];

/* ======================================================================
   STATIC CONFIG
====================================================================== */

const INDUSTRIES = [
  "Technology",
  "Banking",
  "Retail",
  "Healthcare",
  "Education",
  "Logistics",
  "Marketing",
  "Construction",
  "Manufacturing",
  "Hospitality",
];

// FIX (real managers, not fake ones): this used to be the ONLY list a
// client could be assigned a manager from — a fixed 6 names that had
// nothing to do with who's actually an approved manager on the site.
// It's now used only as (a) a last-resort fallback if zero real managers
// are approved yet, so the demo/select never ends up with no options at
// all, and (b) filler for the generated demo companies below. The Add/
// Edit Client forms themselves now pull from `assignableManagers`
// (built from real `approvedUsers` in the main component) instead.
const MANAGERS = [
  { name: "Ali Raza", role: "Project Manager" },
  { name: "Usman Ali", role: "Team Lead" },
  { name: "Sara Khan", role: "Project Manager" },
  { name: "Hina Fatima", role: "Project Manager" },
  { name: "Zain Ali", role: "Team Lead" },
  { name: "Ayesha Noor", role: "Team Lead" },
];

const STATUS_STYLES = {
  Active: "bg-emerald-50 text-emerald-600",
  Inactive: "bg-rose-50 text-rose-600",
};

/* ----------------------------------------------------------------------
   PROJECT TYPES — each type ships its own fixed checklist of modules
   (Frontend, Backend, etc). A project's completion % is always DERIVED
   from how many of its modules are ticked — nothing else sets it. Ticking
   the last module automatically brings a project to 100% / "Complete",
   and that's what both the admin panel and the client portal read.
---------------------------------------------------------------------- */

const PROJECT_TYPES = {
  Website: ["UI/UX Design", "Frontend", "Backend", "Database", "Deployment"],
  "Mobile App": ["UI/UX Design", "Frontend", "Backend", "API Integration", "Testing", "Deployment"],
  "E-commerce": ["UI/UX Design", "Frontend", "Backend", "Payment Integration", "Testing", "Deployment"],
  "Custom Software": ["Requirement Analysis", "Backend", "Frontend", "Database", "Testing", "Deployment"],
  // FIX (graphic design clients): a completely different kind of project —
  // no code, no live URL, so the checklist and attachment rules for this
  // type are handled separately (see LINK_REQUIRED_MODULES below, which
  // deliberately does NOT include any of these names, and TasksPage.jsx's
  // SUBTASK_ATTACHMENT_RULES, which allows .cdr/.ai/.psd for these instead
  // of requiring a link).
  "Graphic Design": ["Concept & Moodboard", "Design Drafts", "Client Revisions", "Final Artwork"],
  Other: ["Planning", "Development", "Testing", "Deployment"],
};

const PROJECT_TYPE_OPTIONS = Object.keys(PROJECT_TYPES);

// Sentinel used by the Add Client form's project-type <select> so the admin
// can type their own project type by hand instead of picking a fixed one.
const CUSTOM_PROJECT_TYPE_VALUE = "__custom__";

// Any module literally named "Development" gets broken down into these
// real sub-tasks instead of being a single tick-box — this is what lets
// the client portal show granular Frontend/Backend/etc progress instead
// of one flat "Development: done/not done".
const DEVELOPMENT_SUBTASKS = ["Frontend", "Backend", "Database", "API Integration"];

// Modules where the assigned manager/developer MUST attach a real link
// (a live URL — deployed site, repo, staging link, etc) before that
// module/sub-task can be marked complete from the Tasks page. Screenshots
// and videos are always optional extras on top of that; other modules
// (Planning, Testing, Database, API Integration, ...) never require a
// link — a screenshot or video is enough there.
const LINK_REQUIRED_MODULES = ["Frontend", "Backend", "Deployment"];

// Builds a project's modules checklist from an explicit list of module
// names — this is what lets the Add Client form offer a real checklist
// (tick the ones you want, type in any extra custom ones) instead of
// always forcing every project onto its type's fixed list.
function makeModulesFromNames(names) {
  const list = names && names.length ? names : PROJECT_TYPES.Other;
  return list.map((name, i) => {
    // unlocked: only the very first module starts unlocked — that's the
    // one work begins on immediately. Every module after it stays locked
    // until the client actually requests it (from the Client Portal) and
    // staff accepts that request here — see acceptModuleRequest below.
    // This mirrors the natural "finish one, ask for the next" order the
    // Client Portal's own "Request to start" buttons already imply.
    const mod = { id: `mod-${i}-${Date.now()}`, name, done: false, attachments: [], unlocked: i === 0 };
    if (name === "Development") {
      mod.subModules = DEVELOPMENT_SUBTASKS.map((sub, j) => ({ id: `mod-${i}-sub-${j}`, name: sub, done: false, attachments: [] }));
    }
    return mod;
  });
}

function makeModules(type, customNames) {
  const names = customNames && customNames.length ? customNames : PROJECT_TYPES[type] || PROJECT_TYPES.Other;
  return makeModulesFromNames(names);
}

/* ----------------------------------------------------------------------
   FIX (Client Portal showed "No projects" even though the project was
   right there on this page): a project added through this page's Add
   Client / "add another project" flow used to live ONLY in this
   component's local state + the clientspage_clients_v1 localStorage
   blob — it never became a real projects.Project row. The Client
   Portal (ClientPortal.jsx) only ever reads real backend data
   (client.projects, via dashboard.ClientSerializer -> the actual
   Postgres projects_project table), so it legitimately had nothing to
   show. This creates the matching real Project (+ its Modules) on the
   backend right after the local project is added, using the exact
   same client id, so the Client Portal — and the real Projects page —
   both pick it up. Best-effort / non-blocking: the client (and its
   local project) has already been saved either way, so a failure here
   just means "not visible on the Portal/Projects page yet", not "the
   Add Client action failed" — same fallback philosophy the rest of
   this file already uses for avatar/portal-access failures.
---------------------------------------------------------------------- */
async function syncClientProjectToBackend(clientBackendId, project, { managerUser, budget = 0 } = {}) {
  if (!clientBackendId || !project) return null;
  try {
    const backendProject = await clientsApi.createProject({
      name: project.name,
      description: project.details || "",
      project_type: "client",
      client: clientBackendId,
      manager: managerUser ? managerUser.id : null,
      team: managerUser ? [managerUser.id] : [],
      status: "In Progress",
      priority: "Medium",
      budget: Number(budget) || 0,
    });
    // FIX (module ticks/attachments never reached the backend after
    // this): the real Module ids created here used to be thrown away
    // the moment this function returned, so nothing after project
    // creation ever had a real id to PATCH — toggling a checkbox or
    // attaching a file on this project always stayed local-only forever,
    // even though the project itself was a genuine Postgres row. Now the
    // real ids come back so the caller can stamp them onto the local
    // project/modules (see handleAdd/backendModuleIdFor below), and
    // every module's `unlocked` matches what the client actually already
    // sees on the Portal, not a re-derived guess.
    const moduleIdByName = {};
    // FIX (sub-modules never reached the backend): projects.Module now
    // has a real `parent` FK (see projects/models.py), so a "Development"
    // module's Frontend/Backend/... breakdown gets its own real child
    // Module row per sub-task — same status/attachment machinery a
    // top-level module already had, just nested one level. Keyed by
    // "<module name>::<sub name>" so stampBackendIds below can find it.
    const subModuleIdByKey = {};
    for (const m of project.modules || []) {
      try {
        const backendModule = await clientsApi.createModule(backendProject.id, {
          name: m.name,
          status: m.done ? "Completed" : "Pending",
          priority: "Medium",
          unlocked: !!m.unlocked,
        });
        moduleIdByName[m.name] = backendModule.id;
        if (m.subModules && m.subModules.length) {
          for (const s of m.subModules) {
            try {
              const backendSub = await clientsApi.createModule(backendProject.id, {
                name: s.name,
                status: s.done ? "Completed" : "Pending",
                priority: "Medium",
                unlocked: true,
                parent: backendModule.id,
              });
              subModuleIdByKey[`${m.name}::${s.name}`] = backendSub.id;
            } catch {
              // one sub-task failing shouldn't stop the rest
            }
          }
        }
      } catch {
        // one module failing shouldn't stop the rest
      }
    }
    return { projectId: backendProject.id, moduleIdByName, subModuleIdByKey };
  } catch (err) {
    console.error("Could not sync project to the real backend (Client Portal / Projects page won't see it yet):", err);
    return null;
  }
}

// Stamps real backend project/module ids returned by
// syncClientProjectToBackend onto a local project object, so every
// later edit (module tick, unlock, attachment) has somewhere real to
// PATCH/POST to instead of silently staying local-only. Sub-modules
// (e.g. Development's Frontend/Backend/... checklist) now get their own
// real backendId too — projects.Module.parent means a sub-task is just
// another Module row, so it gets the exact same status/unlock/
// ModuleFile machinery every top-level module already had.
function stampBackendIds(project, syncResult) {
  if (!syncResult) return project;
  return {
    ...project,
    backendId: syncResult.projectId,
    modules: (project.modules || []).map((m) => ({
      ...m,
      backendId: syncResult.moduleIdByName[m.name] ?? m.backendId ?? null,
      subModules: (m.subModules || []).map((s) => ({
        ...s,
        backendId: syncResult.subModuleIdByKey?.[`${m.name}::${s.name}`] ?? s.backendId ?? null,
      })),
    })),
  };
}

// A single new module, built the exact same shape makeModules() produces
// — used when a client's "request next module" is accepted and a module
// needs to be appended onto an already-existing project. Starts unlocked
// since it only ever gets created here, as a direct result of an
// accepted request.
function makeSingleModule(name) {
  return { id: `mod-${Date.now()}-${Math.round(Math.random() * 9999)}`, name, done: false, attachments: [], unlocked: true };
}

// A module's own "weight" toward progress: a plain module counts as one
// unit; a module broken into sub-tasks (e.g. Development) counts as many
// units — one per sub-task — so ticking Frontend/Backend individually
// moves the overall % by the right amount instead of jumping straight
// from 0% to 100% for the whole "Development" line.
function moduleUnits(m) {
  if (m.subModules && m.subModules.length) {
    return { total: m.subModules.length, done: m.subModules.filter((s) => s.done).length };
  }
  return { total: 1, done: m.done ? 1 : 0 };
}

function computeProgress(modules) {
  if (!modules || modules.length === 0) return 0;
  let total = 0;
  let done = 0;
  modules.forEach((m) => {
    const u = moduleUnits(m);
    total += u.total;
    done += u.done;
  });
  if (total === 0) return 0;
  return Math.round((done / total) * 100);
}

// Normalizes any project into the { type, modules, progress } shape.
// Projects that already have a modules checklist just get their progress
// recomputed from it (and any "Development" module's own done flag kept
// in sync with its sub-tasks). Older records that only ever had a flat
// `progress` number (e.g. something still sitting in a browser's
// localStorage from before module checklists existed) get a same-length
// checklist synthesized so their existing % isn't lost on next load.
function ensureProjectModules(p) {
  const type = p.type || "Other";
  if (p.modules && p.modules.length) {
    // FIX (locking never showed up on Tasks for already-existing
    // projects): `unlocked` only ever got set going forward — by
    // makeModulesFromNames on brand-new projects and by
    // acceptModuleRequest when a request is accepted. Any project saved
    // before this feature existed (which is every project already
    // sitting in localStorage) has modules with no `unlocked` field at
    // all, and TasksPage.jsx treats that as "unlocked" so nothing
    // already in progress would suddenly and wrongly lock. That's safe,
    // but it also means those older projects never show ANY lock. This
    // backfills the same rule brand-new projects already follow — the
    // first not-yet-done module opens automatically, everything after
    // it waits for a client request — the moment this runs (on load, or
    // right after a "storage"/CLIENTS_DATA_EVENT refresh), so existing
    // projects fall in line instead of staying permanently unlocked.
    let unlockedAssigned = false;
    const modules = p.modules.map((m) => {
      const base =
        m.subModules && m.subModules.length
          ? {
              ...m,
              attachments: m.attachments || [],
              subModules: m.subModules.map((s) => ({ ...s, attachments: s.attachments || [] })),
              done: m.subModules.every((s) => s.done),
            }
          : { ...m, attachments: m.attachments || [] };

      if (base.done) {
        // A completed module doesn't need to "hold" the unlocked slot —
        // whichever module is actually next (done or not) still gets to
        // claim it below.
        return base;
      }
      if (base.unlocked !== undefined) {
        if (base.unlocked) unlockedAssigned = true;
        return base;
      }
      if (!unlockedAssigned) {
        unlockedAssigned = true;
        return { ...base, unlocked: true };
      }
      return { ...base, unlocked: false };
    });
    return { ...p, type, modules, progress: computeProgress(modules) };
  }
  const modules = makeModules(type);
  const doneCount = Math.round(((p.progress ?? 0) / 100) * modules.length);
  modules.forEach((m, i) => (m.done = i < doneCount));
  const firstNotDone = modules.findIndex((m) => !m.done);
  if (firstNotDone >= 0) modules[firstNotDone].unlocked = true;
  return { ...p, type, modules, progress: computeProgress(modules) };
}

const INVOICE_STATUS_STYLES = {
  Paid: "bg-emerald-50 text-emerald-600",
  Partial: "bg-amber-50 text-amber-600",
  Pending: "bg-slate-100 text-slate-500",
  // Client uploaded a payment screenshot from the Client Portal but staff
  // hasn't confirmed it yet — distinct from "Pending" so it's obvious this
  // one needs a look, and distinct from "Paid" since nobody here has
  // actually verified the money landed yet.
  Submitted: "bg-blue-50 text-blue-600",
};

/* ----------------------------------------------------------------------
   4-MILESTONE PAYMENT PLAN
   Every project is billed in 4 installments, tied to real delivery
   events rather than being one lump sum:
     1. Project Assigned    — collected up front, before portal access is handed out
     2. Frontend Delivery   — due once the Frontend module is marked done
     3. Backend Delivery    — due once the Backend module is marked done
     4. Final Deliverable   — due once the finished ZIP is uploaded
   An invoice optionally carries a `milestone` (1-4) and `projectName` so
   the Client Portal knows exactly which milestone it corresponds to, and
   can lock that milestone's deliverable (Frontend/Backend attachments, or
   the final ZIP) until the matching invoice's status is "Paid".
---------------------------------------------------------------------- */
const MILESTONE_LABELS = {
  1: "Milestone 1 · Project Assigned",
  2: "Milestone 2 · Frontend Delivery",
  3: "Milestone 3 · Backend Delivery",
  4: "Milestone 4 · Final Deliverable (ZIP)",
};

// Baseline "total project payment" that milestone invoice amounts are
// calculated from: the client's original, non-milestone invoice (the
// project budget booked when the client/project was added) if there is
// one, otherwise the largest invoice already on file — so milestone math
// always has a sensible total to work from without anyone typing it in
// by hand more than once.
function getProjectTotal(client) {
  const invoices = client?.invoices || [];
  const base = invoices.find((inv) => !inv.milestone);
  if (base) return base.amount;
  // No stand-alone base invoice anymore now that budgeted clients get
  // their 4 milestone invoices auto-generated straight away — reconstruct
  // the original total from whichever milestone invoice is on file,
  // using the same MILESTONE_AMOUNT_FRACTION share it was split with.
  const milestoneInvoice = invoices.find((inv) => inv.milestone && MILESTONE_AMOUNT_FRACTION[inv.milestone]);
  if (milestoneInvoice) {
    return Math.round((milestoneInvoice.amount / MILESTONE_AMOUNT_FRACTION[milestoneInvoice.milestone]) * 100) / 100;
  }
  return invoices.reduce((max, inv) => Math.max(max, inv.amount || 0), 0);
}

// Share of the total project payment billed at each milestone. These add
// up to exactly 1 (100%): Milestone 1 collects 30% up front, Milestones 2
// and 3 each collect half of whatever's left at that point (35%, then
// 17.5%), and Milestone 4 collects whatever remains (17.5%) — so the four
// milestone invoices always add up to the full total payment, and nobody
// has to calculate the split by hand.
const MILESTONE_AMOUNT_FRACTION = { 1: 0.3, 2: 0.35, 3: 0.175, 4: 0.175 };

function calcMilestoneAmount(total, milestone) {
  const frac = MILESTONE_AMOUNT_FRACTION[milestone];
  if (!total || !frac) return null;
  return Math.round(total * frac * 100) / 100;
}

// Whether every milestone before this one is already fully paid — this is
// what gates Record Payment / Confirm Payment on a milestone invoice, so
// the 4 milestones can only ever be cleared in order: Milestone 2 can't
// be recorded as paid before Milestone 1 is "Paid", Milestone 3 can't be
// recorded before Milestone 2 is "Paid", and so on. Milestone 1 (and any
// invoice with no milestone tag) is never gated.
// FIX (custom milestone counts / advance-only plans): a project no
// longer necessarily has an invoice for every single milestone number in
// order (an "advance now, remainder at the end" plan only ever bills
// milestone 1 and the final milestone — the ones in between are just
// progress markers with no invoice at all). Requiring every number 1..N
// to exist and be Paid would permanently lock the final milestone on
// those plans. Instead this only requires whichever EARLIER milestones
// actually got billed to be Paid — any milestone with no invoice at all
// is simply skipped, it was never meant to gate anything.
function priorMilestonesCleared(client, milestone) {
  if (!milestone || milestone <= 1) return true;
  const earlierBilled = (client?.invoices || []).filter((i) => i.milestone && i.milestone < milestone);
  if (earlierBilled.length === 0) return true;
  return earlierBilled.every((inv) => inv.status === "Paid");
}

// Auto-generates the full set of 4 milestone invoices from a project
// budget — used when a client (or a new project) is added with a budget,
// so nobody has to open Billing afterwards and generate each milestone
// invoice by hand one at a time. Every invoice comes out "Pending" with
// paidAmount 0: nothing is ever marked as paid automatically here — a
// milestone only becomes "Paid" once Record Payment is actually used
// against it, same as before. Amounts are split with the same
// MILESTONE_AMOUNT_FRACTION shares (30/35/17.5/17.5) the manual
// Generate Invoice flow already uses, so the four always add up to the
// full budget.
function buildMilestoneInvoices(budget, projectName, startNumber) {
  const issueDate = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return [1, 2, 3, 4].map((milestone, i) => ({
    id: `inv-${Date.now()}-${milestone}`,
    number: `INV-${startNumber + i}`,
    issueDate,
    dueDate: "—",
    amount: calcMilestoneAmount(budget, milestone),
    paidAmount: 0,
    status: "Pending",
    milestone,
    projectName: projectName || undefined,
    note: `${MILESTONE_LABELS[milestone]}${projectName ? ` for "${projectName}"` : ""}`,
  }));
}

/* ----------------------------------------------------------------------
   CUSTOM MILESTONE PLAN (Add Client flow)
   Independent of the fixed 4-milestone scheme above (which the manual
   "Generate Invoice" modal still uses as-is). This is what powers the
   Add Client form: the admin picks how many milestones a project is
   tracked across (2 / 4 / 6 / any custom number 2-10) and how it's
   billed:
     - "full"    → 100% collected up front, right at Milestone 1. The
                   rest of the milestones are just delivery/progress
                   checkpoints with nothing owed against them.
     - "advance" → an advance % (default 30) is collected now at
                   Milestone 1, and the remaining balance is billed at
                   the FINAL milestone once the project wraps up. Every
                   milestone in between is a progress checkpoint only.
     - "custom"  → the admin types their own % for every milestone
                   (must add up to 100) — full control over the split.
   Milestones with a 0% share never get an invoice at all — they're pure
   progress markers, same idea as MILESTONE_LABELS' "Project Assigned"
   already being separate from the money.
---------------------------------------------------------------------- */
const PAYMENT_TYPE_OPTIONS = [
  { value: "advance", label: "Advance / Partial — remaining due at the end" },
  { value: "full", label: "Full payment — collected up front" },
  { value: "custom", label: "Custom split per milestone" },
];

const MILESTONE_COUNT_OPTIONS = [2, 4, 6];
const CUSTOM_MILESTONE_COUNT_VALUE = "__custom_count__";

function clampMilestoneCount(n) {
  return Math.max(2, Math.min(10, Math.round(Number(n) || 4)));
}

function buildMilestonePlanFractions(count, paymentType, { advancePercent, customSplits } = {}) {
  const n = clampMilestoneCount(count);
  if (paymentType === "custom" && Array.isArray(customSplits) && customSplits.length === n) {
    return customSplits.map((p) => Math.max(0, Number(p) || 0) / 100);
  }
  if (paymentType === "full") {
    return Array.from({ length: n }, (_, i) => (i === 0 ? 1 : 0));
  }
  // "advance" (default): advance % now, remainder due at the final milestone
  const adv = Math.min(90, Math.max(5, Number(advancePercent) || 30)) / 100;
  return Array.from({ length: n }, (_, i) => (i === 0 ? adv : i === n - 1 ? Math.round((1 - adv) * 1000) / 1000 : 0));
}

function customMilestoneLabel(milestone, count, moduleNames = []) {
  if (milestone === 1) return "Milestone 1 · Project Started";
  if (milestone === count) return `Milestone ${milestone} · Final Delivery`;
  const name = moduleNames[milestone - 2];
  return `Milestone ${milestone}${name ? ` · ${name}` : ""}`;
}

// Auto-generates only the milestone invoices that actually carry a
// non-zero share of the budget — used by the Add Client flow instead of
// the fixed buildMilestoneInvoices() above. `plan` = { count, paymentType,
// advancePercent, customSplits, moduleNames }.
function buildCustomMilestoneInvoices(budget, projectName, startNumber, plan) {
  const count = clampMilestoneCount(plan?.count);
  const fractions = buildMilestonePlanFractions(count, plan?.paymentType, plan);
  const issueDate = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const invoices = [];
  fractions.forEach((frac, idx) => {
    if (!frac || frac <= 0) return;
    const milestone = idx + 1;
    invoices.push({
      id: `inv-${Date.now()}-${milestone}`,
      number: `INV-${startNumber + invoices.length}`,
      issueDate,
      dueDate: "—",
      amount: Math.round(budget * frac * 100) / 100,
      paidAmount: 0,
      status: "Pending",
      milestone,
      milestoneTotal: count,
      projectName: projectName || undefined,
      note: `${customMilestoneLabel(milestone, count, plan?.moduleNames)}${projectName ? ` for "${projectName}"` : ""}`,
    });
  });
  return invoices;
}

/* ----------------------------------------------------------------------
   STEP 4 (real backend) — INVOICES / BILLING.
   dashboard.Invoice now carries the full document shape too (number,
   dates, bill-to snapshot, line items, PO number, approvals, ...) —
   FIX: this used to send only milestone/amount/note, so the Client
   Portal's real Billing tab (reads straight off dashboard.Invoice, see
   clientPortalApi.js) showed invoices with no number/dates and no
   document to view. This gives each locally-generated invoice a
   matching real Postgres row with everything it has, best-effort, so:
   (a) the Client Portal's Billing tab actually shows a complete
   invoice, and (b) a payment proof the client submits from there can
   be confirmed here.
---------------------------------------------------------------------- */
async function createBackendInvoicesForClient(clientBackendId, localInvoices, projectBackendId = null) {
  if (!clientBackendId || !localInvoices?.length) return [];
  const stamped = [];
  for (const inv of localInvoices) {
    try {
      const created = await clientsApi.createInvoice({
        client: clientBackendId,
        project: projectBackendId || null,
        milestone_number: inv.milestone || 1,
        milestone_total: inv.milestoneTotal || (inv.milestone ? 4 : 1),
        amount: inv.amount,
        note: inv.note || "",
        number: inv.number || "",
        issue_date: inv.issueDate || "",
        due_date: inv.dueDate || "",
        bill_to: inv.billTo || {},
        line_items: Array.isArray(inv.lineItems) && inv.lineItems.length ? inv.lineItems : [{ description: inv.projectName || "", scope: inv.note || "", qty: 1, rate: inv.amount }],
        po_number: inv.poNumber || "",
        payment_method: inv.paymentMethod || "",
        transaction_ref: inv.transactionRef || "",
        amount_received: Number(inv.amountReceived) || 0,
        discount: Number(inv.discount) || 0,
        subtotal: Number.isFinite(inv.subtotal) ? inv.subtotal : inv.amount,
        grand_total: Number.isFinite(inv.grandTotal) ? inv.grandTotal : inv.amount,
        approved_by: inv.approvedBy || "",
        designation: inv.designation || "",
        approval_date: inv.approvalDate || "",
      });
      stamped.push({ localId: inv.id, backendId: created.id });
    } catch {
      // one invoice failing shouldn't stop the rest — it just stays
      // local-only until the next successful sync for this client.
    }
  }
  return stamped;
}

// Patches real backend ids returned by createBackendInvoicesForClient
// back onto the matching local invoices, so a later Record Payment on
// one of them has somewhere real to PATCH/confirm against.
function stampInvoiceBackendIds(invoices, stamped) {
  if (!stamped?.length) return invoices;
  const byLocalId = new Map(stamped.map((s) => [s.localId, s.backendId]));
  return invoices.map((inv) => (byLocalId.has(inv.id) ? { ...inv, backendId: byLocalId.get(inv.id) } : inv));
}

// Whether a client's payment is fully settled — used to decide whether
// the client-facing side (Client Portal, and the "visible to client"
// badge here) is allowed to actually download the final deliverable ZIP.
// `outstanding` is the same running balance the Billing tab already
// treats as the single source of truth for what's still owed.
function isPaymentComplete(client) {
  return (client?.outstanding || 0) <= 0;
}

/* ----------------------------------------------------------------------
   NEEDS-ATTENTION RED DOT (client list)
   A quick, at-a-glance flag on a client's row/card so staff can see —
   without opening every client — that something from them is sitting
   unreviewed: either a pending "start this module" request from the
   Client Portal ("projects"), or a payment screenshot the client has
   submitted that's awaiting confirmation ("billing"). Clears itself
   automatically the moment the request is accepted/declined or the
   payment is confirmed, since neither state exists as "pending" any
   more at that point — no separate seen/unseen tracking needed here.
---------------------------------------------------------------------- */
function hasPendingProjectRequest(client) {
  return (client.moduleRequests || []).some((r) => r.status === "pending");
}
function hasPendingBillingReview(client) {
  return (client.invoices || []).some((inv) => inv.status === "Submitted");
}
function needsAttention(client) {
  return hasPendingProjectRequest(client) || hasPendingBillingReview(client);
}

// Formats a raw byte count (from file.size) into a short human string —
// used on the final-deliverable ZIP card instead of showing a raw number.
function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ----------------------------------------------------------------------
   COUNTRIES — full ISO 3166-1 list (name + 2-letter code) so the flag can
   be derived from the code instead of storing separate flag images.
   Regional-indicator Unicode trick: each letter of the 2-letter code maps
   to a "regional indicator symbol" letter; the OS/browser renders any two
   of those side-by-side as that country's flag automatically.
---------------------------------------------------------------------- */

/* ----------------------------------------------------------------------
   CLIENT ID GENERATOR — short, readable IDs (e.g. CLT-1024) that admins
   can actually read out loud / type into an email, instead of the old
   `c${Date.now()}` values. Retries on the (very unlikely) chance of a
   collision with an existing client.
---------------------------------------------------------------------- */

function genClientId(existingClients = []) {
  const taken = new Set(existingClients.map((c) => c.id));
  let id;
  do {
    const n = Math.floor(1000 + Math.random() * 9000); // 4-digit, 1000-9999
    id = `CLT-${n}`;
  } while (taken.has(id));
  return id;
}

/* ----------------------------------------------------------------------
   DEDUPE CLIENTS — merges any client rows that share the same name +
   same manager into a single row (combined projects, totals, invoices,
   etc). `handleAdd` already prevents *new* duplicates going forward, but
   this repairs rows that were already saved as separate entries in
   localStorage before that fix existed (or from any other stray path),
   so a client whose "2 projects" got split across two rows shows up —
   and gets clicked into — as one row with both projects, on next load.
---------------------------------------------------------------------- */

function dedupeClients(list) {
  const merged = [];
  const indexByKey = new Map();

  list.forEach((c) => {
    const key = `${(c.name || "").trim().toLowerCase()}__${c.manager?.name || ""}`;
    const existingIndex = indexByKey.get(key);

    if (existingIndex === undefined) {
      indexByKey.set(key, merged.length);
      merged.push({ ...c });
      return;
    }

    const base = merged[existingIndex];
    const mergedProjects = [...(base.projects || []), ...(c.projects || [])];
    merged[existingIndex] = {
      ...base,
      projects: mergedProjects,
      activeProjects: mergedProjects.length,
      totalProjects: mergedProjects.length,
      totalSpent: (base.totalSpent || 0) + (c.totalSpent || 0),
      outstanding: (base.outstanding || 0) + (c.outstanding || 0),
      invoices: [...(base.invoices || []), ...(c.invoices || [])],
      documents: [...(base.documents || []), ...(c.documents || [])],
      team: Array.from(new Set([...(base.team || []), ...(c.team || [])])),
      activity: [...(c.activity || []), ...(base.activity || [])],
      // FIX (client's module-start requests vanishing): this merge branch
      // never carried `moduleRequests` over at all — only whichever entry
      // happened to become `base` kept its pending requests, and the
      // other's were silently dropped every time two client records
      // merged (same name + same manager). Since this dedupe runs again
      // on every live refresh (storage/focus/CLIENTS_DATA_EVENT), a
      // request submitted from the Client Portal could be wiped out
      // before it ever reached this page if the client's record happened
      // to collide with another. Now both sides' requests are kept.
      moduleRequests: [...(c.moduleRequests || []), ...(base.moduleRequests || [])],
    };
  });

  return merged;
}

/* ----------------------------------------------------------------------
   COPY BUTTON — small inline "copy to clipboard" control with a brief
   "Copied!" confirmation. Falls back quietly if the Clipboard API isn't
   available (e.g. insecure context) so it never throws in the UI.
---------------------------------------------------------------------- */

function CopyButton({ value, className = "", label = "Copy" }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e) => {
    e.stopPropagation();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — silently no-op, button just won't confirm
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`inline-flex items-center gap-1 text-[11px] font-semibold transition ${className}`}
      title={label}
    >
      {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied!" : label}
    </button>
  );
}

function countryFlagEmoji(code) {
  if (!code || code.length !== 2) return "🏳️";
  const points = code
    .toUpperCase()
    .split("")
    .map((c) => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...points);
}

const COUNTRIES = [
  { name: "Afghanistan", code: "AF" }, { name: "Albania", code: "AL" }, { name: "Algeria", code: "DZ" },
  { name: "Andorra", code: "AD" }, { name: "Angola", code: "AO" }, { name: "Antigua and Barbuda", code: "AG" },
  { name: "Argentina", code: "AR" }, { name: "Armenia", code: "AM" }, { name: "Australia", code: "AU" },
  { name: "Austria", code: "AT" }, { name: "Azerbaijan", code: "AZ" }, { name: "Bahamas", code: "BS" },
  { name: "Bahrain", code: "BH" }, { name: "Bangladesh", code: "BD" }, { name: "Barbados", code: "BB" },
  { name: "Belarus", code: "BY" }, { name: "Belgium", code: "BE" }, { name: "Belize", code: "BZ" },
  { name: "Benin", code: "BJ" }, { name: "Bhutan", code: "BT" }, { name: "Bolivia", code: "BO" },
  { name: "Bosnia and Herzegovina", code: "BA" }, { name: "Botswana", code: "BW" }, { name: "Brazil", code: "BR" },
  { name: "Brunei", code: "BN" }, { name: "Bulgaria", code: "BG" }, { name: "Burkina Faso", code: "BF" },
  { name: "Burundi", code: "BI" }, { name: "Cabo Verde", code: "CV" }, { name: "Cambodia", code: "KH" },
  { name: "Cameroon", code: "CM" }, { name: "Canada", code: "CA" }, { name: "Central African Republic", code: "CF" },
  { name: "Chad", code: "TD" }, { name: "Chile", code: "CL" }, { name: "China", code: "CN" },
  { name: "Colombia", code: "CO" }, { name: "Comoros", code: "KM" }, { name: "Congo (Congo-Brazzaville)", code: "CG" },
  { name: "Congo (DRC)", code: "CD" }, { name: "Costa Rica", code: "CR" }, { name: "Croatia", code: "HR" },
  { name: "Cuba", code: "CU" }, { name: "Cyprus", code: "CY" }, { name: "Czechia", code: "CZ" },
  { name: "Denmark", code: "DK" }, { name: "Djibouti", code: "DJ" }, { name: "Dominica", code: "DM" },
  { name: "Dominican Republic", code: "DO" }, { name: "Ecuador", code: "EC" }, { name: "Egypt", code: "EG" },
  { name: "El Salvador", code: "SV" }, { name: "Equatorial Guinea", code: "GQ" }, { name: "Eritrea", code: "ER" },
  { name: "Estonia", code: "EE" }, { name: "Eswatini", code: "SZ" }, { name: "Ethiopia", code: "ET" },
  { name: "Fiji", code: "FJ" }, { name: "Finland", code: "FI" }, { name: "France", code: "FR" },
  { name: "Gabon", code: "GA" }, { name: "Gambia", code: "GM" }, { name: "Georgia", code: "GE" },
  { name: "Germany", code: "DE" }, { name: "Ghana", code: "GH" }, { name: "Greece", code: "GR" },
  { name: "Grenada", code: "GD" }, { name: "Guatemala", code: "GT" }, { name: "Guinea", code: "GN" },
  { name: "Guinea-Bissau", code: "GW" }, { name: "Guyana", code: "GY" }, { name: "Haiti", code: "HT" },
  { name: "Honduras", code: "HN" }, { name: "Hungary", code: "HU" }, { name: "Iceland", code: "IS" },
  { name: "India", code: "IN" }, { name: "Indonesia", code: "ID" }, { name: "Iran", code: "IR" },
  { name: "Iraq", code: "IQ" }, { name: "Ireland", code: "IE" }, { name: "Israel", code: "IL" },
  { name: "Italy", code: "IT" }, { name: "Jamaica", code: "JM" }, { name: "Japan", code: "JP" },
  { name: "Jordan", code: "JO" }, { name: "Kazakhstan", code: "KZ" }, { name: "Kenya", code: "KE" },
  { name: "Kiribati", code: "KI" }, { name: "Kosovo", code: "XK" }, { name: "Kuwait", code: "KW" },
  { name: "Kyrgyzstan", code: "KG" }, { name: "Laos", code: "LA" }, { name: "Latvia", code: "LV" },
  { name: "Lebanon", code: "LB" }, { name: "Lesotho", code: "LS" }, { name: "Liberia", code: "LR" },
  { name: "Libya", code: "LY" }, { name: "Liechtenstein", code: "LI" }, { name: "Lithuania", code: "LT" },
  { name: "Luxembourg", code: "LU" }, { name: "Madagascar", code: "MG" }, { name: "Malawi", code: "MW" },
  { name: "Malaysia", code: "MY" }, { name: "Maldives", code: "MV" }, { name: "Mali", code: "ML" },
  { name: "Malta", code: "MT" }, { name: "Marshall Islands", code: "MH" }, { name: "Mauritania", code: "MR" },
  { name: "Mauritius", code: "MU" }, { name: "Mexico", code: "MX" }, { name: "Micronesia", code: "FM" },
  { name: "Moldova", code: "MD" }, { name: "Monaco", code: "MC" }, { name: "Mongolia", code: "MN" },
  { name: "Montenegro", code: "ME" }, { name: "Morocco", code: "MA" }, { name: "Mozambique", code: "MZ" },
  { name: "Myanmar", code: "MM" }, { name: "Namibia", code: "NA" }, { name: "Nauru", code: "NR" },
  { name: "Nepal", code: "NP" }, { name: "Netherlands", code: "NL" }, { name: "New Zealand", code: "NZ" },
  { name: "Nicaragua", code: "NI" }, { name: "Niger", code: "NE" }, { name: "Nigeria", code: "NG" },
  { name: "North Korea", code: "KP" }, { name: "North Macedonia", code: "MK" }, { name: "Norway", code: "NO" },
  { name: "Oman", code: "OM" }, { name: "Pakistan", code: "PK" }, { name: "Palau", code: "PW" },
  { name: "Palestine", code: "PS" }, { name: "Panama", code: "PA" }, { name: "Papua New Guinea", code: "PG" },
  { name: "Paraguay", code: "PY" }, { name: "Peru", code: "PE" }, { name: "Philippines", code: "PH" },
  { name: "Poland", code: "PL" }, { name: "Portugal", code: "PT" }, { name: "Qatar", code: "QA" },
  { name: "Romania", code: "RO" }, { name: "Russia", code: "RU" }, { name: "Rwanda", code: "RW" },
  { name: "Saint Kitts and Nevis", code: "KN" }, { name: "Saint Lucia", code: "LC" }, { name: "Saint Vincent and the Grenadines", code: "VC" },
  { name: "Samoa", code: "WS" }, { name: "San Marino", code: "SM" }, { name: "Sao Tome and Principe", code: "ST" },
  { name: "Saudi Arabia", code: "SA" }, { name: "Senegal", code: "SN" }, { name: "Serbia", code: "RS" },
  { name: "Seychelles", code: "SC" }, { name: "Sierra Leone", code: "SL" }, { name: "Singapore", code: "SG" },
  { name: "Slovakia", code: "SK" }, { name: "Slovenia", code: "SI" }, { name: "Solomon Islands", code: "SB" },
  { name: "Somalia", code: "SO" }, { name: "South Africa", code: "ZA" }, { name: "South Korea", code: "KR" },
  { name: "South Sudan", code: "SS" }, { name: "Spain", code: "ES" }, { name: "Sri Lanka", code: "LK" },
  { name: "Sudan", code: "SD" }, { name: "Suriname", code: "SR" }, { name: "Sweden", code: "SE" },
  { name: "Switzerland", code: "CH" }, { name: "Syria", code: "SY" }, { name: "Taiwan", code: "TW" },
  { name: "Tajikistan", code: "TJ" }, { name: "Tanzania", code: "TZ" }, { name: "Thailand", code: "TH" },
  { name: "Timor-Leste", code: "TL" }, { name: "Togo", code: "TG" }, { name: "Tonga", code: "TO" },
  { name: "Trinidad and Tobago", code: "TT" }, { name: "Tunisia", code: "TN" }, { name: "Turkey", code: "TR" },
  { name: "Turkmenistan", code: "TM" }, { name: "Tuvalu", code: "TV" }, { name: "Uganda", code: "UG" },
  { name: "Ukraine", code: "UA" }, { name: "United Arab Emirates", code: "AE" }, { name: "United Kingdom", code: "GB" },
  { name: "United States", code: "US" }, { name: "Uruguay", code: "UY" }, { name: "Uzbekistan", code: "UZ" },
  { name: "Vanuatu", code: "VU" }, { name: "Vatican City", code: "VA" }, { name: "Venezuela", code: "VE" },
  { name: "Vietnam", code: "VN" }, { name: "Yemen", code: "YE" }, { name: "Zambia", code: "ZM" },
  { name: "Zimbabwe", code: "ZW" },
];

const COUNTRY_CODE_BY_NAME = Object.fromEntries(COUNTRIES.map((c) => [c.name, c.code]));

// The Add/Edit Client form's photo picker stores whatever's picked as a
// base64 data: URL in local state (client.profilePic) for an instant
// preview — but the backend's real Client.avatar field needs an actual
// uploaded file, not a data: URL string. This turns one back into a
// File so it can ride along in the same multipart request as the rest
// of the form (see the create/update calls below).
async function dataUrlToFile(dataUrl, filename) {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return new File([blob], filename || "avatar", { type: blob.type || "image/png" });
  } catch (err) {
    console.error("Could not prepare profile photo for upload:", err);
    return null;
  }
}

// Builds whatever should be passed straight into clientsApi.createClient/
// updateClient (which already know how to send either shape — see
// clientsApi.js) — a FormData with a real file attached whenever there's
// a NEW photo to upload (a fresh data: URL — an already-saved client's
// profilePic gets overwritten with the real backend URL after save, see
// below, so this only fires for an actual new pick), otherwise the
// plain fields object unchanged.
async function buildClientPayload(fields, newProfilePicDataUrl) {
  if (!newProfilePicDataUrl || !newProfilePicDataUrl.startsWith("data:")) {
    return fields;
  }
  const file = await dataUrlToFile(newProfilePicDataUrl, "avatar.png");
  if (!file) return fields;

  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => {
    if (value !== null && value !== undefined) form.append(key, value);
  });
  form.append("avatar", file);
  return form;
}

const AVATAR_PALETTE = [
  "bg-indigo-900",
  "bg-blue-600",
  "bg-emerald-600",
  "bg-rose-600",
  "bg-violet-600",
  "bg-amber-600",
  "bg-cyan-600",
  "bg-fuchsia-600",
  "bg-teal-600",
  "bg-orange-600",
];

function personInitials(name) {
  return (name || "?")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function companyCode(name) {
  const words = (name || "?").split(" ").filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (name || "??").slice(0, 2).toUpperCase();
}

function colorFor(str) {
  let hash = 0;
  const s = str || "?";
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

// FEATURE (client profile picture): CompanyAvatar doubles as the
// client's own profile picture slot — pass `imageUrl` (the client's
// stored `profilePic` data URL) and it renders that photo instead of
// the initials tile. No imageUrl just falls back to the same
// colored-initials look as before, so every existing call site keeps
// working untouched.
function CompanyAvatar({ name, size = "w-10 h-10", text = "text-xs", imageUrl }) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name || "Client"}
        className={`${size} rounded-xl object-cover shrink-0 ring-1 ring-black/5`}
      />
    );
  }
  return (
    <div className={`${size} ${colorFor(name)} rounded-xl flex items-center justify-center font-bold text-white shrink-0 ${text}`}>
      {companyCode(name)}
    </div>
  );
}

function PersonAvatar({ name, size = "w-8 h-8", text = "text-[10px]" }) {
  return (
    <div className={`${size} ${colorFor(name)} rounded-full flex items-center justify-center font-bold text-white shrink-0 ${text}`}>
      {personInitials(name)}
    </div>
  );
}

/* ----------------------------------------------------------------------
   PROFILE PICTURE UPLOAD HELPERS — same downscale-then-encode pattern
   ClientPortal.jsx uses for payment screenshots, sized down further
   here since a profile photo only ever needs to look good as a small
   avatar tile. Keeping this compressed is what lets a client's photo
   live safely inside the same localStorage blob as everything else on
   their record without pushing it toward the browser's storage quota.
---------------------------------------------------------------------- */
const MAX_PROFILE_PIC_SOURCE_BYTES = 8 * 1024 * 1024; // 8MB raw upload ceiling, before compression

function loadImageElementForProfilePic(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not process image."));
    img.src = dataUrl;
  });
}

async function compressProfilePicDataUrl(dataUrl, targetBytes = 180 * 1024) {
  let img;
  try {
    img = await loadImageElementForProfilePic(dataUrl);
  } catch {
    return dataUrl;
  }
  const passes = [
    { maxDimension: 480, quality: 0.85 },
    { maxDimension: 380, quality: 0.75 },
    { maxDimension: 300, quality: 0.65 },
    { maxDimension: 220, quality: 0.55 },
    { maxDimension: 160, quality: 0.5 },
  ];
  let smallest = dataUrl;
  for (const { maxDimension, quality } of passes) {
    let width = img.naturalWidth || img.width;
    let height = img.naturalHeight || img.height;
    if (!width || !height) return dataUrl;
    if (width > maxDimension || height > maxDimension) {
      const scale = maxDimension / Math.max(width, height);
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, width, height);
    const candidate = canvas.toDataURL("image/jpeg", quality);
    smallest = candidate;
    if (candidate.length * 0.75 <= targetBytes) return candidate;
  }
  return smallest;
}

function readProfilePicFile(file) {
  return new Promise((resolve, reject) => {
    if (!file.type?.startsWith("image/")) {
      reject(new Error("Please choose an image file."));
      return;
    }
    if (file.size > MAX_PROFILE_PIC_SOURCE_BYTES) {
      reject(new Error("Image is too large (max 8MB)."));
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        resolve(await compressProfilePicDataUrl(reader.result));
      } catch {
        resolve(reader.result);
      }
    };
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.readAsDataURL(file);
  });
}

// Shared upload control used by both Add Client and Edit Client forms —
// shows the current photo (or an empty placeholder), and lets the admin
// pick a new one or remove it. `onChange` receives the compressed data
// URL, or null when removed.
function ProfilePicField({ value, onChange, theme, labelCls }) {
  const inputRef = useRef(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    setLoading(true);
    try {
      const dataUrl = await readProfilePicFile(file);
      onChange(dataUrl);
    } catch (err) {
      setError(err?.message || "Could not load that image.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <label className={labelCls}>Profile picture</label>
      <div className="flex items-center gap-3">
        {value ? (
          <img src={value} alt="Profile preview" className="w-14 h-14 rounded-xl object-cover ring-1 ring-black/5 shrink-0" />
        ) : (
          <div className={`w-14 h-14 rounded-xl flex items-center justify-center shrink-0 border ${theme.border} ${theme.subtleText}`}>
            <ImageIcon className="w-5 h-5" />
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={loading}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-violet-100 text-violet-700 hover:bg-violet-200 disabled:opacity-50"
          >
            {loading ? "Uploading…" : value ? "Change" : "Upload"}
          </button>
          {value && !loading && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border ${theme.border} ${theme.cardText}`}
            >
              Remove
            </button>
          )}
        </div>
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      </div>
      {error && <p className="text-[11px] text-rose-500 mt-1">{error}</p>}
    </div>
  );
}

function fmtMoney(n) {
  return `PKR ${Number(n || 0).toLocaleString()}`;
}

/* ----------------------------------------------------------------------
   PERSISTENCE — same pattern used by EmployeesPage / TasksPage, so
   creating, editing, or deactivating a client survives navigating away
   from this page and coming back, instead of resetting to seed data.
---------------------------------------------------------------------- */

// FIX (no fake clients, without losing real ones): earlier versions of
// this page seeded `clients` with 76 generated demo companies (ids
// "c1".."c76"), which got saved into localStorage the first time the
// page ran. The code itself no longer generates that data, but whatever
// was already saved under this key keeps getting loaded as-is — fake
// rows included, mixed in with any real clients you've actually added
// since (real ones get a "CLT-XXXX" id from genClientId, never "c1"
// style). So on load, strip out only the old fake-shaped ids and leave
// every real client exactly as it was — nothing you added is touched.
const CLIENTS_STORAGE_KEY = "clientspage_clients_v1";

// FIX (accepted module requests not showing up on Tasks/Portal right
// away): the native "storage" event only ever fires in a DIFFERENT
// browser tab than the one that wrote the change — never this one — so
// accepting a module request here never reached TasksPage.jsx or
// ClientPortal.jsx until a manual focus/refresh, even though all three
// live in the same running app. ClientPortal.jsx already dispatches this
// same plain window CustomEvent after every write it makes and listens
// for it too; this page now does the same so a change made in any one of
// the three is picked up by the other two immediately, same-tab or not.
const CLIENTS_DATA_EVENT = "clientsdata:updated";

const LEGACY_SEED_ID_RE = /^c\d+$/;
function stripLegacySeedClients(list) {
  if (!Array.isArray(list)) return list;
  return list.filter((c) => !LEGACY_SEED_ID_RE.test(c?.id));
}

/* ----------------------------------------------------------------------
   CLIENT PORTAL LINK — points at wherever ClientPortal.jsx is mounted.
   Update CLIENT_PORTAL_PATH if the portal lives at a different route.
   The Client ID is passed as a query param purely to pre-fill the
   login form; the client still has to enter their email, so sharing
   this link alone doesn't let anyone else log in.
---------------------------------------------------------------------- */

const CLIENT_PORTAL_PATH = "/client-portal";

function portalLinkFor(client) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${CLIENT_PORTAL_PATH}?id=${encodeURIComponent(client.id)}`;
}

/* ----------------------------------------------------------------------
   WHATSAPP SHARE LINK — opens WhatsApp (web or app) with the client's
   own Portal link pre-filled in a message, addressed to the client's
   saved phone number when we have one. Uses the wa.me deep link so it
   works the same on desktop and mobile without any extra dependency.
---------------------------------------------------------------------- */

function whatsappLinkFor(client) {
  const digits = (client.phone || "").replace(/[^\d]/g, "");
  const message = `Hi ${client.contactPerson || client.name}, here is your Client Portal link: ${portalLinkFor(client)}`;
  const base = digits ? `https://wa.me/${digits}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(message)}`;
}

/** Same wa.me pattern as whatsappLinkFor() above, but for one specific
 * invoice — addressed to the client's saved phone number when we have
 * one, message includes the invoice number/amount/due date plus their
 * Portal link (where the same invoice document is visible, since it
 * lives on the same client.invoices array). */
function whatsappLinkForInvoice(client, invoice) {
  const digits = (client.phone || "").replace(/[^\d]/g, "");
  const balance = Math.max(0, (invoice.amount || 0) - (invoice.paidAmount || 0));
  const message =
    `Hi ${client.contactPerson || client.name}, invoice ${invoice.number} for ${fmtMoney(invoice.amount)} ` +
    `(${balance > 0 ? `${fmtMoney(balance)} due` : "paid in full"}) is ready — view it on your Client Portal: ${portalLinkFor(client)}`;
  const base = digits ? `https://wa.me/${digits}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(message)}`;
}

/* ----------------------------------------------------------------------
   CLIENT INTAKE REQUESTS — a public, no-login "New Project Request" form
   (ClientIntakeForm.jsx) a prospect fills in themselves: project details,
   requirements, timeline, budget, and a screenshot proving the 30%
   advance was paid. Submissions land here as "Pending" until an admin
   opens the Requests panel and either Approves (which turns the
   submission into a real client + Client Portal login, the exact same
   way Add Client does) or Rejects it.

   STEP 7 (real backend): this used to live in its own localStorage
   key/array, completely separate from `clients` — meaning a request
   submitted on one browser/device was invisible everywhere else. The
   real dashboard.IntakeRequest model + /api/dashboard/intake-requests/
   endpoints (list/reject, see clientsApi.js) already existed for this;
   the page just never called them. Reading now pulls the real pending
   queue from Postgres (see refreshIntakeFromBackend below), so any
   admin, on any device, sees the same list. Rejecting calls the real
   /reject/ action. Approving still goes through this page's own richer
   Add Client flow (lets admin pick modules/manager/milestone plan first,
   see startApproveIntakeRequest) rather than the backend's own one-shot
   /approve/ action, which would auto-create a second, less-configured
   client — once that flow finishes, the now-redundant backend row is
   best-effort deleted (see finishApprovalIfAny) so it doesn't linger as
   "pending" forever.
---------------------------------------------------------------------- */

// Same-app route ClientIntakeForm.jsx is mounted at — keep this in sync
// with wherever that component is actually rendered.
const CLIENT_INTAKE_FORM_PATH = "/client-request";

function intakeFormLink() {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${CLIENT_INTAKE_FORM_PATH}`;
}

// Generic WhatsApp share — no phone number baked in, since this link
// isn't addressed to any one existing client yet. Opens WhatsApp with
// the message pre-typed so the admin just picks who to send it to.
function intakeFormWhatsappLink() {
  const message = `Hi! Please fill out this quick project request form to get started — takes about 2 minutes: ${intakeFormLink()}`;
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

// Real backend row (dashboard.IntakeRequest, snake_case) -> the flat
// camelCase shape IntakeRequestsModal / initialDataFromIntakeRequest /
// handleAdd already expect. `paymentScreenshot` is now a real uploaded
// file URL instead of a base64 data: URL — renders the same either way
// in an <img src>.
function backendIntakeToLocal(bi) {
  return {
    id: bi.id,
    backendId: bi.id,
    companyName: bi.company_name || "",
    contactPerson: bi.contact_person || "",
    email: bi.email || "",
    phone: bi.phone || "",
    city: bi.city || "",
    projectName: bi.project_name || "",
    projectType: bi.project_type || "",
    budget: bi.budget ? Number(bi.budget) : null,
    requirements: bi.requirements || "",
    paymentScreenshot: bi.payment_proof || null,
    submittedAt: bi.created_at,
    status: bi.status,
  };
}

// Pre-fills the Add Client modal from a submitted intake request, so
// admin lands on the exact same modules/milestones/budget UI used for a
// manual Add Client instead of a client being created silently behind
// the scenes. Only fields the intake form actually collects are filled
// in — Industry, Date of Birth, and Manager are left for admin to pick,
// same as any other new client.
function initialDataFromIntakeRequest(req) {
  if (!req) return null;
  const knownType = PROJECT_TYPE_OPTIONS.includes(req.projectType);
  return {
    name: req.companyName || req.contactPerson || "",
    contactPerson: req.contactPerson || "",
    email: req.email || "",
    phone: req.phone || "",
    address: req.city || "",
    country: "Pakistan",
    projectName: req.projectName || "",
    projectType: knownType ? req.projectType : CUSTOM_PROJECT_TYPE_VALUE,
    customProjectType: knownType ? "" : req.projectType || "",
    projectBudget: req.budget ? String(req.budget) : "",
    projectDetails: req.requirements || "",
  };
}

function loadClientsFromStorage(fallback) {
  try {
    const raw = localStorage.getItem(CLIENTS_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    const cleaned = Array.isArray(parsed) ? stripLegacySeedClients(parsed) : parsed;
    return Array.isArray(cleaned) && cleaned.length ? cleaned : fallback;
  } catch {
    return fallback;
  }
}

function saveClientsToStorage(clients) {
  try {
    localStorage.setItem(CLIENTS_STORAGE_KEY, JSON.stringify(clients));
  } catch {
    // storage unavailable (e.g. private browsing) — state still works in-memory for this session
  }
}

/* ----------------------------------------------------------------------
   BACKEND -> LOCAL SHAPE — this page used to only ever WRITE to the real
   Client rows (create/update/delete) and never actually READ the list
   back from Postgres; `clients` state was seeded from localStorage only,
   so a second browser/device (or this same browser after clearing
   storage) never saw the real backend data at all, and two admins working
   at the same time could each be looking at a different "truth". This is
   what actually makes the page real-backend-driven: on load (and on
   refresh below) we now pull GET /dashboard/clients/ and treat it as the
   source of truth for every field the backend owns.

   Backend Steps 3/4/7 (Projects/Modules, Invoices, ModuleRequests, Intake
   Requests — see clientsApi.js) aren't wired up yet, so `projects`,
   `invoices`, `moduleRequests`, `documents` and `activity` still only
   exist in this browser's local cache for now — mergeBackendClients below
   keeps that local-only data attached to the right client (by real
   backend id) instead of wiping it out every time we refresh from the
   server.
---------------------------------------------------------------------- */
function backendStatusToLocal(status) {
  return status === "inactive" ? "Inactive" : "Active";
}

function backendClientToLocal(bc, assignableTeam = []) {
  const managerRole = bc.manager_name
    ? assignableTeam.find((m) => m.name === bc.manager_name)?.role || "Team Member"
    : null;
  return {
    id: bc.id,
    backendSynced: true,
    name: bc.name || "",
    industry: bc.industry || "",
    contactPerson: bc.contact_person || "",
    // FIX: the birthday is now stored on the backend (Client.date_of_birth)
    // so the Client Portal can show the birthday celebration.
    dateOfBirth: bc.date_of_birth || "",
    email: bc.email || "",
    phone: bc.phone || "—",
    address: bc.address || "—",
    notes: bc.notes || "",
    country: bc.country || "Pakistan",
    country_code: bc.country_code || "",
    status: backendStatusToLocal(bc.status),
    // A freshly-uploaded `avatar` wins over a plain pasted `avatar_url`
    // link, same preference the model/serializer comment describes.
    profilePic: bc.avatar || bc.avatar_url || null,
    manager: bc.manager_name ? { name: bc.manager_name, role: managerRole } : null,
    has_portal_access: !!bc.has_portal_access,
    portalEmail: bc.portal_email || "",
    totalSpent: Number(bc.total_spent) || 0,
    outstanding: Number(bc.outstanding) || 0,
    since: bc.created_at
      ? new Date(bc.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
      : "",
  };
}

// FIX (moduleBackendId was always null for existing projects): mergeBackendClients
// used only local.projects and discarded bc.projects entirely, so the real
// Postgres pk was never stamped onto local module objects. Local modules were
// created with browser-local Date.now() ids ("mod-1-..."), not real pks, so
// moduleLeaves() returned moduleBackendId:null → Task.module was never set →
// upload_zip/upload_file_attachment never created ModuleFile rows →
// ClientPortal attachments were always empty.
//
// This helper walks the backend projects/modules, matches them to the existing
// local objects BY NAME (the only reliable shared key), and stamps the real
// backend pk as `.backendId` on each match. It never removes local data, never
// creates duplicates — purely a one-way ID stamp, identical in intent to
// stampBackendIds() which does the same thing after a project is first created.
// Merges a module's local attachments with the backend's authoritative
// list (see _module_attachments on the backend — every real upload,
// whether it came from this page or from TasksPage.jsx, ends up in this
// same list). Backend entries win by id (fresher approval/URL state);
// any local-only entry with no matching backend id is kept as-is so a
// legacy/offline attachment that hasn't synced yet isn't dropped.
function mergeModuleAttachments(localAttachments, backendAttachments) {
  const backend = backendAttachments || [];
  if (!backend.length) return localAttachments || [];
  const backendIds = new Set(backend.map((a) => String(a.id)));
  // A module has exactly ONE link on the backend (Module.url, id "link-<pk>").
  // A link pasted locally before it synced has a different local id, so
  // without this it showed up twice once the backend copy arrived — and the
  // local copy had no approval checkbox.
  const backendHasLink = backend.some((a) => a.type === "link");
  const localOnly = (localAttachments || []).filter(
    (a) => !backendIds.has(String(a.id)) && !(backendHasLink && a.type === "link")
  );
  return [...backend, ...localOnly];
}

// A link pasted on the Clients page is stored on the real Module's `url`
// (one per module), so once the module has a backend row, give the local copy
// that same "link-<pk>" id + un-approved state right away — that's what makes
// its "Approved / Show on Portal" checkbox appear without waiting for a
// refetch.
function withBackendLinkId(attachment, moduleBackendId) {
  if (attachment?.type !== "link" || !moduleBackendId) return attachment;
  return { ...attachment, id: `link-${moduleBackendId}`, approved: false };
}

// Appends an attachment to a module's list; a backend-keyed link REPLACES the
// module's previous link (the backend can only hold one).
function appendAttachment(list, attachment) {
  const current = list || [];
  if (attachment?.type === "link" && String(attachment.id).startsWith("link-")) {
    return [...current.filter((a) => a.type !== "link"), attachment];
  }
  return [...current, attachment];
}

function stampBackendProjectIds(localProjects, backendProjects) {
  if (!backendProjects || !backendProjects.length) return localProjects;
  // Index backend projects by lower-cased name for O(1) lookup.
  const bpByName = new Map(
    backendProjects.map((bp) => [String(bp.name || "").trim().toLowerCase(), bp])
  );
  return localProjects.map((lp) => {
    const bp = bpByName.get(String(lp.name || "").trim().toLowerCase());
    if (!bp) return ensureProjectModules(lp); // no backend match — keep as-is

    // Index backend modules by lower-cased name.
    const bmByName = new Map(
      (bp.modules || []).map((bm) => [String(bm.name || "").trim().toLowerCase(), bm])
    );

    const patchedModules = (lp.modules || []).map((lm) => {
      const bm = bmByName.get(String(lm.name || "").trim().toLowerCase());
      if (!bm) return lm; // no backend match for this module — keep as-is

      // Stamp sub-modules too (e.g. Development → Frontend/Backend/...),
      // AND pull each sub-module's real completion + attachments the
      // same way as its parent below.
      const bsmByName = new Map(
        (bm.subModules || []).map((bs) => [String(bs.name || "").trim().toLowerCase(), bs])
      );
      const patchedSubs = (lm.subModules || []).map((ls) => {
        const bs = bsmByName.get(String(ls.name || "").trim().toLowerCase());
        if (!bs) return ls;
        return {
          ...ls,
          backendId: bs.id,
          done: bs.status === "Completed",
          attachments: mergeModuleAttachments(ls.attachments, bs.attachments),
        };
      });
      // A parent with sub-modules is only "done" once every sub-module
      // is — matches the same rule toggleProjectModule already applies
      // locally (see its m.subModules.every((s) => s.done) check).
      const parentDone = patchedSubs.length ? patchedSubs.every((s) => s.done) : bm.status === "Completed";

      return {
        ...lm,
        backendId: bm.id,         // real projects.Module.pk
        done: parentDone,
        attachments: mergeModuleAttachments(lm.attachments, bm.attachments),
        subModules: patchedSubs,
      };
    });

    return ensureProjectModules({
      ...lp,
      backendId: bp.id,           // real projects.Project.pk
      modules: patchedModules,
      // FIX: the final deliverable zip lives on the backend
      // (Project.completed_zip) — whether it was uploaded from this page
      // or from the Tasks page — but it was never read back here, so it
      // only ever showed in the tab that uploaded it.
      deliverableZip: bp.deliverableZip || lp.deliverableZip || null,
    });
  });
}

// Real Postgres rows are authoritative for identity/profile/status/money
// fields; anything the backend doesn't own yet (projects, invoices,
// module requests, documents, activity feed — still local-only pending
// Steps 3/4/7) is carried over from whatever this browser already had
// cached for that same client id, so refreshing from the server never
// throws away work in progress. A client_synced:false row (created while
// the server was unreachable) has no real backend id yet, so it's kept
// as-is rather than dropped.
function mergeBackendClients(backendList, localList, assignableTeam) {
  const localById = new Map(localList.map((c) => [String(c.id), c]));
  const seenIds = new Set();

  const merged = backendList.map((bc) => {
    seenIds.add(String(bc.id));
    const local = localById.get(String(bc.id)) || {};
    const patch = backendClientToLocal(bc, assignableTeam);
    return {
      ...local,
      ...patch,
      // Older client whose DOB only exists in this browser's cache: keep it.
      dateOfBirth: patch.dateOfBirth || local.dateOfBirth || "",
      // FIX: stamp real backend project/module pks onto the local objects
      // so moduleLeaves() → moduleBackendId flows into task creation.
      projects: stampBackendProjectIds(local.projects || [], bc.projects || []),
      invoices: local.invoices || [],
      documents: local.documents || [],
      activity: local.activity || [],
      moduleRequests: local.moduleRequests || [],
      team: local.team || (patch.manager ? [patch.manager.name] : []),
      activeProjects: (local.projects || []).length,
      totalProjects: (local.projects || []).length,
      workComplete: local.workComplete || false,
    };
  });

  // Anything local that never reached the server (backendSynced === false)
  // stays visible so it isn't silently lost — everything else that's
  // missing from the fresh backend list has genuinely been deleted
  // server-side (by this admin or another) and should disappear here too.
  const localOnly = localList.filter((c) => c.backendSynced === false && !seenIds.has(String(c.id)));

  return [...merged, ...localOnly];
}


/* ----------------------------------------------------------------------
   MODULE ATTACHMENTS — uploading straight from a project's checklist
   (image, video, zip file, or a link) instead of only from the Tasks
   page. Mirrors the same helpers TasksPage.jsx uses for its own
   Attachments section, so a file picked here is tagged and stored
   exactly the same way everywhere it's displayed (Clients page, Task
   Details sidebar, Client Portal).
---------------------------------------------------------------------- */
const ATTACHMENT_ACCEPT =
  "image/*,video/*,.zip,.rar,.7z,.cdr,.ai,.psd,.eps,.pdf,application/zip,application/x-zip-compressed,application/x-7z-compressed,application/x-rar-compressed";

function detectAttachmentKind(file) {
  const name = (file.name || "").toLowerCase();
  if (file.type?.startsWith("image/")) return "image";
  if (file.type?.startsWith("video/")) return "video";
  if (
    file.type === "application/zip" ||
    file.type === "application/x-zip-compressed" ||
    file.type === "application/x-7z-compressed" ||
    file.type === "application/x-rar-compressed" ||
    /\.(zip|rar|7z)$/.test(name)
  ) {
    return "zip";
  }
  return "file";
}

// BUG FIX (Section 9 — ZIP files above ~5MB failing): this used to
// base64-encode the WHOLE file with FileReader.readAsDataURL and hard-
// reject anything over 5MB before the real upload was even attempted —
// so a large zip never reached uploadModuleFile()/the backend at all,
// even though the backend itself has no such limit (see
// projects/views.py ModuleFileViewSet, streamed straight to disk).
// The local `url` here is only ever used for an immediate on-screen
// preview until the real backend ModuleFile row comes back from
// addModuleAttachment's uploadModuleFile() call and replaces it — an
// object URL does that instantly, for a file of any size, without
// reading/encoding the bytes at all. (No IndexedDB round-trip needed
// here either, unlike attachmentStorage.js's localStorage-quota problem
// — this preview lives only in this tab's memory for this session.)
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    try {
      resolve(URL.createObjectURL(file));
    } catch (e) {
      reject(new Error("Could not read file."));
    }
  });
}

function genAttachmentId() {
  return `att-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

/* ----------------------------------------------------------------------
   CLIENT ASSIGNED -> MESSAGES (instant)

   FIX (client add/assign hone par manager/employee ko Messages page par
   msg nahi ja raha tha): the assignment message used to be sent ONLY by
   TasksPage.jsx's sync (runClientAssignmentSync / runClientModuleSync),
   and that sync only runs while the Tasks page is actually open. So
   adding a client here and then looking at Messages showed nothing until
   someone happened to visit Tasks. The message now goes out right here,
   the moment the assignment is saved, through the same real endpoint the
   Messages composer uses (POST /api/messages/send/ via messagesApi.js).

   To stop TasksPage from sending a second, identical message later, the
   same "already notified" key TasksPage itself uses
   (taskspage_notified_auto_keys_v1 -> `client::<id>::<name>`) is
   recorded here too.
---------------------------------------------------------------------- */
const NOTIFIED_AUTO_KEYS_STORAGE = FLAG_KEYS.taskAutoNotified; // synced per user via /api/flags/

function markClientAssignmentNotified(clientId, managerName) {
  try {
    const raw = localStorage.getItem(NOTIFIED_AUTO_KEYS_STORAGE);
    const arr = raw ? JSON.parse(raw) : [];
    const set = new Set(Array.isArray(arr) ? arr : []);
    set.add(`client::${clientId}::${(managerName || "").trim().toLowerCase()}`);
    localStorage.setItem(NOTIFIED_AUTO_KEYS_STORAGE, JSON.stringify(Array.from(set).slice(-400)));
    syncFlag(NOTIFIED_AUTO_KEYS_STORAGE);
  } catch {
    /* storage unavailable — worst case TasksPage sends its own copy */
  }
}

async function sendClientAssignmentMessage({ managerUser, senderId, clientId, clientName, projectName }) {
  if (!managerUser?.id || managerUser.id === senderId) return;
  const text =
    `👤 New client assigned: "${clientName}"` +
    (projectName ? ` — Project: ${projectName}` : "") +
    `\nPlease review the scope and kick off onboarding.`;
  try {
    await apiSendMessage({ recipientId: managerUser.id, text });
    markClientAssignmentNotified(clientId, managerUser.name);
  } catch (err) {
    console.error("Could not send client-assignment message:", err);
  }
}

// Kept in sync with TasksPage.jsx's own key format — this is what lets
// an attachment uploaded here find and update the exact same generated
// module task over on the Tasks page.
const TASKS_STORAGE_KEY = "taskspage_tasks_v1";

function moduleTaskKey(clientId, projectName, moduleId, subModuleId) {
  return `${clientId}::${projectName}::${moduleId}::${subModuleId || ""}`;
}

// Writes a module attachment straight into the matching task's own
// `attachments` array over in `taskspage_tasks_v1` — the reverse of what
// TasksPage.jsx's syncModuleStatusToClientsStorage does — so a file
// uploaded from the Clients page checklist shows up on the Tasks page
// too, without either page needing to be open at the same time.
function syncModuleAttachmentToTasksStorage(clientId, projectName, moduleId, subModuleId, attachment) {
  try {
    const raw = localStorage.getItem(TASKS_STORAGE_KEY);
    if (!raw) return;
    const tasks = JSON.parse(raw);
    if (!Array.isArray(tasks)) return;
    const key = moduleTaskKey(clientId, projectName, moduleId, subModuleId);
    let touched = false;
    const next = tasks.map((t) => {
      if (t.moduleTaskKey !== key) return t;
      touched = true;
      return { ...t, attachments: [...(t.attachments || []), attachment] };
    });
    if (touched) localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable — best-effort sync only, the module attachment
    // itself is already saved on the client record regardless
  }
}

/* ----------------------------------------------------------------------
   SEED DATA — the 8 clients shown in the reference design, then padded
   out to 76 total (matching the "Total Clients" stat) with generated
   companies so pagination has real pages to click through.
---------------------------------------------------------------------- */

const SEED_CLIENTS_BASE = [
  {
    id: "c1",
    name: "Tech Solutions Inc.",
    industry: "Technology",
    contactPerson: "Ahmed Khan",
    contactTitle: "CTO",
    email: "ahmed@techsolutions.com",
    phone: "+92 300 1234567",
    activeProjects: 3,
    manager: { name: "Ali Raza", role: "Project Manager" },
    lastActivityDate: "May 20, 2025",
    lastActivityAgo: "2 hours ago",
    status: "Active",
    workComplete: false,
    since: "Jan 15, 2024",
    address: "123, Tech Street, Lahore, Punjab, Pakistan",
    totalProjects: 3,
    totalSpent: 85450,
    outstanding: 12300,
    projects: [
      { name: "E-Commerce Website", progress: 67 },
      { name: "Mobile Banking App", progress: 75 },
      { name: "CRM System Integration", progress: 90 },
    ],
    team: ["Ali Raza", "Usman Ali", "Sara Khan", "Hina Fatima", "Zain Ali", "Ayesha Noor"],
    documents: [
      { name: "Service_Agreement.pdf", size: "1.4 MB", date: "Jan 15, 2024" },
      { name: "Project_Scope.docx", size: "0.8 MB", date: "Feb 2, 2024" },
    ],
    activity: [
      { text: 'Project "E-Commerce Website" updated', time: "2 hours ago" },
      { text: "New payment of $10,000 received", time: "1 day ago" },
      { text: 'Project "Mobile Banking App" completed milestone', time: "3 days ago" },
      { text: "Contract renewed for another year", time: "2 weeks ago" },
    ],
  },
  {
    id: "c2",
    name: "FinBank",
    industry: "Banking",
    contactPerson: "Fatima Ali",
    contactTitle: "Head of Operations",
    email: "fatima.ali@finbank.com",
    phone: "+92 301 9876543",
    activeProjects: 2,
    manager: { name: "Usman Ali", role: "Team Lead" },
    lastActivityDate: "May 18, 2025",
    lastActivityAgo: "1 day ago",
    status: "Active",
    workComplete: false,
    since: "Mar 2, 2024",
    address: "45, Finance Avenue, Karachi, Sindh, Pakistan",
    totalProjects: 4,
    totalSpent: 62300,
    outstanding: 4200,
    projects: [
      { name: "Internal Dashboard Revamp", progress: 40 },
      { name: "Payment Gateway Upgrade", progress: 82 },
    ],
    team: ["Usman Ali", "Zain Ali", "Ayesha Noor"],
    documents: [{ name: "NDA_FinBank.pdf", size: "0.6 MB", date: "Mar 2, 2024" }],
    activity: [
      { text: "Invoice #2291 marked as paid", time: "1 day ago" },
      { text: 'Project "Payment Gateway Upgrade" updated', time: "4 days ago" },
    ],
  },
  {
    id: "c3",
    name: "Mega Retail Ltd.",
    industry: "Retail",
    contactPerson: "Bilal Mehmood",
    contactTitle: "Director",
    email: "bilal@megaretail.com",
    phone: "+92 302 5556677",
    activeProjects: 4,
    manager: { name: "Sara Khan", role: "Project Manager" },
    lastActivityDate: "May 17, 2025",
    lastActivityAgo: "2 days ago",
    status: "Active",
    workComplete: false,
    since: "Nov 10, 2023",
    address: "78, Market Road, Faisalabad, Punjab, Pakistan",
    totalProjects: 6,
    totalSpent: 118900,
    outstanding: 21000,
    projects: [
      { name: "POS System Rollout", progress: 55 },
      { name: "Inventory Dashboard", progress: 70 },
      { name: "Loyalty Program App", progress: 30 },
      { name: "Store Analytics Portal", progress: 88 },
    ],
    team: ["Sara Khan", "Ali Raza", "Hina Fatima"],
    documents: [{ name: "Rollout_Plan.pdf", size: "2.1 MB", date: "Nov 20, 2023" }],
    activity: [
      { text: 'Project "Store Analytics Portal" nearing completion', time: "2 days ago" },
      { text: "New payment of $18,000 received", time: "1 week ago" },
    ],
  },
  {
    id: "c4",
    name: "HealthGuard Clinics",
    industry: "Healthcare",
    contactPerson: "Dr. Ali Hassan",
    contactTitle: "CEO",
    email: "info@healthguard.com",
    phone: "+92 303 7654321",
    activeProjects: 1,
    manager: { name: "Hina Fatima", role: "Project Manager" },
    lastActivityDate: "May 15, 2025",
    lastActivityAgo: "4 days ago",
    status: "Active",
    workComplete: true,
    since: "Jun 5, 2024",
    address: "12, Clinic Road, Islamabad, Pakistan",
    totalProjects: 1,
    totalSpent: 24500,
    outstanding: 0,
    projects: [
      {
        name: "Patient Portal",
        type: "Website",
        modules: [
          { id: "mod-0", name: "UI/UX Design", done: true },
          { id: "mod-1", name: "Frontend", done: true },
          { id: "mod-2", name: "Backend", done: true },
          { id: "mod-3", name: "Database", done: false },
          { id: "mod-4", name: "Deployment", done: false },
        ],
      },
    ],
    team: ["Hina Fatima", "Zain Ali"],
    documents: [],
    activity: [{ text: 'Project "Patient Portal" updated', time: "4 days ago" }],
  },
  {
    id: "c5",
    name: "EduPrime Academy",
    industry: "Education",
    contactPerson: "Usman Tariq",
    contactTitle: "Principal",
    email: "contact@eduprime.edu.pk",
    phone: "+92 304 1122334",
    activeProjects: 2,
    manager: { name: "Zain Ali", role: "Team Lead" },
    lastActivityDate: "May 12, 2025",
    lastActivityAgo: "1 week ago",
    status: "Inactive",
    workComplete: false,
    since: "Aug 18, 2023",
    address: "9, School Lane, Multan, Punjab, Pakistan",
    totalProjects: 3,
    totalSpent: 31200,
    outstanding: 6800,
    projects: [
      {
        name: "Student Portal",
        type: "Website",
        modules: PROJECT_TYPES.Website.map((name, i) => ({ id: `mod-${i}`, name, done: true })),
      },
      {
        name: "Fee Management System",
        type: "Website",
        modules: [
          { id: "mod-0", name: "UI/UX Design", done: true },
          { id: "mod-1", name: "Frontend", done: false },
          { id: "mod-2", name: "Backend", done: false },
          { id: "mod-3", name: "Database", done: false },
          { id: "mod-4", name: "Deployment", done: false },
        ],
      },
    ],
    team: ["Zain Ali", "Ayesha Noor"],
    documents: [],
    activity: [{ text: "Contract paused by client", time: "1 week ago" }],
  },
  {
    id: "c6",
    name: "BlueLine Logistics",
    industry: "Logistics",
    contactPerson: "Rashid Ahmed",
    contactTitle: "Operations Head",
    email: "rashid@blueline.com",
    phone: "+92 305 7788990",
    activeProjects: 3,
    manager: { name: "Ali Raza", role: "Project Manager" },
    lastActivityDate: "May 11, 2025",
    lastActivityAgo: "1 week ago",
    status: "Active",
    workComplete: false,
    since: "Feb 22, 2024",
    address: "56, Cargo Street, Sialkot, Punjab, Pakistan",
    totalProjects: 3,
    totalSpent: 47800,
    outstanding: 9100,
    projects: [
      {
        name: "Fleet Tracking System",
        type: "Custom Software",
        modules: [
          { id: "mod-0", name: "Requirement Analysis", done: true },
          { id: "mod-1", name: "Backend", done: true },
          { id: "mod-2", name: "Frontend", done: false },
          { id: "mod-3", name: "Database", done: false },
          { id: "mod-4", name: "Testing", done: false },
          { id: "mod-5", name: "Deployment", done: false },
        ],
      },
      {
        name: "Driver Mobile App",
        type: "Mobile App",
        modules: [
          { id: "mod-0", name: "UI/UX Design", done: true },
          { id: "mod-1", name: "Frontend", done: true },
          { id: "mod-2", name: "Backend", done: true },
          { id: "mod-3", name: "API Integration", done: true },
          { id: "mod-4", name: "Testing", done: false },
          { id: "mod-5", name: "Deployment", done: false },
        ],
      },
      {
        name: "Warehouse Dashboard",
        type: "Website",
        modules: [
          { id: "mod-0", name: "UI/UX Design", done: true },
          { id: "mod-1", name: "Frontend", done: false },
          { id: "mod-2", name: "Backend", done: false },
          { id: "mod-3", name: "Database", done: false },
          { id: "mod-4", name: "Deployment", done: false },
        ],
      },
    ],
    team: ["Ali Raza", "Usman Ali"],
    documents: [],
    activity: [{ text: 'Project "Driver Mobile App" updated', time: "1 week ago" }],
  },
  {
    id: "c7",
    name: "Digital Media House",
    industry: "Marketing",
    contactPerson: "Mariam Saleem",
    contactTitle: "Marketing Director",
    email: "mariam@dmh.com",
    phone: "+92 306 9988776",
    activeProjects: 1,
    manager: { name: "Ayesha Noor", role: "Team Lead" },
    lastActivityDate: "May 9, 2025",
    lastActivityAgo: "1 week ago",
    status: "Active",
    workComplete: false,
    since: "Sep 1, 2024",
    address: "3, Media Plaza, Lahore, Punjab, Pakistan",
    totalProjects: 2,
    totalSpent: 15600,
    outstanding: 2500,
    projects: [
      {
        name: "Campaign Landing Pages",
        type: "Website",
        modules: [
          { id: "mod-0", name: "UI/UX Design", done: true },
          { id: "mod-1", name: "Frontend", done: true },
          { id: "mod-2", name: "Backend", done: true },
          { id: "mod-3", name: "Database", done: true },
          { id: "mod-4", name: "Deployment", done: false },
        ],
      },
      {
        name: "Marketing Automation Tool",
        type: "Custom Analytics Dashboard",
        details: "In-house tool to track campaign spend and lead-gen across channels.",
        modules: [
          { id: "mod-0", name: "Planning", done: true },
          {
            id: "mod-1",
            name: "Development",
            done: false,
            subModules: [
              { id: "mod-1-sub-0", name: "Frontend", done: true },
              { id: "mod-1-sub-1", name: "Backend", done: true },
              { id: "mod-1-sub-2", name: "Database", done: false },
              { id: "mod-1-sub-3", name: "API Integration", done: false },
            ],
          },
          { id: "mod-2", name: "Testing", done: false },
          { id: "mod-3", name: "Deployment", done: false },
        ],
      },
    ],
    team: ["Ayesha Noor"],
    documents: [],
    activity: [{ text: "New payment of $3,200 received", time: "1 week ago" }],
  },
  {
    id: "c8",
    name: "Alpha Construction",
    industry: "Construction",
    contactPerson: "Kashif Malik",
    contactTitle: "Project Director",
    email: "kashif@alphaconst.com",
    phone: "+92 307 3344556",
    activeProjects: 2,
    manager: { name: "Usman Ali", role: "Team Lead" },
    lastActivityDate: "May 7, 2025",
    lastActivityAgo: "2 weeks ago",
    status: "Inactive",
    workComplete: false,
    since: "Dec 12, 2023",
    address: "21, Builder's Road, Rawalpindi, Pakistan",
    totalProjects: 2,
    totalSpent: 39400,
    outstanding: 11200,
    projects: [
      {
        name: "Site Management Tool",
        type: "Custom Software",
        modules: [
          { id: "mod-0", name: "Requirement Analysis", done: true },
          { id: "mod-1", name: "Backend", done: true },
          { id: "mod-2", name: "Frontend", done: false },
          { id: "mod-3", name: "Database", done: false },
          { id: "mod-4", name: "Testing", done: false },
          { id: "mod-5", name: "Deployment", done: false },
        ],
      },
      {
        name: "Client Portal",
        type: "Website",
        modules: [
          { id: "mod-0", name: "UI/UX Design", done: true },
          { id: "mod-1", name: "Frontend", done: false },
          { id: "mod-2", name: "Backend", done: false },
          { id: "mod-3", name: "Database", done: false },
          { id: "mod-4", name: "Deployment", done: false },
        ],
      },
    ],
    team: ["Usman Ali", "Zain Ali"],
    documents: [],
    activity: [{ text: "Follow-up call scheduled", time: "2 weeks ago" }],
  },
];

const COMPANY_PREFIXES = ["Tech", "Prime", "Alpha", "Bright", "Blue", "Green", "Metro", "Global", "Elite", "Swift", "Nova", "Peak", "Silver", "Golden", "Unity", "Vertex", "Horizon", "Crown", "Falcon", "Summit"];
const COMPANY_SUFFIXES = ["Solutions", "Traders", "Industries", "Enterprises", "Group", "Systems", "Corp", "Networks", "Holdings", "Ventures", "Logistics", "Textiles", "Foods", "Motors", "Realty", "Consulting", "Labs", "Works", "Partners", "Studio"];
const FIRST_NAMES = ["Ali", "Sara", "Usman", "Hina", "Zain", "Ayesha", "Hassan", "Fatima", "Bilal", "Mariam", "Hamza", "Nida", "Danish", "Zeeshan", "Amna", "Kamran", "Sana", "Talha", "Rabia", "Owais"];
const LAST_NAMES = ["Raza", "Khan", "Ali", "Fatima", "Noor", "Ahmed", "Iqbal", "Shahid", "Malik", "Aziz", "Shah", "Saboor", "Yousaf", "Baig", "Chaudhry", "Farooq"];
const CONTACT_TITLES = ["CEO", "CTO", "Director", "Head of Operations", "Marketing Director", "Project Director", "Principal", "Operations Head", "Founder", "General Manager"];
const CITIES = ["Lahore", "Karachi", "Islamabad", "Faisalabad", "Sialkot", "Multan", "Rawalpindi", "Peshawar"];

function buildSeedClients() {
  const clients = [...SEED_CLIENTS_BASE];
  let i = clients.length;
  while (clients.length < 76) {
    const name = `${COMPANY_PREFIXES[i % COMPANY_PREFIXES.length]} ${COMPANY_SUFFIXES[(i * 3) % COMPANY_SUFFIXES.length]}`;
    const industry = INDUSTRIES[i % INDUSTRIES.length];
    const first = FIRST_NAMES[i % FIRST_NAMES.length];
    const last = LAST_NAMES[(i * 2) % LAST_NAMES.length];
    const contactPerson = `${first} ${last}`;
    const manager = MANAGERS[i % MANAGERS.length];
    const activeProjects = 1 + (i % 4);
    const statusRoll = i % 6;
    const status = statusRoll === 0 ? "Inactive" : "Active";
    const month = ((i * 3) % 12) + 1;
    const day = ((i * 7) % 27) + 1;
    const genType = PROJECT_TYPE_OPTIONS[i % PROJECT_TYPE_OPTIONS.length];
    const genModules = makeModules(genType);
    // Flatten to leaf tasks (sub-tasks of "Development" count individually)
    // so the random completion % lines up with how progress is computed.
    const genLeaves = [];
    genModules.forEach((m) => (m.subModules && m.subModules.length ? genLeaves.push(...m.subModules) : genLeaves.push(m)));
    const targetPct = 20 + (i % 70);
    const doneCount = Math.round((targetPct / 100) * genLeaves.length);
    genLeaves.forEach((leaf, idx) => (leaf.done = idx < doneCount));
    genModules.forEach((m) => {
      if (m.subModules && m.subModules.length) m.done = m.subModules.every((s) => s.done);
    });
    clients.push({
      id: `c${i + 1}`,
      name,
      industry,
      contactPerson,
      contactTitle: CONTACT_TITLES[i % CONTACT_TITLES.length],
      email: `${first.toLowerCase()}.${last.toLowerCase()}@${name.split(" ")[0].toLowerCase()}.com`,
      phone: `+92 3${String(10 + (i % 40)).padStart(2, "0")} ${1000000 + i * 191}`,
      activeProjects,
      manager,
      lastActivityDate: `2025-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      lastActivityAgo: `${1 + (i % 4)} week${(i % 4) === 0 ? "" : "s"} ago`,
      status,
      workComplete: i % 7 === 0,
      since: `2024-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      address: `${CITIES[i % CITIES.length]}, Pakistan`,
      totalProjects: activeProjects + (i % 3),
      totalSpent: 8000 + ((i * 3737) % 60000),
      outstanding: (i * 271) % 15000,
      projects: [{ name: "Ongoing Engagement", type: genType, modules: genModules }],
      team: [manager.name],
      documents: [],
      activity: [{ text: "Account created", time: "a while ago" }],
    });
    i++;
  }
  return clients;
}

const SEED_CLIENTS = buildSeedClients();

/* ======================================================================
   SMALL UI PIECES
====================================================================== */

function StatCard({ icon: Icon, iconBg, iconText, label, value, delta, up, wide, emphasize, onEdit, onClick, active, theme }) {
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      title={onClick ? `View ${label.toLowerCase()}` : undefined}
      className={`rounded-2xl relative ${theme.card} ${wide ? "sm:col-span-2" : ""} ${emphasize ? "p-5" : "p-4"} ${
        onClick
          ? `cursor-pointer transition hover:shadow-md hover:-translate-y-0.5 ${active ? "ring-2 ring-violet-400" : ""}`
          : ""
      }`}
    >
      {onEdit && (
        <button onClick={onEdit} className={`absolute top-3 right-3 w-7 h-7 rounded-lg flex items-center justify-center ${theme.subtleText} hover:${theme.hoverIconBg} hover:text-violet-600`}>
          <Pencil className="w-3.5 h-3.5" />
        </button>
      )}
      <div className="flex items-center gap-2.5">
        <span className={`${emphasize ? "w-11 h-11" : "w-10 h-10"} rounded-xl flex items-center justify-center shrink-0 ${iconBg} ${iconText}`}>
          <Icon className={emphasize ? "w-5 h-5" : "w-4.5 h-4.5"} />
        </span>
        <div className="min-w-0">
          <p className={`text-xs truncate ${theme.mutedText}`}>{label}</p>
          <p className={`${emphasize ? "text-2xl" : "text-xl"} font-extrabold leading-tight break-words ${theme.headingText}`}>{value}</p>
        </div>
      </div>
      {delta && (
        <p className="text-[11px] font-semibold mt-2.5 text-emerald-600">
          {up ? "↑" : "↓"} {delta} <span className={`font-normal ${theme.subtleText}`}>vs last month</span>
        </p>
      )}
    </div>
  );
}

function IndustryText({ industry, theme }) {
  return <p className={`text-[11px] truncate ${theme.subtleText}`}>{industry}</p>;
}

function StatusBadge({ status }) {
  return <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap ${STATUS_STYLES[status] || "bg-slate-100 text-slate-500"}`}>{status}</span>;
}

function InvoiceStatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap ${INVOICE_STATUS_STYLES[status] || "bg-slate-100 text-slate-500"}`}>
      {status}
    </span>
  );
}

function CountrySelect({ value, onChange, inputCls, labelCls }) {
  return (
    <div>
      <label className={labelCls}>Country</label>
      <select value={value} onChange={onChange} className={inputCls}>
        <option value="">Select country</option>
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.name}>
            {countryFlagEmoji(c.code)} {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function WorkCompleteBadge({ complete }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap ${
        complete ? "bg-violet-50 text-violet-600" : "bg-slate-100 text-slate-400"
      }`}
    >
      {complete ? <CheckCircle2 className="w-3 h-3" /> : <Circle className="w-3 h-3" />}
      {complete ? "Complete" : "In progress"}
    </span>
  );
}

function ProjectCheckbox({ checked, onToggle, theme }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      title={checked ? "Mark module as pending" : "Mark module as done"}
      className={`w-5 h-5 rounded-md flex items-center justify-center border shrink-0 transition ${
        checked ? "bg-violet-600 border-violet-600 text-white" : `${theme.card} ${theme.border} text-transparent hover:border-violet-300`
      }`}
    >
      <Check className="w-3.5 h-3.5" />
    </button>
  );
}

// NEW — what a click on an attachment does. Nothing opens or downloads on the
// first click any more: it opens the review popup (AttachmentPreviewModal) so
// the file/URL can be looked at and approved first. Only once it IS approved
// does a click on a URL or a zip/file go straight to its real action — the
// URL opens in a new tab, the zip/file downloads. Images and videos always
// use the popup (that is how they're viewed).
function isDirectActionAttachment(a) {
  return a?.approved === true && (a.type === "link" || a.type === "zip" || a.type === "file");
}

// Text for the button/tooltip that matches what the next click will do.
function attachmentClickLabel(a) {
  if (isDirectActionAttachment(a)) return a.type === "link" ? "Open ↗" : "Download";
  return "Preview";
}

// The real open / download. Links open in a new tab, images/videos too;
// zips and other files are downloaded.
function runAttachmentAction(a) {
  if (!a?.url) return;
  if (a.type === "link") {
    const url = /^[a-z][a-z0-9+.-]*:/i.test(a.url) ? a.url : `https://${a.url}`;
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  if (a.type === "image" || a.type === "video") {
    window.open(a.url, "_blank", "noopener,noreferrer");
    return;
  }
  const el = document.createElement("a");
  el.href = a.url;
  el.download = a.name || "";
  el.target = "_blank"; // a cross-origin file ignores `download` — never navigate the app away
  el.rel = "noopener noreferrer";
  document.body.appendChild(el);
  el.click();
  document.body.removeChild(el);
}

// Compact row of "chips" for whatever was uploaded against a module/
// sub-task from the Tasks page (screenshot, video, zip or a link) — this is
// the same `attachments` array the client portal renders in full, shown
// here so the admin can see at a glance what's been submitted without
// leaving the Clients page. Clicking a chip goes through `onOpen` (see
// isDirectActionAttachment above) instead of opening/downloading straight away.
function AttachmentChips({ attachments = [], theme, onOpen }) {
  if (!attachments.length) return null;
  const chipClass = `inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-1 rounded-lg border ${theme.border} ${theme.inputBg} ${theme.subtleText} hover:text-violet-600`;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5 ml-7">
      {attachments.map((a) => {
        const inner = (
          <>
            {a.type === "image" ? (
              <ImageIcon className="w-3 h-3 shrink-0" />
            ) : a.type === "video" ? (
              <Video className="w-3 h-3 shrink-0" />
            ) : a.type === "zip" ? (
              <Archive className="w-3 h-3 shrink-0" />
            ) : a.type === "link" ? (
              <Link2 className="w-3 h-3 shrink-0" />
            ) : (
              <FileIcon className="w-3 h-3 shrink-0" />
            )}
            <span className="max-w-[110px] truncate">{a.name || (a.type === "link" ? "Link" : a.type)}</span>
            {a.approved === false && (
              <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-amber-500" title="Pending review — not visible on the Client Portal yet" />
            )}
          </>
        );
        return onOpen ? (
          <button
            key={a.id}
            type="button"
            onClick={() => onOpen(a)}
            title={isDirectActionAttachment(a) ? `${attachmentClickLabel(a)} — ${a.name || a.type}` : `Preview & approve — ${a.name || a.type}`}
            className={chipClass}
          >
            {inner}
          </button>
        ) : (
          <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" title={a.name || a.type} className={chipClass}>
            {inner}
          </a>
        );
      })}
    </div>
  );
}

function ProgressBar({ value, theme }) {
  return (
    <div className="flex items-center gap-2 flex-1">
      <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${theme.inputBg}`}>
        <div className="h-full rounded-full bg-gradient-to-r from-violet-600 to-indigo-500 transition-all duration-500" style={{ width: `${value}%` }} />
      </div>
      <span className={`text-[10.5px] font-semibold w-8 text-right shrink-0 ${theme.mutedText}`}>{value}%</span>
    </div>
  );
}

/* ======================================================================
   MAIN PAGE
====================================================================== */

export default function ClientsPage({ darkMode = false }) {
  const [dark, setDark] = useState(darkMode);
  useEffect(() => setDark(darkMode), [darkMode]);

  const { approvedUsers, user: authUser } = useAuth();

  // Real, approved team members a client can be assigned to — every
  // approved manager AND developer (anyone who isn't an admin or a
  // client themselves), same rule the Tasks page's own `assignableUsers`
  // uses. This used to only include managers; now a developer can be
  // assigned directly too, since the Tasks page auto-generates one task
  // per project module for whoever ends up assigned here.
  // FIX (no fake employees): this used to fall back to the hardcoded
  // demo MANAGERS list whenever nobody real had been approved yet, which
  // meant made-up names could be picked and assigned to real clients.
  // Only actual registered (approved, non-admin, non-client) users are
  // ever offered now — if nobody's approved yet, the list is simply
  // empty and the Add/Edit Client form already shows a clear "no
  // approved managers or developers yet" message instead of fake names.
  const assignableTeam = useMemo(() => {
    return (approvedUsers || [])
      .filter((u) => u.role !== "admin" && u.role !== "client")
      .map((u) => ({ name: u.name, role: u.role || "Team Member" }));
  }, [approvedUsers]);
  // Back-compat alias — kept so any code below that still refers to the
  // old name keeps working exactly the same.
  const assignableManagers = assignableTeam;

  const theme = {
    card: dark ? "bg-slate-900 border border-slate-800" : "bg-white border border-slate-200",
    headingText: dark ? "text-white" : "text-slate-900",
    cardText: dark ? "text-slate-200" : "text-slate-800",
    mutedText: dark ? "text-slate-400" : "text-slate-500",
    subtleText: dark ? "text-slate-500" : "text-slate-400",
    border: dark ? "border-slate-800" : "border-slate-200",
    borderLight: dark ? "border-slate-800" : "border-slate-100",
    divide: dark ? "divide-slate-800" : "divide-slate-100",
    inputBg: dark ? "bg-slate-800" : "bg-slate-50",
    hoverRow: dark ? "hover:bg-slate-800/60" : "hover:bg-slate-50",
    hoverIconBg: dark ? "bg-slate-800" : "bg-slate-50",
  };

  const [clients, setClients] = useState(() =>
    dedupeClients(loadClientsFromStorage([])).map((c) => ({
      ...c,
      country: c.country || "Pakistan",
      invoices: c.invoices || [],
      projects: (c.projects || []).map(ensureProjectModules),
    }))
  );
  const [activeTab, setActiveTab] = useState("all"); // all | active | inactive | industry
  const [statusFilter, setStatusFilter] = useState("All Status");
  const [industryFilter, setIndustryFilter] = useState("All Industries");
  const [managerFilter, setManagerFilter] = useState("All Managers");
  const [completeFilter, setCompleteFilter] = useState("All Work");
  // Set when a top stat card is clicked, for the two metrics ("New Clients",
  // "Clients with Active Projects") that don't map onto an existing filter
  // dropdown. null | "newest" | "withProjects"
  const [quickFilter, setQuickFilter] = useState(null);
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(8);
  const [openActionMenu, setOpenActionMenu] = useState(null);
  // Screen position (fixed-position coords) for the 3-dot row menu below.
  // Needed because the menu now renders in a portal (see fix below for why),
  // so it can no longer rely on being positioned relative to its row.
  const [actionMenuPos, setActionMenuPos] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  // Controls the "Client Pending Payment" breakdown modal opened from
  // its stat card below — not tied to any one client, so it's separate
  // from editingClientId/payingInvoiceId above.
  const [pendingPaymentOpen, setPendingPaymentOpen] = useState(false);
  // Bell icon at the top of the page — dropdown of every client's still-
  // pending billing submission (payment screenshot awaiting confirmation)
  // and module-start request, so admin doesn't have to open each client
  // to notice one came in. See `notifications` useMemo below.
  const [notifOpen, setNotifOpen] = useState(false);
  const [newClientInfo, setNewClientInfo] = useState(null); // { id, name, email, password?, portalError? } — shown after Add Client succeeds
  // Client Portal login isn't usable until a real users.User row
  // (role="client") is linked as client.portal_user on the backend —
  // that only happens via clientsApi.generatePortalAccess (auto-run on
  // Add Client, or manually via the button in the client details panel).
  const [generatingPortalId, setGeneratingPortalId] = useState(null); // client id currently generating, or null
  const [portalCredentials, setPortalCredentials] = useState(null); // { name, clientId, username, password } — shown once
  // Pending "New Project Request" submissions from the public client
  // intake form (ClientIntakeForm.jsx) — separate from `clients` until an
  // admin explicitly Approves one from the Requests panel below.
  const [intakeRequests, setIntakeRequests] = useState([]);
  const [requestsPanelOpen, setRequestsPanelOpen] = useState(false);
  const [viewingRequestId, setViewingRequestId] = useState(null);
  // Which pending request (if any) the currently-open Add Client modal is
  // finishing the approval for — null means it's a plain, manual Add
  // Client. Set by startApproveIntakeRequest, read/cleared by handleAdd.
  const [approvingRequestId, setApprovingRequestId] = useState(null);
  const [editingClientId, setEditingClientId] = useState(null);
  // Which project (by clientId + projectName) the Edit Project modal
  // below is currently open for — null means closed. Projects are still
  // keyed by name everywhere else in this file (see toggleProjectModule),
  // so this follows the same convention instead of introducing a new id.
  const [editingProject, setEditingProject] = useState(null);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [payingInvoiceId, setPayingInvoiceId] = useState(null);
  // NOTE: this used to default to the first seed client, which meant the
  // details panel was always populated. On mobile that panel stacks below
  // the entire list in normal document flow, so the page loaded looking
  // "broken" (a big details block sitting under everything). Defaulting to
  // nothing selected keeps desktop's placeholder state (already handled
  // below) and means mobile only opens the details sheet when a client is
  // actually tapped.
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [detailsTab, setDetailsTab] = useState("Overview");
  const [toasts, setToasts] = useState([]);
  const filtersRef = useRef(null);
  const notifRef = useRef(null);
  const tableRef = useRef(null);
  // Guards against the CLIENTS_DATA_EVENT feedback loop below: without
  // this, "clients changed -> dispatch event" and "event fired ->
  // setClients" kept re-triggering each other forever (same-tab sync
  // update re-counted as a fresh local change), which crashed the page
  // with "Maximum update depth exceeded" and stopped Client Portal
  // requests from ever showing up here.
  const syncingFromEventRef = useRef(false);
  // FIX (Add Client sometimes created the same project twice under one
  // client): handleAdd is a multi-step async function (create client ->
  // upload avatar -> generate portal access -> sync project to backend),
  // and the Add Client button had no "already submitting" guard — a
  // slightly slow response plus an impatient double-click (or a stray
  // double-fire of the click event) ran handleAdd a second time before
  // the first call's setClients had even landed. By the time that second
  // call re-evaluated `existingClient`, the first call's client already
  // existed in state, so the second call took the "add another project to
  // an existing client" branch and merged in an identical duplicate
  // project. This ref blocks any re-entrant call while one is in flight.
  const isAddingClientRef = useRef(false);
  // Mirrors isAddingClientRef into render-visible state purely so the Add
  // Client button itself can show "Saving..." and go disabled — the ref
  // above is what actually blocks the duplicate call, this is just UI.
  const [savingClient, setSavingClient] = useState(false);

  useEffect(() => {
    saveClientsToStorage(clients);
    // See CLIENTS_DATA_EVENT above — lets TasksPage.jsx and
    // ClientPortal.jsx (same tab, same running app) pick up a change
    // like an accepted module request the instant it happens, instead
    // of waiting on a focus/blur or a different-tab "storage" event.
    // Skip the dispatch when this update itself just came FROM that
    // same event (see refreshFromStorage below) — otherwise every
    // sync-triggered setClients re-fires the event, which triggers
    // another sync, forever.
    if (syncingFromEventRef.current) {
      syncingFromEventRef.current = false;
      return;
    }
    window.dispatchEvent(new Event(CLIENTS_DATA_EVENT));
  }, [clients]);

  // Mirrors the same pattern ClientPortal.jsx already uses: if the Tasks
  // page (open in another tab, or reachable without a full unmount in
  // this app's layout) writes a module's completion/attachment straight
  // into `clientspage_clients_v1`, this page's own `clients` state would
  // otherwise keep showing the stale copy it loaded at mount until a
  // manual refresh. Re-reading on focus/storage keeps it in sync with
  // Tasks the same way Tasks now stays in sync with this page.
  useEffect(() => {
    const refreshFromStorage = () => {
      syncingFromEventRef.current = true;
      setClients((prev) => {
        const fresh = dedupeClients(loadClientsFromStorage(prev)).map((c) => ({
          ...c,
          country: c.country || "Pakistan",
          invoices: c.invoices || [],
          projects: (c.projects || []).map(ensureProjectModules),
        }));

        // FIX (client request / payment came in, but admin had to go dig
        // through every client to notice): a module request submitted from
        // the Client Portal, or a payment screenshot submitted against an
        // invoice, used to only ever show up quietly inside that one
        // client's Projects/Billing tab — nothing told admin it had
        // arrived unless they happened to open that exact client. `prev`
        // (state as of the last time this ran) and `fresh` (what just got
        // loaded) are only ever both available right here, so this is
        // where a genuinely NEW pending request / NEW submitted payment
        // can be told apart from one admin already knows about — and
        // surfaced as an immediate on-page message instead.
        const prevPendingRequestIds = new Set(
          prev.flatMap((c) => (c.moduleRequests || []).filter((r) => r.status === "pending").map((r) => r.id))
        );
        const prevSubmittedInvoiceIds = new Set(
          prev.flatMap((c) => (c.invoices || []).filter((i) => i.status === "Submitted").map((i) => i.id))
        );

        fresh.forEach((c) => {
          (c.moduleRequests || []).forEach((r) => {
            if (r.status === "pending" && !prevPendingRequestIds.has(r.id)) {
              showToast(`New request from ${c.name}: "${r.moduleName}" for "${r.projectName}" — accept it below.`, "success");
            }
          });
          (c.invoices || []).forEach((inv) => {
            if (inv.status === "Submitted" && !prevSubmittedInvoiceIds.has(inv.id)) {
              showToast(`Payment received from ${c.name} — check Billing to confirm.`, "success");
            }
          });
        });

        return fresh;
      });
    };
    const onStorage = (e) => {
      if (e.key === CLIENTS_STORAGE_KEY) refreshFromStorage();
    };
    window.addEventListener("focus", refreshFromStorage);
    window.addEventListener("storage", onStorage);
    // Same-tab counterpart to the "storage" listener above — see
    // CLIENTS_DATA_EVENT: catches a module task completed/uploaded from
    // TasksPage.jsx without needing a tab switch first.
    window.addEventListener(CLIENTS_DATA_EVENT, refreshFromStorage);
    return () => {
      window.removeEventListener("focus", refreshFromStorage);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CLIENTS_DATA_EVENT, refreshFromStorage);
    };
  }, []);

  // BUG FIX — this page used to never call clientsApi.listClients() at
  // all, so it only ever showed whatever this one browser had cached in
  // localStorage. That's the actual gap in "client page 100% connected
  // to the backend": a client added/edited/deleted from another browser,
  // another admin, or after this browser's storage was cleared, never
  // showed up here. This pulls the real Client rows from Postgres on
  // load and again whenever the tab regains focus, and merges them with
  // whatever local-only data (projects/invoices/etc, see
  // mergeBackendClients above) this browser already had for each one.
  const [backendLoadError, setBackendLoadError] = useState(null);
  const backendFetchInFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const refreshFromBackend = async ({ silent = false } = {}) => {
      if (backendFetchInFlight.current) return;
      backendFetchInFlight.current = true;
      try {
        const backendClients = await clientsApi.listClients();
        if (cancelled || !Array.isArray(backendClients)) return;
        setClients((prev) => {
          const next = dedupeClients(mergeBackendClients(backendClients, prev, assignableTeam));
          // Nothing new from the server -> keep the exact same state so
          // the frequent poll above doesn't re-render / re-broadcast.
          try {
            if (JSON.stringify(next) === JSON.stringify(prev)) return prev;
          } catch {
            /* fall through and apply */
          }
          return next;
        });
        setBackendLoadError(null);
      } catch (err) {
        if (cancelled) return;
        setBackendLoadError(err.message);
        if (!silent) {
          showToast(`Couldn't load clients from the server (${err.message}) — showing cached data.`, "error");
        }
      } finally {
        backendFetchInFlight.current = false;
      }
    };

    refreshFromBackend();
    const onFocusRefresh = () => refreshFromBackend({ silent: true });
    window.addEventListener("focus", onFocusRefresh);
    // FIX (employee Tasks page se URL/file upload karta hai to yahan late
    // dikhta tha): the employee's upload goes to the backend from THEIR
    // browser, and this page only ever re-read the backend on mount /
    // window focus — so an admin already sitting on this page saw nothing
    // until they refocused or reloaded. A short poll (only while the tab
    // is visible; skipped if a fetch is already running) makes it show up
    // within a few seconds. refreshFromBackend below returns the SAME
    // state when nothing changed, so an idle poll re-renders nothing.
    const pollId = setInterval(() => {
      if (document.visibilityState === "visible") refreshFromBackend({ silent: true });
    }, 4000);
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshFromBackend({ silent: true });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(pollId);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocusRefresh);
    };
    // Intentionally only depends on mount — assignableTeam is read fresh
    // off the ref-stable clientsApi module each call, and re-running this
    // every time assignableTeam changes would refetch on every unrelated
    // render; manager role enrichment is a nice-to-have, not required for
    // correctness (name still comes straight from the backend).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // STEP 7 (real backend): pulls the real pending queue from Postgres —
  // GET /dashboard/intake-requests/?status=pending — on load, on an
  // interval, and whenever the tab regains focus, same polling shape as
  // `refreshModuleRequestsFromBackend` below. A submission from
  // ClientIntakeForm.jsx now reaches every admin on every device, not
  // just other tabs of the same browser.
  const prevPendingIntakeIdsRef = useRef(new Set());
  const intakeFetchInFlight = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const refreshIntakeFromBackend = async ({ silent = false } = {}) => {
      if (intakeFetchInFlight.current) return;
      intakeFetchInFlight.current = true;
      try {
        const backendRequests = await clientsApi.listIntakeRequests("pending");
        if (cancelled || !Array.isArray(backendRequests)) return;
        // FIX: only ever show genuinely pending requests — a rejected /
        // approved one must not come back on the next poll.
        const fresh = backendRequests.map(backendIntakeToLocal).filter((r) => !r.status || r.status === "pending");
        const freshIds = new Set(fresh.map((r) => r.id));
        const isNew = [...freshIds].some((id) => !prevPendingIntakeIdsRef.current.has(id));
        if (isNew && prevPendingIntakeIdsRef.current.size > 0) {
          showToast("New project request received — check Requests.", "success");
        }
        prevPendingIntakeIdsRef.current = freshIds;
        setIntakeRequests(fresh);
      } catch (err) {
        if (!cancelled && !silent) {
          showToast(`Couldn't load project requests from the server (${err.message}).`, "error");
        }
      } finally {
        intakeFetchInFlight.current = false;
      }
    };
    refreshIntakeFromBackend();
    const intervalId = setInterval(() => refreshIntakeFromBackend({ silent: true }), 20000);
    const onFocus = () => refreshIntakeFromBackend({ silent: true });
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showToast = (message, tone = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  };

  useEffect(() => setPage(1), [activeTab, statusFilter, industryFilter, managerFilter, completeFilter, quickFilter, search, rowsPerPage]);

  useEffect(() => {
    function onClickOutside(e) {
      if (filtersRef.current && !filtersRef.current.contains(e.target)) setFiltersOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const counts = useMemo(() => {
    const active = clients.filter((c) => c.status === "Active").length;
    const withActiveProjects = clients.filter((c) => c.activeProjects > 0).length;
    // "Total Client Revenue" = total contracted business value: money
    // already collected (totalSpent) plus money still owed (outstanding).
    // This is what makes it move the moment a client is added with a
    // project budget, instead of staying at 0 until an invoice is paid —
    // recordInvoicePayment just shifts an amount from outstanding into
    // totalSpent, so the sum (and this total) doesn't double-count it.
    const totalRevenue = clients.reduce((sum, c) => sum + (c.totalSpent || 0) + (c.outstanding || 0), 0);
    const completedWork = clients.filter((c) => c.workComplete).length;
    // How many clients still owe money — the count shown on the new
    // "Client Pending Payment" stat card below (its click-through modal
    // lists each one by name with exactly how much they still owe).
    const pendingPaymentClients = clients.filter((c) => (c.outstanding || 0) > 0).length;
    return {
      total: clients.length,
      active,
      newClients: Math.min(8, clients.length),
      withActiveProjects,
      totalRevenue,
      completedWork,
      pendingPaymentClients,
    };
  }, [clients]);

  // Feeds the bell icon at the top of the page — every client's still-
  // pending "start this module" request and every payment screenshot
  // that's been submitted but not yet confirmed, flattened into one list.
  // Reuses the exact same "pending" checks as the row/card red-dot
  // (hasPendingProjectRequest / hasPendingBillingReview) so both stay in
  // sync automatically; nothing new is tracked here.
  const notifications = useMemo(() => {
    const items = [];
    clients.forEach((c) => {
      (c.moduleRequests || []).forEach((r) => {
        if (r.status === "pending") {
          items.push({
            id: `req-${r.id}`,
            clientId: c.id,
            type: "request",
            text: `${c.name} requested to start "${r.moduleName}" for "${r.projectName}"`,
            time: r.requestedAt,
          });
        }
      });
      (c.invoices || []).forEach((inv) => {
        if (inv.status === "Submitted") {
          items.push({
            id: `bill-${inv.id}`,
            clientId: c.id,
            type: "billing",
            text: `${c.name} submitted a payment for ${inv.number} (${fmtMoney(inv.amount)})`,
            time: inv.paymentProof?.submittedAt,
          });
        }
      });
    });
    return items;
  }, [clients]);

  // Live total of every client's collected + outstanding amounts — updates
  // automatically the moment a client/project is added with a budget, when
  // an invoice is generated, or when a payment is recorded. No manual entry.
  const displayedRevenue = counts.totalRevenue;

  const managerOptions = useMemo(() => Array.from(new Set(clients.map((c) => c.manager?.name).filter(Boolean))).sort(), [clients]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter((c) => {
      const matchesTab =
        activeTab === "all" ||
        (activeTab === "active" && c.status === "Active") ||
        (activeTab === "inactive" && c.status === "Inactive");
      const matchesSearch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.contactPerson.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q);
      const matchesStatus = statusFilter === "All Status" || c.status === statusFilter;
      const matchesIndustry = industryFilter === "All Industries" || c.industry === industryFilter;
      const matchesManager = managerFilter === "All Managers" || c.manager?.name === managerFilter;
      const matchesComplete =
        completeFilter === "All Work" ||
        (completeFilter === "Completed" && c.workComplete) ||
        (completeFilter === "In progress" && !c.workComplete);
      const matchesQuick =
        !quickFilter ||
        (quickFilter === "newest" && clients.indexOf(c) < counts.newClients) ||
        (quickFilter === "withProjects" && c.activeProjects > 0);
      return matchesTab && matchesSearch && matchesStatus && matchesIndustry && matchesManager && matchesComplete && matchesQuick;
    });
  }, [clients, activeTab, search, statusFilter, industryFilter, managerFilter, completeFilter, quickFilter, counts.newClients]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const pageStart = (page - 1) * rowsPerPage;
  const paged = filtered.slice(pageStart, pageStart + rowsPerPage);

  const selectedClient = clients.find((c) => c.id === selectedClientId) || null;

  const setClientStatus = (id, status) => {
    const target = clients.find((c) => c.id === id);
    setClients((list) => list.map((c) => (c.id === id ? { ...c, status } : c)));
    setOpenActionMenu(null);
    if (target?.backendSynced) {
      clientsApi
        .updateClient(id, { status: status.toLowerCase() })
        .catch((err) => showToast(`Server sync failed: ${err.message}`, "error"));
    }
  };

  const toggleWorkComplete = (id) => {
    let nextState = false;
    let clientName = "";
    setClients((list) =>
      list.map((c) => {
        if (c.id !== id) return c;
        nextState = !c.workComplete;
        clientName = c.name;
        return { ...c, workComplete: nextState };
      })
    );
    setOpenActionMenu(null);
    showToast(`${clientName || "Client"} marked as ${nextState ? "work complete" : "in progress"}.`, nextState ? "success" : "error");
  };

  const removeClient = (id) => {
    const c = clients.find((x) => x.id === id);
    setClients((list) => list.filter((x) => x.id !== id));
    setOpenActionMenu(null);
    if (selectedClientId === id) setSelectedClientId(null);
    showToast(`${c?.name || "Client"} removed.`, "error");
    if (c?.backendSynced) {
      clientsApi.deleteClient(id).catch((err) => showToast(`Server delete failed: ${err.message}`, "error"));
    }
  };

  // Ticking/unticking one module (Frontend, Backend, etc.) inside a project.
  // A project's % is never set directly — it's always derived from how many
  // of its modules are done, so this is the only place progress changes.
  // Once every module is ticked the project is 100% / "Complete", which is
  // exactly what both the admin panel and the client portal read.
  // subModuleId is optional — pass it to toggle one sub-task (e.g. "Frontend"
  // inside "Development") instead of the whole module. The parent module's
  // own `done` flag is kept in sync (true only once every sub-task is done).
  const toggleProjectModule = (clientId, projectName, moduleId, subModuleId = null) => {
    let clientName = "";
    let nowComplete = false;
    let moduleName = "";
    let syncTarget = null; // { projectBackendId, moduleBackendId, done } — set only when both real ids exist
    let parentSyncTarget = null; // { projectBackendId, moduleBackendId, done } — parent's own aggregate status, when toggling a sub-task moves it
    setClients((list) =>
      list.map((c) => {
        if (c.id !== clientId) return c;
        clientName = c.name;
        const projects = (c.projects || []).map((p) => {
          if (p.name !== projectName) return p;
          const modules = (p.modules || []).map((m) => {
            if (m.id !== moduleId) return m;
            if (subModuleId) {
              const subModules = (m.subModules || []).map((s) => {
                if (s.id !== subModuleId) return s;
                moduleName = `${m.name}: ${s.name}`;
                // FIX (sub-task ticks never reached the backend): a
                // sub-task is now a real child Module row of its own
                // (see projects.Module.parent) — synced on its own
                // backendId, not silently skipped.
                if (p.backendId && s.backendId) syncTarget = { projectBackendId: p.backendId, moduleBackendId: s.backendId, done: !s.done };
                return { ...s, done: !s.done };
              });
              const nextDone = subModules.length > 0 && subModules.every((s) => s.done);
              // The parent's own row also gets its aggregate status kept
              // in sync, so "Development" shows Completed on the Client
              // Portal/Projects page the moment every sub-task is done.
              if (p.backendId && m.backendId && nextDone !== m.done) parentSyncTarget = { projectBackendId: p.backendId, moduleBackendId: m.backendId, done: nextDone };
              return { ...m, subModules, done: nextDone };
            }
            moduleName = m.name;
            const nextDone = !m.done;
            if (p.backendId && m.backendId) syncTarget = { projectBackendId: p.backendId, moduleBackendId: m.backendId, done: nextDone };
            return { ...m, done: nextDone };
          });
          const progress = computeProgress(modules);
          nowComplete = progress >= 100;
          return { ...p, modules, progress };
        });
        return {
          ...c,
          projects,
          activity: [{ text: `"${moduleName}" ${nowComplete ? "and project \"" + projectName + "\" marked complete" : "updated on \"" + projectName + "\""}`, time: "just now" }, ...(c.activity || [])],
        };
      })
    );
    if (nowComplete) showToast(`"${projectName}" for ${clientName || "client"} is now 100% complete.`, "success");
    // Best-effort real backend sync — same fire-and-forget pattern used
    // everywhere else in this file.
    if (syncTarget) {
      clientsApi
        .updateModule(syncTarget.projectBackendId, syncTarget.moduleBackendId, {
          status: syncTarget.done ? "Completed" : "Pending",
        })
        .catch((err) => showToast(`Module update didn't reach the server: ${err.message}`, "error"));
    }
    if (parentSyncTarget) {
      clientsApi
        .updateModule(parentSyncTarget.projectBackendId, parentSyncTarget.moduleBackendId, {
          status: parentSyncTarget.done ? "Completed" : "Pending",
        })
        .catch(() => {}); // best-effort only — the sub-task's own sync above already surfaced any error
    }
  };

  // Uploading an image/video/zip or pasting a link straight from a
  // module's own detail panel (opened by clicking the module row) —
  // writes into the same modules array `toggleProjectModule` above
  // updates, then mirrors into the matching Tasks page task (if one's
  // already been generated for it) so it shows up there too.
  const addModuleAttachment = (clientId, projectName, moduleId, subModuleId, attachment, file) => {
    let syncTarget = null; // { projectBackendId, moduleBackendId } — the real Module row this attachment belongs to (top-level OR its own sub-task row)
    setClients((list) =>
      list.map((c) => {
        if (c.id !== clientId) return c;
        const projects = (c.projects || []).map((p) => {
          if (p.name !== projectName) return p;
          const modules = (p.modules || []).map((m) => {
            if (subModuleId) {
              if (m.id !== moduleId) return m;
              const subModules = (m.subModules || []).map((s) => {
                if (s.id !== subModuleId) return s;
                // FIX (sub-task attachments never reached the backend):
                // a sub-task is now a real Module row of its own (see
                // projects.Module.parent) with its own ModuleFile
                // uploads, synced on its own backendId.
                if (p.backendId && s.backendId) syncTarget = { projectBackendId: p.backendId, moduleBackendId: s.backendId };
                return { ...s, attachments: appendAttachment(s.attachments, withBackendLinkId(attachment, s.backendId)) };
              });
              return { ...m, subModules };
            }
            if (m.id !== moduleId) return m;
            if (p.backendId && m.backendId) syncTarget = { projectBackendId: p.backendId, moduleBackendId: m.backendId };
            return { ...m, attachments: appendAttachment(m.attachments, withBackendLinkId(attachment, m.backendId)) };
          });
          return { ...p, modules };
        });
        return {
          ...c,
          projects,
          activity: [{ text: `New attachment added on "${projectName}"`, time: "just now" }, ...(c.activity || [])],
        };
      })
    );
    syncModuleAttachmentToTasksStorage(clientId, projectName, moduleId, subModuleId, attachment);
    showToast("Attachment uploaded.", "success");
    // Real backend file, when we have somewhere real to put it.
    if (syncTarget && file instanceof File) {
      clientsApi
        .uploadModuleFile(syncTarget.projectBackendId, syncTarget.moduleBackendId, file)
        .catch((err) => showToast(`Attachment saved here, but didn't reach the server: ${err.message}`, "error"));
    }
    // FIX (a pasted link never reached the backend Module -> never showed
    // up on the Client Portal / another browser, and could even get wiped
    // the next time this page re-fetched clients from the real backend):
    // a "link" attachment has no File to upload, but it still needs to
    // reach the server — it lives on the real Module's own `url` field
    // (see dashboard/serializers.py's _module_attachments), not as a
    // ModuleFile row. This used to be skipped entirely with a comment
    // saying "a link has nothing to upload", which was true for
    // uploadModuleFile but left the link with no backend sync at all.
    if (syncTarget && attachment?.type === "link" && attachment.url) {
      clientsApi
        .updateModule(syncTarget.projectBackendId, syncTarget.moduleBackendId, { url: attachment.url })
        .catch((err) => showToast(`Link saved here, but didn't reach the server: ${err.message}`, "error"));
    }
  };

  // NEW — Section 6/14's "Approved / Show on Portal" checkbox. Flips
  // ModuleFile.approved on the real backend row (the only thing
  // dashboard/serializers.py's _module_attachments actually gates a
  // client viewer's visibility on) and mirrors the flag into local state
  // so the checkbox/label reflects it without waiting on a refetch.
  const toggleModuleAttachmentApproval = (clientId, projectName, moduleId, subModuleId, projectBackendId, moduleBackendId, attachmentId, approved) => {
    if (!projectBackendId || !moduleBackendId) return Promise.resolve(false);
    // A module's link isn't a ModuleFile row — its id is "link-<modulePk>"
    // and its approval lives on Module.url_approved (own endpoint).
    const isLink = String(attachmentId).startsWith("link-");
    // Returns a promise resolving true/false so the review popup (see
    // AttachmentPreviewModal) can wait for the result.
    return (isLink
      ? clientsApi.toggleModuleUrlApproval(projectBackendId, moduleBackendId, approved)
      : clientsApi.toggleModuleFileApproval(projectBackendId, moduleBackendId, attachmentId, approved)
    )
      .then(() => {
        setClients((list) =>
          list.map((c) => {
            if (c.id !== clientId) return c;
            const projects = (c.projects || []).map((p) => {
              if (p.name !== projectName) return p;
              const modules = (p.modules || []).map((m) => {
                if (subModuleId) {
                  if (m.id !== moduleId) return m;
                  const subModules = (m.subModules || []).map((s) =>
                    s.id !== subModuleId
                      ? s
                      : { ...s, attachments: (s.attachments || []).map((a) => (a.id === attachmentId ? { ...a, approved } : a)) }
                  );
                  return { ...m, subModules };
                }
                if (m.id !== moduleId) return m;
                return { ...m, attachments: (m.attachments || []).map((a) => (a.id === attachmentId ? { ...a, approved } : a)) };
              });
              return { ...p, modules };
            });
            return { ...c, projects };
          })
        );
        showToast(approved ? "Approved — now visible on the Client Portal." : "Hidden from the Client Portal.", "success");
        return true;
      })
      .catch((err) => {
        showToast(`Couldn't update approval: ${err.message}`, "error");
        return false;
      });
  };

  // EDIT PROJECT — name/type/budget, from the client-detail Projects tab
  // (the checklist-style embedded view, not the standalone ProjectsPage).
  // Same optimistic-update + best-effort-backend-sync pattern as
  // toggleProjectModule/addModuleAttachment above: local state (and the
  // project's key, `name`) updates immediately, then a real PATCH goes
  // out to /api/projects/<id>/ when this project actually has a
  // backendId (older, never-synced projects just stay local-only, same
  // as everywhere else in this file).
  const updateProjectDetails = (clientId, projectName, data) => {
    let syncTarget = null; // { projectBackendId } — set only when the project has a real backend row
    setClients((list) =>
      list.map((c) => {
        if (c.id !== clientId) return c;
        const projects = (c.projects || []).map((p) => {
          if (p.name !== projectName) return p;
          if (p.backendId) syncTarget = { projectBackendId: p.backendId };
          return { ...p, name: data.name.trim() || p.name, type: data.type || p.type, budget: Number(data.budget) || 0 };
        });
        return {
          ...c,
          projects,
          activity: [{ text: `Project "${projectName}" details updated`, time: "just now" }, ...(c.activity || [])],
        };
      })
    );
    setEditingProject(null);
    showToast("Project updated.", "success");
    if (syncTarget) {
      clientsApi
        .updateProject(syncTarget.projectBackendId, {
          name: data.name.trim(),
          project_type: data.type,
          budget: Number(data.budget) || 0,
        })
        .catch((err) => showToast(`Project update didn't reach the server: ${err.message}`, "error"));
    }
  };

  // DELETE PROJECT — same spot. Backend delete is a soft-delete
  // (is_archived=True, admin-only — see ProjectViewSet.destroy), so a
  // 403 here (a non-admin user) is a real, expected outcome, not a bug;
  // the local row is still removed either way since this page has no
  // separate "archived projects" view to fall back into.
  const deleteProject = (clientId, projectName) => {
    if (!window.confirm(`Delete "${projectName}"? This can't be undone from this page.`)) return;
    let syncTarget = null; // { projectBackendId }
    setClients((list) =>
      list.map((c) => {
        if (c.id !== clientId) return c;
        const target = (c.projects || []).find((p) => p.name === projectName);
        if (target?.backendId) syncTarget = { projectBackendId: target.backendId };
        return {
          ...c,
          projects: (c.projects || []).filter((p) => p.name !== projectName),
          activity: [{ text: `Project "${projectName}" deleted`, time: "just now" }, ...(c.activity || [])],
        };
      })
    );
    showToast(`"${projectName}" deleted.`, "success");
    if (syncTarget) {
      clientsApi
        .deleteProject(syncTarget.projectBackendId)
        .catch((err) => showToast(`Deleted here, but didn't reach the server: ${err.message}`, "error"));
    }
  };

  // MODULE REQUESTS — a client on the Client Portal can ask for the next
  // module (e.g. Backend, once Frontend is delivered) to be started.
  //
  // FIX (requests submitted from the real Client Portal never showed up
  // here): this used to ONLY ever read/write `client.moduleRequests`
  // inside the `clientspage_clients_v1` localStorage blob. That blob is
  // per-browser — it isn't shared between the client's device and the
  // admin's device, only between tabs of the SAME browser. The backend
  // already has a fully working dashboard.ModuleRequest API
  // (clientsApi.listModuleRequests/acceptModuleRequest/rejectModuleRequest)
  // that a real Client Portal write reaches regardless of whose browser
  // it's on — this page just never called it. `refreshModuleRequestsFromBackend`
  // below now polls that real endpoint and merges its rows into each
  // client's `moduleRequests` (tagged with a real `backendId`) so a
  // request from any device shows up here, not just same-browser ones.
  const mergeModuleRequestsIntoClients = (list, backendRequests) => {
    if (!Array.isArray(backendRequests)) return list;
    const byClient = {};
    backendRequests.forEach((r) => {
      (byClient[r.client] || (byClient[r.client] = [])).push({
        id: `mr-${r.id}`,
        backendId: r.id,
        moduleName: r.module_name || r.custom_module_name || "",
        projectName: r.project_name || "",
        note: r.note || "",
        // Backend uses "rejected"; the rest of this page's UI already
        // checks for "declined" — normalize so both mean the same thing.
        status: r.status === "rejected" ? "declined" : r.status,
        requestedAt: r.requested_at,
      });
    });
    return list.map((c) => {
      const fresh = byClient[c.id];
      if (!fresh) return c;
      // Keep any purely-local, never-synced requests (old data / offline
      // fallback) alongside the real ones, but real backend rows are the
      // source of truth for anything that has a backendId already.
      const localOnly = (c.moduleRequests || []).filter((r) => !r.backendId);
      return { ...c, moduleRequests: [...fresh, ...localOnly] };
    });
  };

  const prevPendingModuleRequestIdsRef = useRef(new Set());
  useEffect(() => {
    let cancelled = false;
    const refreshModuleRequestsFromBackend = async () => {
      try {
        const backendRequests = await clientsApi.listModuleRequests();
        if (cancelled || !Array.isArray(backendRequests)) return;
        const pendingIds = new Set(backendRequests.filter((r) => r.status === "pending").map((r) => r.id));
        const newlyPending = backendRequests.filter(
          (r) => r.status === "pending" && !prevPendingModuleRequestIdsRef.current.has(r.id)
        );
        // Skip the toast on the very first load (everything looks "new"
        // then) — only announce requests that arrived after this page
        // was already open and watching.
        if (prevPendingModuleRequestIdsRef.current.size > 0 || newlyPending.length) {
          newlyPending.forEach((r) => {
            if (prevPendingModuleRequestIdsRef.current.size > 0) {
              showToast(`New request from ${r.client_name}: "${r.module_name || r.custom_module_name}" for "${r.project_name}" — accept it below.`, "success");
            }
          });
        }
        prevPendingModuleRequestIdsRef.current = pendingIds;
        setClients((prev) => mergeModuleRequestsIntoClients(prev, backendRequests));
      } catch {
        // Best-effort: Requests panel just shows whatever's local until
        // the next successful poll.
      }
    };
    refreshModuleRequestsFromBackend();
    const intervalId = setInterval(refreshModuleRequestsFromBackend, 20000);
    window.addEventListener("focus", refreshModuleRequestsFromBackend);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
      window.removeEventListener("focus", refreshModuleRequestsFromBackend);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // STEP 4 (real backend) — mirrors mergeModuleRequestsIntoClients above,
  // for Billing. A client's payment-proof submission (real Client Portal,
  // via clientPortalApi.submitPaymentProof) writes straight to Postgres —
  // this is what pulls that status change (Pending -> Submitted, plus the
  // uploaded proof) back into this browser's local invoice objects,
  // matched by the real `backendId` each got stamped with when it was
  // generated. Only fields the backend actually owns (status, proof) are
  // ever overwritten — everything else (line items, bill-to, ...) stays
  // whatever this browser already has, since the backend row never
  // carries the full document.
  const mergeInvoicesIntoClients = (list, backendInvoices) => {
    if (!Array.isArray(backendInvoices)) return list;
    const byClient = {};
    backendInvoices.forEach((bi) => {
      (byClient[bi.client] || (byClient[bi.client] = [])).push(bi);
    });
    return list.map((c) => {
      const fresh = byClient[c.id];
      if (!fresh || !(c.invoices || []).length) return c;
      const byBackendId = new Map(fresh.map((bi) => [bi.id, bi]));
      let touched = false;
      const invoices = (c.invoices || []).map((inv) => {
        const bi = inv.backendId ? byBackendId.get(inv.backendId) : null;
        if (!bi) return inv;
        const status =
          bi.status === "paid" ? "Paid" : bi.status === "partial" ? "Partial" : bi.status === "submitted" ? "Submitted" : inv.status;
        // Reuses the same `dataUrl`/`fileName`/`submittedAt` shape the
        // rest of this file's paymentProof rendering already expects
        // (see the Billing tab below) — `dataUrl` here is a real
        // uploaded-file URL rather than a base64 data: URL, but an
        // <img src>/<a href> renders either one identically.
        const paymentProof = bi.payment_proof
          ? { dataUrl: bi.payment_proof, fileName: "payment-proof", submittedAt: bi.submitted_at }
          : inv.paymentProof;
        // Keeps this device's paidAmount in sync too — e.g. a payment
        // recorded from a different admin session/browser.
        const paidAmount = bi.paid_amount != null ? Number(bi.paid_amount) : inv.paidAmount;
        if (status === inv.status && paymentProof === inv.paymentProof && paidAmount === inv.paidAmount) return inv;
        touched = true;
        return { ...inv, status, paymentProof, paidAmount };
      });
      return touched ? { ...c, invoices } : c;
    });
  };

  const prevSubmittedInvoiceBackendIdsRef = useRef(new Set());
  useEffect(() => {
    let cancelled = false;
    const refreshInvoicesFromBackend = async () => {
      try {
        const backendInvoices = await clientsApi.listInvoices();
        if (cancelled || !Array.isArray(backendInvoices)) return;
        const submittedIds = new Set(backendInvoices.filter((i) => i.status === "submitted").map((i) => i.id));
        const newlySubmitted = backendInvoices.filter(
          (i) => i.status === "submitted" && !prevSubmittedInvoiceBackendIdsRef.current.has(i.id)
        );
        if (prevSubmittedInvoiceBackendIdsRef.current.size > 0) {
          newlySubmitted.forEach((bi) => {
            showToast(`Payment received from ${bi.client_name} — check Billing to confirm.`, "success");
          });
        }
        prevSubmittedInvoiceBackendIdsRef.current = submittedIds;
        setClients((prev) => mergeInvoicesIntoClients(prev, backendInvoices));
      } catch {
        // Best-effort: Billing just shows whatever's local until the next
        // successful poll.
      }
    };
    refreshInvoicesFromBackend();
    const intervalId = setInterval(refreshInvoicesFromBackend, 20000);
    window.addEventListener("focus", refreshInvoicesFromBackend);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
      window.removeEventListener("focus", refreshInvoicesFromBackend);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // STEP 4 (real backend) — ActivityLogEntry, ClientPortal.jsx's Activity
  // tab feed. Entries here are written automatically server-side at the
  // key transitions (payment submitted/confirmed, module request
  // accepted/rejected — see dashboard/views.py's log_activity calls),
  // so pulling them in is what makes a client's activity history survive
  // across browsers/devices instead of only ever existing as whatever
  // this one admin's browser happened to push into local state. Runs
  // whenever the details panel is opened for a real (backendSynced)
  // client; merged in ahead of local-only entries, de-duplicated by
  // text so an event this page already pushed its own local line for
  // doesn't show up twice.
  useEffect(() => {
    if (!selectedClientId) return;
    const target = clients.find((c) => c.id === selectedClientId);
    if (!target?.backendSynced) return;
    let cancelled = false;
    clientsApi
      .listActivity(selectedClientId)
      .then((backendEntries) => {
        if (cancelled || !Array.isArray(backendEntries)) return;
        setClients((prev) =>
          prev.map((c) => {
            if (c.id !== selectedClientId) return c;
            const existingTexts = new Set((c.activity || []).map((a) => a.text));
            const newOnes = backendEntries
              .filter((e) => !existingTexts.has(e.text))
              .map((e) => ({ text: e.text, time: e.created_at, backendId: e.id }));
            if (!newOnes.length) return c;
            return { ...c, activity: [...newOnes, ...(c.activity || [])] };
          })
        );
      })
      .catch(() => {
        // Best-effort — the panel just shows whatever's local until the
        // next time it's opened.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClientId]);

  // Accepting appends a real module onto that project's modules array —
  // which, because TasksPage.jsx's own sync engine watches every client's
  // project modules and auto-creates a task for any module that doesn't
  // have one yet, is all it takes for a new task to appear on the Tasks
  // page, assigned to that client's manager/developer, kicking off work
  // on it. When the request is a real backend row (backendId set), the
  // actual accept/reject also goes to the server — best-effort, fired
  // right after the local update below so the UI stays instant.
  const acceptModuleRequest = (clientId, requestId) => {
    let clientName = "";
    let moduleName = "";
    let projectName = "";
    let backendReqId = null;
    setClients((list) =>
      list.map((c) => {
        if (c.id !== clientId) return c;
        clientName = c.name;
        const req = (c.moduleRequests || []).find((r) => r.id === requestId);
        if (!req || req.status !== "pending") return c;
        moduleName = req.moduleName;
        projectName = req.projectName;
        backendReqId = req.backendId || null;
        const projects = (c.projects || []).map((p) => {
          if (p.name !== req.projectName) return p;
          const alreadyExists = (p.modules || []).some((m) => m.name.toLowerCase() === req.moduleName.toLowerCase());
          const base = alreadyExists ? p.modules : [...(p.modules || []), makeSingleModule(req.moduleName)];
          // kickoffPing: most modules already exist from the moment the
          // project was created (makeModules() at project setup builds
          // the whole checklist upfront) — so accepting a request here
          // usually doesn't add a NEW module, it just means the client
          // wants staff to start one that was already sitting there
          // locked/Pending. Flagging it lets TasksPage.jsx's sync engine
          // message the assigned manager "start this now" even when no
          // new task gets created, instead of silently doing nothing.
          // TasksPage clears this flag itself right after sending that
          // message. `unlocked: true` is the permanent counterpart —
          // this is what actually lifts the lock on the Tasks page (see
          // makeModulesFromNames: every module past the first starts
          // locked) so the manager can act on it at all, not just get
          // told about it.
          const modules = base.map((m) => (m.name.toLowerCase() === req.moduleName.toLowerCase() ? { ...m, kickoffPing: true, unlocked: true } : m));
          return { ...p, modules, progress: computeProgress(modules) };
        });
        const moduleRequests = (c.moduleRequests || []).map((r) => (r.id === requestId ? { ...r, status: "accepted" } : r));
        return {
          ...c,
          projects,
          moduleRequests,
          activity: [{ text: `"${req.moduleName}" module request accepted for "${req.projectName}" — assigned to ${c.manager?.name || "the team"}`, time: "just now" }, ...(c.activity || [])],
        };
      })
    );
    showToast(`"${moduleName}" started for "${projectName}" — task assigned to ${clientName || "the client's"} manager.`, "success");
    if (backendReqId) {
      clientsApi
        .acceptModuleRequest(backendReqId)
        .then((accepted) => {
          // FIX: the backend returns the accepted ModuleRequest with `module`
          // set to the real backend Module id (either the existing one that was
          // just unlocked, or the brand-new one created for a custom request).
          // Stamp it as `backendId` on the matching local module so that
          // toggleProjectModule and addModuleAttachment can PATCH/POST to the
          // real backend row instead of silently skipping (they both guard on
          // `p.backendId && m.backendId` before making any API call).
          if (!accepted?.module) return;
          setClients((list) =>
            list.map((c) => {
              if (c.id !== clientId) return c;
              const req = (c.moduleRequests || []).find((r) => r.id === requestId);
              if (!req) return c;
              const projects = (c.projects || []).map((p) => {
                if (p.name !== req.projectName) return p;
                const modules = (p.modules || []).map((m) =>
                  m.name.toLowerCase() === req.moduleName.toLowerCase()
                    ? { ...m, backendId: accepted.module }
                    : m
                );
                return { ...p, modules };
              });
              return { ...c, projects };
            })
          );
        })
        .catch((err) => showToast(`Accepted here, but didn't reach the server: ${err.message}`, "error"));
    }
  };

  const declineModuleRequest = (clientId, requestId) => {
    let backendReqId = null;
    setClients((list) =>
      list.map((c) => {
        if (c.id !== clientId) return c;
        const req = (c.moduleRequests || []).find((r) => r.id === requestId);
        backendReqId = req?.backendId || null;
        const moduleRequests = (c.moduleRequests || []).map((r) => (r.id === requestId ? { ...r, status: "declined" } : r));
        return {
          ...c,
          moduleRequests,
          activity: req ? [{ text: `"${req.moduleName}" module request declined for "${req.projectName}"`, time: "just now" }, ...(c.activity || [])] : c.activity,
        };
      })
    );
    showToast("Request declined.", "error");
    // Real backend row too — same best-effort pattern as
    // acceptModuleRequest above.
    if (backendReqId) {
      clientsApi
        .rejectModuleRequest(backendReqId)
        .catch((err) => showToast(`Declined here, but didn't reach the server: ${err.message}`, "error"));
    }
  };

  // FIX (final deliverable ZIP, gated by payment): the very last step once
  // every module in a project is 100% complete — the team uploads one ZIP
  // of the finished deliverable for the whole project. It's stored right
  // on the project record (so it shows up here AND on the Client Portal,
  // since both read the same `clientspage_clients_v1` storage), but the
  // client only ever gets a download/open option for it once they've
  // fully paid (client.outstanding <= 0) — see isPaymentComplete(). Staff
  // here on the Clients page can always open/replace/remove it regardless
  // of payment status, since they're the ones managing it.
  const setProjectDeliverableZip = (clientId, projectName, zip) => {
    setClients((list) =>
      list.map((c) => {
        if (c.id !== clientId) return c;
        const projects = (c.projects || []).map((p) => (p.name === projectName ? { ...p, deliverableZip: zip } : p));
        return {
          ...c,
          projects,
          activity: [
            { text: zip ? `Final deliverable ZIP uploaded for "${projectName}"` : `Final deliverable ZIP removed for "${projectName}"`, time: "just now" },
            ...(c.activity || []),
          ],
        };
      })
    );
    showToast(zip ? "Final deliverable uploaded." : "Final deliverable removed.", zip ? "success" : "error");
  };

  // Creates a new invoice on the client's permanent ledger (`client.invoices`).
  // This is what makes "a year later, still shows the pending payment" work —
  // it's not a transient activity-feed line, it's a real record that sticks
  // around (and stays "Pending"/"Partial") until a payment fully covers it.
  //
  // `amount` stays the authoritative billable total (= grandTotal from the
  // document form) — everything else that already reads inv.amount
  // (outstanding, milestone locking, Record Payment, ...) keeps working
  // exactly as before, unchanged. Everything past `amount` below is the
  // extra document data (bill-to snapshot, line items, payment details,
  // subtotal/discount) the new PDF-style GenerateInvoiceModal collects —
  // it travels with the invoice purely so InvoiceDocumentPreview can
  // re-render the exact same branded document later, for the admin here
  // AND for the client on the Client Portal (same client.invoices array).
  const generateInvoice = (
    clientId,
    { amount, dueDate, note, milestone, projectName, billTo, lineItems, poNumber, paymentMethod, transactionRef, amountReceived, discount, subtotal, grandTotal, approvedBy, designation, approvalDate }
  ) => {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return;
    let invoiceNumber = "";
    let newInvoiceId = "";
    let targetClientBackendId = null;
    let targetProjectBackendId = null;
    setClients((list) =>
      list.map((c) => {
        if (c.id !== clientId) return c;
        invoiceNumber = `INV-${1001 + (c.invoices?.length || 0)}`;
        const milestoneLabel = milestone ? MILESTONE_LABELS[milestone] : "";
        if (c.backendSynced) targetClientBackendId = c.id;
        targetProjectBackendId = (c.projects || []).find((p) => p.name === projectName)?.backendId || null;
        // Amount is already the correct milestone share of the total
        // project payment by the time it gets here (auto-calculated in
        // the Generate Invoice modal — see MILESTONE_AMOUNT_FRACTION), so
        // this stays a plain Pending invoice: actually collecting the
        // money still happens through Record Payment, which is gated by
        // priorMilestonesCleared() so the 4 milestones can only clear in
        // order and nothing unlocks on the Client Portal ahead of time.
        const newInvoice = {
          id: `inv-${Date.now()}`,
          number: invoiceNumber,
          issueDate: new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
          dueDate: dueDate || "—",
          amount: amt,
          paidAmount: 0,
          status: "Pending",
          note: note || "",
          milestone: milestone || null,
          projectName: projectName || "",
          paymentProof: null,
          // Document fields — everything InvoiceDocumentPreview needs to
          // re-render the same branded invoice later.
          billTo: billTo || { name: c.name, address: c.address || "", phone: c.phone || "", email: c.email || "" },
          lineItems: Array.isArray(lineItems) && lineItems.length ? lineItems : [{ description: projectName || "", scope: note || "", qty: 1, rate: amt }],
          poNumber: poNumber || "",
          paymentMethod: paymentMethod || "",
          transactionRef: transactionRef || "",
          amountReceived: Number(amountReceived) || 0,
          discount: Number(discount) || 0,
          subtotal: Number.isFinite(subtotal) ? subtotal : amt,
          grandTotal: Number.isFinite(grandTotal) ? grandTotal : amt,
          approvedBy: approvedBy || "",
          designation: designation || "",
          approvalDate: approvalDate || "",
        };
        newInvoiceId = newInvoice.id;
        return {
          ...c,
          invoices: [newInvoice, ...(c.invoices || [])],
          outstanding: (c.outstanding || 0) + amt,
          activity: [
            {
              text: `Invoice ${newInvoice.number} generated for ${fmtMoney(amt)}${milestoneLabel ? ` (${milestoneLabel})` : ""}`,
              time: "just now",
            },
            ...(c.activity || []),
          ],
        };
      })
    );
    setInvoiceModalOpen(false);
    showToast(`Invoice ${invoiceNumber} generated.`, "success");
    // Real backend row too — see createBackendInvoicesForClient above.
    // Fire-and-forget: the invoice is already saved locally regardless.
    if (targetClientBackendId) {
      clientsApi
        .createInvoice({
          client: targetClientBackendId,
          project: targetProjectBackendId,
          milestone_number: milestone || 1,
          milestone_total: milestone ? 4 : 1,
          amount: amt,
          note: note || "",
          // FIX (Client Portal Billing showed blank/broken invoices):
          // this used to stop at amount/milestone/note — the real
          // backend row never got the invoice number, dates, or any of
          // the document fields InvoiceDocumentPreview needs, so the
          // Client Portal (which reads straight from that row, not from
          // this browser's local state) had nothing to show. Send the
          // SAME data the local ledger just got, so admin and portal
          // always agree on one real invoice.
          number: invoiceNumber,
          issue_date: new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
          due_date: dueDate || "—",
          bill_to: billTo || {},
          line_items: Array.isArray(lineItems) && lineItems.length ? lineItems : [{ description: projectName || "", scope: note || "", qty: 1, rate: amt }],
          po_number: poNumber || "",
          payment_method: paymentMethod || "",
          transaction_ref: transactionRef || "",
          amount_received: Number(amountReceived) || 0,
          discount: Number(discount) || 0,
          subtotal: Number.isFinite(subtotal) ? subtotal : amt,
          grand_total: Number.isFinite(grandTotal) ? grandTotal : amt,
          approved_by: approvedBy || "",
          designation: designation || "",
          approval_date: approvalDate || "",
        })
        .then((created) => {
          setClients((list) =>
            list.map((c) =>
              c.id !== clientId
                ? c
                : { ...c, invoices: (c.invoices || []).map((inv) => (inv.id === newInvoiceId ? { ...inv, backendId: created.id } : inv)) }
            )
          );
        })
        .catch((err) => showToast(`Invoice saved here, but didn't reach the server: ${err.message}`, "error"));
    }
  };

  // Records a payment against one invoice on the ledger. Partial payments
  // keep the invoice (and the remaining balance) sitting in the ledger as
  // "Partial" — it never disappears until it's fully paid off, so a client's
  // full payment history plus anything still owed stays visible whenever
  // the details panel is opened, regardless of how much time has passed.
  const recordInvoicePayment = (clientId, invoiceId, amount) => {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return;
    let invoiceNumber = "";
    let syncTarget = null; // { backendId } — set for ANY payment against a real (backendSynced) invoice now
    setClients((list) =>
      list.map((c) => {
        if (c.id !== clientId) return c;
        const invoices = (c.invoices || []).map((inv) => {
          if (inv.id !== invoiceId) return inv;
          invoiceNumber = inv.number;
          const paidAmount = Math.min(inv.amount, (inv.paidAmount || 0) + amt);
          const fullyPaid = paidAmount >= inv.amount;
          // FIX (partial payments never reached the Client Portal): the
          // backend Invoice model now has its own paid_amount + a real
          // "partial" status (see dashboard/views.py record-payment), so
          // this syncs on EVERY payment, not only once fully settled.
          if (inv.backendId) syncTarget = { backendId: inv.backendId };
          return { ...inv, paidAmount, status: fullyPaid ? "Paid" : "Partial" };
        });
        return {
          ...c,
          invoices,
          outstanding: Math.max(0, (c.outstanding || 0) - amt),
          totalSpent: (c.totalSpent || 0) + amt,
          activity: [{ text: `${fmtMoney(amt)} payment received against ${invoiceNumber}`, time: "just now" }, ...(c.activity || [])],
        };
      })
    );
    setPayingInvoiceId(null);
    showToast("Payment recorded.", "success");
    if (syncTarget) {
      clientsApi
        .recordInvoicePayment(syncTarget.backendId, amt)
        .catch((err) => showToast(`Payment recorded here, but didn't reach the server: ${err.message}`, "error"));
    }
  };

  const handleAdd = async (data) => {
    // Re-entrancy guard — see isAddingClientRef above. Any call that
    // arrives while a previous one is still in flight is dropped instead
    // of running a second time.
    if (isAddingClientRef.current) return;
    isAddingClientRef.current = true;
    setSavingClient(true);
    // If this submission is actually finishing an intake-request approval
    // (admin clicked "Approve" on a public form submission, which opens
    // this very same Add Client modal pre-filled — see
    // `startApproveIntakeRequest` below), carry the prospect's uploaded
    // 30% advance screenshot onto Milestone 1's invoice as proof — already
    // "Submitted", ready for admin to confirm in Billing — and clear that
    // submission out of the pending Requests list once the client is
    // created. A completely normal manual Add Client (approvingRequestId
    // null) skips all of this and behaves exactly as before.
    const approvingRequest = approvingRequestId ? intakeRequests.find((r) => r.id === approvingRequestId) : null;
    const withApprovalProof = (invoiceList) => {
      if (!approvingRequest || !approvingRequest.paymentScreenshot) return invoiceList;
      return invoiceList.map((inv) =>
        inv.milestone === 1
          ? {
              ...inv,
              status: "Submitted",
              paymentProof: { dataUrl: approvingRequest.paymentScreenshot, fileName: "advance-payment-screenshot.png", submittedAt: approvingRequest.submittedAt },
            }
          : inv
      );
    };
    const finishApprovalIfAny = () => {
      if (!approvingRequestId) return;
      const backendReqId = approvingRequest?.backendId || null;
      setIntakeRequests((list) => list.filter((r) => r.id !== approvingRequestId));
      setApprovingRequestId(null);
      // Best-effort cleanup — the real client this request turned into
      // has already been created above regardless of whether this
      // succeeds; see the comment on deleteIntakeRequest in clientsApi.js.
      if (backendReqId) {
        clientsApi.deleteIntakeRequest(backendReqId).catch(() => {});
      }
    };

    const projectName = (data.projectName || "").trim();
    const projectType =
      data.projectType === CUSTOM_PROJECT_TYPE_VALUE
        ? (data.customProjectType || "").trim() || "Custom"
        : data.projectType || "Website";
    // Custom milestone plan resolved from the form — falls back to sane
    // defaults if this client (older code path/tests) never set them.
    const milestoneCount = clampMilestoneCount(
      data.milestoneCount === CUSTOM_MILESTONE_COUNT_VALUE ? data.customMilestoneCount : data.milestoneCount
    );
    const paymentType = data.paymentType || "advance";
    const milestonePlan = {
      count: milestoneCount,
      paymentType,
      advancePercent: data.advancePercent,
      customSplits: data.customSplits,
      moduleNames: data.selectedModules || [],
    };
    const chosenModuleNames = data.selectedModules && data.selectedModules.length ? data.selectedModules : undefined;

    const projects = projectName
      ? [
          {
            name: projectName,
            type: projectType,
            details: (data.projectDetails || "").trim(),
            modules: makeModules(projectType, chosenModuleNames),
            progress: 0,
            milestoneCount,
            paymentType,
            advancePercent: paymentType === "advance" ? Number(data.advancePercent) || 30 : undefined,
          },
        ]
      : [];
    // Project budget becomes the client's opening balance: it's booked as
    // "outstanding" (contracted but not yet collected) with a matching
    // Pending invoice on the ledger — Total Client Revenue counts
    // outstanding + totalSpent, so it reflects the moment a budgeted
    // project is added, and Record Payment later shifts it into totalSpent
    // without double-counting.
    const budget = Math.min(Number(data.projectBudget) || 0, 99999999);
    const hasBudget = Number.isFinite(budget) && budget > 0;
    const hasProjectDetails = Boolean(hasBudget || (data.projectDetails || "").trim());

    // Budget/details were filled in but no project name given — same
    // "would silently do nothing" trap as the existing-client case below,
    // just for a brand-new client. Block it instead of dropping the data.
    if (!projectName && hasProjectDetails) {
      showToast("Enter a Project name for the project details you've filled in, or clear them first.", "error");
      isAddingClientRef.current = false;
      setSavingClient(false);
      return;
    }

    // Same client, same manager, added again through this form? That's not
    // a new client — it's another project for the one that already exists.
    // Merge it into that client's own `projects` list instead of creating a
    // second, duplicate client row (which used to split "Active Projects"
    // across two entries instead of counting both under the one client).
    const trimmedName = data.name.trim();
    const existingClient = clients.find(
      (c) => c.name.trim().toLowerCase() === trimmedName.toLowerCase() && c.manager?.name === data.manager
    );

    if (existingClient) {
      // Merging into an existing client only makes sense if there's an
      // actual new project to add. Without a project name, nothing would
      // change (Active Projects would stay exactly as it was) even though
      // the form would otherwise report "success" — so block that instead
      // of silently doing nothing.
      if (!projectName) {
        showToast(`"${existingClient.name}" already exists — enter a Project name to add another project for it.`, "error");
        isAddingClientRef.current = false;
        setSavingClient(false);
        return;
      }
      const newInvoices = hasBudget
        ? withApprovalProof(buildCustomMilestoneInvoices(budget, projectName, 1000 + (existingClient.invoices?.length || 0) + 1, milestonePlan))
        : [];

      setClients((list) =>
        list.map((c) => {
          if (c.id !== existingClient.id) return c;
          const mergedProjects = [...(c.projects || []), ...projects];
          return {
            ...c,
            projects: mergedProjects,
            activeProjects: mergedProjects.length,
            totalProjects: mergedProjects.length,
            outstanding: (c.outstanding || 0) + (hasBudget ? budget : 0),
            invoices: newInvoices.length ? [...(c.invoices || []), ...newInvoices] : c.invoices,
            lastActivityDate: new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
            lastActivityAgo: "just now",
            activity: [
              ...(hasBudget ? [{ text: `Project budget of ${fmtMoney(budget)} added — ${newInvoices.length} milestone invoice${newInvoices.length === 1 ? "" : "s"} generated`, time: "just now" }] : []),
              { text: projectName ? `New project "${projectName}" added` : "New project added", time: "just now" },
              ...(c.activity || []),
            ],
          };
        })
      );
      setSelectedClientId(existingClient.id);
      setAddOpen(false);
      finishApprovalIfAny();
      showToast(`Added as a new project for existing client "${existingClient.name}".`, "success");
      isAddingClientRef.current = false;
      setSavingClient(false);
      // Real backend row too — see syncClientProjectToBackend above.
      // Only when this client itself is a real (backendSynced) row;
      // a locally-only client has no real id to attach a project to.
      if (existingClient.backendSynced && projects[0]) {
        const managerUser = data.manager ? (approvedUsers || []).find((u) => u.name === data.manager) : null;
        const localProjectId = projects[0].id;
        syncClientProjectToBackend(existingClient.id, projects[0], { managerUser, budget }).then((syncResult) => {
          if (!syncResult) return;
          setClients((list) =>
            list.map((c) =>
              c.id !== existingClient.id
                ? c
                : {
                    ...c,
                    projects: (c.projects || []).map((p) =>
                      p.id === localProjectId ? stampBackendIds(p, syncResult) : p
                    ),
                  }
            )
          );
        });
      }
      // Real backend invoice rows too — see createBackendInvoicesForClient
      // above. Fire-and-forget, same as the project sync just above.
      if (existingClient.backendSynced && newInvoices.length) {
        createBackendInvoicesForClient(existingClient.id, newInvoices).then((stamped) => {
          if (!stamped.length) return;
          setClients((list) =>
            list.map((c) =>
              c.id !== existingClient.id ? c : { ...c, invoices: stampInvoiceBackendIds(c.invoices || [], stamped) }
            )
          );
        });
      }
      return;
    }

    // Real Postgres row first — this client's `id` from here on IS the
    // real database id (a number), not a fake local "CLT-XXXX" string.
    // FIX (Priority 1): this used to fall back to a fake local id and
    // add the client to state anyway when the backend call failed. Per
    // the required flow, a failed request must NOT create a client
    // anywhere — not on the backend, not locally. See the catch block
    // below, which now returns instead of falling through.
    let id;
    let savedAvatarUrl = null;
    let portalPassword = null; // plain password, only ever available right here
    let portalError = null;
    try {
      const managerUser = data.manager ? (approvedUsers || []).find((u) => u.name === data.manager) : null;
      const fields = {
        name: data.name,
        email: data.email.trim(),
        industry: data.industry || "",
        contact_person: data.contactPerson || "",
        date_of_birth: data.dateOfBirth || null,
        phone: data.phone || "",
        address: data.address || "",
        country: data.country || "",
        // FIX (Dashboard's "Most Order by Country" card stayed empty for
        // a brand-new client): only the country's display NAME ("Pakistan")
        // was ever sent — the backend's country_code field (needed for the
        // flag icon and for the dashboard query to pick this client up at
        // all) was silently left blank forever. COUNTRY_CODE_BY_NAME
        // already exists (see client detail view) — it just wasn't being
        // used here yet.
        country_code: (COUNTRY_CODE_BY_NAME[data.country] || "").toLowerCase(),
        status: "active",
        manager: managerUser ? managerUser.id : null,
      };
      // FIX (client's uploaded photo never reached the backend, so the
      // Dashboard fell back to a random placeholder avatar): the picked
      // photo used to only ever live in local state as a base64 data:
      // URL — now, when there's a fresh one, it rides along as a real
      // file upload in the same request (see buildClientPayload above).
      const payload = await buildClientPayload(fields, data.profilePic);
      const createdClient = await clientsApi.createClient(payload);
      id = createdClient.id;
      savedAvatarUrl = createdClient.avatar || null;
      // Real backend project row too — see syncClientProjectToBackend
      // above. Fire-and-forget: the client itself is already saved
      // above regardless of whether this succeeds. Once it resolves,
      // stamp the real project/module ids onto this client's project so
      // later edits (module ticks, attachments) have something real to
      // sync to instead of silently staying local-only forever.
      if (projects[0]) {
        const localProjectId = projects[0].id;
        syncClientProjectToBackend(id, projects[0], { managerUser, budget }).then((syncResult) => {
          if (!syncResult) return;
          setClients((list) =>
            list.map((c) =>
              c.id !== id
                ? c
                : {
                    ...c,
                    projects: (c.projects || []).map((p) =>
                      p.id === localProjectId ? stampBackendIds(p, syncResult) : p
                    ),
                  }
            )
          );
        });
      }
      // Client Portal login only works once a real backend user is linked
      // to this client — do it right now so the admin can hand over a
      // working login immediately. A failure here doesn't undo the add;
      // the details panel's "Generate Portal Access" button can retry.
      try {
        const access = await clientsApi.generatePortalAccess(createdClient.id);
        portalPassword = access.password;
      } catch (accessErr) {
        portalError = accessErr.message;
      }
    } catch (err) {
      // FIX (Priority 1): show the REAL backend error and stop here.
      // No fake id, no local-only client, no "success" toast — the
      // modal stays open with what the admin typed so they can retry
      // once the backend is reachable/the validation error is fixed.
      showToast(`Couldn't add client — the server rejected the request: ${err.message}`, "error");
      isAddingClientRef.current = false;
      setSavingClient(false);
      return;
    }

    const invoices = withApprovalProof(hasBudget ? buildCustomMilestoneInvoices(budget, projectName, 1001, milestonePlan) : []);
    // Real backend rows too — see createBackendInvoicesForClient above.
    // Fire-and-forget: the client is already saved on the backend above
    // (we returned in the catch block otherwise), so this only ever
    // runs once that's confirmed.
    if (invoices.length) {
      createBackendInvoicesForClient(id, invoices).then((stamped) => {
        if (!stamped.length) return;
        setClients((list) =>
          list.map((c) => (c.id !== id ? c : { ...c, invoices: stampInvoiceBackendIds(c.invoices || [], stamped) }))
        );
      });
    }
    const fresh = {
      id,
      backendSynced: true, // always true now — we return in the catch block above on any backend failure
      name: data.name,
      industry: data.industry,
      contactPerson: data.contactPerson,
      contactTitle: data.contactTitle,
      email: data.email.trim(),
      phone: data.phone || "—",
      dateOfBirth: data.dateOfBirth || "",
      activeProjects: projects.length,
      manager: data.manager ? assignableTeam.find((m) => m.name === data.manager) || null : null,
      lastActivityDate: new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
      lastActivityAgo: "just now",
      status: "Active",
      has_portal_access: !!portalPassword,
      workComplete: false,
      since: new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
      address: data.address || "—",
      country: data.country || "",
      totalProjects: projects.length,
      totalSpent: 0,
      outstanding: hasBudget ? budget : 0,
      profilePic: savedAvatarUrl || data.profilePic || null,
      projects,
      team: [data.manager].filter(Boolean),
      documents: [],
      invoices,
      activity: [
        ...(hasBudget ? [{ text: `Project budget of ${fmtMoney(budget)} added — ${invoices.length} milestone invoice${invoices.length === 1 ? "" : "s"} generated`, time: "just now" }] : []),
        { text: approvingRequest ? "Client approved from project request form" : "Client added to Hopenix", time: "just now" },
      ],
    };
    setClients((list) => [fresh, ...list]);
    // Assigned manager/employee gets the message right now (see
    // sendClientAssignmentMessage) — the client row is already saved on
    // the backend at this point, which is what lets the backend's
    // messaging permissions treat them as connected.
    if (fresh.manager?.name) {
      const assignedUser = (approvedUsers || []).find((u) => u.name === fresh.manager.name);
      sendClientAssignmentMessage({
        managerUser: assignedUser,
        senderId: authUser?.id,
        clientId: id,
        clientName: fresh.name,
        projectName: projects[0]?.name || "",
      });
    }
    setSelectedClientId(id);
    setAddOpen(false);
    finishApprovalIfAny();
    setNewClientInfo({
      id, name: fresh.name, email: fresh.email,
      password: portalPassword,
      portalError,
    });
    showToast(approvingRequest ? `"${fresh.name}" approved and added as a client.` : "Client added successfully.", "success");
    isAddingClientRef.current = false;
    setSavingClient(false);
  };

  // Generates (or resets) the REAL Client Portal login on the backend.
  // Without this, portal-login keeps returning 403 "Portal access hasn't
  // been set up for this account yet" — the Client ID alone is just the
  // row's pk, not portal access.
  const handleGeneratePortalAccess = async (client) => {
    if (!client?.backendSynced) {
      showToast("This client only exists locally (never reached the server) — portal access can't be generated for it.", "error");
      return;
    }
    if (!client.email || client.email === "—") {
      showToast("Add an email for this client before generating portal access.", "error");
      return;
    }
    setGeneratingPortalId(client.id);
    try {
      const { username, password } = await clientsApi.generatePortalAccess(client.id);
      setClients((list) => list.map((c) => (c.id === client.id ? { ...c, has_portal_access: true } : c)));
      setPortalCredentials({ name: client.name, clientId: client.id, username, password });
      showToast(`Portal access ready for ${client.name}.`, "success");
    } catch (err) {
      showToast(`Couldn't generate portal access: ${err.message}`, "error");
    } finally {
      setGeneratingPortalId(null);
    }
  };

  const openEdit = (id) => {
    setEditingClientId(id);
    setOpenActionMenu(null);
  };

  const handleEditSave = (id, data) => {
    const target = clients.find((c) => c.id === id);
    setClients((list) =>
      list.map((c) =>
        c.id === id
          ? {
              ...c,
              name: data.name,
              industry: data.industry,
              contactPerson: data.contactPerson,
              contactTitle: data.contactTitle,
              email: data.email.trim(),
              phone: data.phone || "—",
              dateOfBirth: data.dateOfBirth || c.dateOfBirth || "",
              address: data.address || "—",
              country: data.country || c.country,
              manager: data.manager ? assignableTeam.find((m) => m.name === data.manager) || c.manager : null,
              status: data.status,
              profilePic: data.profilePic !== undefined ? data.profilePic : c.profilePic,
              activeProjects: Number.isFinite(Number(data.activeProjects)) ? Number(data.activeProjects) : c.activeProjects,
              totalProjects: Number.isFinite(Number(data.totalProjects)) ? Number(data.totalProjects) : c.totalProjects,
              totalSpent: Number.isFinite(Number(data.totalSpent)) ? Math.min(Number(data.totalSpent), 99999999) : c.totalSpent,
              outstanding: Number.isFinite(Number(data.outstanding)) ? Math.min(Number(data.outstanding), 99999999) : c.outstanding,
            }
          : c
      )
    );
    setEditingClientId(null);
    showToast("Client updated successfully.", "success");

    // Best-effort sync to Postgres — never blocks the (already-applied)
    // local edit above. Older clients created before this integration
    // (backendSynced !== true, no real database row) simply skip this.
    if (target?.backendSynced) {
      const managerUser = data.manager ? (approvedUsers || []).find((u) => u.name === data.manager) : null;
      const fields = {
        name: data.name,
        email: data.email.trim(),
        industry: data.industry || "",
        contact_person: data.contactPerson || "",
        date_of_birth: data.dateOfBirth || null,
        phone: data.phone || "",
        address: data.address || "",
        country: data.country || "",
        country_code: (COUNTRY_CODE_BY_NAME[data.country] || "").toLowerCase(),
        status: (data.status || "Active").toLowerCase(),
        manager: managerUser ? managerUser.id : null,
      };
      // FIX (edited client's newly-picked photo never reached the
      // backend either — same root cause as Add Client, see
      // buildClientPayload above): upload it for real when there's a
      // fresh one, then swap the optimistic local data: URL for the
      // real saved URL so every other place reading profilePic (cards,
      // Dashboard, ...) shows the same real photo, not just this tab's
      // in-memory copy of it.
      buildClientPayload(fields, data.profilePic)
        .then((payload) => clientsApi.updateClient(id, payload))
        .then((savedClient) => {
          if (savedClient?.avatar) {
            setClients((prev) => prev.map((c) => (c.id === id ? { ...c, profilePic: savedClient.avatar } : c)));
          }
          // A NEW manager/employee was just assigned to this client from
          // the Edit form — tell them right away too (only when the
          // assignment actually changed, so a plain edit never re-sends).
          if (managerUser && managerUser.name !== target?.manager?.name) {
            sendClientAssignmentMessage({
              managerUser,
              senderId: authUser?.id,
              clientId: id,
              clientName: data.name,
              projectName: (target?.projects || [])[0]?.name || "",
            });
          }
        })
        .catch((err) => showToast(`Server sync failed for this edit: ${err.message}`, "error"));
    }
  };

  // "Approve" no longer silently creates the client with fixed defaults —
  // it opens the exact same Add Client modal admin already uses by hand,
  // pre-filled with everything the prospect submitted (name, contact info,
  // project name/type/details/budget), so admin can pick modules and set
  // up the milestone/payment plan themselves before the client is actually
  // created. `handleAdd` (above) detects `approvingRequestId` is set and
  // takes care of carrying the 30% advance screenshot onto Milestone 1's
  // invoice and clearing this request out of the pending list once
  // submitted — see `approvingRequest`/`withApprovalProof` there.
  const startApproveIntakeRequest = (requestId) => {
    setApprovingRequestId(requestId);
    setViewingRequestId(null);
    setRequestsPanelOpen(false);
    setAddOpen(true);
  };

  const rejectIntakeRequest = (requestId) => {
    const target = intakeRequests.find((r) => r.id === requestId);
    setIntakeRequests((list) => list.filter((r) => r.id !== requestId));
    setViewingRequestId(null);
    showToast("Request declined and removed.", "success");
    if (target?.backendId) {
      clientsApi
        .rejectIntakeRequestApi(target.backendId)
        .catch((err) => showToast(`Declined here, but didn't reach the server: ${err.message}`, "error"));
    }
  };

  // Makes the stat cards at the top of the page act as quick filters for
  // the table below — clicking one resets the other filters, applies the
  // relevant one, and scrolls the table into view.
  const applyQuickFilter = ({ tab = "all", status = "All Status", complete = "All Work", quick = null, toast }) => {
    setActiveTab(tab);
    setStatusFilter(status);
    setIndustryFilter("All Industries");
    setManagerFilter("All Managers");
    setCompleteFilter(complete);
    setQuickFilter(quick);
    setSearch("");
    setPage(1);
    if (toast) showToast(toast, "success");
    requestAnimationFrame(() => tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const clearQuickFilters = () => {
    setActiveTab("all");
    setStatusFilter("All Status");
    setIndustryFilter("All Industries");
    setManagerFilter("All Managers");
    setCompleteFilter("All Work");
    setQuickFilter(null);
    setSearch("");
  };

  const tabDefs = [
    { key: "all", label: "All Clients" },
    { key: "active", label: "Active" },
    { key: "inactive", label: "Inactive" },
    { key: "industry", label: "By Industry" },
  ];

  const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

  return (
    <div className={theme.headingText} style={{ fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif" }}>
      <div className="space-y-4">
        {backendLoadError && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-600">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            Couldn't reach the server to refresh clients ({backendLoadError}) — showing the last data this browser has.
          </div>
        )}
        <div className="flex justify-end items-center gap-2">
          {/* BELL — billing + module-request notifications. Badge count is
              `notifications.length`; the dropdown lists each one and jumps
              straight to that client's Billing/Projects tab on click. */}
          <div className="relative" ref={notifRef}>
            <button
              onClick={() => setNotifOpen((v) => !v)}
              className={`relative flex items-center justify-center w-10 h-10 rounded-full border transition ${theme.border} ${theme.inputBg} ${theme.cardText} hover:${theme.hoverIconBg}`}
            >
              <Bell className="w-4 h-4" />
              {notifications.length > 0 && (
                <span
                  className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ${
                    dark ? "ring-slate-900" : "ring-white"
                  }`}
                >
                  {notifications.length > 9 ? "9+" : notifications.length}
                </span>
              )}
            </button>
            {notifOpen && (
              <div className={`absolute right-0 top-full mt-2 w-80 max-h-96 overflow-y-auto rounded-xl shadow-xl z-30 ${theme.card}`}>
                <div className={`px-4 py-3 border-b ${theme.borderLight}`}>
                  <p className={`text-sm font-bold ${theme.headingText}`}>Notifications</p>
                  <p className={`text-[11px] ${theme.subtleText}`}>Billing aur module requests jo review ka intezar kar rahe hain</p>
                </div>
                {notifications.length === 0 ? (
                  <p className={`text-xs text-center py-8 ${theme.subtleText}`}>Koi nayi notification nahi.</p>
                ) : (
                  <div className={`divide-y ${theme.divide}`}>
                    {notifications.map((n) => (
                      <button
                        key={n.id}
                        onClick={() => {
                          setSelectedClientId(n.clientId);
                          setDetailsTab(n.type === "billing" ? "Billing" : "Projects");
                          setNotifOpen(false);
                        }}
                        className={`w-full text-left px-4 py-3 flex items-start gap-2.5 transition-colors ${theme.hoverRow}`}
                      >
                        <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${n.type === "billing" ? "bg-emerald-500" : "bg-amber-500"}`} />
                        <div className="min-w-0">
                          <p className={`text-xs leading-snug ${theme.cardText}`}>{n.text}</p>
                          {n.time && <p className={`text-[10px] mt-0.5 ${theme.subtleText}`}>{n.time}</p>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {/* REQUESTS — pending "New Project Request" submissions from the
              public client intake form. Badge mirrors the Bell's style so
              it reads as "things waiting on you" the same way. */}
          <button
            onClick={() => setRequestsPanelOpen(true)}
            className={`relative flex items-center gap-1.5 border text-sm font-semibold px-3.5 py-2.5 rounded-full transition shrink-0 ${theme.border} ${theme.inputBg} ${theme.cardText} hover:${theme.hoverIconBg}`}
            title="Project requests from clients"
          >
            <FileText className="w-4 h-4" />
            <span className="hidden sm:inline">Requests</span>
            {intakeRequests.length > 0 && (
              <span
                className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ${
                  dark ? "ring-slate-900" : "ring-white"
                }`}
              >
                {intakeRequests.length > 9 ? "9+" : intakeRequests.length}
              </span>
            )}
          </button>

          {/* SHARE CLIENT FORM — a real, working link to the public intake
              form (ClientIntakeForm.jsx). One click opens WhatsApp with the
              link pre-typed so the admin just picks a chat to send it to —
              no specific client needs to be added first. */}
          <a
            href={intakeFormWhatsappLink()}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 border border-emerald-500/30 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-sm font-semibold px-3.5 py-2.5 rounded-full transition shrink-0"
            title="Send the project request form link on WhatsApp"
          >
            <MessageCircle className="w-4 h-4" /> <span className="hidden sm:inline">Share Client Form</span>
          </a>

          <button
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 text-white text-sm font-semibold px-4 py-2.5 rounded-full transition shrink-0"
          >
            <Plus className="w-4 h-4" /> Add Client
          </button>
        </div>

        {/* STAT CARDS — each (besides Revenue, which has its own edit action)
            doubles as a quick filter for the table below */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard
            theme={theme}
            icon={Users2}
            iconBg="bg-violet-50"
            iconText="text-violet-600"
            label="Total Clients"
            value={counts.total}
            delta="14%"
            up
            active={activeTab === "all" && statusFilter === "All Status" && completeFilter === "All Work" && !quickFilter && !search}
            onClick={() => applyQuickFilter({ tab: "all", toast: "Showing all clients." })}
          />
          <StatCard
            theme={theme}
            icon={Briefcase}
            iconBg="bg-emerald-50"
            iconText="text-emerald-600"
            label="Active Clients"
            value={counts.active}
            delta="10%"
            up
            active={activeTab === "active" && !quickFilter}
            onClick={() => applyQuickFilter({ tab: "active", status: "Active", toast: "Showing active clients." })}
          />
          <StatCard
            theme={theme}
            icon={UserPlus2}
            iconBg="bg-blue-50"
            iconText="text-blue-600"
            label="New Clients"
            value={counts.newClients}
            delta="23%"
            up
            active={quickFilter === "newest"}
            onClick={() => applyQuickFilter({ tab: "all", quick: "newest", toast: "Showing the newest clients." })}
          />
          <StatCard
            theme={theme}
            icon={FolderOpen}
            iconBg="bg-amber-50"
            iconText="text-amber-600"
            label="Clients with Active Projects"
            value={counts.withActiveProjects}
            delta="8%"
            up
            active={quickFilter === "withProjects"}
            onClick={() => applyQuickFilter({ tab: "all", quick: "withProjects", toast: "Showing clients with active projects." })}
          />
          <StatCard
            theme={theme}
            icon={CheckCircle2}
            iconBg="bg-teal-50"
            iconText="text-teal-600"
            label="Work Completed"
            value={counts.completedWork}
            delta="5%"
            up
            active={completeFilter === "Completed" && !quickFilter}
            onClick={() => applyQuickFilter({ tab: "all", complete: "Completed", toast: "Showing clients with completed work." })}
          />
          <StatCard
            theme={theme}
            emphasize
            icon={DollarSign}
            iconBg="bg-indigo-50"
            iconText="text-indigo-600"
            label="Total Client Revenue"
            value={fmtMoney(displayedRevenue)}
            delta="16%"
            up
          />
          <StatCard
            theme={theme}
            icon={Wallet}
            iconBg="bg-rose-50"
            iconText="text-rose-600"
            label="Client Pending Payment"
            value={counts.pendingPaymentClients}
            active={pendingPaymentOpen}
            onClick={() => setPendingPaymentOpen(true)}
          />
        </div>

        {/* CONTENT GRID */}
        <div className="grid gap-4 items-start lg:grid-cols-[1fr,380px]">
          {/* LEFT: table card */}
          <div ref={tableRef} className={`rounded-2xl overflow-hidden ${theme.card}`}>
            <div className={`flex items-center gap-1 px-4 pt-3 overflow-x-auto whitespace-nowrap border-b ${theme.borderLight}`}>
              {tabDefs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`px-3 py-2 text-sm font-semibold border-b-2 transition shrink-0 ${
                    activeTab === t.key ? "text-violet-600 border-violet-600" : `${theme.mutedText} border-transparent hover:text-violet-500`
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {quickFilter && (
              <div className="flex items-center gap-2 px-4 pt-2.5">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-violet-50 text-violet-600">
                  {quickFilter === "newest" ? "Newest clients" : "Clients with active projects"}
                  <button onClick={() => setQuickFilter(null)} className="hover:text-violet-800">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              </div>
            )}

            {activeTab !== "industry" && (
              <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className={`text-sm border rounded-lg px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-violet-300 ${theme.border} ${theme.inputBg} ${theme.cardText}`}
                >
                  <option>All Status</option>
                  <option>Active</option>
                  <option>Inactive</option>
                </select>
                <select
                  value={industryFilter}
                  onChange={(e) => setIndustryFilter(e.target.value)}
                  className={`text-sm border rounded-lg px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-violet-300 ${theme.border} ${theme.inputBg} ${theme.cardText}`}
                >
                  <option>All Industries</option>
                  {INDUSTRIES.map((i) => (
                    <option key={i}>{i}</option>
                  ))}
                </select>
                <select
                  value={managerFilter}
                  onChange={(e) => setManagerFilter(e.target.value)}
                  className={`text-sm border rounded-lg px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-violet-300 ${theme.border} ${theme.inputBg} ${theme.cardText}`}
                >
                  <option>All Managers</option>
                  {managerOptions.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
                <select
                  value={completeFilter}
                  onChange={(e) => setCompleteFilter(e.target.value)}
                  className={`text-sm border rounded-lg px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-violet-300 ${theme.border} ${theme.inputBg} ${theme.cardText}`}
                >
                  <option>All Work</option>
                  <option>Completed</option>
                  <option>In progress</option>
                </select>

                <div className="relative" ref={filtersRef}>
                  <button onClick={() => setFiltersOpen((v) => !v)} className={`flex items-center gap-1.5 text-sm border rounded-lg px-3 py-1.5 ${theme.border} ${theme.inputBg} ${theme.cardText}`}>
                    <Filter className="w-3.5 h-3.5" /> Filter
                    <ChevronDown size={12} className={`transition-transform ${filtersOpen ? "rotate-180" : ""}`} />
                  </button>
                  {filtersOpen && (
                    <div className={`absolute left-0 top-full mt-1.5 w-52 rounded-xl shadow-xl z-30 p-3 space-y-2 ${theme.card}`}>
                      <p className={`text-[10px] font-bold uppercase tracking-wide ${theme.subtleText}`}>Quick filters</p>
                      <button
                        onClick={() => {
                          clearQuickFilters();
                          setFiltersOpen(false);
                        }}
                        className="w-full text-xs font-semibold text-violet-600 hover:text-violet-700 text-left"
                      >
                        Clear all filters
                      </button>
                    </div>
                  )}
                </div>

                <div className="relative flex-1 min-w-[160px] ml-auto max-w-xs">
                  <Search className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 ${theme.subtleText}`} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search clients..."
                    className={`w-full text-sm border rounded-lg pl-9 pr-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-300 ${theme.border} ${theme.inputBg} ${theme.cardText}`}
                  />
                </div>
              </div>
            )}

            {/* ---------- By Industry view ---------- */}
            {activeTab === "industry" && (
              <div className="p-4 space-y-3 max-h-[600px] overflow-y-auto">
                {INDUSTRIES.map((ind) => {
                  const list = clients.filter((c) => c.industry === ind);
                  if (list.length === 0) return null;
                  const active = list.filter((c) => c.status === "Active").length;
                  return (
                    <div key={ind} className={`rounded-xl border ${theme.borderLight}`}>
                      <div className="flex items-center justify-between px-4 py-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-violet-50 text-violet-500">
                            <Building2 className="w-4 h-4" />
                          </span>
                          <div className="min-w-0">
                            <p className={`font-semibold text-sm truncate ${theme.headingText}`}>{ind}</p>
                            <p className={`text-[11px] ${theme.subtleText}`}>
                              {active}/{list.length} active
                            </p>
                          </div>
                        </div>
                        <div className={`w-24 h-1.5 rounded-full overflow-hidden shrink-0 ${theme.inputBg}`}>
                          <div className="h-full rounded-full bg-gradient-to-r from-violet-600 to-indigo-500" style={{ width: `${list.length ? (active / list.length) * 100 : 0}%` }} />
                        </div>
                      </div>
                      <div className={`divide-y ${theme.divide}`}>
                        {list.slice(0, 6).map((c) => (
                          <button
                            key={c.id}
                            onClick={() => {
                              setSelectedClientId(c.id);
                              setDetailsTab("Overview");
                            }}
                            className={`w-full flex items-center justify-between gap-3 text-left px-4 py-2.5 transition-colors ${theme.hoverRow} ${selectedClientId === c.id ? "bg-violet-50/50" : ""}`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <CompanyAvatar name={c.name} size="w-6 h-6" text="text-[9px]" imageUrl={c.profilePic} />
                              <span className={`text-xs font-medium truncate ${theme.headingText}`}>{c.name}</span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {c.workComplete && <CheckCircle2 className="w-3.5 h-3.5 text-violet-500" />}
                              <StatusBadge status={c.status} />
                            </div>
                          </button>
                        ))}
                        {list.length > 6 && <p className={`px-4 py-2 text-[11px] ${theme.subtleText}`}>+{list.length - 6} more</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ---------- Table view ---------- */}
            {activeTab !== "industry" && (
              <>
                <div className="hidden md:block overflow-auto max-h-[600px]">
                  <table className="w-full min-w-[980px] text-sm">
                    <thead className="sticky top-0 z-10">
                      <tr className={`text-left text-xs border-y ${theme.mutedText} ${theme.borderLight} ${theme.inputBg}`}>
                        <th className="py-2.5 pl-5 pr-2 font-semibold">Client / Company</th>
                        <th className="py-2.5 px-2 font-semibold">Contact Person</th>
                        <th className="py-2.5 px-2 font-semibold">Email</th>
                        <th className="py-2.5 px-2 font-semibold">Active Projects</th>
                        <th className="py-2.5 px-2 font-semibold">Assigned Manager</th>
                        <th className="py-2.5 px-2 font-semibold">Last Activity</th>
                        <th className="py-2.5 px-2 font-semibold">Status</th>
                        <th className="py-2.5 px-2 font-semibold">Work</th>
                        <th className="py-2.5 pr-5 pl-2 font-semibold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${theme.divide}`}>
                      {paged.map((c) => (
                        <tr
                          key={c.id}
                          onClick={() => {
                            setSelectedClientId(c.id);
                            setDetailsTab("Overview");
                          }}
                          className={`cursor-pointer ${theme.hoverRow}`}
                        >
                          <td className="py-2.5 pl-5 pr-2">
                            <div className="flex items-center gap-2.5 min-w-[190px]">
                              <div className="relative shrink-0">
                                <CompanyAvatar name={c.name} imageUrl={c.profilePic} />
                                {needsAttention(c) && (
                                  <span
                                    title={
                                      hasPendingProjectRequest(c) && hasPendingBillingReview(c)
                                        ? "New project request and a payment awaiting confirmation"
                                        : hasPendingProjectRequest(c)
                                        ? "New module request awaiting review"
                                        : "Payment submitted — awaiting confirmation"
                                    }
                                    className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ${dark ? "ring-slate-900" : "ring-white"}`}
                                  />
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className={`font-semibold truncate ${theme.headingText}`}>{c.name}</p>
                                <IndustryText industry={c.industry} theme={theme} />
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-2">
                            <div className="min-w-[130px]">
                              <p className={`font-medium truncate ${theme.cardText}`}>{c.contactPerson}</p>
                              <p className={`text-[11px] truncate ${theme.subtleText}`}>{c.contactTitle}</p>
                            </div>
                          </td>
                          <td className="py-2.5 px-2">
                            <div className="min-w-[160px]">
                              <p className={`truncate ${theme.cardText}`}>{c.email}</p>
                              <p className={`text-[11px] truncate ${theme.subtleText}`}>{c.phone}</p>
                            </div>
                          </td>
                          <td className="py-2.5 px-2 whitespace-nowrap">
                            {(c.projects?.length || 0) > 1 ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedClientId(c.id);
                                  setDetailsTab("Projects");
                                }}
                                title="View all projects"
                                className="font-semibold text-violet-600 hover:text-violet-700 hover:underline underline-offset-2"
                              >
                                {c.activeProjects}
                              </button>
                            ) : (
                              <span className={`font-semibold ${theme.cardText}`}>{c.activeProjects}</span>
                            )}
                          </td>
                          <td className="py-2.5 px-2">
                            <div className="flex items-center gap-2 whitespace-nowrap">
                              <PersonAvatar name={c.manager?.name} size="w-7 h-7" />
                              <div className="min-w-0">
                                <p className={`truncate text-xs font-medium ${theme.cardText}`}>{c.manager?.name}</p>
                                <p className={`text-[10.5px] truncate ${theme.subtleText}`}>{c.manager?.role}</p>
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-2 whitespace-nowrap">
                            <p className={theme.cardText}>{c.lastActivityDate}</p>
                            <p className={`text-[11px] ${theme.subtleText}`}>{c.lastActivityAgo}</p>
                          </td>
                          <td className="py-2.5 px-2">
                            <StatusBadge status={c.status} />
                          </td>
                          <td className="py-2.5 px-2" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => toggleWorkComplete(c.id)}
                              title={c.workComplete ? "Mark as in progress" : "Mark work complete"}
                              className={`w-7 h-7 rounded-lg flex items-center justify-center border transition ${
                                c.workComplete
                                  ? "bg-violet-600 border-violet-600 text-white"
                                  : `${theme.card} ${theme.border} text-transparent hover:border-violet-300`
                              }`}
                            >
                              <Check className="w-4 h-4" />
                            </button>
                          </td>
                          <td className="py-2.5 pr-5 pl-2 text-right relative" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={(e) => {
                                if (openActionMenu === c.id) {
                                  setOpenActionMenu(null);
                                  setActionMenuPos(null);
                                  return;
                                }
                                // FIX (popup getting clipped/cut off): this menu used to be
                                // `absolute` inside a td that sits inside the table's
                                // `overflow-auto` wrapper, so for rows near the bottom/edge
                                // of that scroll box the dropdown got clipped or shoved off
                                // screen instead of floating on top of everything. It's now
                                // portaled straight to <body> and placed with fixed
                                // viewport coords computed from the button itself, so it
                                // always renders fully on-screen regardless of table scroll.
                                const rect = e.currentTarget.getBoundingClientRect();
                                const menuWidth = 192; // w-48
                                const menuHeight = 220; // approx, enough for 5 rows
                                const left = Math.min(Math.max(8, rect.right - menuWidth), window.innerWidth - menuWidth - 8);
                                const top = Math.min(rect.bottom + 6, window.innerHeight - menuHeight - 8);
                                setActionMenuPos({ top, left });
                                setOpenActionMenu(c.id);
                              }}
                              className={`w-8 h-8 inline-flex items-center justify-center rounded-lg ${theme.mutedText} hover:${theme.hoverIconBg}`}
                              aria-label="Row actions"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                            {openActionMenu === c.id &&
                              actionMenuPos &&
                              createPortal(
                                <>
                                  <div
                                    className="fixed inset-0 z-[100]"
                                    onClick={() => {
                                      setOpenActionMenu(null);
                                      setActionMenuPos(null);
                                    }}
                                  />
                                  <div
                                    style={{ top: actionMenuPos.top, left: actionMenuPos.left }}
                                    className={`fixed z-[101] w-48 rounded-xl shadow-lg py-1 text-left ${theme.card}`}
                                  >
                                    <button
                                      onClick={() => {
                                        setSelectedClientId(c.id);
                                        setDetailsTab("Overview");
                                        setOpenActionMenu(null);
                                        setActionMenuPos(null);
                                      }}
                                      className={`w-full flex items-center gap-2 text-left px-3 py-2 text-sm ${theme.cardText} ${theme.hoverRow}`}
                                    >
                                      <Eye className="w-3.5 h-3.5" /> View profile
                                    </button>
                                    <button
                                      onClick={() => {
                                        openEdit(c.id);
                                        setOpenActionMenu(null);
                                        setActionMenuPos(null);
                                      }}
                                      className={`w-full flex items-center gap-2 text-left px-3 py-2 text-sm ${theme.cardText} ${theme.hoverRow}`}
                                    >
                                      <Pencil className="w-3.5 h-3.5" /> Edit client
                                    </button>
                                    {c.status !== "Inactive" ? (
                                      <button
                                        onClick={() => {
                                          setClientStatus(c.id, "Inactive");
                                          setOpenActionMenu(null);
                                          setActionMenuPos(null);
                                        }}
                                        className={`w-full flex items-center gap-2 text-left px-3 py-2 text-sm ${theme.cardText} ${theme.hoverRow}`}
                                      >
                                        <UserX className="w-3.5 h-3.5" /> Deactivate
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => {
                                          setClientStatus(c.id, "Active");
                                          setOpenActionMenu(null);
                                          setActionMenuPos(null);
                                        }}
                                        className={`w-full flex items-center gap-2 text-left px-3 py-2 text-sm ${theme.cardText} ${theme.hoverRow}`}
                                      >
                                        <UserCheck className="w-3.5 h-3.5" /> Activate
                                      </button>
                                    )}
                                    <button
                                      onClick={() => {
                                        toggleWorkComplete(c.id);
                                        setOpenActionMenu(null);
                                        setActionMenuPos(null);
                                      }}
                                      className={`w-full flex items-center gap-2 text-left px-3 py-2 text-sm ${theme.cardText} ${theme.hoverRow}`}
                                    >
                                      <CheckCircle2 className="w-3.5 h-3.5" /> {c.workComplete ? "Mark in progress" : "Mark work complete"}
                                    </button>
                                    <button
                                      onClick={() => {
                                        removeClient(c.id);
                                        setOpenActionMenu(null);
                                        setActionMenuPos(null);
                                      }}
                                      className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm text-rose-600 hover:bg-rose-50"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" /> Remove client
                                    </button>
                                  </div>
                                </>,
                                document.body
                              )}
                          </td>
                        </tr>
                      ))}
                      {paged.length === 0 && (
                        <tr>
                          <td colSpan={9} className={`text-center py-14 text-sm ${theme.subtleText}`}>
                            No clients match these filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Mobile card list */}
                <div className={`md:hidden divide-y ${theme.divide} overflow-y-auto max-h-[600px]`}>
                  {paged.map((c) => (
                    <div key={c.id} className={`p-4 ${theme.hoverRow}`}>
                      <button
                        onClick={() => {
                          setSelectedClientId(c.id);
                          setDetailsTab("Overview");
                        }}
                        className="w-full text-left"
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="relative shrink-0">
                              <CompanyAvatar name={c.name} imageUrl={c.profilePic} />
                              {needsAttention(c) && (
                                <span
                                  title={
                                    hasPendingProjectRequest(c) && hasPendingBillingReview(c)
                                      ? "New project request and a payment awaiting confirmation"
                                      : hasPendingProjectRequest(c)
                                      ? "New module request awaiting review"
                                      : "Payment submitted — awaiting confirmation"
                                  }
                                  className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ${dark ? "ring-slate-900" : "ring-white"}`}
                                />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className={`font-semibold text-sm truncate ${theme.headingText}`}>{c.name}</p>
                              <IndustryText industry={c.industry} theme={theme} />
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <StatusBadge status={c.status} />
                            <WorkCompleteBadge complete={c.workComplete} />
                          </div>
                        </div>
                        <div className={`flex items-center justify-between text-xs ${theme.mutedText}`}>
                          <span>{c.contactPerson}</span>
                          {(c.projects?.length || 0) > 1 ? (
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedClientId(c.id);
                                setDetailsTab("Projects");
                              }}
                              className="font-semibold text-violet-600 underline underline-offset-2"
                            >
                              {c.activeProjects} active projects
                            </span>
                          ) : (
                            <span>{c.activeProjects} active projects</span>
                          )}
                        </div>
                        <p className={`text-[11px] mt-1 truncate ${theme.subtleText}`}>{c.email}</p>
                      </button>
                      <button
                        onClick={() => toggleWorkComplete(c.id)}
                        className={`mt-2.5 w-full flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-lg border transition ${
                          c.workComplete ? "bg-violet-50 border-violet-200 text-violet-600" : `${theme.border} ${theme.mutedText}`
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> {c.workComplete ? "Marked complete" : "Mark work complete"}
                      </button>
                      <div className="mt-2 grid grid-cols-3 gap-1.5">
                        <button
                          onClick={() => openEdit(c.id)}
                          className={`flex items-center justify-center gap-1 text-[11px] font-semibold py-2 rounded-lg border ${theme.border} ${theme.cardText}`}
                        >
                          <Pencil className="w-3 h-3" /> Edit
                        </button>
                        <button
                          onClick={() => setClientStatus(c.id, c.status === "Active" ? "Inactive" : "Active")}
                          className={`flex items-center justify-center gap-1 text-[11px] font-semibold py-2 rounded-lg border ${theme.border} ${theme.cardText}`}
                        >
                          {c.status === "Active" ? <UserX className="w-3 h-3" /> : <UserCheck className="w-3 h-3" />}
                          {c.status === "Active" ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          onClick={() => removeClient(c.id)}
                          className="flex items-center justify-center gap-1 text-[11px] font-semibold py-2 rounded-lg border border-rose-200 text-rose-600"
                        >
                          <Trash2 className="w-3 h-3" /> Remove
                        </button>
                      </div>
                    </div>
                  ))}
                  {paged.length === 0 && <p className={`text-center py-12 text-sm ${theme.subtleText}`}>No clients match these filters.</p>}
                </div>

                {/* Pagination */}
                <div className={`flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t ${theme.borderLight} text-sm`}>
                  <p className={`text-xs ${theme.subtleText}`}>
                    Showing {filtered.length === 0 ? 0 : pageStart + 1} to {Math.min(pageStart + rowsPerPage, filtered.length)} of {filtered.length} clients
                  </p>
                  <div className="flex items-center gap-1.5 flex-wrap justify-center">
                    <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className={`w-8 h-8 flex items-center justify-center rounded-lg border ${theme.border} disabled:opacity-40`}>
                      ‹
                    </button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1).slice(0, 5).map((p) => (
                      <button key={p} onClick={() => setPage(p)} className={`w-8 h-8 rounded-lg text-sm font-semibold ${page === p ? "bg-violet-600 text-white" : `border ${theme.border} ${theme.cardText}`}`}>
                        {p}
                      </button>
                    ))}
                    <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className={`w-8 h-8 flex items-center justify-center rounded-lg border ${theme.border} disabled:opacity-40`}>
                      ›
                    </button>
                  </div>
                  <div className={`flex items-center gap-2 text-xs ${theme.subtleText}`}>
                    Rows per page:
                    <select value={rowsPerPage} onChange={(e) => setRowsPerPage(Number(e.target.value))} className={`border rounded-lg px-2 py-1 outline-none ${theme.border} ${theme.inputBg} ${theme.cardText}`}>
                      {[8, 10, 25, 50].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* RIGHT: Client Details panel.
              Mobile (<lg): fixed bottom-sheet overlay with its own scroll,
              only appears once a client is actually tapped (see the
              selectedClientId default above), and no longer forces the
              user to scroll past the whole client list to reach it.
              Desktop (lg+): `lg:contents` drops the wrapper so the panel
              stays a normal sticky grid column, unchanged. */}
          <div
            className={
              selectedClient
                ? "fixed inset-0 z-50 flex items-end justify-center bg-black/50 lg:contents"
                : "hidden lg:contents"
            }
            onClick={() => setSelectedClientId(null)}
          >
            <div
              className={`w-full max-h-[88vh] overflow-y-auto rounded-t-2xl p-4 lg:max-h-none lg:overflow-visible lg:w-auto lg:rounded-2xl lg:sticky lg:top-4 ${theme.card}`}
              onClick={(e) => e.stopPropagation()}
            >
            {selectedClient ? (
              <ClientDetails
                client={selectedClient}
                detailsTab={detailsTab}
                setDetailsTab={setDetailsTab}
                onClose={() => setSelectedClientId(null)}
                onEdit={() => openEdit(selectedClient.id)}
                onGeneratePortalAccess={() => handleGeneratePortalAccess(selectedClient)}
                generatingPortalAccess={generatingPortalId === selectedClient.id}
                onDeactivate={() => {
                  setClientStatus(selectedClient.id, selectedClient.status === "Active" ? "Inactive" : "Active");
                  showToast(selectedClient.status === "Active" ? `${selectedClient.name} deactivated.` : `${selectedClient.name} reactivated.`, selectedClient.status === "Active" ? "error" : "success");
                }}
                onToggleComplete={() => toggleWorkComplete(selectedClient.id)}
                onToggleProjectModule={(projectName, moduleId, subModuleId) => toggleProjectModule(selectedClient.id, projectName, moduleId, subModuleId)}
                onAddModuleAttachment={(projectName, moduleId, subModuleId, attachment, file) =>
                  addModuleAttachment(selectedClient.id, projectName, moduleId, subModuleId, attachment, file)
                }
                onToggleAttachmentApproval={(projectName, moduleId, subModuleId, projectBackendId, moduleBackendId, attachmentId, approved) =>
                  toggleModuleAttachmentApproval(selectedClient.id, projectName, moduleId, subModuleId, projectBackendId, moduleBackendId, attachmentId, approved)
                }
                onSetDeliverableZip={(projectName, zip) => setProjectDeliverableZip(selectedClient.id, projectName, zip)}
                onEditProject={(projectName) => setEditingProject({ clientId: selectedClient.id, projectName })}
                onDeleteProject={(projectName) => deleteProject(selectedClient.id, projectName)}
                onAcceptModuleRequest={(requestId) => acceptModuleRequest(selectedClient.id, requestId)}
                onDeclineModuleRequest={(requestId) => declineModuleRequest(selectedClient.id, requestId)}
                onGenerateInvoice={() => setInvoiceModalOpen(true)}
                onRecordPayment={(invoiceId) => setPayingInvoiceId(invoiceId)}
                theme={theme}
              />
            ) : (
              <div className="text-center py-10">
                <span className="w-12 h-12 rounded-xl bg-violet-50 text-violet-500 flex items-center justify-center mx-auto mb-3">
                  <Building2 className="w-5 h-5" />
                </span>
                <p className={`text-sm font-semibold ${theme.headingText}`}>No client selected</p>
                <p className={`text-xs mt-1 ${theme.subtleText}`}>Click any client in the list to see its details here.</p>
              </div>
            )}
            </div>
          </div>
        </div>
      </div>

      {addOpen && (
        <AddClientModal
          theme={theme}
          onClose={() => {
            setAddOpen(false);
            setApprovingRequestId(null);
          }}
          onSubmit={handleAdd}
          submitting={savingClient}
          isValidEmail={isValidEmail}
          existingClients={clients}
          managers={assignableManagers}
          initialData={approvingRequestId ? initialDataFromIntakeRequest(intakeRequests.find((r) => r.id === approvingRequestId)) : null}
          approvalScreenshot={approvingRequestId ? intakeRequests.find((r) => r.id === approvingRequestId)?.paymentScreenshot || null : null}
          title={approvingRequestId ? "Approve Request — Set Up Client" : "Add Client"}
        />
      )}

      {newClientInfo && <NewClientIdModal theme={theme} info={newClientInfo} onClose={() => setNewClientInfo(null)} />}
      {portalCredentials && (
        <PortalCredentialsModal theme={theme} info={portalCredentials} onClose={() => setPortalCredentials(null)} />
      )}

      {requestsPanelOpen && (
        <IntakeRequestsModal
          theme={theme}
          dark={dark}
          requests={intakeRequests}
          viewingRequestId={viewingRequestId}
          onView={setViewingRequestId}
          onApprove={startApproveIntakeRequest}
          onReject={rejectIntakeRequest}
          onClose={() => {
            setRequestsPanelOpen(false);
            setViewingRequestId(null);
          }}
        />
      )}

      {editingClientId && (
        <EditClientModal
          theme={theme}
          client={clients.find((c) => c.id === editingClientId)}
          onClose={() => setEditingClientId(null)}
          onSubmit={(data) => handleEditSave(editingClientId, data)}
          isValidEmail={isValidEmail}
          managers={assignableManagers}
        />
      )}

      {editingProject && (
        <EditProjectModal
          theme={theme}
          project={(clients.find((c) => c.id === editingProject.clientId)?.projects || []).find((p) => p.name === editingProject.projectName)}
          onClose={() => setEditingProject(null)}
          onSubmit={(data) => updateProjectDetails(editingProject.clientId, editingProject.projectName, data)}
        />
      )}

      {invoiceModalOpen && selectedClient && (
        <GenerateInvoiceModal
          theme={theme}
          client={selectedClient}
          onClose={() => setInvoiceModalOpen(false)}
          onSubmit={(data) => generateInvoice(selectedClient.id, data)}
        />
      )}

      {payingInvoiceId && selectedClient && (selectedClient.invoices || []).some((i) => i.id === payingInvoiceId) && (
        <RecordPaymentModal
          theme={theme}
          invoice={(selectedClient.invoices || []).find((i) => i.id === payingInvoiceId)}
          onClose={() => setPayingInvoiceId(null)}
          onSubmit={(amt) => recordInvoicePayment(selectedClient.id, payingInvoiceId, amt)}
        />
      )}

      {pendingPaymentOpen && (
        <PendingPaymentModal
          theme={theme}
          clients={clients}
          onClose={() => setPendingPaymentOpen(false)}
          onSelectClient={(id) => {
            setSelectedClientId(id);
            setPendingPaymentOpen(false);
          }}
        />
      )}

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 z-[100] space-y-2 w-[calc(100%-2rem)] max-w-sm">
        {toasts.map((t) => (
          <div key={t.id} className={`rounded-xl px-4 py-3 text-sm font-medium shadow-lg text-white ${t.tone === "error" ? "bg-rose-600" : "bg-emerald-600"}`}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ======================================================================
   CLIENT DETAILS PANEL
====================================================================== */

const DETAILS_TABS = ["Overview", "Projects", "Team", "Billing", "Documents", "Activity"];

// Activity tab — merges this browser's local activity feed (every admin
// action: client added, budget set, module ticked, ...) with the REAL
// backend log (dashboard.ActivityLogEntry — payment submitted/confirmed,
// module request accepted/declined, support requests). That backend
// endpoint already existed but nothing on this page ever called it, so
// entries a client generated from their own Client Portal never showed
// up here unless they also happened to get written into this browser's
// localStorage by some other code path. Fetched fresh every time this
// tab is opened for a (real, backendSynced) client — best-effort, a
// failure here just falls back to the local-only feed.
function ActivityTabContent({ client, theme }) {
  const [backendEntries, setBackendEntries] = useState([]);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!client?.backendSynced) {
      setBackendEntries([]);
      return;
    }
    clientsApi
      .listActivity(client.id)
      .then((rows) => {
        if (cancelled || !Array.isArray(rows)) return;
        setBackendEntries(
          rows.map((r) => ({
            text: r.text,
            time: new Date(r.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
            sortKey: r.created_at,
            fromServer: true,
          }))
        );
        setLoadError(null);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [client?.id, client?.backendSynced]);

  const combined = [
    ...backendEntries,
    ...(client.activity || []).map((a) => ({ ...a, sortKey: a.sortKey || null })),
  ];
  // Real server entries carry a real timestamp and sort correctly among
  // themselves; local-only ones ("just now" etc.) don't have a sortable
  // timestamp, so they're simply kept in their existing (already
  // newest-first) order, stacked ahead of the server ones. Good enough
  // for a feed that's read top-to-bottom, without pretending we can
  // perfectly interleave a exact timestamp against "just now".
  const entries = [...combined.filter((a) => !a.sortKey), ...combined.filter((a) => a.sortKey)];

  return (
    <div className="space-y-2">
      {loadError && (
        <p className={`text-[10.5px] ${theme.subtleText}`}>Couldn't load server activity ({loadError}) — showing what's saved here.</p>
      )}
      {entries.length === 0 && <p className={`text-xs ${theme.subtleText}`}>No activity recorded yet.</p>}
      {entries.map((a, i) => (
        <div key={i} className={`flex items-start gap-2.5 rounded-xl border p-2.5 ${theme.borderLight}`}>
          <span className="w-7 h-7 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center shrink-0 mt-0.5">
            <ActivityIcon className="w-3.5 h-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className={`text-xs ${theme.cardText}`}>{a.text}</p>
            <p className={`text-[10.5px] ${theme.subtleText}`}>{a.time}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// Documents tab — fetches real uploaded documents from the Django backend
// (/api/dashboard/documents/?client=<id>). Upload, download, and delete
// are all wired to the real API. Only rendered for backend-synced clients
// (those with a real Postgres id). Follows the same self-contained
// component pattern as ActivityTabContent above.
function DocumentsTabContent({ client, theme }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const fileInputRef = useRef(null);

  const reload = () => {
    if (!client?.backendSynced) return;
    setLoading(true);
    setLoadError(null);
    clientsApi
      .listDocuments(client.id)
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : (rows.results || []);
        setDocs(list);
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.id, client?.backendSynced]);

  const handleUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    clientsApi
      .uploadDocument(client.id, file)
      .then(() => reload())
      .catch((err) => setUploadError(err.message))
      .finally(() => {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      });
  };

  const handleDelete = (docId) => {
    if (!window.confirm("Delete this document? This cannot be undone.")) return;
    clientsApi
      .deleteDocument(docId)
      .then(() => setDocs((prev) => prev.filter((d) => d.id !== docId)))
      .catch((err) => alert("Delete failed: " + err.message));
  };

  if (!client?.backendSynced) {
    return <p className={`text-xs ${theme.subtleText}`}>Documents are available for saved clients only.</p>;
  }

  return (
    <div className="space-y-3">
      {/* Upload button */}
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          id={`doc-upload-${client.id}`}
          className="hidden"
          onChange={handleUpload}
          disabled={uploading}
        />
        <label
          htmlFor={`doc-upload-${client.id}`}
          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full cursor-pointer transition border ${theme.border} ${theme.cardText} hover:bg-slate-50 dark:hover:bg-white/5 ${uploading ? "opacity-50 pointer-events-none" : ""}`}
        >
          <Upload className="w-3.5 h-3.5" />
          {uploading ? "Uploading…" : "Upload Document"}
        </label>
      </div>

      {/* Error messages */}
      {loadError && <p className={`text-[10.5px] ${theme.subtleText}`}>Couldn't load documents: {loadError}</p>}
      {uploadError && <p className="text-[10.5px] text-rose-500">{uploadError}</p>}

      {/* Document list */}
      {loading && <p className={`text-xs ${theme.subtleText}`}>Loading…</p>}
      {!loading && docs.length === 0 && !loadError && (
        <p className={`text-xs ${theme.subtleText}`}>No documents uploaded yet.</p>
      )}
      <div className="space-y-2">
        {docs.map((d) => (
          <div key={d.id} className={`flex items-center gap-2.5 rounded-xl border p-2.5 ${theme.borderLight}`}>
            <span className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-xs font-semibold truncate ${theme.cardText}`}>{d.file_name}</p>
              <p className={`text-[10.5px] ${theme.subtleText}`}>
                {d.file_size && <>{d.file_size} · </>}
                {new Date(d.uploaded_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                {d.uploaded_by_name && <> · {d.uploaded_by_name}</>}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {d.file_url && (
                <a
                  href={d.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  download={d.file_name}
                  className={`w-7 h-7 flex items-center justify-center rounded-lg border ${theme.borderLight} ${theme.subtleText} hover:text-blue-600 transition`}
                  title="Download"
                >
                  <Download className="w-3.5 h-3.5" />
                </a>
              )}
              <button
                type="button"
                onClick={() => handleDelete(d.id)}
                className={`w-7 h-7 flex items-center justify-center rounded-lg border ${theme.borderLight} ${theme.subtleText} hover:text-rose-600 transition`}
                title="Delete document"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ClientDetails({ client, detailsTab, setDetailsTab, onClose, onEdit, onGeneratePortalAccess, generatingPortalAccess, onDeactivate, onToggleComplete, onToggleProjectModule, onAddModuleAttachment, onToggleAttachmentApproval, onSetDeliverableZip, onEditProject, onDeleteProject, onAcceptModuleRequest, onDeclineModuleRequest, onGenerateInvoice, onRecordPayment, theme }) {
  const countryCode = COUNTRY_CODE_BY_NAME[client.country];
  const [expandedProject, setExpandedProject] = useState(null);
  // Which module/sub-task row's Task Details panel is currently open —
  // { projectName, moduleId, subModuleId, name, done, attachments }.
  const [selectedModule, setSelectedModule] = useState(null);
  // NEW — the attachment currently open in the review popup:
  // { snapshot: <attachment>, ctx: <which project/module it belongs to> }.
  const [attachmentPreview, setAttachmentPreview] = useState(null);
  // Full-size view of a client's uploaded payment screenshot — opened by
  // tapping the small thumbnail next to an invoice below. Doesn't touch
  // any other state; just a local lightbox for this one image.
  const [paymentProofPreview, setPaymentProofPreview] = useState(null);
  // Full branded invoice document — opened by "View Invoice" below.
  const [viewingInvoice, setViewingInvoice] = useState(null);
  // Full-size view of this client's own profile picture — opened by
  // tapping the avatar tile in the header just below. Same one-off
  // lightbox pattern as paymentProofPreview above.
  const [profilePicPreview, setProfilePicPreview] = useState(false);
  const invoices = client.invoices || [];
  const totalInvoiced = invoices.reduce((sum, inv) => sum + (inv.amount || 0), 0);
  const totalPaid = invoices.reduce((sum, inv) => sum + (inv.paidAmount || 0), 0);

  // NEW — a click on an uploaded file / zip / URL (project checklist chips and
  // the Task Details panel both come through here). Unapproved → review popup
  // first; already-approved URL / zip / file → straight to open / download.
  // ctx = { projectName, moduleId, subModuleId, projectBackendId,
  // moduleBackendId, name }.
  const openAttachment = (a, ctx) => {
    if (isDirectActionAttachment(a)) {
      runAttachmentAction(a);
      return;
    }
    setAttachmentPreview({ snapshot: a, ctx });
  };
  // Always show the freshest copy (its approved flag changes while the popup
  // is open) by looking the attachment up again in the live client data.
  const livePreviewAttachment = (() => {
    if (!attachmentPreview) return null;
    const { snapshot, ctx } = attachmentPreview;
    const project = (client.projects || []).find((pr) => pr.name === ctx.projectName);
    const mod = (project?.modules || []).find((mm) => mm.id === ctx.moduleId);
    const holder = ctx.subModuleId ? (mod?.subModules || []).find((ss) => ss.id === ctx.subModuleId) : mod;
    return (holder?.attachments || []).find((x) => x.id === snapshot.id) || snapshot;
  })();

  return (
    <div>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => client.profilePic && setProfilePicPreview(true)}
            className={client.profilePic ? "cursor-zoom-in" : "cursor-default"}
            title={client.profilePic ? "View profile picture" : undefined}
          >
            <CompanyAvatar name={client.name} size="w-12 h-12" text="text-sm" imageUrl={client.profilePic} />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className={`font-bold text-sm truncate ${theme.headingText}`}>{client.name}</h3>
              {client.country && (
                <span className="text-base leading-none" title={client.country}>
                  {countryFlagEmoji(countryCode)}
                </span>
              )}
              <StatusBadge status={client.status} />
            </div>
            <p className={`text-[11px] mt-0.5 ${theme.subtleText}`}>{client.industry}</p>
            <p className={`text-[10.5px] ${theme.subtleText}`}>Client since {client.since}</p>
          </div>
        </div>
        <button onClick={onClose} className={`w-7 h-7 flex items-center justify-center rounded-lg shrink-0 ${theme.subtleText} hover:${theme.hoverIconBg}`}>
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Portal login Client ID — the same value the client types into
          the Client Portal login screen alongside their email. */}
      <div className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 mb-3 ${theme.border} ${theme.inputBg}`}>
        <span className={`flex items-center gap-1.5 text-xs font-semibold min-w-0 ${theme.cardText}`}>
          <KeyRound className="w-3.5 h-3.5 text-violet-500 shrink-0" />
          <span className="shrink-0">Client ID:</span> <span className="font-bold tracking-wide truncate">{client.id}</span>
        </span>
        <span className="shrink-0">
          <CopyButton value={client.id} label="Copy ID" className={`${theme.subtleText} hover:text-violet-600`} />
        </span>
      </div>

      {/* Generate Portal Access — creates the backend users.User row
          (role="client") linked as client.portal_user. The Client ID
          above exists the moment a client is added; portal LOGIN does
          not work until this has been run at least once. */}
      <button
        type="button"
        onClick={() => onGeneratePortalAccess?.()}
        disabled={generatingPortalAccess}
        className={`w-full flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 mb-3 text-xs font-semibold transition disabled:opacity-60 disabled:cursor-not-allowed ${theme.border} hover:border-violet-300 hover:text-violet-600 ${theme.cardText}`}
      >
        <KeyRound className="w-3.5 h-3.5 text-violet-500" />
        {generatingPortalAccess ? "Generating…" : client.has_portal_access ? "Reset Portal Password" : "Generate Portal Access"}
      </button>

      {/* Share portal link — sends the client straight to their Client
          Portal login screen with their Client ID pre-filled. */}
      <div className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 mb-3 ${theme.border} ${theme.inputBg}`}>
        <span className={`flex items-center gap-1.5 text-xs font-semibold min-w-0 ${theme.cardText}`}>
          <Share2 className="w-3.5 h-3.5 text-violet-500 shrink-0" />
          <span className="truncate">Portal link</span>
        </span>
        <span className="flex items-center gap-3 shrink-0">
          <CopyButton value={portalLinkFor(client)} label="Copy link" className={`${theme.subtleText} hover:text-violet-600`} />
          <a
            href={whatsappLinkFor(client)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-semibold transition text-emerald-600 hover:text-emerald-700"
            title="Send portal link on WhatsApp"
          >
            <MessageCircle className="w-3 h-3" />
            WhatsApp
          </a>
          <button
            type="button"
            onClick={async () => {
              const url = portalLinkFor(client);
              if (navigator.share) {
                try {
                  await navigator.share({ title: `${client.name} — Client Portal`, url });
                } catch {
                  // user cancelled the share sheet — nothing to do
                }
              } else if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(url);
              }
            }}
            className={`inline-flex items-center gap-1 text-[11px] font-semibold transition ${theme.subtleText} hover:text-violet-600`}
            title="Share portal link"
          >
            <Share2 className="w-3 h-3" />
            Share
          </button>
        </span>
      </div>

      {/* Work-complete toggle */}
      <button
        onClick={onToggleComplete}
        className={`w-full flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 mb-3 transition ${
          client.workComplete ? "bg-violet-50 border-violet-200" : `${theme.border} hover:border-violet-200`
        }`}
      >
        <span className={`flex items-center gap-2 text-xs font-semibold ${theme.cardText}`}>
          {client.workComplete ? <CheckCircle2 className="w-4 h-4 text-violet-600" /> : <Circle className={`w-4 h-4 ${theme.subtleText}`} />}
          Client work complete
        </span>
        <span className={`w-9 h-5 rounded-full relative transition-colors duration-200 ${client.workComplete ? "bg-violet-600" : theme.inputBg}`}>
          <span
            className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200"
            style={{ transform: client.workComplete ? "translateX(16px)" : "translateX(0px)" }}
          />
        </span>
      </button>

      <div className={`flex items-center gap-1 border-b mb-3 overflow-x-auto whitespace-nowrap ${theme.borderLight}`}>
        {DETAILS_TABS.map((t) => {
          // Same red-dot logic as the client list/bell — points at exactly
          // which tab has the pending module request / payment review
          // that brought the admin here, so it's obvious where to look
          // without having to scan every section.
          const showDot = (t === "Projects" && hasPendingProjectRequest(client)) || (t === "Billing" && hasPendingBillingReview(client));
          return (
            <button
              key={t}
              onClick={() => setDetailsTab(t)}
              className={`relative px-2.5 py-2 text-xs font-semibold border-b-2 transition shrink-0 ${
                detailsTab === t ? "text-violet-600 border-violet-600" : `${theme.subtleText} border-transparent hover:text-violet-500`
              }`}
            >
              {t === "Team" ? `Team (${client.team?.length || 0})` : t === "Projects" ? `Projects (${client.projects?.length || 0})` : t === "Billing" ? `Billing (${invoices.length})` : t}
              {showDot && <span className="absolute top-1 right-0.5 w-1.5 h-1.5 rounded-full bg-rose-500" />}
            </button>
          );
        })}
      </div>

      {detailsTab === "Overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <p className={theme.subtleText}>Contact Person</p>
              <p className={`font-semibold mt-0.5 ${theme.headingText}`}>{client.contactPerson}</p>
              <p className={theme.subtleText}>{client.contactTitle}</p>
            </div>
            <div>
              <p className={theme.subtleText}>Total Projects</p>
              <p className={`font-bold mt-0.5 ${theme.headingText}`}>{client.totalProjects}</p>
            </div>
            <div className={`flex items-center gap-2 rounded-xl px-3 py-2.5 ${theme.inputBg}`}>
              <Mail className="w-3.5 h-3.5 text-violet-500 shrink-0" />
              <span className={`truncate ${theme.cardText}`}>{client.email}</span>
            </div>
            <div className="min-w-0">
              <p className={theme.subtleText}>Total Spent</p>
              <p className={`font-bold mt-0.5 truncate ${theme.headingText}`} title={fmtMoney(client.totalSpent)}>{fmtMoney(client.totalSpent)}</p>
            </div>
            <div className={`flex items-center gap-2 rounded-xl px-3 py-2.5 ${theme.inputBg}`}>
              <Phone className="w-3.5 h-3.5 text-violet-500 shrink-0" />
              <span className={`truncate ${theme.cardText}`}>{client.phone}</span>
            </div>
            <div className="min-w-0">
              <p className={theme.subtleText}>Outstanding</p>
              <p className={`font-bold mt-0.5 truncate ${theme.headingText}`} title={fmtMoney(client.outstanding)}>{fmtMoney(client.outstanding)}</p>
            </div>
            <div className={`flex items-center gap-2 rounded-xl px-3 py-2.5 ${theme.inputBg}`}>
              <MapPin className="w-3.5 h-3.5 text-violet-500 shrink-0" />
              <span className={`truncate ${theme.cardText}`}>{client.address}</span>
            </div>
            <div>
              <p className={theme.subtleText}>Last Activity</p>
              <p className={`font-semibold mt-0.5 ${theme.headingText}`}>{client.lastActivityAgo}</p>
            </div>
            <div className={`flex items-center gap-2 rounded-xl px-3 py-2.5 sm:col-span-2 ${theme.inputBg}`}>
              <Building2 className="w-3.5 h-3.5 text-violet-500 shrink-0" />
              <span className={`truncate ${theme.cardText}`}>Industry: {client.industry}</span>
            </div>
            <div className={`flex items-center gap-2 rounded-xl px-3 py-2.5 sm:col-span-2 ${theme.inputBg}`}>
              <span className="text-sm leading-none shrink-0">{client.country ? countryFlagEmoji(countryCode) : "🏳️"}</span>
              <span className={`truncate ${theme.cardText}`}>Country: {client.country || "Not set"}</span>
            </div>
          </div>

          {client.projects?.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className={`text-xs font-bold ${theme.headingText}`}>Active Projects</p>
                <button onClick={() => setDetailsTab("Projects")} className="text-[11px] font-semibold text-violet-600 hover:text-violet-700">
                  View All
                </button>
              </div>
              <div className="space-y-2.5">
                {client.projects.slice(0, 3).map((p) => {
                  const doneCount = (p.modules || []).filter((m) => m.done).length;
                  const totalCount = (p.modules || []).length;
                  return (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => {
                        setDetailsTab("Projects");
                        setExpandedProject(p.name);
                      }}
                      className="w-full flex items-center gap-2.5 text-xs text-left"
                    >
                      <span className={`shrink-0 text-[9.5px] font-bold px-1.5 py-0.5 rounded ${theme.inputBg} ${theme.subtleText}`}>{p.type || "Other"}</span>
                      <span className={`flex-1 min-w-0 truncate ${theme.cardText}`}>{p.name}</span>
                      <span className={`shrink-0 text-[10.5px] ${theme.subtleText}`}>
                        {doneCount}/{totalCount}
                      </span>
                      <ProgressBar value={p.progress} theme={theme} />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {client.manager && (
            <div>
              <p className={`text-xs font-bold mb-2 ${theme.headingText}`}>Assigned Manager</p>
              <div className={`flex items-center gap-2.5 rounded-xl border p-3 ${theme.borderLight}`}>
                <PersonAvatar name={client.manager.name} size="w-9 h-9" />
                <div className="min-w-0 flex-1">
                  <p className={`text-xs font-semibold truncate ${theme.headingText}`}>{client.manager.name}</p>
                  <p className={`text-[11px] truncate ${theme.subtleText}`}>{client.manager.role}</p>
                </div>
                <a href={`mailto:${client.email}`} className="w-7 h-7 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center hover:bg-violet-100">
                  <Mail className="w-3.5 h-3.5" />
                </a>
                <a href={`tel:${client.phone}`} className="w-7 h-7 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center hover:bg-violet-100">
                  <Phone className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          )}

          {client.activity?.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className={`text-xs font-bold ${theme.headingText}`}>Recent Activity</p>
                <button onClick={() => setDetailsTab("Activity")} className="text-[11px] font-semibold text-violet-600 hover:text-violet-700">
                  View All
                </button>
              </div>
              <div className="space-y-2">
                {client.activity.slice(0, 3).map((a, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-xs">
                    <span className={`truncate ${theme.cardText}`}>{a.text}</span>
                    <span className={`shrink-0 ${theme.subtleText}`}>{a.time}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {detailsTab === "Projects" && (
        <div className="space-y-2.5">
          {(client.projects || []).length === 0 && <p className={`text-xs ${theme.subtleText}`}>No projects on record yet.</p>}
          {(client.projects || []).length > 1 && (
            <p className={`text-[11px] ${theme.subtleText}`}>This client has {client.projects.length} projects — tick off each module as it's done; % updates automatically.</p>
          )}
          {(client.projects || []).map((p) => {
            const isComplete = (p.progress ?? 0) >= 100;
            const isOpen = expandedProject === p.name;
            const unitTotals = (p.modules || []).reduce(
              (acc, m) => {
                const u = moduleUnits(m);
                return { total: acc.total + u.total, done: acc.done + u.done };
              },
              { total: 0, done: 0 }
            );
            const doneCount = unitTotals.done;
            const totalCount = unitTotals.total;
            return (
              <div key={p.name} className={`rounded-xl border p-3 ${theme.borderLight}`}>
                <div className="flex items-center gap-2.5 mb-2">
                  <button
                    type="button"
                    onClick={() => setExpandedProject(isOpen ? null : p.name)}
                    className="flex-1 min-w-0 flex items-center gap-2 text-left"
                  >
                    <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${theme.subtleText} ${isOpen ? "rotate-180" : ""}`} />
                    <span className={`min-w-0 truncate text-xs font-semibold ${theme.headingText}`}>{p.name}</span>
                    <span className={`shrink-0 text-[9.5px] font-bold px-1.5 py-0.5 rounded ${theme.inputBg} ${theme.subtleText}`}>{p.type || "Other"}</span>
                  </button>
                  <span className={`shrink-0 text-[10.5px] font-semibold px-2 py-0.5 rounded-full ${isComplete ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>
                    {isComplete ? "Complete" : "In progress"}
                  </span>
                  {onEditProject && (
                    <button
                      type="button"
                      onClick={() => onEditProject(p.name)}
                      className={`shrink-0 w-6 h-6 flex items-center justify-center rounded-md ${theme.subtleText} hover:text-violet-600 ${theme.inputBg}`}
                      title="Edit project"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {onDeleteProject && (
                    <button
                      type="button"
                      onClick={() => onDeleteProject(p.name)}
                      className={`shrink-0 w-6 h-6 flex items-center justify-center rounded-md ${theme.subtleText} hover:text-rose-600 ${theme.inputBg}`}
                      title="Delete project"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2.5 mb-1">
                  <span className={`shrink-0 text-[10.5px] ${theme.subtleText}`}>
                    {doneCount}/{totalCount} tasks
                  </span>
                  <ProgressBar value={p.progress} theme={theme} />
                </div>
                {isOpen && (
                  <div className={`mt-2.5 pt-2.5 border-t space-y-1.5 ${theme.borderLight}`}>
                    {(p.modules || []).map((m) => {
                      const hasSubs = m.subModules && m.subModules.length > 0;
                      const subDone = hasSubs ? m.subModules.filter((s) => s.done).length : 0;
                      return (
                        <div key={m.id}>
                          <div className="flex items-center gap-2.5 text-xs">
                            {hasSubs ? (
                              <span
                                className={`w-5 h-5 rounded-md flex items-center justify-center border shrink-0 ${
                                  m.done ? "bg-violet-600 border-violet-600 text-white" : `${theme.card} ${theme.border} text-transparent`
                                }`}
                              >
                                <Check className="w-3.5 h-3.5" />
                              </span>
                            ) : (
                              <ProjectCheckbox checked={m.done} onToggle={() => onToggleProjectModule(p.name, m.id)} theme={theme} />
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedModule({
                                  projectName: p.name,
                                  moduleId: m.id,
                                  subModuleId: null,
                                  name: m.name,
                                  done: m.done,
                                  attachments: m.attachments || [],
                                  projectBackendId: p.backendId,
                                  moduleBackendId: m.backendId,
                                })
                              }
                              className={`flex-1 min-w-0 truncate text-left hover:underline hover:text-violet-600 ${m.done ? theme.cardText : theme.mutedText}`}
                              title="Open task details"
                            >
                              {m.name}
                            </button>
                            {hasSubs && (
                              <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${theme.inputBg} ${theme.subtleText}`}>
                                {subDone}/{m.subModules.length}
                              </span>
                            )}
                            {!hasSubs && (
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedModule({
                                    projectName: p.name,
                                    moduleId: m.id,
                                    subModuleId: null,
                                    name: m.name,
                                    done: m.done,
                                    attachments: m.attachments || [],
                                    projectBackendId: p.backendId,
                                    moduleBackendId: m.backendId,
                                  })
                                }
                                className={`shrink-0 w-6 h-6 flex items-center justify-center rounded-md ${theme.subtleText} hover:text-violet-600 ${theme.inputBg}`}
                                title="Upload / view attachments"
                              >
                                <Paperclip className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                          {!hasSubs && (
                            <AttachmentChips
                              attachments={m.attachments}
                              theme={theme}
                              onOpen={(a) =>
                                openAttachment(a, {
                                  projectName: p.name,
                                  moduleId: m.id,
                                  subModuleId: null,
                                  name: m.name,
                                  projectBackendId: p.backendId,
                                  moduleBackendId: m.backendId,
                                })
                              }
                            />
                          )}
                          {hasSubs && (
                            <div className="ml-7 mt-1.5 space-y-1.5">
                              {m.subModules.map((s) => (
                                <div key={s.id}>
                                  <div className="flex items-center gap-2.5 text-xs">
                                    <ProjectCheckbox checked={s.done} onToggle={() => onToggleProjectModule(p.name, m.id, s.id)} theme={theme} />
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setSelectedModule({
                                          projectName: p.name,
                                          moduleId: m.id,
                                          subModuleId: s.id,
                                          name: `${m.name}: ${s.name}`,
                                          done: s.done,
                                          attachments: s.attachments || [],
                                          projectBackendId: p.backendId,
                                          moduleBackendId: s.backendId,
                                        })
                                      }
                                      className={`flex-1 min-w-0 truncate text-left hover:underline hover:text-violet-600 ${s.done ? theme.cardText : theme.mutedText}`}
                                      title="Open task details"
                                    >
                                      {s.name}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setSelectedModule({
                                          projectName: p.name,
                                          moduleId: m.id,
                                          subModuleId: s.id,
                                          name: `${m.name}: ${s.name}`,
                                          done: s.done,
                                          attachments: s.attachments || [],
                                          projectBackendId: p.backendId,
                                          moduleBackendId: s.backendId,
                                        })
                                      }
                                      className={`shrink-0 w-6 h-6 flex items-center justify-center rounded-md ${theme.subtleText} hover:text-violet-600 ${theme.inputBg}`}
                                      title="Upload / view attachments"
                                    >
                                      <Paperclip className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                  <AttachmentChips
                                    attachments={s.attachments}
                                    theme={theme}
                                    onOpen={(a) =>
                                      openAttachment(a, {
                                        projectName: p.name,
                                        moduleId: m.id,
                                        subModuleId: s.id,
                                        name: `${m.name}: ${s.name}`,
                                        projectBackendId: p.backendId,
                                        moduleBackendId: s.backendId,
                                      })
                                    }
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {p.details && (
                      <p className={`text-[11px] mt-2 pt-2 border-t ${theme.borderLight} ${theme.subtleText}`}>{p.details}</p>
                    )}
                    {/* FIX (final deliverable ZIP): once every module in this
                        project is 100% done, the last step is uploading one
                        ZIP of the finished deliverable. Shown on the Clients
                        page AND the Client Portal (both read this same
                        record) — but the client only gets a download option
                        there once payment is fully settled. Staff here can
                        always manage it regardless of payment status. */}
                    {(isComplete || p.backendId || p.deliverableZip) && (
                      <DeliverableZipSection
                        project={p}
                        paymentComplete={isPaymentComplete(client)}
                        onUpload={(zip) => onSetDeliverableZip(p.name, zip)}
                        onRemove={() => onSetDeliverableZip(p.name, null)}
                        theme={theme}
                      />
                    )}

                    {/* MODULE REQUESTS — client asked from the Client
                        Portal to have another module started (e.g.
                        "start Backend now that Frontend is delivered").
                        Accepting appends the module to this project's
                        checklist, which the Tasks page auto-picks up and
                        assigns to this client's manager/developer. */}
                    {(client.moduleRequests || []).filter((r) => r.projectName === p.name && r.status === "pending").length > 0 && (
                      <div className="mt-2.5 pt-2.5 border-t border-amber-200 space-y-2">
                        <p className="text-[11px] font-bold text-amber-600">Client Requests — request to start a new module</p>
                        {(client.moduleRequests || [])
                          .filter((r) => r.projectName === p.name && r.status === "pending")
                          .map((r) => (
                            <div key={r.id} className="rounded-lg bg-amber-50 border border-amber-200 p-2.5">
                              <p className="text-xs font-semibold text-amber-800">Request to start "{r.moduleName}" module</p>
                              {r.note && <p className="text-[11px] text-amber-700 mt-0.5">{r.note}</p>}
                              {/* Reference the client attached (only possible for a
                                  brand-new/custom module request) — an image they
                                  uploaded or a URL they pasted, so staff can see
                                  exactly what's being asked for before accepting. */}
                              {r.attachment?.type === "image" && (
                                <img
                                  src={r.attachment.dataUrl}
                                  alt={r.attachment.fileName || "Client reference"}
                                  className="mt-1.5 max-h-32 rounded-md border border-amber-200 object-contain"
                                />
                              )}
                              {r.attachment?.type === "link" && (
                                <a
                                  href={r.attachment.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-violet-700 hover:underline break-all"
                                >
                                  <Link2 className="w-3 h-3 shrink-0" /> {r.attachment.url}
                                </a>
                              )}
                              <p className="text-[10px] text-amber-600 mt-0.5">{r.requestedAt}</p>
                              <div className="flex gap-1.5 mt-2">
                                <button
                                  onClick={() => onAcceptModuleRequest(r.id)}
                                  className="flex-1 text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-full py-1.5"
                                >
                                  Accept — create task
                                </button>
                                <button
                                  onClick={() => onDeclineModuleRequest(r.id)}
                                  className="flex-1 text-[11px] font-semibold text-rose-600 border border-rose-200 hover:bg-rose-50 rounded-full py-1.5"
                                >
                                  Decline
                                </button>
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {detailsTab === "Team" && (
        <div className="space-y-2">
          {(client.team || []).length === 0 && <p className={`text-xs ${theme.subtleText}`}>No team members assigned yet.</p>}
          {(client.team || []).map((name) => (
            <div key={name} className={`flex items-center gap-2.5 rounded-xl border p-2.5 ${theme.borderLight}`}>
              <PersonAvatar name={name} size="w-8 h-8" />
              <span className={`text-xs font-medium ${theme.cardText}`}>{name}</span>
            </div>
          ))}
        </div>
      )}

      {detailsTab === "Billing" && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <div className={`rounded-xl border p-2.5 text-center min-w-0 ${theme.borderLight}`}>
              <p className={`text-[10px] ${theme.subtleText}`}>Total Invoiced</p>
              <p className={`text-sm font-bold mt-0.5 truncate ${theme.headingText}`} title={fmtMoney(totalInvoiced)}>{fmtMoney(totalInvoiced)}</p>
            </div>
            <div className={`rounded-xl border p-2.5 text-center min-w-0 ${theme.borderLight}`}>
              <p className={`text-[10px] ${theme.subtleText}`}>Total Paid</p>
              <p className="text-sm font-bold mt-0.5 text-emerald-600 truncate" title={fmtMoney(totalPaid)}>{fmtMoney(totalPaid)}</p>
            </div>
            <div className={`rounded-xl border p-2.5 text-center min-w-0 ${theme.borderLight}`}>
              <p className={`text-[10px] ${theme.subtleText}`}>Outstanding</p>
              <p className="text-sm font-bold mt-0.5 text-rose-600 truncate" title={fmtMoney(client.outstanding)}>{fmtMoney(client.outstanding)}</p>
            </div>
          </div>

          <button
            onClick={onGenerateInvoice}
            className="w-full flex items-center justify-center gap-1.5 border border-dashed border-violet-300 text-violet-600 text-xs font-semibold py-2.5 rounded-full hover:bg-violet-50 transition"
          >
            <Plus className="w-3.5 h-3.5" /> Generate Invoice
          </button>

          <div className="space-y-2.5">
            {invoices.length === 0 && <p className={`text-xs ${theme.subtleText}`}>No invoices on record yet. This client's full billing history — including anything still pending — will build up here and stay visible for as long as it's owed.</p>}
            {invoices.map((inv) => {
              const balance = Math.max(0, inv.amount - (inv.paidAmount || 0));
              const milestoneLabel = inv.milestone ? MILESTONE_LABELS[inv.milestone] : "";
              return (
                <div key={inv.id} className={`rounded-xl border p-3 ${theme.borderLight}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className={`text-xs font-bold ${theme.headingText}`}>{inv.number}</p>
                    <InvoiceStatusBadge status={inv.status} />
                  </div>
                  {(milestoneLabel || inv.projectName) && (
                    <p className="text-[10.5px] mt-1 font-semibold text-violet-600">
                      {milestoneLabel}
                      {milestoneLabel && inv.projectName ? " · " : ""}
                      {inv.projectName}
                    </p>
                  )}
                  <p className={`text-[10.5px] mt-0.5 ${theme.subtleText}`}>
                    Issued {inv.issueDate} · Due {inv.dueDate}
                  </p>
                  {inv.note && <p className={`text-[11px] mt-1 ${theme.cardText}`}>{inv.note}</p>}
                  <div className="flex items-center justify-between gap-2 mt-2 text-xs">
                    <span className={`min-w-0 truncate ${theme.subtleText}`}>
                      Amount <span className={`font-semibold ${theme.cardText}`}>{fmtMoney(inv.amount)}</span>
                    </span>
                    <span className={`min-w-0 truncate ${theme.subtleText}`}>
                      Paid <span className="font-semibold text-emerald-600">{fmtMoney(inv.paidAmount || 0)}</span>
                    </span>
                  </div>
                  <div className="flex gap-1.5 mt-2">
                    <button
                      onClick={() => setViewingInvoice(inv)}
                      className={`flex-1 flex items-center justify-center gap-1 text-[10.5px] font-semibold py-1.5 rounded-full border ${theme.border} ${theme.cardText} hover:bg-violet-50`}
                    >
                      <Eye className="w-3 h-3" /> View Invoice
                    </button>
                    <a
                      href={whatsappLinkForInvoice(client, inv)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 flex items-center justify-center gap-1 text-[10.5px] font-semibold py-1.5 rounded-full border border-emerald-200 text-emerald-600 hover:bg-emerald-50"
                    >
                      <MessageCircle className="w-3 h-3" /> Share
                    </a>
                  </div>
                  {inv.paymentProof && (
                    <button
                      type="button"
                      onClick={() => inv.paymentProof.dataUrl && setPaymentProofPreview({ ...inv.paymentProof, invoiceNumber: inv.number })}
                      className={`w-full flex items-center gap-2.5 mt-2.5 rounded-lg border p-2 text-left ${theme.borderLight} ${inv.paymentProof.dataUrl ? "hover:border-violet-300 cursor-pointer" : "cursor-default"}`}
                    >
                      {inv.paymentProof.dataUrl && (
                        <img
                          src={inv.paymentProof.dataUrl}
                          alt="Payment screenshot"
                          className="w-10 h-10 rounded-md object-cover shrink-0 border border-blue-200"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-[10.5px] font-semibold text-blue-600">Client submitted payment proof</p>
                        <p className={`text-[10px] truncate ${theme.subtleText}`}>{inv.paymentProof.fileName || "screenshot"} · {inv.paymentProof.submittedAt}{inv.paymentProof.dataUrl ? " · tap to view" : ""}</p>
                      </div>
                    </button>
                  )}
                  {balance > 0 &&
                    // FIX (client's payment stuck un-confirmable): the order
                    // gate below is meant to stop staff from jumping ahead
                    // and recording a payment nobody's actually made yet —
                    // it was never meant to block confirming money that HAS
                    // already come in. Previously it blocked both cases the
                    // same way, so a client who paid (and submitted proof)
                    // for e.g. Milestone 2 before Milestone 1 was ever
                    // confirmed got stuck permanently on a plain "Locked"
                    // label with no way to confirm their payment at all —
                    // nothing on the Clients page or Client Portal ever
                    // unlocked. A "Submitted" invoice (proof already
                    // attached) can always be confirmed regardless of
                    // milestone order; only a fresh, not-yet-submitted
                    // Record Payment still respects the order.
                    (inv.status === "Submitted" || priorMilestonesCleared(client, inv.milestone) ? (
                      <button
                        onClick={() => onRecordPayment(inv.id)}
                        className="w-full mt-2.5 text-[11px] font-semibold text-violet-600 border border-violet-200 rounded-full py-1.5 px-2 hover:bg-violet-50 transition truncate"
                      >
                        {inv.status === "Submitted" ? "Confirm Payment" : "Record Payment"} · {fmtMoney(balance)} due
                      </button>
                    ) : (
                      // Record Payment stays locked here instead of being
                      // clickable — this milestone hasn't had any payment
                      // submitted against it yet, and can't be recorded
                      // until every earlier milestone invoice is "Paid".
                      <div className="w-full mt-2.5 text-[11px] font-semibold text-center text-amber-600 border border-amber-200 bg-amber-50 rounded-full py-1.5">
                        Locked · clear Milestone {inv.milestone - 1} first
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {detailsTab === "Documents" && (
        <DocumentsTabContent client={client} theme={theme} />
      )}

      {detailsTab === "Activity" && (
        <ActivityTabContent client={client} theme={theme} />
      )}

      <div className="flex flex-col sm:flex-row gap-2 mt-5">
        <button onClick={onEdit} className={`flex-1 flex items-center justify-center gap-1.5 border text-xs font-semibold py-2.5 rounded-full transition ${theme.border} ${theme.cardText} hover:${theme.hoverIconBg}`}>
          <Pencil className="w-3.5 h-3.5" /> Edit Client
        </button>
        <button
          onClick={onDeactivate}
          className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold py-2.5 rounded-full transition ${
            client.status === "Active" ? "bg-rose-600 hover:bg-rose-500 text-white" : "bg-emerald-600 hover:bg-emerald-500 text-white"
          }`}
        >
          {client.status === "Active" ? (
            <>
              <UserX className="w-3.5 h-3.5" /> Deactivate Client
            </>
          ) : (
            <>
              <UserCheck className="w-3.5 h-3.5" /> Activate Client
            </>
          )}
        </button>
      </div>

      {/* FIX (Task Details popup showing "behind" the client panel):
          this used to render as a plain child right here, inside the
          `lg:sticky` client-details container. `position: sticky`
          always creates its own stacking context, so this modal's own
          `z-[110]` only ever won against siblings INSIDE that sticky
          panel — the panel itself (header, tabs, right-rail cards, ...)
          could still paint on top of/beside it, exactly like the
          screenshot showed. Portaling straight to document.body (same
          pattern already used for the row-actions menu above) escapes
          that ancestor stacking context entirely, so the popup and its
          dark backdrop now correctly cover the whole screen, including
          the client panel behind it. */}
      {selectedModule &&
        createPortal(
          <ModuleDetailsPanel
            module={selectedModule}
            clientName={client.name}
            onClose={() => setSelectedModule(null)}
            onToggleDone={() => {
              onToggleProjectModule(selectedModule.projectName, selectedModule.moduleId, selectedModule.subModuleId);
              setSelectedModule((m) => (m ? { ...m, done: !m.done } : m));
            }}
            onAddAttachment={(attachment, file) => {
              onAddModuleAttachment(selectedModule.projectName, selectedModule.moduleId, selectedModule.subModuleId, attachment, file);
              setSelectedModule((m) =>
                m ? { ...m, attachments: appendAttachment(m.attachments, withBackendLinkId(attachment, m.moduleBackendId)) } : m
              );
            }}
            // NEW — Section 6/14's "Approved / Show on Portal" checkbox.
            // Real uploaded files (ModuleFile pk) AND a module's link
            // ("link-<modulePk>") both need approval before the client sees them.
            // Delegates to onToggleAttachmentApproval (defined up in
            // ClientsPage, where clientsApi's response + showToast are
            // actually in scope) so ClientDetails itself stays a plain
            // pass-through, then mirrors the flag into the open panel so
            // its label updates immediately.
            onToggleApproval={
              selectedModule.projectBackendId && selectedModule.moduleBackendId
                ? (attachmentId, approved) => {
                    onToggleAttachmentApproval(
                      selectedModule.projectName,
                      selectedModule.moduleId,
                      selectedModule.subModuleId,
                      selectedModule.projectBackendId,
                      selectedModule.moduleBackendId,
                      attachmentId,
                      approved
                    );
                    setSelectedModule((mm) =>
                      mm
                        ? { ...mm, attachments: (mm.attachments || []).map((a) => (a.id === attachmentId ? { ...a, approved } : a)) }
                        : mm
                    );
                  }
                : null
            }
            onOpenAttachment={(a) => openAttachment(a, selectedModule)}
            theme={theme}
          />,
          document.body
        )}

      {/* NEW — review popup for an uploaded file / zip / URL. Portaled like
          the Task Details panel above (and given a higher z-index so it can
          also open on top of it). */}
      {attachmentPreview &&
        livePreviewAttachment &&
        createPortal(
          <AttachmentPreviewModal
            attachment={livePreviewAttachment}
            moduleName={attachmentPreview.ctx.name}
            onClose={() => setAttachmentPreview(null)}
            onToggleApproval={
              attachmentPreview.ctx.projectBackendId && attachmentPreview.ctx.moduleBackendId
                ? async (attachmentId, approved) => {
                    const ctx = attachmentPreview.ctx;
                    const ok = await onToggleAttachmentApproval(
                      ctx.projectName,
                      ctx.moduleId,
                      ctx.subModuleId,
                      ctx.projectBackendId,
                      ctx.moduleBackendId,
                      attachmentId,
                      approved
                    );
                    // keep an open Task Details panel's own copy in step
                    if (ok) {
                      setSelectedModule((mm) =>
                        mm && mm.projectName === ctx.projectName && mm.moduleId === ctx.moduleId && (mm.subModuleId || null) === (ctx.subModuleId || null)
                          ? { ...mm, attachments: (mm.attachments || []).map((x) => (x.id === attachmentId ? { ...x, approved } : x)) }
                          : mm
                      );
                    }
                    return ok;
                  }
                : null
            }
            theme={theme}
          />,
          document.body
        )}

      {/* Full branded invoice document — same portal pattern as the
          payment-proof lightbox above, so it isn't confined behind the
          sticky client panel either. */}
      {viewingInvoice &&
        createPortal(
          <InvoiceDocumentPreview client={client} invoice={viewingInvoice} theme={theme} onClose={() => setViewingInvoice(null)} />,
          document.body
        )}

      {/* Same fix as the Task Details popup above — portaled out so the
          payment-screenshot lightbox properly covers the whole screen
          instead of being confined behind the sticky client panel. */}
      {paymentProofPreview &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70"
            onClick={() => setPaymentProofPreview(null)}
          >
            <div
              className={`w-full max-w-lg rounded-2xl p-4 ${theme.card}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <p className={`text-xs font-bold ${theme.headingText}`}>Payment proof · {paymentProofPreview.invoiceNumber}</p>
                  <p className={`text-[10.5px] mt-0.5 truncate ${theme.subtleText}`}>
                    {paymentProofPreview.fileName || "screenshot"} · {paymentProofPreview.submittedAt}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPaymentProofPreview(null)}
                  className={`w-8 h-8 shrink-0 flex items-center justify-center rounded-lg ${theme.hoverIconBg} ${theme.subtleText}`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <img
                src={paymentProofPreview.dataUrl}
                alt="Payment screenshot"
                className="w-full max-h-[75vh] object-contain rounded-xl border border-blue-200"
              />
            </div>
          </div>,
          document.body
        )}

      {/* Profile picture lightbox — same portaled full-screen pattern as
          the payment proof preview above. */}
      {profilePicPreview &&
        client.profilePic &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70"
            onClick={() => setProfilePicPreview(false)}
          >
            <div className={`w-full max-w-sm rounded-2xl p-4 ${theme.card}`} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3 mb-3">
                <p className={`text-xs font-bold ${theme.headingText}`}>{client.name} · Profile picture</p>
                <button
                  type="button"
                  onClick={() => setProfilePicPreview(false)}
                  className={`w-8 h-8 shrink-0 flex items-center justify-center rounded-lg ${theme.hoverIconBg} ${theme.subtleText}`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <img
                src={client.profilePic}
                alt={`${client.name} profile`}
                className="w-full max-h-[70vh] object-contain rounded-xl"
              />
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

/* ----------------------------------------------------------------------
   ATTACHMENT REVIEW POPUP — what opens when a file / zip / URL uploaded on a
   module is clicked (instead of it opening or downloading straight away).
   Shows the image / video / link / file details so it can be checked, and
   carries the same "Approved / Show on Portal" tick as the Task Details
   panel. Once approved, clicking the URL or zip again opens / downloads it
   (see isDirectActionAttachment). Attachments that can't be approved at all
   (legacy local-only uploads with no real backend id) are let through with
   a button, so they never get stuck behind an approval that can't happen.
---------------------------------------------------------------------- */
function AttachmentPreviewModal({ attachment: a, moduleName, onToggleApproval, onClose, theme }) {
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isBackendLink = a.type === "link" && String(a.id).startsWith("link-");
  const hasRealId = isBackendLink || (a.id !== undefined && a.id !== null && /^\d+$/.test(String(a.id)));
  const canApprove = !!onToggleApproval && hasRealId;
  const approved = a.approved === true;
  const canActNow = approved || !canApprove;
  const isMedia = a.type === "image" || a.type === "video";
  const noun = a.type === "link" ? "URL" : a.type === "zip" ? "zip" : a.type === "image" ? "image" : a.type === "video" ? "video" : "file";
  const actionVerb = a.type === "link" ? "open" : isMedia ? "open" : "download";
  const actionLabel = a.type === "link" ? "Open link ↗" : isMedia ? "Open in new tab ↗" : "Download";

  const toggle = async (checked) => {
    setPending(true);
    try {
      await onToggleApproval(a.id, checked);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-3 sm:p-4" onClick={onClose}>
      <div
        className={`w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-2xl p-4 shadow-2xl ${theme.card}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <p className={`text-sm font-bold truncate ${theme.headingText}`}>{a.name || (a.type === "link" ? "Link" : a.type)}</p>
            <p className={`text-[10.5px] mt-0.5 capitalize truncate ${theme.subtleText}`}>
              {a.type}
              {moduleName ? ` · ${moduleName}` : ""}
              {a.size ? ` · ${formatFileSize(a.size)}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`w-8 h-8 shrink-0 flex items-center justify-center rounded-lg ${theme.hoverIconBg} ${theme.subtleText}`}
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {a.type === "image" && a.url ? (
          <img src={a.url} alt={a.name} className={`w-full max-h-[55vh] object-contain rounded-xl border ${theme.border}`} />
        ) : a.type === "video" && a.url ? (
          <video src={a.url} controls className="w-full max-h-[55vh] rounded-xl bg-black" />
        ) : (
          <div className={`flex items-center gap-3 rounded-xl border p-3 ${theme.border} ${theme.inputBg}`}>
            <span className="w-10 h-10 rounded-md bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
              {a.type === "link" ? <Link2 className="w-5 h-5" /> : a.type === "zip" ? <Archive className="w-5 h-5" /> : <FileIcon className="w-5 h-5" />}
            </span>
            <div className="min-w-0 flex-1">
              {a.type === "link" ? (
                <p className={`text-xs font-semibold break-all ${theme.headingText}`}>{a.url || a.name}</p>
              ) : (
                <>
                  <p className={`text-xs font-semibold truncate ${theme.headingText}`}>{a.name}</p>
                  <p className={`text-[10.5px] mt-0.5 ${theme.subtleText}`}>{a.size ? formatFileSize(a.size) : "Size not available"}</p>
                </>
              )}
            </div>
          </div>
        )}

        {canApprove && (
          <label className="mt-3 flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={approved}
              disabled={pending}
              onChange={(e) => toggle(e.target.checked)}
              className="w-4 h-4 accent-violet-600"
            />
            <span className={`text-xs font-semibold ${approved ? "text-emerald-600" : "text-amber-600"}`}>
              {pending ? "Saving…" : approved ? "Approved · shown on Portal" : "Pending review — tick to approve & show on Portal"}
            </span>
          </label>
        )}

        <p className={`text-[10.5px] mt-2 ${theme.subtleText}`}>
          {canApprove && !approved
            ? `Check this ${noun}, then tick Approved. After that, click the ${noun} again to ${actionVerb} it.`
            : approved
            ? `Approved. Click the ${noun} again any time to ${actionVerb} it.`
            : `This is a legacy upload — it has no approval step, you can ${actionVerb} it directly.`}
        </p>

        {canActNow && (
          <button
            type="button"
            onClick={() => runAttachmentAction(a)}
            className="mt-3 w-full flex items-center justify-center gap-1.5 text-xs font-semibold py-2.5 rounded-full bg-violet-600 hover:bg-violet-500 text-white transition"
          >
            {a.type === "link" || isMedia ? null : <Download className="w-3.5 h-3.5" />} {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------
   MODULE / TASK DETAILS PANEL — opened by clicking a module or sub-task
   row inside a project's checklist (the same rows shown on the Projects
   tab above). Mirrors TasksPage.jsx's own Task Details sidebar so admins
   don't have to jump to the Tasks page just to check off a module or
   drop in a screenshot/video/zip/link — everything added here is synced
   straight back into the same module (via onToggleDone/onAddAttachment)
   and, from there, into the matching Tasks page task and the Client
   Portal automatically.
---------------------------------------------------------------------- */
function ModuleDetailsPanel({ module: m, clientName, onClose, onToggleDone, onAddAttachment, onToggleApproval, onOpenAttachment, theme }) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attachments = m.attachments || [];

  const addLink = () => {
    const trimmed = link.trim();
    if (!trimmed) return;
    onAddAttachment({ id: genAttachmentId(), type: "link", name: trimmed, url: trimmed, uploadedAt: new Date().toISOString() });
    setLink("");
    setError("");
  };

  const addFile = async (file) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const type = detectAttachmentKind(file);
      onAddAttachment({ id: genAttachmentId(), type, name: file.name, url: dataUrl, uploadedAt: new Date().toISOString() }, file);
    } catch (e) {
      setError(e.message || "Could not upload file.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className={`w-full sm:max-w-sm max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-4 shadow-2xl ${theme.card}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className={`font-bold text-sm ${theme.headingText}`}>Task Details</h3>
          <button onClick={onClose} className={`w-7 h-7 flex items-center justify-center rounded-lg ${theme.subtleText} hover:${theme.hoverIconBg}`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-start gap-3 mb-4">
          <span className="w-10 h-10 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
            <ListChecks className="w-5 h-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className={`font-bold text-sm ${theme.headingText}`}>{m.name}</p>
            <p className={`text-[11px] mt-0.5 ${theme.subtleText}`}>{clientName}</p>
          </div>
          <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${m.done ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>
            {m.done ? "Done" : "Pending"}
          </span>
        </div>

        <button
          type="button"
          onClick={onToggleDone}
          className={`w-full flex items-center justify-center gap-1.5 text-sm font-semibold py-2.5 rounded-full transition mb-4 ${
            m.done ? "border text-rose-500 hover:bg-rose-50" + " " + theme.border : "bg-emerald-600 hover:bg-emerald-500 text-white"
          }`}
        >
          <Check className="w-4 h-4" /> {m.done ? "Mark as Not Done" : "Mark as Done"}
        </button>

        <div className={`rounded-xl p-3 ${theme.inputBg}`}>
          <p className={`text-xs font-bold mb-2 ${theme.headingText}`}>Attachments</p>

          {attachments.length > 0 && (
            <div className="space-y-2 mb-3">
              {attachments.map((a) => (
                <div key={a.id} className={`flex items-center gap-2.5 rounded-lg border p-2 ${theme.border}`}>
                  {a.type === "image" ? (
                    <img src={a.url} alt={a.name} className="w-10 h-10 rounded-md object-cover shrink-0" />
                  ) : a.type === "video" ? (
                    <span className="w-10 h-10 rounded-md bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                      <Video className="w-4 h-4" />
                    </span>
                  ) : a.type === "zip" ? (
                    <span className="w-10 h-10 rounded-md bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                      <Archive className="w-4 h-4" />
                    </span>
                  ) : a.type === "link" ? (
                    <span className="w-10 h-10 rounded-md bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                      <Link2 className="w-4 h-4" />
                    </span>
                  ) : (
                    <span className="w-10 h-10 rounded-md bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                      <FileIcon className="w-4 h-4" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={`text-xs font-semibold truncate ${theme.headingText}`}>{a.name}</p>
                    <p className={`text-[10.5px] capitalize ${theme.subtleText}`}>{a.type}</p>
                    {/* Section 6/14 — review/approval gate. Every submission
                        (link OR image/video/zip/file) starts pending_review
                        and stays invisible to the Client Portal until this
                        is checked — see ModuleFile.approved / Module.url_approved
                        on the backend.
                        BUG 1 FIX: only show the checkbox when the attachment
                        has a real numeric ModuleFile pk. Legacy local-only
                        entries have att-... string ids that have no real DB
                        row, so calling the approve endpoint with them 404s.
                        They display as informational only until they are
                        re-uploaded through the real upload pipeline. */}
                    {onToggleApproval && (() => {
                      // A link's real backend id is "link-<modulePk>"; a link
                      // that only exists locally (legacy) has nothing to approve.
                      const isBackendLink = a.type === "link" && String(a.id).startsWith("link-");
                      if (a.type === "link" && !isBackendLink) return null;
                      const hasRealId = isBackendLink || (a.id !== undefined && a.id !== null && /^\d+$/.test(String(a.id)));
                      return hasRealId ? (
                        <label className="mt-1 flex items-center gap-1.5 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={!!a.approved}
                            onChange={(e) => onToggleApproval(a.id, e.target.checked)}
                            className="w-3.5 h-3.5 accent-violet-600"
                          />
                          <span className={`text-[10px] font-semibold ${a.approved ? "text-emerald-600" : "text-amber-600"}`}>
                            {a.approved ? "Approved · shown on Portal" : "Pending review — approve to show on Portal"}
                          </span>
                        </label>
                      ) : (
                        <p className="mt-1 text-[10px] text-slate-400 font-medium">
                          Legacy upload — re-upload to enable approval
                        </p>
                      );
                    })()}
                  </div>
                  {onOpenAttachment ? (
                    <button
                      type="button"
                      onClick={() => onOpenAttachment(a)}
                      className="shrink-0 text-[11px] font-semibold text-violet-600 hover:text-violet-700"
                    >
                      {attachmentClickLabel(a)}
                    </button>
                  ) : (
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-[11px] font-semibold text-violet-600 hover:text-violet-700"
                    >
                      Open ↗
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
          {attachments.length === 0 && <p className={`text-[11px] mb-3 ${theme.subtleText}`}>Nothing uploaded yet.</p>}

          <div className="flex items-center gap-2">
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addLink()}
              placeholder="Paste a link (https://...)"
              className={`flex-1 min-w-0 text-xs border rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-violet-300 ${theme.border} ${theme.card} ${theme.headingText}`}
            />
            <button
              type="button"
              onClick={addLink}
              disabled={!link.trim()}
              className="shrink-0 text-[11px] font-semibold px-2.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white"
            >
              Add
            </button>
            <label className={`shrink-0 w-9 h-9 flex items-center justify-center rounded-lg border cursor-pointer ${theme.border} ${theme.card}`} title="Upload screenshot, video, or zip file">
              <Upload className={`w-4 h-4 ${theme.headingText}`} />
              <input
                type="file"
                accept={ATTACHMENT_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) addFile(file);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          {busy && <p className={`text-[11px] mt-1.5 ${theme.subtleText}`}>Uploading…</p>}
          {error && <p className="text-[11px] mt-1.5 text-rose-500">{error}</p>}
          <p className={`text-[10.5px] mt-1.5 ${theme.subtleText}`}>Images, videos, or zip files of any size — or just paste a link. Shows on the Tasks page, and on the Client Portal once approved below.</p>
        </div>
      </div>
    </div>
  );
}

/* ======================================================================
   FINAL DELIVERABLE ZIP — the last step once a project's modules are
   all 100% done. One ZIP for the whole project, stored on the project
   record itself (`p.deliverableZip`) so it shows up here AND on the
   Client Portal automatically. Staff can always upload/replace/remove
   it; the payment badge here is informational only — the actual
   download restriction for the client lives on the Portal side.
====================================================================== */
const DELIVERABLE_ZIP_ACCEPT = ".zip,.rar,.7z,application/zip,application/x-zip-compressed,application/x-7z-compressed,application/x-rar-compressed";

function DeliverableZipSection({ project, paymentComplete, onUpload, onRemove, theme }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const zip = project.deliverableZip;

  // BUG FIX (Section 9/10 — ZIP upload succeeds but never appears on the
  // Client Portal, and large zips "failed"): this used to only ever
  // base64-encode the file (capped at 5MB by readFileAsDataUrl) into
  // local React state via onUpload — there was NO call anywhere to the
  // real backend. The Client Portal reads deliverableZip from the
  // backend's own Project.completed_zip (see dashboard/serializers.py
  // ClientProjectSummarySerializer.get_deliverableZip), which stayed
  // permanently empty regardless of what this page showed locally. Now
  // this posts the real file to POST /api/projects/<id>/zip/ (streamed
  // to disk, no size ceiling) and stores the real, permanent server URL
  // it returns — the same file the Portal's own fetch will see.
  const addFile = async (file) => {
    if (!file) return;
    if (!project.backendId) {
      setError("This project isn't linked to the backend yet, so a deliverable can't be uploaded for it.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const updated = await clientsApi.uploadProjectZip(project.backendId, file);
      onUpload({
        id: `project-zip-${project.backendId}`,
        name: updated.zip_original_name || file.name,
        url: updated.completed_zip,
        size: formatFileSize(file.size),
        uploadedAt: new Date().toISOString(),
      });
    } catch (e) {
      setError(e.message || "Could not upload file.");
    } finally {
      setBusy(false);
    }
  };

  const removeFile = async () => {
    setBusy(true);
    setError("");
    try {
      if (project.backendId) {
        try {
          await clientsApi.deleteProjectZip(project.backendId);
        } catch (err) {
          // Nothing stored on the server for this project -> just clear it here.
          if (!/no deliverable|not found/i.test(err?.message || "")) throw err;
        }
      }
      onRemove();
    } catch (e) {
      setError(e.message || "Could not remove the deliverable.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`mt-3 pt-3 border-t rounded-b-xl ${theme.borderLight}`}>
      <div className="flex items-center gap-2 mb-2">
        <Archive className="w-3.5 h-3.5 text-violet-500 shrink-0" />
        <p className={`text-xs font-bold ${theme.headingText}`}>Final Deliverable</p>
        <span
          className={`shrink-0 text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full ${
            paymentComplete ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
          }`}
          title={paymentComplete ? "Client has fully paid — they can download this." : "Client hasn't fully paid yet — hidden from their download on the Portal until they do."}
        >
          {paymentComplete ? "Payment complete" : "Payment pending"}
        </span>
      </div>

      {zip ? (
        <div className={`flex items-center gap-2.5 rounded-lg border p-2.5 ${theme.border}`}>
          <span className="w-9 h-9 rounded-md bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
            <Archive className="w-4 h-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className={`text-xs font-semibold truncate ${theme.headingText}`}>{zip.name}</p>
            <p className={`text-[10.5px] ${theme.subtleText}`}>{zip.size}</p>
          </div>
          <a href={zip.url} download={zip.name} className="shrink-0 text-[11px] font-semibold text-violet-600 hover:text-violet-700">
            Download
          </a>
          <button type="button" onClick={removeFile} disabled={busy} className="shrink-0 text-[11px] font-semibold text-rose-500 hover:text-rose-600">
            Remove
          </button>
        </div>
      ) : (
        <label
          className={`flex items-center justify-center gap-1.5 rounded-lg border border-dashed text-xs font-semibold py-2.5 cursor-pointer ${theme.border} ${theme.subtleText} hover:text-violet-600`}
        >
          <Upload className="w-3.5 h-3.5" /> {busy ? "Uploading…" : "Upload final deliverable (ZIP)"}
          <input
            type="file"
            accept={DELIVERABLE_ZIP_ACCEPT}
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) addFile(file);
              e.target.value = "";
            }}
          />
        </label>
      )}
      {error && <p className="text-[11px] mt-1.5 text-rose-500">{error}</p>}
      <p className={`text-[10.5px] mt-1.5 ${theme.subtleText}`}>
        Shows on the Client Portal too — the client can only download it once their payment is fully settled.
      </p>
    </div>
  );
}

/* ======================================================================
   GENERATE INVOICE MODAL
====================================================================== */

function GenerateInvoiceModal({ client, onClose, onSubmit, theme }) {
  const projects = client.projects || [];
  const [projectName, setProjectName] = useState(projects[0]?.name || "");
  const [milestone, setMilestone] = useState("");
  // Total project payment that milestone amounts get calculated from —
  // prefilled from the client's existing project budget/invoices so it
  // usually doesn't need to be typed at all, but stays editable in case
  // the real total is different.
  const [totalPayment, setTotalPayment] = useState(() => {
    const t = getProjectTotal(client);
    return t ? String(t) : "";
  });

  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");

  // BILL TO — auto-filled from the client record, editable in case this
  // particular invoice needs to go to a different contact/address.
  const [billToName, setBillToName] = useState(client.name || "");
  const [billToAddress, setBillToAddress] = useState(client.address || "");
  const [billToPhone, setBillToPhone] = useState(client.phone || "");
  const [billToEmail, setBillToEmail] = useState(client.email || "");

  // Line items — PROJECT/SERVICE · SCOPE/DESCRIPTION · QTY · RATE ·
  // AMOUNT, same columns as the branded PDF. Row 1 auto-fills from
  // Project/Milestone below (same amount the old single-Amount field
  // used to compute) but every field stays fully editable, and more
  // rows can be added for extra line items.
  const [lineItems, setLineItems] = useState([{ id: 1, description: projectName, scope: "", qty: 1, rate: 0 }]);
  const nextLineId = useRef(2);

  // Auto-calculated milestone share of Total project payment goes into
  // the FIRST line item's rate (same math as before — MILESTONE_AMOUNT_FRACTION,
  // see calcMilestoneAmount), same as the old single Amount field.
  useEffect(() => {
    if (!milestone) return;
    const total = Number(totalPayment);
    if (!Number.isFinite(total) || total <= 0) return;
    const computed = calcMilestoneAmount(total, Number(milestone));
    if (computed == null) return;
    setLineItems((rows) =>
      rows.map((r, i) => (i === 0 ? { ...r, description: projectName || r.description, scope: MILESTONE_LABELS[milestone] || r.scope, rate: computed } : r))
    );
  }, [milestone, totalPayment, projectName]);

  const addLineItem = () => {
    setLineItems((rows) => [...rows, { id: nextLineId.current++, description: "", scope: "", qty: 1, rate: 0 }]);
  };
  const removeLineItem = (id) => setLineItems((rows) => (rows.length > 1 ? rows.filter((r) => r.id !== id) : rows));
  const updateLineItem = (id, field, value) => setLineItems((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));

  // PROJECT NOTES / PAYMENT DETAILS — same box as the PDF.
  const [poNumber, setPoNumber] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [transactionRef, setTransactionRef] = useState("");
  // Amount received auto-fills from what this client has already paid
  // across every invoice on file — "jo already pay ho chuka" — still
  // editable in case this particular invoice's received amount differs.
  const [amountReceived, setAmountReceived] = useState(() => String((client.invoices || []).reduce((sum, i) => sum + (i.paidAmount || 0), 0)));
  const [discount, setDiscount] = useState("0");

  // APPROVAL & AUTHORIZATION — optional, matches the PDF's signature block.
  const [approvedBy, setApprovedBy] = useState("");
  const [designation, setDesignation] = useState("");
  const [approvalDate, setApprovalDate] = useState("");

  const subtotal = lineItems.reduce((sum, r) => sum + (Number(r.qty) || 0) * (Number(r.rate) || 0), 0);
  const discountNum = Number(discount) || 0;
  const grandTotal = Math.max(0, subtotal - discountNum);
  const amountReceivedNum = Number(amountReceived) || 0;
  const balanceDue = Math.max(0, grandTotal - amountReceivedNum);
  const canSubmit = grandTotal > 0;

  const previewNumber = `INV-${1001 + (client.invoices?.length || 0)}`;
  const today = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  const inputCls = `w-full text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-300 ${theme.border} ${theme.inputBg} ${theme.cardText}`;
  const smallInputCls = `w-full text-xs border rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-violet-300 ${theme.border} ${theme.inputBg} ${theme.cardText}`;
  const labelCls = `text-xs font-semibold mb-1 block ${theme.mutedText}`;

  const handleSubmit = () => {
    onSubmit({
      amount: grandTotal,
      dueDate: dueDate ? new Date(dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—",
      note: note.trim(),
      milestone: milestone ? Number(milestone) : null,
      projectName: projectName || "",
      billTo: { name: billToName, address: billToAddress, phone: billToPhone, email: billToEmail },
      lineItems: lineItems.map((r) => ({ description: r.description, scope: r.scope, qty: Number(r.qty) || 0, rate: Number(r.rate) || 0 })),
      poNumber: poNumber.trim(),
      paymentMethod: paymentMethod.trim(),
      transactionRef: transactionRef.trim(),
      amountReceived: amountReceivedNum,
      discount: discountNum,
      subtotal,
      grandTotal,
      approvedBy: approvedBy.trim(),
      designation,
      approvalDate,
    });
  };

  return (
    <div className="fixed inset-0 z-[95] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`rounded-2xl w-full max-w-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto ${theme.card}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className={`text-lg font-bold ${theme.headingText}`}>Generate Invoice</h3>
          <button onClick={onClose} className={`w-8 h-8 flex items-center justify-center rounded-lg hover:${theme.hoverIconBg} ${theme.mutedText}`}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className={`text-xs mb-4 ${theme.subtleText}`}>
          For {client.name} · will be previewed as {previewNumber}, dated {today}
        </p>

        <div className="space-y-4">
          {/* FROM / BILL TO — matches the PDF's two side-by-side boxes */}
          <div className="grid sm:grid-cols-2 gap-3">
            <div className={`rounded-xl border p-3 ${theme.borderLight}`}>
              <p className="text-[10px] font-bold text-violet-600 mb-1.5">FROM</p>
              <p className={`text-xs font-bold ${theme.headingText}`}>{HOPENIX_COMPANY.name}</p>
              <p className={`text-[10.5px] mt-1 ${theme.subtleText}`}>{HOPENIX_COMPANY.address}</p>
              <p className={`text-[10.5px] ${theme.subtleText}`}>{HOPENIX_COMPANY.phone}</p>
              <p className={`text-[10.5px] ${theme.subtleText}`}>{HOPENIX_COMPANY.email}</p>
            </div>
            <div className={`rounded-xl border p-3 space-y-1.5 ${theme.borderLight}`}>
              <p className="text-[10px] font-bold text-violet-600 mb-0.5">BILL TO</p>
              <input value={billToName} onChange={(e) => setBillToName(e.target.value)} placeholder="Client / company name" className={smallInputCls} />
              <input value={billToAddress} onChange={(e) => setBillToAddress(e.target.value)} placeholder="Address" className={smallInputCls} />
              <div className="grid grid-cols-2 gap-1.5">
                <input value={billToPhone} onChange={(e) => setBillToPhone(e.target.value)} placeholder="Phone" className={smallInputCls} />
                <input value={billToEmail} onChange={(e) => setBillToEmail(e.target.value)} placeholder="Email" className={smallInputCls} />
              </div>
            </div>
          </div>

          {/* Project + milestone — drives line item 1's auto-fill, same as before */}
          <div className="grid sm:grid-cols-2 gap-3">
            {projects.length > 0 && (
              <div>
                <label className={labelCls}>Project</label>
                <select value={projectName} onChange={(e) => setProjectName(e.target.value)} className={inputCls}>
                  {projects.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className={labelCls}>Milestone (optional)</label>
              <select value={milestone} onChange={(e) => setMilestone(e.target.value)} className={inputCls}>
                <option value="">No specific milestone</option>
                {Object.entries(MILESTONE_LABELS).map(([n, label]) => (
                  <option key={n} value={n}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {milestone && (
            <div>
              <label className={labelCls}>Total project payment (PKR)</label>
              <div className="relative">
                <DollarSign className={`w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 ${theme.subtleText}`} />
                <input
                  type="number"
                  min="0"
                  max="99999999"
                  inputMode="decimal"
                  value={totalPayment}
                  onChange={(e) => setTotalPayment(e.target.value)}
                  className={`w-full text-sm border rounded-lg pl-9 pr-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-300 ${theme.border} ${theme.inputBg} ${theme.cardText}`}
                />
              </div>
              <p className={`text-[10.5px] mt-1 ${theme.subtleText}`}>
                {MILESTONE_LABELS[milestone]} bills {Math.round((MILESTONE_AMOUNT_FRACTION[Number(milestone)] || 0) * 100)}% of this into line item 1
                below. Frontend/Backend attachments (or the final ZIP) stay locked for the client until this invoice is Paid.
              </p>
            </div>
          )}

          {/* Line items table — # · PROJECT/SERVICE · SCOPE/DESCRIPTION · QTY · RATE · AMOUNT */}
          <div>
            <label className={labelCls}>Project / Service items</label>
            <div className={`rounded-xl border overflow-hidden ${theme.borderLight}`}>
              <div className={`grid grid-cols-[1fr_1fr_44px_70px_70px_28px] gap-1.5 px-2 py-1.5 text-[9.5px] font-bold uppercase ${theme.subtleText} bg-violet-500/10`}>
                <span>Project/Service</span>
                <span>Scope/Description</span>
                <span>Qty</span>
                <span>Rate</span>
                <span>Amount</span>
                <span />
              </div>
              {lineItems.map((row) => (
                <div key={row.id} className={`grid grid-cols-[1fr_1fr_44px_70px_70px_28px] gap-1.5 px-2 py-1.5 border-t items-center ${theme.borderLight}`}>
                  <input value={row.description} onChange={(e) => updateLineItem(row.id, "description", e.target.value)} className={smallInputCls} />
                  <input value={row.scope} onChange={(e) => updateLineItem(row.id, "scope", e.target.value)} className={smallInputCls} />
                  <input
                    type="number"
                    min="0"
                    value={row.qty}
                    onChange={(e) => updateLineItem(row.id, "qty", e.target.value)}
                    className={`${smallInputCls} text-center px-1`}
                  />
                  <input
                    type="number"
                    min="0"
                    value={row.rate}
                    onChange={(e) => updateLineItem(row.id, "rate", e.target.value)}
                    className={`${smallInputCls} px-1.5`}
                  />
                  <span className={`text-xs font-semibold text-right ${theme.cardText}`}>{fmtMoney((Number(row.qty) || 0) * (Number(row.rate) || 0))}</span>
                  <button
                    type="button"
                    onClick={() => removeLineItem(row.id)}
                    disabled={lineItems.length === 1}
                    className="text-rose-500 hover:text-rose-600 disabled:opacity-30 disabled:cursor-not-allowed justify-self-center"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addLineItem} className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-violet-600 hover:text-violet-700">
              <Plus className="w-3 h-3" /> Add line item
            </button>
          </div>

          {/* Project notes / payment details */}
          <div className={`rounded-xl border p-3 space-y-2 ${theme.borderLight}`}>
            <p className="text-[10px] font-bold text-violet-600">PROJECT NOTES / PAYMENT DETAILS</p>
            <input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="Project reference / PO no." className={smallInputCls} />
            <div className="grid grid-cols-2 gap-1.5">
              <input value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} placeholder="Payment method" className={smallInputCls} />
              <input value={transactionRef} onChange={(e) => setTransactionRef(e.target.value)} placeholder="Transaction ref." className={smallInputCls} />
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="text-[10px] font-semibold mb-0.5 block text-emerald-600">Amount received (PKR)</label>
                <input type="number" min="0" value={amountReceived} onChange={(e) => setAmountReceived(e.target.value)} className={smallInputCls} />
              </div>
              <div>
                <label className="text-[10px] font-semibold mb-0.5 block text-rose-500">Balance due (PKR)</label>
                <div className={`text-xs font-bold py-2 ${theme.headingText}`}>{fmtMoney(balanceDue)}</div>
              </div>
            </div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Note (optional)" className={`${smallInputCls} resize-none`} />
          </div>

          {/* Totals */}
          <div className={`rounded-xl border p-3 space-y-1.5 ${theme.borderLight}`}>
            <div className="flex items-center justify-between text-xs">
              <span className={theme.subtleText}>Subtotal</span>
              <span className={`font-semibold ${theme.cardText}`}>{fmtMoney(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className={theme.subtleText}>Discount (PKR)</span>
              <input
                type="number"
                min="0"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                className={`w-24 text-xs text-right border rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-violet-300 ${theme.border} ${theme.inputBg} ${theme.cardText}`}
              />
            </div>
            <div className="flex items-center justify-between pt-1.5 border-t border-dashed border-violet-300">
              <span className="text-xs font-bold text-violet-600">Grand Total</span>
              <span className="text-sm font-extrabold text-violet-600">{fmtMoney(grandTotal)}</span>
            </div>
          </div>

          <div>
            <label className={labelCls}>Due date</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
          </div>

          {/* Approval & authorization — optional, matches the PDF's signature block */}
          <div className={`rounded-xl border p-3 space-y-2 ${theme.borderLight}`}>
            <p className="text-[10px] font-bold text-violet-600">APPROVAL &amp; AUTHORIZATION (optional)</p>
            <input value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} placeholder="Approved by (name)" className={smallInputCls} />
            <div className="flex flex-wrap gap-1.5">
              {INVOICE_DESIGNATIONS.map((d) => (
                <button
                  type="button"
                  key={d}
                  onClick={() => setDesignation((cur) => (cur === d ? "" : d))}
                  className={`text-[10.5px] font-semibold px-2.5 py-1 rounded-full border ${
                    designation === d ? "bg-violet-600 border-violet-600 text-white" : `${theme.border} ${theme.subtleText}`
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
            <input type="date" value={approvalDate} onChange={(e) => setApprovalDate(e.target.value)} className={smallInputCls} />
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className={`flex-1 border text-sm font-semibold py-2.5 rounded-full ${theme.border} ${theme.cardText}`}>
            Cancel
          </button>
          <button
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="flex-1 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-full transition"
          >
            Generate
          </button>
        </div>
      </div>
    </div>
  );
}

/* ======================================================================
   INVOICE DOCUMENT PREVIEW — read-only render of a generated invoice,
   visually matching the branded HOPENIX PDF exactly (same FROM/BILL TO
   boxes, line-item table, notes/payment box, totals, approval block).
   Used here for the admin's "View Invoice" button; exported so the same
   component can be dropped into the Client Portal to show the client
   this exact document too (it reads straight off invoice fields that
   generateInvoice() now saves — billTo/lineItems/paymentMethod/etc — so
   nothing extra needs fetching).
====================================================================== */
export function InvoiceDocumentPreview({ client, invoice, theme, onClose }) {
  if (!invoice) return null;
  const billTo = invoice.billTo || { name: client?.name, address: client?.address, phone: client?.phone, email: client?.email };
  const lineItems = invoice.lineItems?.length ? invoice.lineItems : [{ description: invoice.projectName, scope: invoice.note, qty: 1, rate: invoice.amount }];
  const subtotal = Number.isFinite(invoice.subtotal) ? invoice.subtotal : invoice.amount;
  const discount = invoice.discount || 0;
  const grandTotal = Number.isFinite(invoice.grandTotal) ? invoice.grandTotal : invoice.amount;
  const balance = Math.max(0, invoice.amount - (invoice.paidAmount || 0));

  return (
    <div className="fixed inset-0 z-[96] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl ${theme.card}`} onClick={(e) => e.stopPropagation()}>
        {/* Header — gradient purple bar + HOPENIX wordmark, matches the PDF */}
        <div className="rounded-t-2xl bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-1.5 text-white font-extrabold text-lg tracking-wide">
              <Building className="w-5 h-5" /> {HOPENIX_COMPANY.name}
            </div>
            <p className="text-[9.5px] text-violet-100 tracking-wide">{HOPENIX_COMPANY.tagline}</p>
          </div>
          <div className="text-right text-white">
            <p className="text-xl font-extrabold tracking-wide">INVOICE</p>
            <p className="text-[9.5px] text-violet-100">MULTI-PROJECT BILLING</p>
          </div>
        </div>

        <div className="p-5 space-y-4" id="invoice-print-area">
          <div className="flex items-center justify-between text-xs">
            <span className={`font-bold ${theme.headingText}`}>Invoice No: {invoice.number}</span>
            <span className={theme.subtleText}>
              Date: {invoice.issueDate} &nbsp; Due: {invoice.dueDate}
            </span>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className={`rounded-xl border p-3 ${theme.borderLight}`}>
              <p className="text-[10px] font-bold text-violet-600 mb-1">FROM</p>
              <p className={`text-xs font-bold ${theme.headingText}`}>{HOPENIX_COMPANY.name}</p>
              <p className={`text-[10.5px] mt-1 ${theme.subtleText}`}>{HOPENIX_COMPANY.address}</p>
              <p className={`text-[10.5px] ${theme.subtleText}`}>{HOPENIX_COMPANY.phone}</p>
              <p className={`text-[10.5px] ${theme.subtleText}`}>{HOPENIX_COMPANY.email}</p>
            </div>
            <div className={`rounded-xl border p-3 ${theme.borderLight}`}>
              <p className="text-[10px] font-bold text-violet-600 mb-1">BILL TO</p>
              <p className={`text-xs font-bold ${theme.headingText}`}>{billTo.name}</p>
              <p className={`text-[10.5px] mt-1 ${theme.subtleText}`}>{billTo.address}</p>
              <p className={`text-[10.5px] ${theme.subtleText}`}>{billTo.phone}</p>
              <p className={`text-[10.5px] ${theme.subtleText}`}>{billTo.email}</p>
            </div>
          </div>

          <div className={`rounded-xl border overflow-hidden ${theme.borderLight}`}>
            <div className="grid grid-cols-[1fr_1fr_40px_70px_70px] gap-1.5 px-2.5 py-1.5 text-[9.5px] font-bold uppercase text-white bg-gradient-to-r from-violet-600 to-indigo-600">
              <span>Project/Service</span>
              <span>Scope/Description</span>
              <span>Qty</span>
              <span>Rate</span>
              <span className="text-right">Amount</span>
            </div>
            {lineItems.map((row, i) => (
              <div key={i} className={`grid grid-cols-[1fr_1fr_40px_70px_70px] gap-1.5 px-2.5 py-2 text-[11px] border-t ${theme.borderLight}`}>
                <span className={theme.cardText}>{row.description}</span>
                <span className={theme.subtleText}>{row.scope}</span>
                <span className={`text-center ${theme.cardText}`}>{row.qty}</span>
                <span className={theme.cardText}>{fmtMoney(row.rate)}</span>
                <span className={`text-right font-semibold ${theme.cardText}`}>{fmtMoney((row.qty || 0) * (row.rate || 0))}</span>
              </div>
            ))}
          </div>

          {(invoice.poNumber || invoice.paymentMethod || invoice.transactionRef || invoice.note) && (
            <div className={`rounded-xl border p-3 space-y-1 text-[11px] ${theme.borderLight}`}>
              <p className="text-[10px] font-bold text-violet-600 mb-1">PROJECT NOTES / PAYMENT DETAILS</p>
              {invoice.poNumber && <p className={theme.cardText}>PO/Reference: {invoice.poNumber}</p>}
              {invoice.paymentMethod && <p className={theme.cardText}>Payment method: {invoice.paymentMethod}</p>}
              {invoice.transactionRef && <p className={theme.cardText}>Transaction ref: {invoice.transactionRef}</p>}
              {invoice.note && <p className={theme.subtleText}>{invoice.note}</p>}
            </div>
          )}

          <div className={`rounded-xl border p-3 space-y-1.5 ${theme.borderLight}`}>
            <div className="flex items-center justify-between text-xs">
              <span className={theme.subtleText}>Subtotal</span>
              <span className={`font-semibold ${theme.cardText}`}>{fmtMoney(subtotal)}</span>
            </div>
            {discount > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className={theme.subtleText}>Discount</span>
                <span className="font-semibold text-rose-500">-{fmtMoney(discount)}</span>
              </div>
            )}
            <div className="flex items-center justify-between pt-1.5 border-t border-dashed border-violet-300">
              <span className="text-xs font-bold text-violet-600">Grand Total</span>
              <span className="text-sm font-extrabold text-violet-600">{fmtMoney(grandTotal)}</span>
            </div>
            <div className="flex items-center justify-between text-xs pt-1">
              <span className={theme.subtleText}>Paid</span>
              <span className="font-semibold text-emerald-600">{fmtMoney(invoice.paidAmount || 0)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className={theme.subtleText}>Balance due</span>
              <span className="font-semibold text-rose-500">{fmtMoney(balance)}</span>
            </div>
          </div>

          {(invoice.approvedBy || invoice.designation) && (
            <div className={`rounded-xl border p-3 text-[11px] ${theme.borderLight}`}>
              <p className="text-[10px] font-bold text-violet-600 mb-1">APPROVAL &amp; AUTHORIZATION</p>
              <p className={theme.cardText}>
                {invoice.approvedBy} {invoice.designation ? `(${invoice.designation})` : ""} {invoice.approvalDate ? `· ${invoice.approvalDate}` : ""}
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-2 p-5 pt-0">
          <button onClick={onClose} className={`flex-1 border text-sm font-semibold py-2.5 rounded-full ${theme.border} ${theme.cardText}`}>
            Close
          </button>
          <a
            href={client ? whatsappLinkForInvoice(client, invoice) : "#"}
            target="_blank"
            rel="noreferrer"
            className="flex-1 flex items-center justify-center gap-1.5 border border-emerald-300 text-emerald-600 text-sm font-semibold py-2.5 rounded-full hover:bg-emerald-50 transition"
          >
            <MessageCircle className="w-4 h-4" /> Share on WhatsApp
          </a>
          <button
            onClick={() => window.print()}
            className="flex-1 flex items-center justify-center gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 text-white text-sm font-semibold py-2.5 rounded-full transition"
          >
            <Download className="w-4 h-4" /> Print / Save PDF
          </button>
        </div>
      </div>
    </div>
  );
}

/* ======================================================================
   RECORD PAYMENT MODAL
====================================================================== */

function RecordPaymentModal({ invoice, onClose, onSubmit, theme }) {
  const balance = Math.max(0, (invoice?.amount || 0) - (invoice?.paidAmount || 0));
  const [amount, setAmount] = useState(String(balance));
  const amt = Number(amount);
  const canSubmit = amount.trim() !== "" && Number.isFinite(amt) && amt > 0 && amt <= balance + 0.01;

  if (!invoice) return null;

  const inputCls = `w-full text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-300 ${theme.border} ${theme.inputBg} ${theme.cardText}`;
  const labelCls = `text-xs font-semibold mb-1 block ${theme.mutedText}`;

  return (
    <div className="fixed inset-0 z-[95] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`rounded-2xl w-full max-w-sm p-6 shadow-2xl ${theme.card}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className={`text-lg font-bold ${theme.headingText}`}>Record Payment</h3>
          <button onClick={onClose} className={`w-8 h-8 flex items-center justify-center rounded-lg hover:${theme.hoverIconBg} ${theme.mutedText}`}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className={`text-xs mb-4 ${theme.subtleText}`}>
          {invoice.number} · balance due {fmtMoney(balance)}
        </p>
        <div>
          <label className={labelCls}>Payment amount (PKR)</label>
          <div className="relative">
            <DollarSign className={`w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 ${theme.subtleText}`} />
            <input
              type="number"
              min="0"
              max={balance}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={`w-full text-sm border rounded-lg pl-9 pr-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-300 ${theme.border} ${theme.inputBg} ${theme.cardText}`}
              autoFocus
            />
          </div>
          {!canSubmit && amount.trim() !== "" && <p className="text-[11px] text-rose-500 mt-1">Enter an amount up to {fmtMoney(balance)}.</p>}
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className={`flex-1 border text-sm font-semibold py-2.5 rounded-full ${theme.border} ${theme.cardText}`}>
            Cancel
          </button>
          <button
            disabled={!canSubmit}
            onClick={() => onSubmit(amt)}
            className="flex-1 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-full transition"
          >
            Record Payment
          </button>
        </div>
      </div>
    </div>
  );
}

/* ======================================================================
   CLIENT PENDING PAYMENT MODAL — opened from the "Client Pending
   Payment" stat card. Lists every client that still owes money
   (client.outstanding > 0), highest balance first, so admin can see at
   a glance who to follow up with without opening each client one by
   one. Clicking a row jumps straight to that client's details panel.
====================================================================== */

function PendingPaymentModal({ clients, onClose, onSelectClient, theme }) {
  const pending = (clients || [])
    .filter((c) => (c.outstanding || 0) > 0)
    .sort((a, b) => (b.outstanding || 0) - (a.outstanding || 0));
  const totalOutstanding = pending.reduce((sum, c) => sum + (c.outstanding || 0), 0);

  return (
    <div className="fixed inset-0 z-[95] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`rounded-2xl w-full max-w-md p-6 shadow-2xl ${theme.card}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className={`text-lg font-bold ${theme.headingText}`}>Client Pending Payment</h3>
          <button onClick={onClose} className={`w-8 h-8 flex items-center justify-center rounded-lg hover:${theme.hoverIconBg} ${theme.mutedText}`}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className={`text-xs mb-4 ${theme.subtleText}`}>
          {pending.length} client{pending.length === 1 ? "" : "s"} with money still owed · {fmtMoney(totalOutstanding)} total outstanding
        </p>

        {pending.length === 0 ? (
          <div className="text-center py-8">
            <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-2.5">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <p className={`text-sm font-semibold ${theme.headingText}`}>All caught up</p>
            <p className={`text-xs mt-1 ${theme.subtleText}`}>No client currently has an outstanding balance.</p>
          </div>
        ) : (
          <div className={`space-y-2 max-h-[60vh] overflow-y-auto pr-1 -mr-1`}>
            {pending.map((c) => (
              <button
                key={c.id}
                onClick={() => onSelectClient(c.id)}
                className={`w-full flex items-center justify-between gap-3 rounded-xl border p-3 text-left transition ${theme.border} hover:${theme.hoverRow}`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <CompanyAvatar name={c.name} size="w-9 h-9" text="text-xs" imageUrl={c.profilePic} />
                  <div className="min-w-0">
                    <p className={`text-sm font-semibold truncate ${theme.cardText}`}>{c.name}</p>
                    <p className={`text-[11px] truncate ${theme.subtleText}`}>{c.manager?.name || "Unassigned"}</p>
                  </div>
                </div>
                <span className="max-w-[40%] truncate text-sm font-bold text-rose-600" title={fmtMoney(c.outstanding)}>{fmtMoney(c.outstanding)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ======================================================================
   NEW CLIENT ID CONFIRMATION MODAL
   Shown right after a client is added, so the admin has one obvious
   place to grab the Client ID (and email) to send over — instead of
   having to hunt for it afterwards in the details panel.
====================================================================== */

function NewClientIdModal({ info, onClose, theme }) {
  if (!info) return null;
  return (
    <div className="fixed inset-0 z-[95] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`rounded-2xl w-full max-w-sm p-6 shadow-2xl text-center ${theme.card}`} onClick={(e) => e.stopPropagation()}>
        <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-3">
          <CheckCircle2 className="w-6 h-6 text-emerald-600" />
        </div>
        <h3 className={`text-lg font-bold ${theme.headingText}`}>Client Added</h3>
        <p className={`text-xs mt-1 ${theme.subtleText}`}>
          {info.password ? `${info.name} ka Client Portal login ready hai.` : `${info.name} add ho gaya, lekin Client Portal login abhi ready nahi hai.`}
        </p>

        <div className={`mt-4 rounded-xl border p-4 text-left space-y-3 ${theme.border} ${theme.inputBg}`}>
          <div>
            <p className={`text-[11px] font-semibold mb-1 ${theme.subtleText}`}>Client ID</p>
            <div className="flex items-center justify-between gap-2">
              <span className={`inline-flex items-center gap-1.5 text-sm font-bold tracking-wide ${theme.headingText}`}>
                <KeyRound className="w-3.5 h-3.5 text-violet-500" />
                {info.id}
              </span>
              <CopyButton value={info.id} label="Copy ID" className="text-violet-600 hover:text-violet-700" />
            </div>
          </div>
          <div className={`h-px ${theme.borderLight} border-t`} />
          <div>
            <p className={`text-[11px] font-semibold mb-1 ${theme.subtleText}`}>Login Email</p>
            <div className="flex items-center justify-between gap-2">
              <span className={`text-sm truncate ${theme.cardText}`}>{info.email}</span>
              <CopyButton value={info.email} label="Copy" className="text-violet-600 hover:text-violet-700 shrink-0" />
            </div>
          </div>
          {info.password && (
            <>
              <div className={`h-px ${theme.borderLight} border-t`} />
              <div>
                <p className={`text-[11px] font-semibold mb-1 ${theme.subtleText}`}>Password</p>
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-sm font-mono tracking-wide ${theme.cardText}`}>{info.password}</span>
                  <CopyButton value={info.password} label="Copy" className="text-violet-600 hover:text-violet-700 shrink-0" />
                </div>
              </div>
            </>
          )}
        </div>

        {info.password ? (
          <p className={`text-[11px] mt-3 ${theme.subtleText}`}>
            Ye password sirf abhi dikhega, dobara nahi milega — Client ID, email aur password client ko securely bhej dein.
          </p>
        ) : (
          <p className="text-[11px] mt-3 text-amber-600">
            Portal access generate nahi ho saka{info.portalError ? ` (${info.portalError})` : ""}. Client details panel mein "Generate Portal Access" button dabayein.
          </p>
        )}

        <button
          onClick={onClose}
          className="w-full mt-5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 text-white text-sm font-semibold py-2.5 rounded-full transition"
        >
          Done
        </button>
      </div>
    </div>
  );
}

/* ======================================================================
   PORTAL CREDENTIALS MODAL
   Shown right after "Generate Portal Access" succeeds. The backend
   only returns the plain-text password on THIS one response — it's
   hashed immediately and never sent again.
====================================================================== */

function PortalCredentialsModal({ info, onClose, theme }) {
  if (!info) return null;
  return (
    <div className="fixed inset-0 z-[95] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`rounded-2xl w-full max-w-sm p-6 shadow-2xl text-center ${theme.card}`} onClick={(e) => e.stopPropagation()}>
        <div className="w-12 h-12 rounded-2xl bg-violet-50 flex items-center justify-center mx-auto mb-3">
          <KeyRound className="w-6 h-6 text-violet-600" />
        </div>
        <h3 className={`text-lg font-bold ${theme.headingText}`}>Portal Access Ready</h3>
        <p className={`text-xs mt-1 ${theme.subtleText}`}>{info.name} ab Client Portal mein login kar sakta hai.</p>

        <div className={`mt-4 rounded-xl border p-4 text-left space-y-3 ${theme.border} ${theme.inputBg}`}>
          {info.clientId != null && (
            <>
              <div>
                <p className={`text-[11px] font-semibold mb-1 ${theme.subtleText}`}>Client ID</p>
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-sm font-bold tracking-wide ${theme.cardText}`}>{info.clientId}</span>
                  <CopyButton value={String(info.clientId)} label="Copy" className="text-violet-600 hover:text-violet-700 shrink-0" />
                </div>
              </div>
              <div className={`h-px ${theme.borderLight} border-t`} />
            </>
          )}
          <div>
            <p className={`text-[11px] font-semibold mb-1 ${theme.subtleText}`}>Login Email</p>
            <div className="flex items-center justify-between gap-2">
              <span className={`text-sm truncate ${theme.cardText}`}>{info.username}</span>
              <CopyButton value={info.username} label="Copy" className="text-violet-600 hover:text-violet-700 shrink-0" />
            </div>
          </div>
          <div className={`h-px ${theme.borderLight} border-t`} />
          <div>
            <p className={`text-[11px] font-semibold mb-1 ${theme.subtleText}`}>Password</p>
            <div className="flex items-center justify-between gap-2">
              <span className={`text-sm font-mono tracking-wide ${theme.cardText}`}>{info.password}</span>
              <CopyButton value={info.password} label="Copy" className="text-violet-600 hover:text-violet-700 shrink-0" />
            </div>
          </div>
        </div>

        <p className={`text-[11px] mt-3 ${theme.subtleText}`}>
          Ye password sirf abhi dikhega, dobara nahi milega — client ko securely bhej dein.
        </p>

        <button
          onClick={onClose}
          className="w-full mt-5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 text-white text-sm font-semibold py-2.5 rounded-full transition"
        >
          Done
        </button>
      </div>
    </div>
  );
}

/* ======================================================================
   INTAKE REQUESTS MODAL — lists every pending "New Project Request"
   submitted through the public client intake form (ClientIntakeForm.jsx),
   with a detail view per request (including the 30% advance payment
   screenshot) and Approve/Reject actions.
====================================================================== */

function IntakeRequestsModal({ theme, dark, requests, viewingRequestId, onView, onApprove, onReject, onClose }) {
  const viewing = requests.find((r) => r.id === viewingRequestId) || null;

  return (
    <div className="fixed inset-0 z-[95] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl ${theme.card}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex items-center justify-between px-5 py-4 border-b ${theme.borderLight}`}>
          <div>
            <h3 className={`text-lg font-bold ${theme.headingText}`}>Project Requests</h3>
            <p className={`text-xs mt-0.5 ${theme.subtleText}`}>Client intake form ke pending submissions — review karke Approve ya Reject karein.</p>
          </div>
          <button onClick={onClose} className={`p-1.5 rounded-lg ${theme.mutedText} hover:${theme.hoverIconBg}`}>
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        {!viewing ? (
          <div className="overflow-y-auto p-4 space-y-2.5">
            {requests.length === 0 && <p className={`text-sm text-center py-10 ${theme.subtleText}`}>Koi pending request nahi hai.</p>}
            {requests.map((r) => (
              <button
                key={r.id}
                onClick={() => onView(r.id)}
                className={`w-full text-left rounded-xl border p-3.5 transition ${theme.borderLight} ${theme.hoverRow}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className={`text-sm font-bold truncate ${theme.headingText}`}>{r.companyName || r.contactPerson}</p>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 shrink-0">Pending</span>
                </div>
                <p className={`text-xs mt-1 truncate ${theme.cardText}`}>
                  {r.projectName} · {r.projectType}
                </p>
                <p className={`text-[11px] mt-1 ${theme.subtleText}`}>
                  {r.city || "—"} · {r.phone || "—"} · Submitted {r.submittedAt}
                </p>
              </button>
            ))}
          </div>
        ) : (
          <div className="overflow-y-auto p-5 space-y-4">
            <button onClick={() => onView(null)} className="text-xs font-semibold text-violet-500 hover:text-violet-600">
              ← Back to all requests
            </button>

            <div className={`rounded-xl border p-4 space-y-2.5 ${theme.borderLight}`}>
              <Field label="Contact Person" value={viewing.contactPerson} theme={theme} />
              <Field label="Company" value={viewing.companyName} theme={theme} />
              <Field label="Email" value={viewing.email} theme={theme} />
              <Field label="Phone" value={viewing.phone} theme={theme} />
              <Field label="City" value={viewing.city} theme={theme} />
            </div>

            <div className={`rounded-xl border p-4 space-y-2.5 ${theme.borderLight}`}>
              <Field label="Project Name" value={viewing.projectName} theme={theme} />
              <Field label="Project Type" value={viewing.projectType} theme={theme} />
              <Field label="Requirements / Details" value={viewing.requirements} theme={theme} multiline />
              <Field label="Timeline Needed" value={viewing.timeline} theme={theme} />
              <Field label="Purpose / Goal" value={viewing.purpose} theme={theme} multiline />
              <Field label="Estimated Budget" value={viewing.budget ? `PKR ${Number(viewing.budget).toLocaleString()}` : "—"} theme={theme} />
            </div>

            <div className={`rounded-xl border p-4 ${theme.borderLight}`}>
              <p className={`text-[11px] font-semibold mb-2 ${theme.subtleText}`}>30% Advance Payment Screenshot</p>
              {viewing.paymentScreenshot ? (
                <a href={viewing.paymentScreenshot} target="_blank" rel="noopener noreferrer" title="Click to view full size">
                  <img
                    src={viewing.paymentScreenshot}
                    alt="Advance payment screenshot"
                    className="max-h-64 w-auto rounded-lg border border-black/10 hover:opacity-90 transition cursor-zoom-in"
                  />
                </a>
              ) : (
                <p className={`text-xs ${theme.subtleText}`}>No screenshot attached.</p>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => onReject(viewing.id)}
                className="flex-1 flex items-center justify-center gap-1.5 border border-rose-200 text-rose-600 hover:bg-rose-50 text-sm font-semibold py-2.5 rounded-full transition"
              >
                <X className="w-4 h-4" /> Reject
              </button>
              <button
                onClick={() => onApprove(viewing.id)}
                className="flex-1 flex items-center justify-center gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 text-white text-sm font-semibold py-2.5 rounded-full transition"
              >
                <Check className="w-4 h-4" /> Approve &amp; Set Up Project
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, theme, multiline = false }) {
  return (
    <div className="min-w-0">
      <p className={`text-[10.5px] font-semibold uppercase tracking-wide ${theme.subtleText}`}>{label}</p>
      <p className={`text-sm mt-0.5 break-words ${multiline ? "whitespace-pre-wrap" : "truncate"} ${theme.cardText}`}>{value || "—"}</p>
    </div>
  );
}

/* ======================================================================
   EDIT CLIENT MODAL
====================================================================== */

function EditClientModal({ client, onClose, onSubmit, isValidEmail, theme, managers = [] }) {
  const [form, setForm] = useState({
    name: client?.name || "",
    contactPerson: client?.contactPerson || "",
    contactTitle: client?.contactTitle || "",
    email: client?.email || "",
    phone: client?.phone || "",
    dateOfBirth: client?.dateOfBirth || "",
    industry: client?.industry || "",
    manager: client?.manager?.name || "",
    address: client?.address || "",
    country: client?.country || "",
    status: client?.status || "Active",
    activeProjects: client?.activeProjects ?? 0,
    totalProjects: client?.totalProjects ?? 0,
    totalSpent: client?.totalSpent ?? 0,
    outstanding: client?.outstanding ?? 0,
    profilePic: client?.profilePic || null,
  });
  const [emailTouched, setEmailTouched] = useState(false);
  const emailOk = isValidEmail(form.email);
  const canSubmit = form.name.trim() && form.contactPerson.trim() && form.industry && form.dateOfBirth && emailOk;

  // Keeps the client's *current* manager selectable even if they're no
  // longer in the approved-managers list for some reason (role changed,
  // no longer approved, etc.) — otherwise editing this client would
  // silently show a blank/different manager the moment the dropdown
  // opened.
  const managerOptions = useMemo(() => {
    if (client?.manager?.name && !managers.some((m) => m.name === client.manager.name)) {
      return [client.manager, ...managers];
    }
    return managers;
  }, [managers, client]);

  if (!client) return null;

  const inputCls = `w-full text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-300 ${theme.border} ${theme.inputBg} ${theme.cardText}`;
  const labelCls = `text-xs font-semibold mb-1 block ${theme.mutedText}`;

  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`rounded-2xl w-full max-w-md p-6 shadow-2xl max-h-[90vh] overflow-y-auto ${theme.card}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className={`text-lg font-bold ${theme.headingText}`}>Edit Client</h3>
          <button onClick={onClose} className={`w-8 h-8 flex items-center justify-center rounded-lg hover:${theme.hoverIconBg} ${theme.mutedText}`}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-3">
          <ProfilePicField value={form.profilePic} onChange={(v) => setForm({ ...form, profilePic: v })} theme={theme} labelCls={labelCls} />
          <div>
            <label className={labelCls}>Company name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Bright Path Traders" className={inputCls} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>Contact person</label>
              <input value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} placeholder="e.g. Ahmed Khan" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Title</label>
              <input value={form.contactTitle} onChange={(e) => setForm({ ...form, contactTitle: e.target.value })} placeholder="e.g. CTO" className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Email address</label>
            <div className="relative">
              <Mail className={`w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 ${theme.subtleText}`} />
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                onBlur={() => setEmailTouched(true)}
                placeholder="name@company.com"
                className={`w-full text-sm border rounded-lg pl-9 pr-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-300 ${theme.inputBg} ${theme.cardText} ${emailTouched && form.email && !emailOk ? "border-rose-400" : theme.border}`}
              />
            </div>
            {emailTouched && form.email && !emailOk && <p className="text-[11px] text-rose-500 mt-1">Enter a valid email address.</p>}
          </div>
          <div>
            <label className={labelCls}>Phone</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="e.g. +92 300 1234567" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Date of Birth *</label>
            <input
              type="date"
              value={form.dateOfBirth}
              onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
              className={inputCls}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>Industry</label>
              <select value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} className={inputCls}>
                <option value="">Select industry</option>
                {INDUSTRIES.map((i) => (
                  <option key={i}>{i}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Assigned manager / developer</label>
              <select value={form.manager} onChange={(e) => setForm({ ...form, manager: e.target.value })} className={inputCls}>
                <option value="">Unassigned</option>
                {managerOptions.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name} — {m.role}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Address</label>
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="e.g. Lahore, Punjab, Pakistan" className={inputCls} />
          </div>
          <CountrySelect value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} inputCls={inputCls} labelCls={labelCls} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>Status</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={inputCls}>
                <option>Active</option>
                <option>Inactive</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Active projects</label>
              <input
                type="number"
                min="0"
                value={form.activeProjects}
                onChange={(e) => setForm({ ...form, activeProjects: e.target.value })}
                className={inputCls}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>Total spent (PKR)</label>
              <input
                type="number"
                min="0"
                max="99999999"
                value={form.totalSpent}
                onChange={(e) => setForm({ ...form, totalSpent: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Outstanding (PKR)</label>
              <input
                type="number"
                min="0"
                max="99999999"
                value={form.outstanding}
                onChange={(e) => setForm({ ...form, outstanding: e.target.value })}
                className={inputCls}
              />
            </div>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 mt-5">
          <button onClick={onClose} className={`flex-1 border text-sm font-semibold py-2.5 rounded-full ${theme.border} ${theme.cardText}`}>
            Cancel
          </button>
          <button disabled={!canSubmit} onClick={() => onSubmit(form)} className="flex-1 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-full transition">
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

/* ======================================================================
   EDIT PROJECT MODAL — name/type/budget only, opened from the
   client-detail Projects tab's project-card header (Pencil button).
   Deliberately small: the checklist itself (modules, ticks,
   attachments) already has its own dedicated editing flow (tick a
   module, click a module to attach a file); this is just for the
   project's own top-level fields.
====================================================================== */
function EditProjectModal({ project, onClose, onSubmit, theme }) {
  const [form, setForm] = useState({
    name: project?.name || "",
    type: project?.type || "",
    budget: project?.budget ?? 0,
  });
  const canSubmit = form.name.trim().length > 0;

  if (!project) return null;

  const inputCls = `w-full text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-300 ${theme.border} ${theme.inputBg} ${theme.cardText}`;
  const labelCls = `text-xs font-semibold mb-1 block ${theme.mutedText}`;

  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`rounded-2xl w-full max-w-md p-6 shadow-2xl max-h-[90vh] overflow-y-auto ${theme.card}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className={`text-lg font-bold ${theme.headingText}`}>Edit Project</h3>
          <button onClick={onClose} className={`w-8 h-8 flex items-center justify-center rounded-lg hover:${theme.hoverIconBg} ${theme.mutedText}`}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Project name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Company Website" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Project type</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={inputCls}>
              <option value="">Select type</option>
              {PROJECT_TYPE_OPTIONS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Budget (PKR)</label>
            <input
              type="number"
              min="0"
              max="99999999"
              value={form.budget}
              onChange={(e) => setForm({ ...form, budget: e.target.value })}
              className={inputCls}
            />
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 mt-5">
          <button onClick={onClose} className={`flex-1 border text-sm font-semibold py-2.5 rounded-full ${theme.border} ${theme.cardText}`}>
            Cancel
          </button>
          <button disabled={!canSubmit} onClick={() => onSubmit(form)} className="flex-1 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-full transition">
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

/* ======================================================================
   ADD CLIENT MODAL
====================================================================== */

function AddClientModal({ onClose, onSubmit, submitting = false, isValidEmail, theme, existingClients = [], managers = [], initialData = null, approvalScreenshot = null, title = "Add Client" }) {
  const [form, setForm] = useState(() => {
    const base = {
      name: "",
      contactPerson: "",
      contactTitle: "",
      email: "",
      phone: "",
      dateOfBirth: "",
      industry: "",
      manager: "",
      address: "",
      country: "Pakistan",
      profilePic: null,
      projectName: "",
      projectType: "Website",
      customProjectType: "",
      projectBudget: "",
      projectDetails: "",
      // Custom modules: which modules from the chosen project type's
      // default list to actually include — admin can untick any of them.
      selectedModules: [...PROJECT_TYPES.Website],
      customModuleInput: "",
      // Custom milestones: how many milestones this project is tracked
      // across, and how the budget is split between them.
      milestoneCount: 4,
      customMilestoneCount: "",
      paymentType: "advance",
      advancePercent: 30,
      customSplits: Array(4).fill(""),
    };
    if (!initialData) return base;
    // Coming from an approved intake request (see initialDataFromIntakeRequest
    // in the main component): overlay whatever it collected, then re-derive
    // the module checklist for whichever project type that resolved to
    // (instead of leaving it stuck on Website's default list above), and
    // default to a simple 2-milestone advance plan — the prospect already
    // paid a 30% advance through the form, so that's what actually happened.
    const merged = { ...base, ...initialData };
    merged.selectedModules =
      merged.projectType === CUSTOM_PROJECT_TYPE_VALUE ? [...PROJECT_TYPES.Other] : [...(PROJECT_TYPES[merged.projectType] || PROJECT_TYPES.Other)];
    merged.milestoneCount = 2;
    merged.paymentType = "advance";
    merged.advancePercent = 30;
    return merged;
  });
  const [emailTouched, setEmailTouched] = useState(false);
  const emailOk = isValidEmail(form.email);

  // Resolved milestone count as a real number (handles the "custom
  // count" dropdown option) — used to size the custom-split inputs and
  // to pass down to the invoice generator.
  const resolvedMilestoneCount =
    form.milestoneCount === CUSTOM_MILESTONE_COUNT_VALUE
      ? clampMilestoneCount(form.customMilestoneCount)
      : clampMilestoneCount(form.milestoneCount);

  const customSplitTotal = form.customSplits.slice(0, resolvedMilestoneCount).reduce((s, v) => s + (Number(v) || 0), 0);

  // When the project type changes, reset the module checklist to that
  // type's default list (all ticked) — matches how the modules checklist
  // preview already behaved before this was made custom.
  const handleProjectTypeChange = (type) => {
    const defaults = type === CUSTOM_PROJECT_TYPE_VALUE ? [...PROJECT_TYPES.Other] : [...(PROJECT_TYPES[type] || PROJECT_TYPES.Other)];
    setForm((f) => ({ ...f, projectType: type, selectedModules: defaults }));
  };

  const toggleModule = (name) => {
    setForm((f) => ({
      ...f,
      selectedModules: f.selectedModules.includes(name) ? f.selectedModules.filter((m) => m !== name) : [...f.selectedModules, name],
    }));
  };

  const addCustomModule = () => {
    const name = form.customModuleInput.trim();
    if (!name || form.selectedModules.some((m) => m.toLowerCase() === name.toLowerCase())) return;
    setForm((f) => ({ ...f, selectedModules: [...f.selectedModules, name], customModuleInput: "" }));
  };

  // If this company name + manager already exists, this submission will
  // merge into that client instead of creating a new one — which only
  // makes sense if a project name is actually given (otherwise there's
  // nothing new to add, and Active Projects wouldn't move).
  const matchedClient = useMemo(() => {
    const trimmedName = form.name.trim().toLowerCase();
    if (!trimmedName) return null;
    return (
      existingClients.find(
        (c) => c.name.trim().toLowerCase() === trimmedName && (c.manager?.name || "") === form.manager
      ) || null
    );
  }, [existingClients, form.name, form.manager]);

  // Filling in budget/details/a custom type but leaving Project name
  // blank used to just silently drop the whole project — nothing got
  // added, so Active Projects stayed at 0 even though it looked like a
  // project had been entered. Any of these counts as "there's a project
  // here", so a name becomes required the moment one of them is filled.
  const hasProjectDetails = Boolean(
    String(form.projectBudget).trim() ||
      form.projectDetails.trim() ||
      (form.projectType === CUSTOM_PROJECT_TYPE_VALUE && form.customProjectType.trim())
  );
  const needsProjectName = !form.projectName.trim() && (!!matchedClient || hasProjectDetails);

  // Custom split must add up to exactly 100% before it can be submitted
  // — only checked when there's actually a budget to split.
  const hasBudgetNow = Number.isFinite(Number(form.projectBudget)) && Number(form.projectBudget) > 0;
  const customSplitInvalid = hasBudgetNow && form.paymentType === "custom" && Math.round(customSplitTotal) !== 100;

  const canSubmit = form.name.trim() && form.contactPerson.trim() && form.industry && form.dateOfBirth && emailOk && !needsProjectName && !customSplitInvalid;

  const inputCls = `w-full text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-300 ${theme.border} ${theme.inputBg} ${theme.cardText}`;
  const labelCls = `text-xs font-semibold mb-1 block ${theme.mutedText}`;

  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`rounded-2xl w-full max-w-md p-6 shadow-2xl max-h-[90vh] overflow-y-auto ${theme.card}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className={`text-lg font-bold ${theme.headingText}`}>{title}</h3>
          <button onClick={onClose} className={`w-8 h-8 flex items-center justify-center rounded-lg hover:${theme.hoverIconBg} ${theme.mutedText}`}>
            <X className="w-4 h-4" />
          </button>
        </div>
        {initialData && (
          <p className="text-[11px] mb-3 px-3 py-2 rounded-lg bg-amber-50 text-amber-700">
            Request se pehle se bhara hua hai — Industry aur Date of birth khud select karein, phir modules/milestones adjust karke {title} dabayein.
          </p>
        )}
        {approvalScreenshot && (
          <div className={`mb-3 rounded-lg border p-2.5 ${theme.border}`}>
            <p className={`text-[11px] font-semibold mb-1.5 ${theme.mutedText}`}>30% Advance Payment Screenshot</p>
            <a href={approvalScreenshot} target="_blank" rel="noopener noreferrer" title="Click to view full size">
              <img src={approvalScreenshot} alt="Advance payment screenshot" className="max-h-40 w-auto rounded-md border border-black/10 hover:opacity-90 transition" />
            </a>
          </div>
        )}
        <div className="space-y-3">
          <ProfilePicField value={form.profilePic} onChange={(v) => setForm({ ...form, profilePic: v })} theme={theme} labelCls={labelCls} />
          <div>
            <label className={labelCls}>Company name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Bright Path Traders" className={inputCls} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>Contact person</label>
              <input value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} placeholder="e.g. Ahmed Khan" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Title</label>
              <input value={form.contactTitle} onChange={(e) => setForm({ ...form, contactTitle: e.target.value })} placeholder="e.g. CTO" className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Email address</label>
            <div className="relative">
              <Mail className={`w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 ${theme.subtleText}`} />
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                onBlur={() => setEmailTouched(true)}
                placeholder="name@company.com"
                className={`w-full text-sm border rounded-lg pl-9 pr-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-300 ${theme.inputBg} ${theme.cardText} ${emailTouched && form.email && !emailOk ? "border-rose-400" : theme.border}`}
              />
            </div>
            {emailTouched && form.email && !emailOk && <p className="text-[11px] text-rose-500 mt-1">Enter a valid email address.</p>}
          </div>
          <div>
            <label className={labelCls}>Phone</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="e.g. +92 300 1234567" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Date of Birth *</label>
            <input
              type="date"
              value={form.dateOfBirth}
              onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
              className={inputCls}
            />
            <p className="text-[11px] mt-1 text-slate-400">
              Used to show them a birthday surprise 🎉 on their portal, and required before saving.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>Industry</label>
              <select value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} className={inputCls}>
                <option value="">Select industry</option>
                {INDUSTRIES.map((i) => (
                  <option key={i}>{i}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Assigned manager / developer</label>
              <select value={form.manager} onChange={(e) => setForm({ ...form, manager: e.target.value })} className={inputCls}>
                <option value="">Unassigned</option>
                {managers.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name} — {m.role}
                  </option>
                ))}
              </select>
              {managers.length === 0 && (
                <p className="text-[11px] mt-1 text-amber-500">No approved managers or developers yet — you can still add this client as Unassigned and assign someone later.</p>
              )}
            </div>
          </div>
          <div>
            <label className={labelCls}>Address</label>
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="e.g. Lahore, Punjab, Pakistan" className={inputCls} />
          </div>
          <CountrySelect value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} inputCls={inputCls} labelCls={labelCls} />

          {matchedClient && (
            <p className="text-[11px] rounded-lg px-3 py-2 bg-amber-50 text-amber-700">
              "{matchedClient.name}" already exists under this manager — this will add another project to it, not a new client. Enter a project name below.
            </p>
          )}

          <div className={`border-t pt-3 mt-1 ${theme.borderLight}`}>
            <p className={`text-xs font-bold mb-2 ${theme.headingText}`}>{matchedClient ? "New project for this client" : "First project (optional)"}</p>
            <div>
              <label className={labelCls}>Project name</label>
              <input value={form.projectName} onChange={(e) => setForm({ ...form, projectName: e.target.value })} placeholder="e.g. Website Redesign" className={inputCls} />
              {needsProjectName && (
                <p className="text-[11px] text-rose-500 mt-1">
                  {matchedClient
                    ? "Required to add a new project for this existing client."
                    : "Enter a name for the project details you've filled in below, or clear them if you don't want to add a project yet."}
                </p>
              )}
            </div>
            <div className="mt-2">
              <label className={labelCls}>Project type</label>
              <select value={form.projectType} onChange={(e) => handleProjectTypeChange(e.target.value)} className={inputCls}>
                {PROJECT_TYPE_OPTIONS.map((t) => (
                  <option key={t}>{t}</option>
                ))}
                <option value={CUSTOM_PROJECT_TYPE_VALUE}>✏️ Custom — type manually</option>
              </select>
              {form.projectType === CUSTOM_PROJECT_TYPE_VALUE ? (
                <input
                  value={form.customProjectType}
                  onChange={(e) => setForm({ ...form, customProjectType: e.target.value })}
                  placeholder="e.g. SEO Campaign, Branding Project"
                  className={`${inputCls} mt-2`}
                />
              ) : null}
            </div>

            {/* CUSTOM MODULES — admin picks exactly which modules this
                project starts with (untick anything not needed yet), plus
                can type in any extra module name of their own. Progress %
                is still calculated automatically from whatever's ticked
                here as work gets done. */}
            <div className="mt-2">
              <label className={labelCls}>Modules — chunein ke project mein konsa modules shamil hon</label>
              <div className={`rounded-lg border p-2.5 space-y-1.5 ${theme.border}`}>
                {form.selectedModules.length === 0 && <p className="text-[11px] text-amber-500 mb-1">Kam az kam 1 module select karein.</p>}
                {Array.from(
                  new Set([
                    ...(form.projectType === CUSTOM_PROJECT_TYPE_VALUE ? PROJECT_TYPES.Other : PROJECT_TYPES[form.projectType] || PROJECT_TYPES.Other),
                    ...form.selectedModules,
                  ])
                ).map((name) => (
                  <label key={name} className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="checkbox" checked={form.selectedModules.includes(name)} onChange={() => toggleModule(name)} className="accent-violet-600 w-3.5 h-3.5" />
                    <span className={theme.cardText}>{name}</span>
                  </label>
                ))}
              </div>
              <div className="flex gap-1.5 mt-1.5">
                <input
                  value={form.customModuleInput}
                  onChange={(e) => setForm({ ...form, customModuleInput: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustomModule();
                    }
                  }}
                  placeholder="e.g. SEO Setup — apna module add karein"
                  className={`${inputCls} flex-1 py-1.5`}
                />
                <button type="button" onClick={addCustomModule} className="shrink-0 px-3 text-xs font-semibold rounded-lg bg-violet-100 text-violet-700 hover:bg-violet-200">
                  + Add
                </button>
              </div>
              <p className={`text-[11px] mt-1 ${theme.subtleText}`}>
                Baaki modules baad mein client ki request par ya Projects tab se add ho sakte hain.
              </p>
            </div>

            <div className="mt-2">
              <label className={labelCls}>Project budget (PKR)</label>
              <div className="relative">
                <DollarSign className={`w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 ${theme.subtleText}`} />
                <input
                  type="number"
                  min="0"
                  max="99999999"
                  inputMode="decimal"
                  value={form.projectBudget}
                  onChange={(e) => setForm({ ...form, projectBudget: e.target.value })}
                  placeholder="e.g. 5000"
                  className={`w-full text-sm border rounded-lg pl-9 pr-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-300 ${theme.border} ${theme.inputBg} ${theme.cardText}`}
                />
              </div>
              <p className={`text-[11px] mt-1 ${theme.subtleText}`}>
                Booked as outstanding with a Pending invoice — this is what makes the client count toward Total Client Revenue right away.
              </p>
            </div>

            {/* CUSTOM MILESTONES + PAYMENT TYPE — only meaningful once a
                budget is entered, since these drive how that budget gets
                split into invoices. */}
            {hasBudgetNow && (
              <div className={`mt-2 rounded-lg border p-2.5 space-y-2.5 ${theme.border}`}>
                <div>
                  <label className={labelCls}>Milestones ki tadad (Number of Milestones)</label>
                  <select
                    value={form.milestoneCount}
                    onChange={(e) => {
                      const v = e.target.value === CUSTOM_MILESTONE_COUNT_VALUE ? CUSTOM_MILESTONE_COUNT_VALUE : Number(e.target.value);
                      setForm((f) => ({ ...f, milestoneCount: v }));
                    }}
                    className={inputCls}
                  >
                    {MILESTONE_COUNT_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n} Milestones
                      </option>
                    ))}
                    <option value={CUSTOM_MILESTONE_COUNT_VALUE}>✏️ Custom — number likhein</option>
                  </select>
                  {form.milestoneCount === CUSTOM_MILESTONE_COUNT_VALUE && (
                    <input
                      type="number"
                      min="2"
                      max="10"
                      value={form.customMilestoneCount}
                      onChange={(e) => setForm({ ...form, customMilestoneCount: e.target.value })}
                      placeholder="e.g. 5 (2 se 10 tak)"
                      className={`${inputCls} mt-2`}
                    />
                  )}
                </div>

                <div>
                  <label className={labelCls}>Payment Type</label>
                  <div className="space-y-1.5">
                    {PAYMENT_TYPE_OPTIONS.map((opt) => (
                      <label key={opt.value} className="flex items-start gap-2 text-xs cursor-pointer">
                        <input
                          type="radio"
                          name="paymentType"
                          checked={form.paymentType === opt.value}
                          onChange={() => setForm((f) => ({ ...f, paymentType: opt.value, customSplits: Array(resolvedMilestoneCount).fill("") }))}
                          className="accent-violet-600 w-3.5 h-3.5 mt-0.5"
                        />
                        <span className={theme.cardText}>{opt.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {form.paymentType === "advance" && (
                  <div>
                    <label className={labelCls}>Advance % (abhi lena hai)</label>
                    <input
                      type="number"
                      min="5"
                      max="90"
                      value={form.advancePercent}
                      onChange={(e) => setForm({ ...form, advancePercent: e.target.value })}
                      className={inputCls}
                    />
                    <p className={`text-[11px] mt-1 ${theme.subtleText}`}>
                      {form.advancePercent || 30}% abhi advance, baqi {100 - (Number(form.advancePercent) || 30)}% project ke end (Milestone {resolvedMilestoneCount}) par.
                    </p>
                  </div>
                )}

                {form.paymentType === "full" && (
                  <p className={`text-[11px] ${theme.subtleText}`}>100% payment abhi start mein hi (Milestone 1) collect hogi.</p>
                )}

                {form.paymentType === "custom" && (
                  <div>
                    <label className={labelCls}>Har milestone ka % (total 100 hona chahiye)</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {Array.from({ length: resolvedMilestoneCount }, (_, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <span className={`text-[10.5px] shrink-0 ${theme.subtleText}`}>M{i + 1}</span>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={form.customSplits[i] || ""}
                            onChange={(e) => {
                              const next = [...form.customSplits];
                              next[i] = e.target.value;
                              setForm({ ...form, customSplits: next });
                            }}
                            className={`${inputCls} py-1.5`}
                          />
                        </div>
                      ))}
                    </div>
                    <p className={`text-[11px] mt-1 ${Math.round(customSplitTotal) === 100 ? "text-emerald-500" : "text-rose-500"}`}>
                      Total: {Math.round(customSplitTotal)}% {Math.round(customSplitTotal) !== 100 && "(100% hona zaroori hai)"}
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="mt-2">
              <label className={labelCls}>Project details</label>
              <textarea
                value={form.projectDetails}
                onChange={(e) => setForm({ ...form, projectDetails: e.target.value })}
                placeholder="Scope, milestones, notes — this shows to the client on their portal"
                rows={3}
                className={`w-full text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-300 resize-none ${theme.border} ${theme.inputBg} ${theme.cardText}`}
              />
            </div>
            <p className={`text-[11px] mt-1 ${theme.subtleText}`}>Aur projects baad mein bhi Projects tab se add ho sakte hain.</p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 mt-5">
          <button onClick={onClose} className={`flex-1 border text-sm font-semibold py-2.5 rounded-full ${theme.border} ${theme.cardText}`}>
            Cancel
          </button>
          <button disabled={!canSubmit || submitting} onClick={() => onSubmit(form)} className="flex-1 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-full transition">
            {submitting ? "Saving..." : title}
          </button>
        </div>
      </div>
    </div>
  );
}