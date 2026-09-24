import React, { useEffect, useMemo, useState } from "react";
import { Activity, Download, Search, X, ChevronLeft } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import * as reportsApi from "./reportsApi.js";

/* ------------------------------------------------------------------ */
/*  Activity — everything each user did on the website.                */
/*  Admins (or anyone with Full Reports Access) see every user; all    */
/*  other people see only their own trail. The backend enforces that   */
/*  — this component just shows what it's given.                       */
/* ------------------------------------------------------------------ */

const ACTION_CHIP = {
  create: "bg-emerald-50 text-emerald-600",
  register: "bg-emerald-50 text-emerald-600",
  upload: "bg-emerald-50 text-emerald-600",
  update: "bg-sky-50 text-sky-600",
  approve: "bg-violet-50 text-violet-600",
  reject: "bg-amber-50 text-amber-600",
  delete: "bg-rose-50 text-rose-600",
  login_failed: "bg-rose-50 text-rose-600",
  login: "bg-slate-100 text-slate-600",
  logout: "bg-slate-100 text-slate-600",
  view: "bg-slate-100 text-slate-500",
};

function avatarFor(name) {
  return `https://ui-avatars.com/api/?background=random&bold=true&name=${encodeURIComponent((name || "?").trim() || "?")}`;
}

function fmtWhen(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function fmtAgo(iso) {
  if (!iso) return "No activity yet";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

function ChangeChips({ changes }) {
  const entries = Object.entries(changes || {}).slice(0, 3);
  if (!entries.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {entries.map(([field, v]) => (
        <span key={field} className="text-[9.5px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 max-w-full truncate">
          {field.replace(/_/g, " ")}: {String(v.from ?? "—")} → {String(v.to ?? "—")}
        </span>
      ))}
    </div>
  );
}

function EventRow({ ev, showUser, border, cardText, subtleText }) {
  return (
    <div className={`flex items-start gap-2.5 py-2.5 border-b last:border-b-0 ${border}`}>
      {showUser && (
        <img src={ev.userAvatar || avatarFor(ev.userName)} alt="" className="w-7 h-7 rounded-full object-cover shrink-0 mt-0.5" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          {showUser && <span className={`text-[11.5px] font-semibold ${cardText}`}>{ev.userName}</span>}
          <span className={`text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full ${ACTION_CHIP[ev.action] || "bg-slate-100 text-slate-600"}`}>
            {ev.actionLabel}
          </span>
          <span className={`text-[9.5px] ${subtleText}`}>{ev.module}</span>
          {ev.project && <span className={`text-[9.5px] ${subtleText}`}>· {ev.project}</span>}
        </div>
        <p className={`text-[11.5px] mt-0.5 break-words ${cardText}`}>{ev.description}</p>
        <ChangeChips changes={ev.changes} />
      </div>
      <span className={`text-[10px] shrink-0 whitespace-nowrap ${subtleText}`}>{fmtWhen(ev.createdAt)}</span>
    </div>
  );
}

export default function ActivitySection({ darkMode = false, isAdmin = false, rangeParams = {}, rangeLabel = "" }) {
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
  const chartGrid = darkMode ? "#1e293b" : "#f1f5f9";

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState(isAdmin ? "users" : "timeline");
  const [filters, setFilters] = useState({ user: "All", module: "All", action: "All" });
  const [search, setSearch] = useState("");
  const [q, setQ] = useState(""); // debounced copy of `search`
  const [options, setOptions] = useState({ users: [], modules: [], actions: [] });

  const [feed, setFeed] = useState({ results: [], count: 0, page: 1, loading: false, error: "" });
  const [userRows, setUserRows] = useState({ results: [], loading: false, error: "" });
  const [detail, setDetail] = useState(null); // {loading, data, error}
  const [me, setMe] = useState(null);
  const [exporting, setExporting] = useState(false);

  // Stable key so effects re-run only when the range actually changes.
  const rangeKey = JSON.stringify(rangeParams);

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  // Filter dropdown options — once, when the section is first opened.
  useEffect(() => {
    if (!open) return;
    reportsApi.getActivityFilters().then(setOptions).catch(() => {});
  }, [open]);

  // Timeline: first page whenever a filter / the range changes.
  useEffect(() => {
    if (!open || tab !== "timeline") return;
    let cancelled = false;
    setFeed((f) => ({ ...f, loading: true, error: "" }));
    reportsApi
      .listActivity({ ...rangeParams, ...filters, q, page: 1, pageSize: 25 })
      .then((d) => !cancelled && setFeed({ results: d.results, count: d.count, page: 1, loading: false, error: "", hasMore: !!d.next }))
      .catch((e) => !cancelled && setFeed({ results: [], count: 0, page: 1, loading: false, error: e.message }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, rangeKey, filters, q]);

  function loadMore() {
    const next = feed.page + 1;
    setFeed((f) => ({ ...f, loading: true }));
    reportsApi
      .listActivity({ ...rangeParams, ...filters, q, page: next, pageSize: 25 })
      .then((d) => setFeed((f) => ({ ...f, results: [...f.results, ...d.results], page: next, loading: false, hasMore: !!d.next })))
      .catch((e) => setFeed((f) => ({ ...f, loading: false, error: e.message })));
  }

  // Per-user report cards (admin).
  useEffect(() => {
    if (!open || !isAdmin || tab !== "users") return;
    let cancelled = false;
    setUserRows((r) => ({ ...r, loading: true, error: "" }));
    reportsApi
      .getUserReports({ ...rangeParams, q })
      .then((d) => !cancelled && setUserRows({ results: d.results, loading: false, error: "" }))
      .catch((e) => !cancelled && setUserRows({ results: [], loading: false, error: e.message }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isAdmin, tab, rangeKey, q]);

  // Non-admins: a small "my activity" strip.
  useEffect(() => {
    if (!open || isAdmin) return;
    reportsApi.getUserReport("me", rangeParams).then(setMe).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isAdmin, rangeKey]);

  function openDetail(userId) {
    setDetail({ loading: true });
    reportsApi
      .getUserReport(userId, rangeParams)
      .then((data) => setDetail({ data }))
      .catch((e) => setDetail({ error: e.message }));
  }

  function viewFullLog(userId) {
    setFilters((f) => ({ ...f, user: String(userId) }));
    setDetail(null);
    setTab("timeline");
  }

  async function exportCsv() {
    setExporting(true);
    try {
      await reportsApi.downloadActivityCsv({ ...rangeParams, ...filters, q });
    } catch (e) {
      setFeed((f) => ({ ...f, error: e.message }));
    }
    setExporting(false);
  }

  const topModules = (byModule) =>
    Object.entries(byModule || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

  const maxModule = useMemo(() => {
    const m = detail?.data?.byModule || {};
    return Math.max(1, ...Object.values(m));
  }, [detail]);

  const selectCls = `rounded-lg border px-2.5 py-1.5 text-[11.5px] focus:outline-none focus:ring-2 focus:ring-violet-300 ${inputCls}`;

  return (
    <div id="activity-anchor" className={`rounded-xl p-4 shadow-sm ${card}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-start justify-between gap-2.5 text-left">
        <div className="flex items-start gap-2.5">
          <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-violet-50 text-violet-600">
            <Activity size={16} />
          </span>
          <div>
            <h3 className={`font-semibold text-sm ${cardText}`}>Activity Log</h3>
            <p className={`text-[10.5px] mt-0.5 ${subtleText}`}>
              {isAdmin
                ? "Everything every user did on the website — who, what, and when."
                : "Everything you did on the website, most recent first."}
              {rangeLabel ? ` (${rangeLabel})` : ""}
            </p>
          </div>
        </div>
        <span className={`text-[10.5px] font-semibold shrink-0 ${mutedText}`}>{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="mt-3">
          {isAdmin && (
            <div className="flex gap-1.5 mb-3">
              {[["users", "By user"], ["timeline", "Timeline"]].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={`text-[11px] font-semibold px-3 py-1.5 rounded-full transition ${
                    tab === key ? "bg-violet-600 text-white" : darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {!isAdmin && me && (
            <div className="grid grid-cols-3 gap-2 mb-3">
              {[["Actions", me.totalActions], ["Active days", me.activeDays], ["Daily reports", me.dailyReports]].map(([label, value]) => (
                <div key={label} className={`rounded-lg border p-2.5 ${border}`}>
                  <p className={`text-[10px] ${mutedText}`}>{label}</p>
                  <p className={`text-base font-bold ${headingText}`}>{value}</p>
                </div>
              ))}
            </div>
          )}

          {/* ---------------- By user (admin) ---------------- */}
          {isAdmin && tab === "users" && !detail && (
            <>
              <div className="relative mb-3 max-w-xs">
                <Search size={13} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${subtleText}`} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people…" className={`w-full pl-8 ${selectCls}`} />
              </div>
              {userRows.error && <p className="text-[11px] text-rose-500 mb-2">{userRows.error}</p>}
              {userRows.loading && !userRows.results.length ? (
                <p className={`text-[11px] py-6 text-center ${subtleText}`}>Loading…</p>
              ) : userRows.results.length === 0 ? (
                <p className={`text-[11px] py-6 text-center ${subtleText}`}>No users found.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11.5px] min-w-[640px]">
                    <thead>
                      <tr className={`text-left text-[10px] uppercase tracking-wide ${subtleText}`}>
                        <th className="py-2 pr-2 font-semibold">User</th>
                        <th className="py-2 pr-2 font-semibold text-right">Actions</th>
                        <th className="py-2 pr-2 font-semibold text-right">Active days</th>
                        <th className="py-2 pr-2 font-semibold">Mostly in</th>
                        <th className="py-2 pr-2 font-semibold text-right">Daily reports</th>
                        <th className="py-2 font-semibold">Last activity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userRows.results.map((u) => (
                        <tr key={u.userId} onClick={() => openDetail(u.userId)} className={`cursor-pointer border-t ${border} ${rowHover}`}>
                          <td className="py-2 pr-2">
                            <div className="flex items-center gap-2">
                              <img src={u.avatar || avatarFor(u.name)} alt="" className="w-7 h-7 rounded-full object-cover" />
                              <div className="min-w-0">
                                <p className={`font-semibold truncate ${cardText}`}>{u.name}</p>
                                <p className={`text-[10px] capitalize ${subtleText}`}>{u.role}{u.department ? ` · ${u.department}` : ""}</p>
                              </div>
                            </div>
                          </td>
                          <td className={`py-2 pr-2 text-right font-semibold ${u.totalActions ? cardText : subtleText}`}>{u.totalActions}</td>
                          <td className={`py-2 pr-2 text-right ${mutedText}`}>{u.activeDays}</td>
                          <td className="py-2 pr-2">
                            <div className="flex gap-1 flex-wrap">
                              {topModules(u.byModule).map(([m, n]) => (
                                <span key={m} className="text-[9.5px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{m} {n}</span>
                              ))}
                              {!u.totalActions && <span className={`text-[10px] ${subtleText}`}>—</span>}
                            </div>
                          </td>
                          <td className={`py-2 pr-2 text-right ${mutedText}`}>{u.dailyReports}</td>
                          <td className={`py-2 ${mutedText}`}>{fmtAgo(u.lastActivityAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* ---------------- One user's report ---------------- */}
          {isAdmin && tab === "users" && detail && (
            <div>
              <button type="button" onClick={() => setDetail(null)} className={`flex items-center gap-1 text-[11px] font-semibold mb-3 ${mutedText}`}>
                <ChevronLeft size={13} /> All users
              </button>
              {detail.loading && <p className={`text-[11px] py-6 text-center ${subtleText}`}>Loading…</p>}
              {detail.error && <p className="text-[11px] text-rose-500">{detail.error}</p>}
              {detail.data && (
                <>
                  <div className="flex items-center gap-3 flex-wrap">
                    <img src={detail.data.avatar || avatarFor(detail.data.name)} alt="" className="w-11 h-11 rounded-full object-cover" />
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold ${headingText}`}>{detail.data.name}</p>
                      <p className={`text-[11px] capitalize ${mutedText}`}>
                        {detail.data.role}{detail.data.department ? ` · ${detail.data.department}` : ""} · {detail.data.presence}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => viewFullLog(detail.data.userId)}
                      className="ml-auto text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-violet-600 text-white"
                    >
                      View full log
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                    {[
                      ["Actions", detail.data.totalActions],
                      ["Active days", detail.data.activeDays],
                      ["Tasks done", `${detail.data.workload.tasksCompleted}/${detail.data.workload.tasksAssigned}`],
                      ["Daily reports", `${detail.data.dailyReportsApproved}/${detail.data.dailyReports} approved`],
                    ].map(([label, value]) => (
                      <div key={label} className={`rounded-lg border p-2.5 ${border}`}>
                        <p className={`text-[10px] ${mutedText}`}>{label}</p>
                        <p className={`text-sm font-bold mt-0.5 ${headingText}`}>{value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                    <div>
                      <p className={`text-[11px] font-semibold mb-1 ${cardText}`}>Activity per day</p>
                      <div className="h-[150px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={detail.data.timeline} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                            <CartesianGrid stroke={chartGrid} vertical={false} />
                            <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                            <YAxis allowDecimals={false} tick={{ fontSize: 9 }} />
                            <Tooltip />
                            <Bar dataKey="count" fill="#7c3aed" radius={[3, 3, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    <div>
                      <p className={`text-[11px] font-semibold mb-1.5 ${cardText}`}>Where they worked</p>
                      {Object.keys(detail.data.byModule).length === 0 ? (
                        <p className={`text-[11px] ${subtleText}`}>No activity in this period.</p>
                      ) : (
                        Object.entries(detail.data.byModule)
                          .sort((a, b) => b[1] - a[1])
                          .map(([m, n]) => (
                            <div key={m} className="flex items-center gap-2 mb-1.5">
                              <span className={`text-[10.5px] w-20 shrink-0 ${mutedText}`}>{m}</span>
                              <div className={`flex-1 h-2 rounded-full ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}>
                                <div className="h-2 rounded-full bg-violet-500" style={{ width: `${(n / maxModule) * 100}%` }} />
                              </div>
                              <span className={`text-[10.5px] w-6 text-right ${cardText}`}>{n}</span>
                            </div>
                          ))
                      )}
                      {detail.data.byProject.length > 0 && (
                        <p className={`text-[10.5px] mt-2 ${mutedText}`}>
                          Top projects: {detail.data.byProject.slice(0, 4).map((p) => `${p.project} (${p.count})`).join(", ")}
                        </p>
                      )}
                    </div>
                  </div>

                  <p className={`text-[11px] font-semibold mt-4 mb-1 ${cardText}`}>Latest activity</p>
                  {detail.data.recentActivity.length === 0 ? (
                    <p className={`text-[11px] ${subtleText}`}>Nothing recorded in this period.</p>
                  ) : (
                    detail.data.recentActivity.slice(0, 15).map((ev) => (
                      <EventRow key={ev.id} ev={ev} showUser={false} border={border} cardText={cardText} subtleText={subtleText} />
                    ))
                  )}
                </>
              )}
            </div>
          )}

          {/* ---------------- Timeline ---------------- */}
          {tab === "timeline" && (
            <>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                {isAdmin && (
                  <select value={filters.user} onChange={(e) => setFilters((f) => ({ ...f, user: e.target.value }))} className={selectCls}>
                    <option value="All">All users</option>
                    {options.users.map((u) => (
                      <option key={u.id} value={String(u.id)}>{u.name}</option>
                    ))}
                  </select>
                )}
                <select value={filters.module} onChange={(e) => setFilters((f) => ({ ...f, module: e.target.value }))} className={selectCls}>
                  <option value="All">All modules</option>
                  {options.modules.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <select value={filters.action} onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))} className={selectCls}>
                  <option value="All">All actions</option>
                  {options.actions.map((a) => (
                    <option key={a.key} value={a.key}>{a.label}</option>
                  ))}
                </select>
                <div className="relative">
                  <Search size={13} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${subtleText}`} />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search activity…" className={`pl-8 w-44 ${selectCls}`} />
                </div>
                {(filters.user !== "All" || filters.module !== "All" || filters.action !== "All" || search) && (
                  <button
                    type="button"
                    onClick={() => {
                      setFilters({ user: "All", module: "All", action: "All" });
                      setSearch("");
                    }}
                    className={`flex items-center gap-1 text-[10.5px] font-semibold px-2 py-1 rounded-full ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"}`}
                  >
                    <X size={11} /> Clear
                  </button>
                )}
                <button
                  type="button"
                  onClick={exportCsv}
                  disabled={exporting}
                  className={`ml-auto flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg border ${border} ${cardText} disabled:opacity-60`}
                >
                  <Download size={12} /> {exporting ? "Exporting…" : "Export CSV"}
                </button>
              </div>

              {feed.error && <p className="text-[11px] text-rose-500 mb-2">{feed.error}</p>}
              {feed.loading && !feed.results.length ? (
                <p className={`text-[11px] py-6 text-center ${subtleText}`}>Loading…</p>
              ) : feed.results.length === 0 && !feed.error ? (
                <p className={`text-[11px] py-6 text-center ${subtleText}`}>No activity recorded for these filters.</p>
              ) : (
                <>
                  <p className={`text-[10.5px] mb-1 ${subtleText}`}>{feed.count} event{feed.count === 1 ? "" : "s"}</p>
                  {feed.results.map((ev) => (
                    <EventRow key={ev.id} ev={ev} showUser={isAdmin} border={border} cardText={cardText} subtleText={subtleText} />
                  ))}
                  {feed.hasMore && (
                    <button
                      type="button"
                      onClick={loadMore}
                      disabled={feed.loading}
                      className={`mt-3 w-full text-[11px] font-semibold py-2 rounded-lg border ${border} ${cardText} disabled:opacity-60`}
                    >
                      {feed.loading ? "Loading…" : "Load more"}
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
