import { useEffect, useMemo, useState } from "react";
import { useAuth, getRoleCategory } from "../AuthContext.jsx";
import { fetchPayTypes, fetchCommissions, saveCommission } from "../api/employeesApi.js";

/* ======================================================================
   PER-PROJECT PAY — commission boxes for the assign popups.

   Employees can be paid either a fixed monthly salary or "per project"
   (set on the Users page). When a project or task is assigned to a
   per-project employee, the Create/Edit Project and Create/Edit Task
   popups show a small commission box for that person here, so the money
   they earn for it can be added right at assignment time. Everything
   saved here is summed up on the Employees page and the Users page.

   Only admins / managers (the people who assign work) ever see these
   boxes — and the server enforces that too.
====================================================================== */

/* Ids of the employees who are paid per project. Loaded once per popup;
   a failed/forbidden request just means "nobody", so the popups behave
   exactly as before. */
export function usePerProjectIds() {
  const { user } = useAuth();
  const [ids, setIds] = useState(() => new Set());
  const category = getRoleCategory(user?.role);
  const allowed = category === "admin" || category === "manager";

  useEffect(() => {
    if (!allowed) return undefined;
    let alive = true;
    fetchPayTypes()
      .then((res) => {
        if (alive) setIds(new Set((res?.perProjectIds || []).map(Number)));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [allowed]);

  return ids;
}

const norm = (s) => (s || "").trim().toLowerCase();

/* Resolve a list of display names to the real approved users who are paid
   per project (de-duplicated, order kept). */
export function resolvePerProjectPeople(names, approvedUsers, perProjectIds) {
  const seen = new Set();
  const out = [];
  (names || []).forEach((n) => {
    if (!n || n === "Unassigned") return;
    const u = (approvedUsers || []).find((x) => norm(x.name) === norm(n));
    if (u && perProjectIds.has(Number(u.id)) && !seen.has(u.id)) {
      seen.add(u.id);
      out.push(u);
    }
  });
  return out;
}

/* Loads what is already saved for an existing task/project (Edit popups)
   and hands it back as { [employeeId]: "amount" }. Returns the same map
   so the caller can later work out what actually changed. */
export function useCommissionPrefill({ taskId, projectId }, onLoaded) {
  const { user } = useAuth();
  const [initial, setInitial] = useState({});
  const category = getRoleCategory(user?.role);
  const allowed = category === "admin" || category === "manager";

  useEffect(() => {
    if (!allowed || (taskId == null && projectId == null)) return undefined;
    let alive = true;
    fetchCommissions(taskId != null ? { task: taskId } : { project: projectId })
      .then((rows) => {
        if (!alive) return;
        const map = {};
        (rows || []).forEach((r) => {
          map[r.employeeId] = String(r.amount);
        });
        setInitial(map);
        if (typeof onLoaded === "function") onLoaded(map);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, taskId, projectId]);

  return initial;
}

/* Saves the commission boxes once a real task/project id exists.
   - `initial`: what was already saved before (empty for a brand-new item)
   - `commissions`: the form's { [employeeId]: "amount" }
   - `names`: who is assigned right now. Anyone who was on it before but
     is no longer assigned has their commission removed; anyone left with
     an empty box has theirs removed too.
   Returns { failed } — how many saves the server refused. */
export async function syncCommissions({ initial = {}, commissions = {}, names, approvedUsers, perProjectIds, taskId, projectId }) {
  const shown = new Set(resolvePerProjectPeople(names, approvedUsers, perProjectIds).map((u) => String(u.id)));
  const ids = new Set([...Object.keys(initial || {}), ...Object.keys(commissions || {})].map(String));
  let failed = 0;

  for (const id of ids) {
    const before = String(initial?.[id] ?? "").trim();
    const wanted = shown.has(id) ? String(commissions?.[id] ?? "").trim() : "";
    if (wanted === before) continue;
    const amount = wanted === "" ? 0 : Number(wanted);
    if (!Number.isFinite(amount) || amount < 0) continue;
    try {
      await saveCommission({
        employee: Number(id),
        task: taskId != null ? taskId : undefined,
        project: projectId != null ? projectId : undefined,
        amount,
      });
    } catch {
      failed += 1;
    }
  }
  return { failed };
}

/* The commission boxes themselves. Renders nothing unless at least one
   of the people in `names` is a per-project employee. */
export default function CommissionFields({ names, values, onChange, darkMode, hint }) {
  const { approvedUsers } = useAuth();
  const perProjectIds = usePerProjectIds();
  const people = useMemo(
    () => resolvePerProjectPeople(names, approvedUsers, perProjectIds),
    [names, approvedUsers, perProjectIds]
  );

  if (people.length === 0) return null;

  const inputCls = darkMode ? "bg-slate-800 border-slate-700 text-slate-200" : "border-slate-200 bg-white";
  const box = darkMode ? "bg-slate-800/60 border-slate-700" : "bg-emerald-50/60 border-emerald-100";

  return (
    <div className={`rounded-xl border p-3 ${box}`}>
      <label className="text-xs font-semibold text-slate-500 mb-1 block">Per-project commission (PKR)</label>
      <p className="text-[10.5px] text-slate-400 mb-2">
        {hint || "These people are paid per project, not a monthly salary. Enter what each one earns for this."}
      </p>
      <div className="space-y-2">
        {people.map((u) => (
          <div key={u.id} className="flex items-center gap-2">
            <span className={`flex-1 min-w-0 truncate text-sm ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{u.name}</span>
            <input
              type="number"
              min="0"
              inputMode="decimal"
              value={values?.[u.id] ?? ""}
              onChange={(e) => onChange({ ...(values || {}), [u.id]: e.target.value })}
              placeholder="e.g. 15000"
              className={`w-36 text-sm border rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-emerald-400 ${inputCls}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
