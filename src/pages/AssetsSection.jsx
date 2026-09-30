import React, { useEffect, useMemo, useState } from "react";
import { Boxes, Plus, Pencil, Trash2, X, Search, Loader2 } from "lucide-react";
import * as reportsApi from "./reportsApi.js";
import { fetchEmployees } from "../api/employeesApi.js";

/* ------------------------------------------------------------------ */
/*  Company Assets — laptops, furniture, vehicles, equipment, software  */
/*  licenses, etc. that the company owns, optionally assigned to one    */
/*  employee. Admins / anyone with Full Reports Access see every asset; */
/*  everyone else only sees the assets assigned to them — the backend   */
/*  enforces that (reports/views.py asset_queryset), this component     */
/*  just renders whatever it's given and hides Add/Edit/Delete from     */
/*  people who can't use them anyway.                                   */
/* ------------------------------------------------------------------ */

const CATEGORIES = ["Laptop", "Desktop", "Mobile Phone", "Furniture", "Vehicle", "Office Equipment", "Software License", "Other"];
const STATUSES = ["In Use", "Available", "In Repair", "Retired"];

const STATUS_CHIP = {
  "In Use": "bg-sky-50 text-sky-600",
  Available: "bg-emerald-50 text-emerald-600",
  "In Repair": "bg-amber-50 text-amber-600",
  Retired: "bg-slate-100 text-slate-500",
};

function emptyForm() {
  return { name: "", category: "Other", assetTag: "", status: "Available", assignedTo: "", location: "", purchaseDate: "", purchaseCost: "", notes: "" };
}

function AssetFormModal({ darkMode, initial, employees, onClose, onSubmit }) {
  const isEdit = !!initial;
  const [form, setForm] = useState(() =>
    initial
      ? {
          name: initial.name,
          category: initial.category,
          assetTag: initial.assetTag || "",
          status: initial.status,
          assignedTo: initial.assignedToId ? String(initial.assignedToId) : "",
          location: initial.location || "",
          purchaseDate: initial.purchaseDate || "",
          purchaseCost: initial.purchaseCost || "",
          notes: initial.notes || "",
        }
      : emptyForm()
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const inputCls = `mt-1 w-full rounded-lg px-3 py-2 text-xs outline-none border ${
    darkMode ? "bg-slate-800 border-slate-700 text-slate-200" : "bg-slate-50 border-slate-200 text-slate-700"
  }`;
  const labelCls = `text-[11px] font-medium ${darkMode ? "text-slate-400" : "text-slate-500"}`;

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("Give the asset a name first.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSubmit({
        name: form.name.trim(),
        category: form.category,
        assetTag: form.assetTag.trim(),
        status: form.status,
        assignedTo: form.assignedTo ? Number(form.assignedTo) : null,
        location: form.location.trim(),
        purchaseDate: form.purchaseDate || null,
        purchaseCost: form.purchaseCost || 0,
        notes: form.notes.trim(),
      });
      onClose();
    } catch (err) {
      setError(err.message || "Couldn't save this asset.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-md rounded-2xl p-5 shadow-xl ${darkMode ? "bg-slate-900 border border-slate-800" : "bg-white"}`}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className={`font-semibold text-sm ${darkMode ? "text-white" : "text-slate-900"}`}>{isEdit ? "Edit Asset" : "Add Asset"}</h3>
          <button type="button" onClick={onClose} className={darkMode ? "text-slate-400" : "text-slate-400"}>
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className={labelCls}>Asset name</label>
            <input type="text" value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="e.g. MacBook Pro 14&quot;" className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Category</label>
              <select value={form.category} onChange={(e) => update("category", e.target.value)} className={inputCls}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <select value={form.status} onChange={(e) => update("status", e.target.value)} className={inputCls}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Asset tag / Serial #</label>
              <input type="text" value={form.assetTag} onChange={(e) => update("assetTag", e.target.value)} placeholder="Optional" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Location</label>
              <input type="text" value={form.location} onChange={(e) => update("location", e.target.value)} placeholder="e.g. Head office" className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Assigned to</label>
            <select value={form.assignedTo} onChange={(e) => update("assignedTo", e.target.value)} className={inputCls}>
              <option value="">Unassigned</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Purchase date</label>
              <input type="date" value={form.purchaseDate} onChange={(e) => update("purchaseDate", e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Purchase cost (PKR)</label>
              <input type="number" min="0" step="0.01" value={form.purchaseCost} onChange={(e) => update("purchaseCost", e.target.value)} placeholder="0" className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <textarea rows={2} value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder="Optional" className={inputCls} />
          </div>

          {error && <p className="text-[12px] text-rose-500">{error}</p>}

          <button
            type="submit"
            disabled={saving}
            className="w-full mt-1 bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-xs font-semibold py-2.5 rounded-lg disabled:opacity-60 flex items-center justify-center gap-1.5"
          >
            {saving && <Loader2 size={13} className="animate-spin" />}
            {isEdit ? "Save Changes" : "Add Asset"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function AssetsSection({ darkMode = false, isAdmin = false }) {
  const card = darkMode ? "bg-slate-900 border border-slate-800" : "bg-white";
  const cardText = darkMode ? "text-slate-200" : "text-slate-800";
  const subtleText = darkMode ? "text-slate-500" : "text-slate-400";
  const mutedText = darkMode ? "text-slate-400" : "text-slate-500";
  const headingText = darkMode ? "text-white" : "text-slate-900";
  const border = darkMode ? "border-slate-800" : "border-slate-100";
  const rowHover = darkMode ? "hover:bg-slate-800/60" : "hover:bg-slate-50";
  const inputCls = darkMode
    ? "bg-slate-800 border-slate-700 text-slate-200 placeholder:text-slate-500"
    : "bg-white border-slate-200 text-slate-700 placeholder:text-slate-400";

  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState({ results: [], loading: false, error: "" });
  const [employees, setEmployees] = useState([]);
  const [filters, setFilters] = useState({ category: "All", status: "All" });
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null); // null | {} (add) | asset (edit)
  const [busyId, setBusyId] = useState(null);

  function load() {
    setAssets((a) => ({ ...a, loading: true, error: "" }));
    reportsApi
      .listAllAssets({ category: filters.category, status: filters.status, q: search })
      .then((d) => setAssets({ results: d.results, loading: false, error: "" }))
      .catch((e) => setAssets({ results: [], loading: false, error: e.message }));
  }

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(load, search ? 350 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, filters, search]);

  useEffect(() => {
    if (!open || !isAdmin || employees.length) return;
    fetchEmployees()
      .then((rows) => setEmployees((Array.isArray(rows) ? rows : rows?.results || []).map((e) => ({ id: e.id, name: e.name || e.email }))))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isAdmin]);

  const totalValue = useMemo(
    () => assets.results.reduce((sum, a) => sum + (Number(a.purchaseCost) || 0), 0),
    [assets.results]
  );

  async function handleSave(payload) {
    if (modal && modal.id) {
      const updated = await reportsApi.updateAsset(modal.id, payload);
      setAssets((a) => ({ ...a, results: a.results.map((x) => (x.id === updated.id ? updated : x)) }));
    } else {
      const created = await reportsApi.createAsset(payload);
      setAssets((a) => ({ ...a, results: [created, ...a.results] }));
    }
  }

  async function handleDelete(asset) {
    if (!window.confirm(`Remove "${asset.name}" from company assets?`)) return;
    setBusyId(asset.id);
    try {
      await reportsApi.deleteAsset(asset.id);
      setAssets((a) => ({ ...a, results: a.results.filter((x) => x.id !== asset.id) }));
    } catch (e) {
      window.alert(e.message || "Couldn't delete this asset.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={`rounded-xl p-4 shadow-sm ${card}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-start justify-between gap-2.5 text-left">
        <div className="flex items-start gap-2.5">
          <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-indigo-50 text-indigo-600">
            <Boxes size={16} />
          </span>
          <div>
            <h3 className={`font-semibold text-sm ${cardText}`}>Company Assets</h3>
            <p className={`text-[10.5px] mt-0.5 ${subtleText}`}>
              {isAdmin ? "Every laptop, device and piece of equipment the company owns." : "Assets currently assigned to you."}
            </p>
          </div>
        </div>
        <span className={`text-[10.5px] font-semibold shrink-0 ${mutedText}`}>{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="mt-3">
          {/* Summary strip */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className={`rounded-lg border p-2.5 ${border}`}>
              <p className={`text-[10px] ${mutedText}`}>Total assets</p>
              <p className={`text-base font-bold ${headingText}`}>{assets.results.length}</p>
            </div>
            <div className={`rounded-lg border p-2.5 ${border}`}>
              <p className={`text-[10px] ${mutedText}`}>In use</p>
              <p className={`text-base font-bold ${headingText}`}>{assets.results.filter((a) => a.status === "In Use").length}</p>
            </div>
            {isAdmin && (
              <div className={`rounded-lg border p-2.5 ${border}`}>
                <p className={`text-[10px] ${mutedText}`}>Total value</p>
                <p className={`text-base font-bold ${headingText}`}>PKR {totalValue.toLocaleString()}</p>
              </div>
            )}
          </div>

          {/* Filters + Add */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="relative flex-1 min-w-[160px] max-w-xs">
              <Search size={13} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${subtleText}`} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search assets…"
                className={`w-full pl-7 pr-2.5 py-1.5 rounded-lg border text-[11.5px] outline-none focus:ring-2 focus:ring-violet-300 ${inputCls}`}
              />
            </div>
            <select
              value={filters.category}
              onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
              className={`rounded-lg border px-2.5 py-1.5 text-[11.5px] outline-none focus:ring-2 focus:ring-violet-300 ${inputCls}`}
            >
              <option value="All">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
              className={`rounded-lg border px-2.5 py-1.5 text-[11.5px] outline-none focus:ring-2 focus:ring-violet-300 ${inputCls}`}
            >
              <option value="All">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setModal({})}
                className="ml-auto flex items-center gap-1 text-[11.5px] font-semibold px-3 py-1.5 rounded-full bg-violet-600 text-white"
              >
                <Plus size={13} /> Add Asset
              </button>
            )}
          </div>

          {assets.error && <p className="text-[12px] text-rose-500 mb-2">{assets.error}</p>}
          {assets.loading && <p className={`text-[12px] ${mutedText}`}>Loading assets…</p>}

          {!assets.loading && assets.results.length === 0 && !assets.error && (
            <p className={`text-[12px] ${mutedText} py-4 text-center`}>
              {isAdmin ? "No company assets yet — add the first one." : "No assets are assigned to you right now."}
            </p>
          )}

          {/* Desktop table */}
          {assets.results.length > 0 && (
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className={`border-b text-[10.5px] uppercase tracking-wide ${mutedText} ${border}`}>
                    <th className="pb-2 pr-3 font-medium">Asset</th>
                    <th className="pb-2 pr-3 font-medium">Category</th>
                    <th className="pb-2 pr-3 font-medium">Status</th>
                    <th className="pb-2 pr-3 font-medium">Assigned to</th>
                    <th className="pb-2 pr-3 font-medium">Location</th>
                    {isAdmin && <th className="pb-2 pr-3 font-medium">Value</th>}
                    {isAdmin && <th className="pb-2 pr-3 font-medium text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {assets.results.map((a) => (
                    <tr key={a.id} className={`border-b last:border-b-0 text-[11.5px] ${border} ${rowHover}`}>
                      <td className={`py-2.5 pr-3 font-medium ${cardText}`}>
                        {a.name}
                        {a.assetTag && <span className={`ml-1.5 text-[10px] ${subtleText}`}>#{a.assetTag}</span>}
                      </td>
                      <td className={`py-2.5 pr-3 ${mutedText}`}>{a.category}</td>
                      <td className="py-2.5 pr-3">
                        <span className={`text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full ${STATUS_CHIP[a.status] || "bg-slate-100 text-slate-600"}`}>
                          {a.status}
                        </span>
                      </td>
                      <td className={`py-2.5 pr-3 ${mutedText}`}>{a.assignedToName || "—"}</td>
                      <td className={`py-2.5 pr-3 ${mutedText}`}>{a.location || "—"}</td>
                      {isAdmin && <td className={`py-2.5 pr-3 ${mutedText}`}>{Number(a.purchaseCost) ? `PKR ${Number(a.purchaseCost).toLocaleString()}` : "—"}</td>}
                      {isAdmin && (
                        <td className="py-2.5 pr-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => setModal(a)}
                              aria-label="Edit asset"
                              className={`w-6 h-6 rounded-md flex items-center justify-center ${mutedText} ${rowHover}`}
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(a)}
                              disabled={busyId === a.id}
                              aria-label="Delete asset"
                              className={`w-6 h-6 rounded-md flex items-center justify-center text-rose-500 ${rowHover} disabled:opacity-50`}
                            >
                              {busyId === a.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Mobile card list */}
          <div className="sm:hidden mt-1 space-y-2.5">
            {assets.results.map((a) => (
              <div key={a.id} className={`rounded-lg border p-3 ${border}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className={`text-[12px] font-semibold truncate ${cardText}`}>{a.name}</p>
                    <p className={`text-[10.5px] ${mutedText}`}>{a.category}{a.assetTag ? ` · #${a.assetTag}` : ""}</p>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button type="button" onClick={() => setModal(a)} className={`w-7 h-7 rounded-md flex items-center justify-center ${mutedText} ${rowHover}`}>
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(a)}
                        disabled={busyId === a.id}
                        className={`w-7 h-7 rounded-md flex items-center justify-center text-rose-500 ${rowHover} disabled:opacity-50`}
                      >
                        {busyId === a.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <span className={`text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full ${STATUS_CHIP[a.status] || "bg-slate-100 text-slate-600"}`}>{a.status}</span>
                  {a.assignedToName && <span className={`text-[9.5px] ${subtleText}`}>· {a.assignedToName}</span>}
                  {a.location && <span className={`text-[9.5px] ${subtleText}`}>· {a.location}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {modal && (
        <AssetFormModal
          darkMode={darkMode}
          initial={modal.id ? modal : null}
          employees={employees}
          onClose={() => setModal(null)}
          onSubmit={handleSave}
        />
      )}
    </div>
  );
}
