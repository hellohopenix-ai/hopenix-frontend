import { useEffect, useMemo, useRef, useState } from "react";
import {
  Briefcase,
  Users,
  Wallet,
  Search,
  Plus,
  Filter,
  MoreVertical,
  Check,
  X,
  ShieldCheck,
  Palette,
  Code2,
  Bug,
  Lock,
  Info,
  Trash2,
} from "lucide-react";
import { useAuth, ALL_PAGES, getRoleCategory } from "../AuthContext.jsx";

/* ======================================================================
   STATIC CONFIG
   In a real backend, `status` is the field that gates authentication:
   a login handler should reject the request (403) unless
   `user.status === "active"`. Everything below is the admin-facing UI
   that manages that field.
====================================================================== */

/* These two lists only seed the suggestion dropdown next to the Role /
   Department fields — they are NOT the only allowed values. An admin
   can always type a custom role or department that isn't in this list
   (e.g. "Graphic Designer", "Video Editor") and it gets saved exactly
   as typed; see RoleDeptInput below. */
const DEPARTMENTS = [
  "Design",
  "Development",
  "Business",
  "QA & Testing",
  "HR",
  "Marketing",
  "Sales",
  "Finance",
  "Operations",
  "IT & Support",
  "Content",
];

const ROLE_OPTIONS = [
  "UI/UX Designer",
  "Graphic Designer",
  "Video Editor",
  "Developer",
  "Frontend Developer",
  "Backend Developer",
  "Full Stack Developer",
  "Mobile App Developer",
  "DevOps Engineer",
  "Business Analyst",
  "QA Engineer",
  "Manager",
  "Project Manager",
  "Accountant",
  "HR Executive",
  "Sales Executive",
  "Digital Marketing Executive",
  "SEO Specialist",
  "Content Writer",
  "Social Media Manager",
  "Support Agent",
  "Data Entry Operator",
];

const DEPT_STYLES = {
  Design: { icon: Palette, bg: "bg-rose-50", text: "text-rose-500" },
  Development: { icon: Code2, bg: "bg-blue-50", text: "text-blue-500" },
  Business: { icon: Briefcase, bg: "bg-amber-50", text: "text-amber-500" },
  "QA & Testing": { icon: Bug, bg: "bg-emerald-50", text: "text-emerald-500" },
  HR: { icon: Users, bg: "bg-violet-50", text: "text-violet-500" },
};

const ROLE_COLORS = {
  "UI/UX Designer": "bg-blue-50 text-blue-600",
  Developer: "bg-violet-50 text-violet-600",
  "Backend Developer": "bg-blue-50 text-blue-600",
  "Business Analyst": "bg-amber-50 text-amber-600",
  "QA Engineer": "bg-emerald-50 text-emerald-600",
  Manager: "bg-indigo-50 text-indigo-600",
  Accountant: "bg-cyan-50 text-cyan-600",
  "HR Executive": "bg-pink-50 text-pink-600",
  "Sales Executive": "bg-amber-50 text-amber-600",
  "Support Agent": "bg-slate-100 text-slate-600",
  "Graphic Designer": "bg-rose-50 text-rose-600",
  "Video Editor": "bg-fuchsia-50 text-fuchsia-600",
  "Frontend Developer": "bg-blue-50 text-blue-600",
  "Full Stack Developer": "bg-violet-50 text-violet-600",
  "Mobile App Developer": "bg-teal-50 text-teal-600",
  "DevOps Engineer": "bg-slate-100 text-slate-600",
  "Project Manager": "bg-indigo-50 text-indigo-600",
  "Digital Marketing Executive": "bg-orange-50 text-orange-600",
  "SEO Specialist": "bg-lime-50 text-lime-600",
  "Content Writer": "bg-sky-50 text-sky-600",
  "Social Media Manager": "bg-purple-50 text-purple-600",
  "Data Entry Operator": "bg-slate-100 text-slate-600",
};

const AVATAR_PALETTE = [
  "bg-rose-500",
  "bg-blue-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-cyan-500",
  "bg-pink-500",
  "bg-indigo-500",
];

const INITIAL_ROLES = [
  { name: "Super Admin", tag: "System", access: "Full Access", locked: true },
  { name: "Admin", tag: null, access: "Full Access", locked: false },
  { name: "Manager", tag: null, access: "Custom Access", locked: false },
  { name: "Employee", tag: null, access: "Limited Access", locked: false },
  { name: "Client", tag: null, access: "Limited Access", locked: false },
  { name: "Accountant", tag: null, access: "Custom Access", locked: false },
];

/* Role Management (the free-text roles list in the left card) now lives
   on the backend — see AuthContext's roleCatalog. Module Access Control
   (view/create/edit/delete) also went through the same localStorage ->
   real-backend migration earlier, backed by AuthContext's
   `modulePermissions` (per role, actually enforced app-wide). Nothing in
   this file reads or writes localStorage for role data anymore. */

/* ======================================================================
   HELPERS
====================================================================== */

/* AuthContext stores status as "pending" | "approved" | "rejected" |
   "deactivated". The table UI below groups "rejected" together with
   "deactivated" (both mean "can't log in, not currently pending"). */
function toUiStatus(authStatus) {
  if (authStatus === "approved") return "active";
  if (authStatus === "pending") return "pending";
  return "deactivated"; // "rejected" or "deactivated"
}

function formatJoinedOn(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "—";
  }
}

function initials(name) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

function fmtMoney(n) {
  return `PKR ${Number(n || 0).toLocaleString()}`;
}

function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function Avatar({ name, avatar, size = "w-9 h-9" }) {
  // Show the person's actual saved photo when there is one. Accepts any
  // non-empty string: a local data:/blob: URL (unsaved preview) as well
  // as the real http(s) URL the Django backend now returns from
  // UserSerializer.get_avatar (e.g. /media/users/<id>/avatar/xyz.png) —
  // this used to only accept data:/blob:, so a photo uploaded for real
  // during registration/CompleteProfilePage never showed here even
  // though it was saved correctly on the backend. Falls back to the
  // colored-initials circle when there's no photo at all (avatar is
  // null/empty, which is exactly what the backend sends for that case).
  //
  // The cache-busting "?v=" used to be built with Date.now() directly in
  // the render body, so it produced a *new* value on every single
  // re-render (not just when the photo actually changed) — every parent
  // re-render (table sort/filter/hover, any unrelated state change) threw
  // away the already-decoded image and made the browser refetch +
  // re-decode it from scratch. That's what read as the photo going soft/
  // blurry or flickering, especially in tables with several avatars.
  // useMemo ties it to `avatar` itself, so it's stable across re-renders
  // and only produces a new value when the photo actually changes.
  const src = useMemo(() => {
    if (typeof avatar !== "string" || avatar.length === 0) return null;
    return avatar.includes("?v=") ? avatar : `${avatar}?v=${Date.now()}`;
  }, [avatar]);

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        loading="eager"
        decoding="async"
        className={`${size} rounded-full object-cover shrink-0`}
        style={{ imageRendering: "auto" }}
      />
    );
  }
  return (
    <div className={`${size} ${avatarColor(name)} rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0`}>
      {initials(name)}
    </div>
  );
}

function StatusBadge({ status }) {
  const styles = {
    active: "bg-emerald-50 text-emerald-600",
    pending: "bg-amber-50 text-amber-600",
    deactivated: "bg-rose-50 text-rose-600",
  };
  const labels = { active: "Active", pending: "Pending", deactivated: "Deactivated" };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function RoleBadge({ role }) {
  if (!role) return <span className="text-slate-400 text-sm">—</span>;
  const cls = ROLE_COLORS[role] || "bg-slate-100 text-slate-600";
  return <span className={`inline-flex px-2.5 py-1 rounded-lg text-xs font-semibold ${cls}`}>{role}</span>;
}

/* Shows where a user's page access currently comes from: their role's
   default, or one of the three individual overrides. `effective` is the
   { source, pages } shape returned by getEffectivePages() below. */
function AccessBadge({ effective }) {
  const { source, pages } = effective;
  const styles = {
    default: "bg-slate-100 text-slate-500",
    custom: "bg-violet-50 text-violet-600",
    full: "bg-emerald-50 text-emerald-600",
    none: "bg-rose-50 text-rose-600",
  };
  const labels = {
    default: "Default",
    custom: `Custom · ${pages.length}`,
    full: "Full Access",
    none: "No Access",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${styles[source]}`}>
      {labels[source]}
    </span>
  );
}

function DepartmentChip({ department }) {
  if (!department) return <span className="text-slate-400 text-sm">—</span>;
  const style = DEPT_STYLES[department] || { icon: Briefcase, bg: "bg-slate-100", text: "text-slate-500" };
  const Icon = style.icon;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-slate-700">
      <span className={`w-6 h-6 rounded-md flex items-center justify-center ${style.bg} ${style.text}`}>
        <Icon className="w-3.5 h-3.5" />
      </span>
      {department}
    </span>
  );
}

/* ======================================================================
   STAT CARD
====================================================================== */

function StatCard({ icon: Icon, iconBg, iconText, label, value, delta, up, action, card, cardText, mutedText, onClick }) {
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
      /* min-w-0 is required here: inside a CSS grid track, a child's
         default min-width is "auto" (its content size), which is what
         was pushing the whole grid — and the whole page — wider than
         the viewport on mobile and forcing a sideways scroll. */
      className={`rounded-2xl p-4 min-w-0 ${card} ${
        onClick ? "cursor-pointer transition hover:-translate-y-0.5 hover:shadow-md active:translate-y-0" : ""
      }`}
    >
      <div className="flex items-start gap-3 min-w-0">
        <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconBg} ${iconText}`}>
          <Icon className="w-5 h-5" />
        </span>
        <div className="min-w-0">
          <p className={`text-xs truncate ${mutedText}`}>{label}</p>
          <p className={`text-2xl font-extrabold ${cardText}`}>{value}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        {delta ? (
          <span className={`text-xs font-semibold ${up ? "text-emerald-600" : "text-rose-600"}`}>
            {up ? "↑" : "↓"} {delta} <span className={`font-normal ${mutedText}`}>vs last month</span>
          </span>
        ) : (
          <span />
        )}
        {/* stopPropagation so the inner action button's own click doesn't
            also bubble up and double-fire the card's onClick */}
        {action && <span onClick={(e) => e.stopPropagation()}>{action}</span>}
      </div>
    </div>
  );
}

/* ======================================================================
   ROLE / DEPARTMENT COMBO INPUT
   A plain text input backed by a <datalist> of suggestions. Behaves like
   a dropdown (click in, a suggestion list of ROLE_OPTIONS/DEPARTMENTS —
   or whatever `options` are passed in — pops up) but never blocks free
   typing, so an admin can pick "Graphic Designer" from the list OR type
   any role/department that isn't in it (e.g. a brand-new title) and it
   is saved exactly as typed. `listId` must be unique per rendered
   input on the page (datalist ids can't collide in the same DOM).
====================================================================== */

function RoleDeptInput({ value, onChange, options, placeholder, listId, className, onBlur }) {
  return (
    <>
      <input
        type="text"
        list={listId}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  );
}

/* ======================================================================
   PENDING ROW FIELDS
====================================================================== */

function PendingFields({ selection, onChange, error, inputCls, rowId }) {
  return (
    <div className="flex flex-col sm:flex-row gap-2 w-full">
      <RoleDeptInput
        listId={`role-options-${rowId}`}
        options={ROLE_OPTIONS}
        value={selection.role}
        onChange={(v) => onChange({ ...selection, role: v })}
        placeholder="Role (pick or type)"
        className={`text-sm rounded-lg border px-2.5 py-2 outline-none focus:ring-2 focus:ring-violet-400 flex-1 min-w-0 ${inputCls} ${
          error && !selection.role ? "border-rose-400" : ""
        }`}
      />
      <RoleDeptInput
        listId={`dept-options-${rowId}`}
        options={DEPARTMENTS}
        value={selection.department}
        onChange={(v) => onChange({ ...selection, department: v })}
        placeholder="Department (pick or type)"
        className={`text-sm rounded-lg border px-2.5 py-2 outline-none focus:ring-2 focus:ring-violet-400 flex-1 min-w-0 ${inputCls} ${
          error && !selection.department ? "border-rose-400" : ""
        }`}
      />
    </div>
  );
}

/* ======================================================================
   USER BIO-DATA DETAIL MODAL
   Shown when an admin clicks a user's name/avatar in the table or on
   mobile. Pulls straight from the raw AuthContext user record — i.e.
   everything that was filled in on CompleteProfilePage.jsx (personal
   info, address, education, experience, skills, CV, ID card images,
   bank details). From here the admin can also assign / update the
   role + department, which is the same action the row-level Approve
   button and the Module/Page Access panels drive — nothing new to
   persist, it all goes through AuthContext exactly like before.
====================================================================== */

function DetailRow({ label, value }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-1.5 text-sm">
      <span className="text-slate-500 col-span-1">{label}</span>
      <span className="col-span-2 font-medium break-words">{value || "—"}</span>
    </div>
  );
}

function DetailSection({ title, children }) {
  return (
    <div className="mb-5">
      <h4 className="text-xs font-bold uppercase tracking-wider text-violet-500 mb-2">{title}</h4>
      {children}
    </div>
  );
}

function UserDetailModal({ rawUser, onApprove, onUpdateRole, onUpdateSalary, onClose, darkMode }) {
  const modalCard = darkMode ? "bg-slate-900 text-slate-100" : "bg-white";
  const inputCls = darkMode ? "bg-slate-800 border-slate-700 text-slate-200" : "border-slate-200";
  const isPending = rawUser.status === "pending";
  const [roleDraft, setRoleDraft] = useState(rawUser.role || "");
  const [deptDraft, setDeptDraft] = useState(rawUser.department || "");
  const [salaryDraft, setSalaryDraft] = useState(rawUser.salary != null ? String(rawUser.salary) : "");
  // Full-size preview for ID card images — opened by clicking a thumbnail below.
  const [lightboxImage, setLightboxImage] = useState(null); // { src, alt } | null

  const regPhoto = rawUser.registrationPhoto || rawUser.avatar;

  // User exists but hasn't filled the CompleteProfilePage form yet —
  // nothing to show except a heads-up.
  if (!rawUser.profileCompleted) {
    return (
      <div className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
        <div className={`rounded-2xl w-full max-w-md p-6 shadow-2xl text-center ${modalCard}`} onClick={(e) => e.stopPropagation()}>
          <Avatar name={rawUser.name} avatar={regPhoto} size="w-14 h-14 mx-auto mb-3" />
          <h3 className="text-lg font-bold mb-1">{rawUser.name}</h3>
          <p className="text-sm text-slate-500">
            This user hasn&apos;t completed their profile form yet, so there&apos;s no bio-data to review.
          </p>
          <button onClick={onClose} className="mt-5 w-full bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold py-2.5 rounded-full">
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div
        className={`rounded-2xl w-full max-w-2xl my-8 p-6 shadow-2xl max-h-[85vh] overflow-y-auto ${modalCard}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3 min-w-0">
            {regPhoto ? (
              // Same click-to-preview treatment as the ID card images
              // below (Documents section) — photo shown here is the
              // original registration-time photo.
              <button
                type="button"
                onClick={() => setLightboxImage({ src: regPhoto, alt: `${rawUser.name}'s registration photo` })}
                className="shrink-0 group relative rounded-full"
                title="View full size"
              >
                <Avatar name={rawUser.name} avatar={regPhoto} size="w-11 h-11" />
                <span className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/20 transition" />
              </button>
            ) : (
              <Avatar name={rawUser.name} avatar={regPhoto} size="w-11 h-11" />
            )}
            <div className="min-w-0">
              <h3 className="text-lg font-bold truncate">{rawUser.name}</h3>
              <p className="text-xs text-slate-500 truncate">{rawUser.email}</p>
              {rawUser.cnic && (
                <span className="inline-flex items-center gap-1 mt-1 text-[11px] font-semibold text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full">
                  CNIC: {rawUser.cnic}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className={`w-8 h-8 flex items-center justify-center rounded-lg shrink-0 ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-100"}`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <DetailSection title="Personal Information">
          <DetailRow label="Father / Guardian" value={rawUser.fatherName} />
          <DetailRow label="Date of Birth" value={rawUser.dob} />
          <DetailRow label="Gender" value={rawUser.gender} />
          <DetailRow label="Marital Status" value={rawUser.maritalStatus} />
          <DetailRow label="Phone" value={rawUser.phone} />
          <DetailRow label="CNIC" value={rawUser.cnic} />
        </DetailSection>

        <DetailSection title="Address & Contact">
          <DetailRow label="Current Address" value={rawUser.currentAddress} />
          <DetailRow label="Permanent Address" value={rawUser.permanentAddress} />
          <DetailRow label="City" value={rawUser.city} />
          <DetailRow label="Country" value={rawUser.country} />
          <DetailRow label="Emergency Contact" value={rawUser.emergencyContact} />
        </DetailSection>

        {rawUser.education?.length > 0 && (
          <DetailSection title="Education">
            {rawUser.education.map((e, i) => (
              <div
                key={e.id || i}
                className={`text-sm mb-2 pb-2 ${i < rawUser.education.length - 1 ? "border-b" : ""} ${darkMode ? "border-slate-800" : "border-slate-100"}`}
              >
                <p className="font-semibold">
                  {e.degree || "—"} {e.year && <span className="font-normal text-slate-500">({e.year})</span>}
                </p>
                <p className="text-slate-500 text-xs">{[e.institute, e.grade].filter(Boolean).join(" · ")}</p>
              </div>
            ))}
          </DetailSection>
        )}

        {(rawUser.totalExperience || rawUser.experience?.length > 0) && (
          <DetailSection title="Work Experience">
            {rawUser.totalExperience && (
              <DetailRow label="Total Experience" value={rawUser.totalExperience} />
            )}
            {rawUser.experience?.map((exp, i) => (
              <div
                key={exp.id || i}
                className={`text-sm mb-2 pb-2 ${i < rawUser.experience.length - 1 ? "border-b" : ""} ${darkMode ? "border-slate-800" : "border-slate-100"}`}
              >
                <p className="font-semibold">
                  {exp.role || "—"} {exp.company && <span className="font-normal text-slate-500">@ {exp.company}</span>}
                </p>
                <p className="text-slate-500 text-xs">{exp.duration}</p>
                {exp.description && <p className="text-slate-500 text-xs mt-1">{exp.description}</p>}
              </div>
            ))}
          </DetailSection>
        )}

        <DetailSection title="Skills & Work Type">
          {rawUser.workTypes?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {rawUser.workTypes.map((w) => (
                <span key={w} className="bg-violet-50 text-violet-600 text-xs font-medium px-2.5 py-1 rounded-full">{w}</span>
              ))}
            </div>
          )}
          {rawUser.programmingLanguages?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {rawUser.programmingLanguages.map((l) => (
                <span key={l} className="bg-blue-50 text-blue-600 text-xs font-medium px-2.5 py-1 rounded-full">{l}</span>
              ))}
            </div>
          )}
          {rawUser.skills?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {rawUser.skills.map((s) => (
                <span key={s} className="bg-slate-100 text-slate-600 text-xs font-medium px-2.5 py-1 rounded-full">{s}</span>
              ))}
            </div>
          )}
          <DetailRow label="Languages" value={rawUser.languages?.join(", ")} />
        </DetailSection>

        <DetailSection title="Documents">
          <div className="grid grid-cols-3 gap-2 py-1.5 text-sm items-center">
            <span className="text-slate-500 col-span-1">CV / Resume</span>
            <span className="col-span-2 flex items-center gap-2 min-w-0">
              <span className="font-medium truncate">{rawUser.cvFileName || "Not uploaded"}</span>
              {rawUser.cvDataUrl && (
                <a
                  href={rawUser.cvDataUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  download={rawUser.cvFileName || "cv"}
                  className="shrink-0 text-xs font-semibold text-violet-600 hover:text-violet-500 border border-violet-200 rounded-full px-2.5 py-1 transition"
                >
                  View CV
                </a>
              )}
            </span>
          </div>
          {(rawUser.idFrontUrl || rawUser.idBackUrl) && (
            <div className="grid grid-cols-2 gap-3 mt-2">
              {rawUser.idFrontUrl && (
                <div>
                  <p className="text-xs text-slate-500 mb-1">ID Card — Front</p>
                  <button
                    type="button"
                    onClick={() => setLightboxImage({ src: rawUser.idFrontUrl, alt: "ID card front" })}
                    className="w-full block group relative"
                  >
                    <img
                      src={rawUser.idFrontUrl}
                      alt="ID card front"
                      className="w-full h-32 object-cover rounded-lg border transition group-hover:opacity-80"
                    />
                    <span className="absolute inset-0 rounded-lg bg-black/0 group-hover:bg-black/10 transition flex items-center justify-center">
                      <span className="opacity-0 group-hover:opacity-100 transition text-[11px] font-semibold text-white bg-black/60 px-2 py-1 rounded-full">
                        View full size
                      </span>
                    </span>
                  </button>
                </div>
              )}
              {rawUser.idBackUrl && (
                <div>
                  <p className="text-xs text-slate-500 mb-1">ID Card — Back</p>
                  <button
                    type="button"
                    onClick={() => setLightboxImage({ src: rawUser.idBackUrl, alt: "ID card back" })}
                    className="w-full block group relative"
                  >
                    <img
                      src={rawUser.idBackUrl}
                      alt="ID card back"
                      className="w-full h-32 object-cover rounded-lg border transition group-hover:opacity-80"
                    />
                    <span className="absolute inset-0 rounded-lg bg-black/0 group-hover:bg-black/10 transition flex items-center justify-center">
                      <span className="opacity-0 group-hover:opacity-100 transition text-[11px] font-semibold text-white bg-black/60 px-2 py-1 rounded-full">
                        View full size
                      </span>
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}
        </DetailSection>

        <DetailSection title="Bank Account Details">
          <DetailRow label="Bank Name" value={rawUser.bankName} />
          <DetailRow label="Account Title" value={rawUser.accountTitle} />
          <DetailRow label="Account Number" value={rawUser.accountNumber} />
          <DetailRow label="IBAN" value={rawUser.iban} />
          <DetailRow label="Branch Code" value={rawUser.branchCode} />
        </DetailSection>

        <DetailSection title="Compensation">
          <label className="text-xs font-semibold text-slate-500 mb-1 block">Monthly Salary (PKR)</label>
          <div className="flex gap-2">
            <input
              type="number"
              min="0"
              inputMode="decimal"
              value={salaryDraft}
              onChange={(e) => setSalaryDraft(e.target.value)}
              placeholder="e.g. 80000"
              className={`flex-1 text-sm border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-violet-400 ${inputCls}`}
            />
            <button
              onClick={() => onUpdateSalary(rawUser.id, salaryDraft)}
              disabled={salaryDraft.trim() === "" || !Number.isFinite(Number(salaryDraft)) || Number(salaryDraft) < 0}
              className="shrink-0 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-semibold px-4 rounded-lg transition"
            >
              Save
            </button>
          </div>
          {rawUser.salary != null && rawUser.salary !== "" && (
            <p className="text-xs text-slate-500 mt-1.5">Current: {fmtMoney(rawUser.salary)}/month</p>
          )}
        </DetailSection>

        <DetailSection title="Role & Access">
          <div className="grid sm:grid-cols-2 gap-2 mb-3">
            <RoleDeptInput
              listId={`role-options-detail-${rawUser.id}`}
              options={ROLE_OPTIONS}
              value={roleDraft}
              onChange={setRoleDraft}
              placeholder="Role (pick or type)"
              className={`text-sm border rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-violet-400 ${inputCls}`}
            />
            <RoleDeptInput
              listId={`dept-options-detail-${rawUser.id}`}
              options={DEPARTMENTS}
              value={deptDraft}
              onChange={setDeptDraft}
              placeholder="Department (pick or type)"
              className={`text-sm border rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-violet-400 ${inputCls}`}
            />
          </div>

          {isPending ? (
            <button
              onClick={() => onApprove(rawUser.id, roleDraft, deptDraft)}
              disabled={!roleDraft || !deptDraft}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-full transition"
            >
              Approve & Assign
            </button>
          ) : (
            <button
              onClick={() => onUpdateRole(rawUser.id, roleDraft, deptDraft)}
              disabled={!roleDraft || !deptDraft}
              className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-full transition"
            >
              Update Role &amp; Department
            </button>
          )}
        </DetailSection>
      </div>

      {lightboxImage && (
        <ImageLightbox
          src={lightboxImage.src}
          alt={lightboxImage.alt}
          onClose={() => setLightboxImage(null)}
        />
      )}
    </div>
  );
}

/* Full-size image preview popup — used for ID card front/back thumbnails.
   Click the thumbnail to open, click the backdrop / X / Escape to close. */
function ImageLightbox({ src, alt, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Both the backdrop and the X button call `e.stopPropagation()` before
  // closing — without it, the click bubbles up through React's tree (this
  // lightbox is rendered as a child of UserDetailModal) and also triggers
  // that modal's own backdrop onClick, closing the whole user details
  // panel along with the image preview.
  return (
    <div
      className="fixed inset-0 z-[110] bg-black/80 flex items-center justify-center p-4"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close preview"
        className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition"
      >
        <X className="w-5 h-5" />
      </button>
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
      />
    </div>
  );
}

/* ======================================================================
   MAIN PAGE (content only — no Sidebar / Topbar, embed inside Dashboard)
====================================================================== */

export default function UserPage({ darkMode = false }) {
  const {
    users: authUsers,
    approveUser: ctxApproveUser,
    rejectUser: ctxRejectUser,
    removeUser: ctxRemoveUser,
    setUserStatus: ctxSetUserStatus,
    inviteUser: ctxInviteUser,
    updateUserRole: ctxUpdateUserRole,
    updateUserProfile,
    rolePermissions,
    updateRolePermissions,
    modulePermissions,
    updateModulePermission,
    getModulePermissions,
    getUserAccessOverride,
    updateUserAccessOverride,
    getSubPageAccess,
    updateSubPageAccess,
    aiAssistantEnabled,
    setAiAssistantEnabled,
    roleCatalog,
    createRoleCatalogEntry,
    deleteRoleCatalogEntry,
  } = useAuth();

  // Real, shared user records from AuthContext, reshaped into the fields
  // this table already knows how to render. Approving/rejecting/removing
  // a user here writes straight back into AuthContext, so it's the same
  // data that gates that user's ability to log in.
  const users = useMemo(
    () =>
      (authUsers || [])
        .filter((u) => u.role !== "admin") // don't show the built-in admin seat in the manageable list
        // Registration alone only creates the account — it should not
        // show up anywhere on this page (not even as a placeholder row)
        // until the person has actually finished every step of their
        // profile and hit "Submit for Approval" (that's when
        // `profileCompleted` flips to true in AuthContext). Before that,
        // there's nothing for an admin to review yet, so the row is
        // dropped entirely instead of being shown incomplete.
        .filter((u) => !!u.profileCompleted)
        .map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          avatar: u.registrationPhoto || u.avatar,
          registrationPhoto: u.registrationPhoto,
          role: u.role || null,
          department: u.department || null,
          status: toUiStatus(u.status),
          joinedOn: formatJoinedOn(u.createdAt),
          lastLogin: "—",
        })),
    [authUsers]
  );

  // Role Management (the free-text role directory) now lives on the
  // backend — see AuthContext's roleCatalog / createRoleCatalogEntry /
  // deleteRoleCatalogEntry. `roles` falls back to INITIAL_ROLES only
  // while the fetch is still in flight (roleCatalog === null); once it
  // resolves this is always the real, shared list.
  const roles = roleCatalog ?? INITIAL_ROLES;

  // Which role's row is currently being edited in the Module Access
  // Control table below. Module permissions are per-role (real,
  // AuthContext-backed), so unlike the old fake single flat table, the
  // admin picks one role at a time here — same "manager/employee/client/
  // accountant" buckets the Page Access Control table already uses.
  const [moduleAccessRole, setModuleAccessRole] = useState("employee");

  // Which user the "Manage Access" modal is currently open for, and the
  // user picked in the Individual User Access card's dropdown. The
  // override data itself (accessOverrides) now lives in AuthContext —
  // see getUserAccessOverride/updateUserAccessOverride below — so it's
  // the SAME data the real page/module gating reads from, not a separate
  // local copy.
  const [accessModalUserId, setAccessModalUserId] = useState(null);
  const [quickAccessUserId, setQuickAccessUserId] = useState("");

  const [activeTab, setActiveTab] = useState("all");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("All Roles");
  const [deptFilter, setDeptFilter] = useState("All Departments");

  // Filter dropdowns need to include any custom role/department an admin
  // typed manually (via RoleDeptInput) too, not just the static
  // ROLE_OPTIONS/DEPARTMENTS suggestion lists — otherwise a user assigned
  // a one-off title like "Motion Graphics Artist" could never be found
  // via this filter.
  const roleFilterOptions = useMemo(() => {
    const extra = users.map((u) => u.role).filter((r) => r && !ROLE_OPTIONS.includes(r));
    return [...ROLE_OPTIONS, ...Array.from(new Set(extra))];
  }, [users]);
  const deptFilterOptions = useMemo(() => {
    const extra = users.map((u) => u.department).filter((d) => d && !DEPARTMENTS.includes(d));
    return [...DEPARTMENTS, ...Array.from(new Set(extra))];
  }, [users]);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const [pendingSelections, setPendingSelections] = useState({});
  const [pendingErrors, setPendingErrors] = useState({});
  // openActionMenu now stores { id, top, left } so the popup can be
  // rendered fixed-position at the document level instead of absolutely
  // inside the scrolling table (which was clipping/mispositioning it).
  const [openActionMenu, setOpenActionMenu] = useState(null);

  // Which user's full bio-data (everything filled on CompleteProfilePage)
  // is currently open in the detail modal. Holds just the id; the raw
  // record is looked up live from authUsers below, so the modal always
  // reflects the latest persisted data.
  const [viewingUserId, setViewingUserId] = useState(null);
  const rawViewingUser = viewingUserId ? (authUsers || []).find((u) => u.id === viewingUserId) || null : null;

  const [inviteOpen, setInviteOpen] = useState(false);
  const [blockedPreviewOpen, setBlockedPreviewOpen] = useState(false);
  const [newRoleForm, setNewRoleForm] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [approvedToday, setApprovedToday] = useState(2);

  const roleManagementRef = useRef(null);
  const actionMenuRef = useRef(null);
  // Target for the stat cards: clicking "Total/Active/Pending/Deactivated"
  // switches the table to that tab and smooth-scrolls it into view (mainly
  // useful on mobile, where the table sits below the stat cards).
  const tableSectionRef = useRef(null);
  const scrollToTable = (tab) => {
    if (tab) setActiveTab(tab);
    tableSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const scrollToRoles = () => {
    roleManagementRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  /* ---- shared style tokens, mirror Dashboard's dark-mode pattern ---- */
  const card = darkMode ? "bg-slate-900 border border-slate-800" : "bg-white border border-slate-200";
  const cardText = darkMode ? "text-slate-100" : "text-slate-900";
  const mutedText = darkMode ? "text-slate-400" : "text-slate-500";
  const subtleText = darkMode ? "text-slate-500" : "text-slate-400";
  const inputCls = darkMode ? "bg-slate-800 border-slate-700 text-slate-200" : "bg-white border-slate-200 text-slate-900";
  const rowHover = darkMode ? "hover:bg-slate-800/60" : "hover:bg-slate-50";

  const showToast = (message, tone = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  };

  useEffect(() => {
    setPage(1);
  }, [activeTab, search, roleFilter, deptFilter, rowsPerPage]);

  // Close the row action popup on outside click / Escape / scroll, so it
  // never lingers in a wrong spot after the table scrolls or resizes.
  useEffect(() => {
    if (!openActionMenu) return;

    const handlePointerDown = (e) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target)) {
        setOpenActionMenu(null);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === "Escape") setOpenActionMenu(null);
    };
    const handleScrollOrResize = () => setOpenActionMenu(null);

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [openActionMenu]);

  const counts = useMemo(
    () => ({
      total: users.length,
      active: users.filter((u) => u.status === "active").length,
      pending: users.filter((u) => u.status === "pending").length,
      deactivated: users.filter((u) => u.status === "deactivated").length,
    }),
    [users]
  );

  const matchesFilters = (u) => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    const matchesRole = roleFilter === "All Roles" || u.role === roleFilter;
    const matchesDept = deptFilter === "All Departments" || u.department === deptFilter;
    return matchesSearch && matchesRole && matchesDept;
  };

  const activeAndDeactivated = users.filter((u) => u.status !== "pending" && matchesFilters(u));
  const pendingUsers = users.filter((u) => u.status === "pending" && matchesFilters(u));

  const flatFiltered = useMemo(() => {
    if (activeTab === "active") return users.filter((u) => u.status === "active" && matchesFilters(u));
    if (activeTab === "pending") return pendingUsers;
    if (activeTab === "deactivated") return users.filter((u) => u.status === "deactivated" && matchesFilters(u));
    return users.filter(matchesFilters);
  }, [activeTab, users, search, roleFilter, deptFilter]);

  const isAllTab = activeTab === "all";
  const totalPages = Math.max(1, Math.ceil(flatFiltered.length / rowsPerPage));
  const pageStart = (page - 1) * rowsPerPage;
  const pagedUsers = isAllTab ? null : flatFiltered.slice(pageStart, pageStart + rowsPerPage);

  // The user currently targeted by the open row-action popup (if any).
  const actionMenuUser = openActionMenu ? users.find((u) => u.id === openActionMenu.id) : null;

  const updateSelection = (id, patch) => {
    setPendingSelections((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
    setPendingErrors((e) => ({ ...e, [id]: false }));
  };

  // Approving here writes the role + department straight into AuthContext
  // and flips that user's status to "approved" — which is exactly what
  // AuthContext's loginUser gate is checking, so the user can now log in.
  const approveUser = (id) => {
    const sel = pendingSelections[id] || {};
    if (!sel.role || !sel.department) {
      setPendingErrors((e) => ({ ...e, [id]: true }));
      showToast("Assign a role and department before approving.", "error");
      return;
    }
    ctxApproveUser(id, sel.role, sel.department);
    setApprovedToday((n) => n + 1);
    showToast("User approved. They can now log in.", "success");
  };

  const rejectUser = (id) => {
    const target = users.find((u) => u.id === id);
    ctxRejectUser(id);
    showToast(`${target?.name || "User"} rejected.`, "error");
  };

  const toggleStatus = (id) => {
    const target = users.find((u) => u.id === id);
    const next = target?.status === "active" ? "deactivated" : "approved";
    ctxSetUserStatus(id, next);
    setOpenActionMenu(null);
  };

  const removeUser = (id) => {
    ctxRemoveUser(id);
    setOpenActionMenu(null);
    showToast("User deactivated. Their data and messages are kept.", "error");
  };

  // Approve / role-update actions triggered from inside the bio-data
  // detail modal. Same AuthContext calls as the row-level controls, so
  // the result is identical (and identically persisted) either way.
  const handleModalApprove = (id, role, department) => {
    if (!role || !department) return;
    ctxApproveUser(id, role, department);
    setApprovedToday((n) => n + 1);
    setViewingUserId(null);
    showToast("User approved after profile review.", "success");
  };

  const handleModalRoleUpdate = (id, role, department) => {
    if (!role || !department) return;
    ctxUpdateUserRole(id, role, department);
    setViewingUserId(null);
    showToast("Role & department updated.", "success");
  };

  // Salary is stored on the same raw AuthContext user record as everything
  // else in the detail modal (bank details, CNIC, etc.) via the existing
  // generic updateUserProfile — no AuthContext changes needed. Unlike
  // Approve/Update Role, this doesn't close the modal, since an admin may
  // still want to review the rest of the profile after setting it.
  // FIX: updateUserProfile is async, so `ok` used to be a Promise (always
  // truthy) and this always toasted "Salary updated." even when the backend
  // rejected the save (e.g. the user hasn't completed their profile yet) —
  // the salary then silently never reached any other device. Now awaited,
  // so the toast reflects what was REALLY saved.
  const handleModalSalaryUpdate = async (id, salary) => {
    const numeric = Number(salary);
    if (!Number.isFinite(numeric) || numeric < 0) return;
    let ok = false;
    try {
      ok = typeof updateUserProfile === "function" ? (await updateUserProfile(id, { salary: numeric })) === true : false;
    } catch {
      ok = false;
    }
    showToast(
      ok ? "Salary updated." : "Could not save salary. The user may not have completed their profile yet.",
      ok ? "success" : "error"
    );
  };

  // Opens the row action popup, positioned from the clicked button's own
  // bounding box in viewport coordinates. Because the popup is rendered
  // with position:fixed at the root of the component (see bottom of the
  // JSX), it's no longer clipped or displaced by the table's
  // `overflow-auto` / `max-h-[420px]` scroll container.
  const toggleActionMenu = (e, id) => {
    if (openActionMenu?.id === id) {
      setOpenActionMenu(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const menuWidth = 160;
    let left = rect.right - menuWidth;
    if (left < 8) left = 8;
    if (left + menuWidth > window.innerWidth - 8) left = window.innerWidth - menuWidth - 8;
    setOpenActionMenu({ id, top: rect.bottom + 6, left });
  };

  const handleInviteSubmit = (data) => {
    const result = ctxInviteUser({
      name: data.name,
      email: data.email,
      role: data.role || null,
      department: data.department || null,
    });
    if (!result.success) {
      showToast(result.error, "error");
      return;
    }
    if (data.role || data.department) {
      setPendingSelections((s) => ({ ...s, [result.user.id]: { role: data.role, department: data.department } }));
    }
    setInviteOpen(false);
    setActiveTab("pending");
    showToast("Invite sent. User added to pending approvals.", "success");
  };

  // REAL module-level (view/create/edit/delete) access control. Toggling a
  // box here writes straight into AuthContext's modulePermissions, so it
  // takes effect immediately for every approved user with that role,
  // everywhere in the app — any page can gate its create/edit/delete UI
  // with useAuth()'s canCreate("ModuleName") / canEdit(...) / canDelete(...).
  const toggleModuleFlag = (moduleName, flag) => {
    const current = getModulePermissions(moduleAccessRole, moduleName);
    updateModulePermission(moduleAccessRole, moduleName, flag, !current[flag]);
  };

  // REAL page-level access control — these roles map straight onto the
  // same categories AuthContext uses (getRoleCategory), so toggling a box
  // here immediately changes what that role's sidebar shows everywhere in
  // the app, for every user with that role. Admin is intentionally not
  // editable here — it always keeps full access.
  const PAGE_ACCESS_ROLES = [
    { key: "manager", label: "Manager" },
    { key: "employee", label: "Employee" },
    { key: "client", label: "Client" },
    { key: "accountant", label: "Accountant" },
  ];

  const togglePageAccess = (roleKey, page) => {
    const current = rolePermissions[roleKey] || [];
    const next = current.includes(page) ? current.filter((p) => p !== page) : [...current, page];
    updateRolePermissions(roleKey, next);
  };

  /* ---- Individual User Access (per-user overrides) ----
     Sits on top of the role-based Page Access Control above. If a user
     has no override, they simply fall back to their role's default
     pages. An override lets one specific person see a hand-picked set
     of pages, everything (admin-style), or nothing at all — regardless
     of what their assigned role normally grants. This now reads/writes
     straight through AuthContext's getUserAccessOverride /
     updateUserAccessOverride, which is the SAME data getAllowedPages /
     getModulePermissions / canAccessPage enforce app-wide — so a change
     made here takes effect for real, not just in this table's display. */

  const defaultPagesForRole = (role) => rolePermissions[getRoleCategory(role)] || [];

  const getEffectivePages = (user) => {
    const ov = getUserAccessOverride(user.id);
    if (!ov) return { source: "default", pages: defaultPagesForRole(user.role) };
    if (ov.mode === "full") return { source: "full", pages: ALL_PAGES };
    if (ov.mode === "none") return { source: "none", pages: [] };
    return { source: "custom", pages: ov.pages || [] };
  };

  const clearUserAccessOverride = (userId) => updateUserAccessOverride(userId, "default");

  // Pages that have their own internal "admin view" vs "everyone else's
  // view" — these are the ones the Manage Access modal offers a per-page
  // "Full X Access / Default" toggle for, on top of the plain page-access
  // picker above. Add a page's ALL_PAGES name here to opt it into the
  // same toggle without touching that page's own file at all — it just
  // needs to read AuthContext's hasFullSubPageAccess("Page Name") itself,
  // the same way SettingsPage.jsx and ReportsPage.jsx already do.
  const SUB_ACCESS_PAGES = ["Settings", "Reports", "Meetings"];

  // Applies whatever mode was chosen in the Manage Access modal. "default"
  // just removes the page-access override; the other three modes write/
  // replace it. `subAccess` (e.g. { Settings: "full", Reports: "default" })
  // is a separate, independent set of toggles for what's visible INSIDE
  // specific pages (Settings' tabs, Reports' admin view, ...), so each
  // entry is saved through updateSubPageAccess rather than bundled into
  // the page-access override above.
  const handleSaveUserAccess = (userId, mode, customPages, subAccess) => {
    const target = users.find((u) => u.id === userId);
    updateUserAccessOverride(userId, mode, mode === "custom" ? customPages || [] : undefined);
    SUB_ACCESS_PAGES.forEach((pageName) => {
      updateSubPageAccess(userId, pageName, subAccess?.[pageName] || "default");
    });
    showToast(
      mode === "default"
        ? `${target?.name || "User"} now follows their role's default access.`
        : `Access updated for ${target?.name || "user"}.`,
      "success"
    );
  };

  // Users who currently have an override, for the summary list in the
  // Individual User Access card (so admins can see + reset them at a glance).
  const overriddenUsers = useMemo(
    () =>
      users
        .filter((u) => !!getUserAccessOverride(u.id))
        .map((user) => ({ user, effective: getEffectivePages(user) })),
    [users, rolePermissions, getUserAccessOverride]
  );

  const accessModalUser = accessModalUserId ? users.find((u) => String(u.id) === String(accessModalUserId)) : null;

  const createRole = async () => {
    if (!newRoleForm?.name) return;
    const result = await createRoleCatalogEntry(newRoleForm.name, "", newRoleForm.access);
    if (result.success) {
      setNewRoleForm(null);
      showToast(`Role "${newRoleForm.name}" created.`, "success");
    } else {
      showToast(result.error || "Could not create role — check your connection", "error");
    }
  };

  // Roles persist until explicitly deleted here (Super Admin stays locked
  // and can't be removed — enforced both here, via the missing delete
  // button, and server-side in RoleCatalogView).
  const deleteRole = async (role) => {
    const result = await deleteRoleCatalogEntry(role.id);
    if (result.success) {
      showToast(`Role "${role.name}" deleted.`, "error");
    } else {
      showToast(result.error || "Could not delete role — check your connection", "error");
    }
  };

  const tabDefs = [
    { key: "all", label: "All Users" },
    { key: "active", label: "Active" },
    { key: "pending", label: `Pending Approval (${counts.pending})` },
    { key: "deactivated", label: "Deactivated" },
  ];

  return (
    <div className="space-y-4">
      {/* Page header row (Dashboard's shared topbar already shows "Users" as the title) */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className={`text-base font-bold ${cardText}`}>Users &amp; Roles</h2>
          <p className={`text-xs mt-0.5 ${subtleText}`}>Manage accounts, approvals, roles and permissions</p>
        </div>
        <button
          onClick={() => setInviteOpen(true)}
          className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-4 py-2 rounded-full transition shrink-0"
        >
          <Plus className="w-4 h-4" /> Invite User
        </button>
      </div>

      {/* STATS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard card={card} cardText={cardText} mutedText={mutedText} icon={Users} iconBg="bg-violet-50" iconText="text-violet-600" label="Total Users" value={counts.total} delta="12%" up onClick={() => scrollToTable("all")} />
        <StatCard card={card} cardText={cardText} mutedText={mutedText} icon={Users} iconBg="bg-emerald-50" iconText="text-emerald-600" label="Active Users" value={counts.active} delta="8%" up onClick={() => scrollToTable("active")} />
        <StatCard
          card={card}
          cardText={cardText}
          mutedText={mutedText}
          icon={Lock}
          iconBg="bg-amber-50"
          iconText="text-amber-600"
          label="Pending Approvals"
          value={counts.pending}
          delta="20%"
          up={false}
          onClick={() => scrollToTable("pending")}
          action={
            <button
              onClick={() => scrollToTable("pending")}
              className="text-xs font-semibold text-violet-600 bg-violet-50 px-2.5 py-1.5 rounded-lg hover:bg-violet-100 transition"
            >
              Review Now
            </button>
          }
        />
        <StatCard card={card} cardText={cardText} mutedText={mutedText} icon={Users} iconBg="bg-rose-50" iconText="text-rose-600" label="Deactivated" value={counts.deactivated} delta="5%" up={false} onClick={() => scrollToTable("deactivated")} />
        <StatCard
          card={card}
          cardText={cardText}
          mutedText={mutedText}
          icon={ShieldCheck}
          iconBg="bg-blue-50"
          iconText="text-blue-600"
          label="Roles"
          value={roles.length}
          onClick={scrollToRoles}
          action={
            <button
              onClick={scrollToRoles}
              className="text-xs font-semibold text-violet-600 bg-violet-50 px-2.5 py-1.5 rounded-lg hover:bg-violet-100 transition"
            >
              Manage
            </button>
          }
        />
      </div>

      {/* CONTENT GRID */}
      <div className="grid lg:grid-cols-[1fr,340px] gap-4 items-start">
        {/* LEFT: table card */}
        <div ref={tableSectionRef} className={`rounded-2xl overflow-hidden min-w-0 ${card}`}>
          {/* Tabs */}
          <div className={`flex items-center gap-1 px-4 pt-3 overflow-x-auto whitespace-nowrap border-b ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
            {tabDefs.map((t) => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`px-3 py-2 text-sm font-semibold border-b-2 transition shrink-0 ${
                  activeTab === t.key ? "text-violet-600 border-violet-600" : `${mutedText} border-transparent hover:text-violet-500`
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Filters — stacked full-width below sm, row + wrap from sm up
              (unchanged on desktop). Selects/buttons are w-full sm:w-auto
              so a long option label can never force the row (and the
              whole page) wider than the screen on mobile. */}
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 px-4 py-2.5">
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className={`w-full sm:w-auto text-sm border rounded-lg px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 ${inputCls}`}
            >
              <option>All Roles</option>
              {roleFilterOptions.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className={`w-full sm:w-auto text-sm border rounded-lg px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 ${inputCls}`}
            >
              <option>All Departments</option>
              {deptFilterOptions.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
            <button className={`w-full sm:w-auto flex items-center justify-center gap-1.5 text-sm border rounded-lg px-3 py-1.5 ${inputCls}`}>
              <Filter className="w-3.5 h-3.5" /> Filter
            </button>
            <div className="relative w-full sm:flex-1 sm:min-w-[160px] sm:ml-auto">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, email..."
                className={`w-full text-sm border rounded-lg pl-9 pr-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 ${inputCls}`}
              />
            </div>
          </div>

          {/* Desktop table — capped height so the whole dashboard page doesn't grow endlessly */}
          <div className="hidden md:block overflow-auto max-h-[420px]">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="sticky top-0 z-10">
                <tr className={`text-left text-xs ${mutedText} border-y ${darkMode ? "border-slate-800 bg-slate-900" : "border-slate-100 bg-slate-50"}`}>
                  <th className="py-2.5 pl-5 pr-2 w-8">
                    <input type="checkbox" className="rounded border-slate-300" />
                  </th>
                  <th className="py-2.5 px-2 font-semibold">User</th>
                  <th className="py-2.5 px-2 font-semibold">Role</th>
                  <th className="py-2.5 px-2 font-semibold">Department</th>
                  <th className="py-2.5 px-2 font-semibold">Status</th>
                  <th className="py-2.5 px-2 font-semibold">Access</th>
                  <th className="py-2.5 px-2 font-semibold">Joined On</th>
                  <th className="py-2.5 px-2 font-semibold">Last Login</th>
                  <th className="py-2.5 pr-5 pl-2 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${darkMode ? "divide-slate-800" : "divide-slate-100"}`}>
                {(isAllTab ? activeAndDeactivated : pagedUsers).map((u) => (
                  <tr key={u.id} className={rowHover}>
                    <td className="py-2.5 pl-5 pr-2">
                      <input type="checkbox" className="rounded border-slate-300" />
                    </td>
                    <td className="py-2.5 px-2">
                      <button
                        type="button"
                        onClick={() => setViewingUserId(u.id)}
                        className="flex items-center gap-2.5 min-w-[180px] text-left hover:opacity-80 transition"
                        title="View full profile / bio-data"
                      >
                        <Avatar name={u.name} avatar={u.avatar} />
                        <div className="min-w-0">
                          <p className={`font-semibold truncate ${cardText}`}>{u.name}</p>
                          <p className={`text-xs truncate ${subtleText}`}>{u.email}</p>
                        </div>
                      </button>
                    </td>
                    <td className="py-2.5 px-2"><RoleBadge role={u.role} /></td>
                    <td className="py-2.5 px-2"><DepartmentChip department={u.department} /></td>
                    <td className="py-2.5 px-2"><StatusBadge status={u.status} /></td>
                    <td className="py-2.5 px-2">
                      <button
                        type="button"
                        onClick={() => setAccessModalUserId(u.id)}
                        title="Manage individual page access"
                      >
                        <AccessBadge effective={getEffectivePages(u)} />
                      </button>
                    </td>
                    <td className={`py-2.5 px-2 whitespace-nowrap ${mutedText}`}>{u.joinedOn}</td>
                    <td className={`py-2.5 px-2 whitespace-nowrap ${mutedText}`}>{u.lastLogin}</td>
                    <td className="py-2.5 pr-5 pl-2 text-right relative">
                      <button
                        onClick={(e) => toggleActionMenu(e, u.id)}
                        className={`w-8 h-8 inline-flex items-center justify-center rounded-lg ${mutedText} ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-100"}`}
                        aria-label="Row actions"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}

                {(isAllTab || activeTab === "pending") && pendingUsers.length > 0 && (
                  <>
                    {isAllTab && (
                      <tr>
                        <td colSpan={9} className={`pt-4 pb-2 px-5 text-xs font-bold uppercase tracking-wider ${subtleText} ${darkMode ? "bg-slate-900" : "bg-slate-50/60"}`}>
                          Pending Approvals
                        </td>
                      </tr>
                    )}
                    {(isAllTab ? pendingUsers : pagedUsers).map((u) => {
                      const sel = pendingSelections[u.id] || {};
                      const err = pendingErrors[u.id];
                      return (
                        <tr key={u.id} className={darkMode ? "hover:bg-amber-950/20" : "hover:bg-amber-50/30"}>
                          <td className="py-2.5 pl-5 pr-2">
                            <input type="checkbox" className="rounded border-slate-300" />
                          </td>
                          <td className="py-2.5 px-2">
                            <button
                              type="button"
                              onClick={() => setViewingUserId(u.id)}
                              className="flex items-center gap-2.5 min-w-[180px] text-left hover:opacity-80 transition"
                              title="View full profile / bio-data"
                            >
                              <Avatar name={u.name} avatar={u.avatar} />
                              <div className="min-w-0">
                                <p className={`font-semibold truncate ${cardText}`}>{u.name}</p>
                                <p className={`text-xs truncate ${subtleText}`}>{u.email}</p>
                              </div>
                            </button>
                          </td>
                          <td colSpan={2} className="py-2.5 px-2">
                            <PendingFields selection={sel} error={err} onChange={(v) => updateSelection(u.id, v)} inputCls={inputCls} rowId={u.id} />
                          </td>
                          <td className="py-2.5 px-2"><StatusBadge status="pending" /></td>
                          <td className={`py-2.5 px-2 text-xs ${subtleText}`}>After approval</td>
                          <td className={`py-2.5 px-2 whitespace-nowrap ${mutedText}`}>{u.joinedOn}</td>
                          <td className={`py-2.5 px-2 whitespace-nowrap ${mutedText}`}>{u.lastLogin}</td>
                          <td className="py-2.5 pr-5 pl-2">
                            <div className="flex items-center justify-end gap-1.5">
                              <button onClick={() => approveUser(u.id)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100" aria-label="Approve">
                                <Check className="w-4 h-4" />
                              </button>
                              <button onClick={() => rejectUser(u.id)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100" aria-label="Reject">
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </>
                )}

                {flatFiltered.length === 0 && (
                  <tr>
                    <td colSpan={9} className={`text-center py-12 text-sm ${subtleText}`}>No users match these filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className={`md:hidden divide-y overflow-y-auto max-h-[420px] ${darkMode ? "divide-slate-800" : "divide-slate-100"}`}>
            {(isAllTab ? [...activeAndDeactivated, ...pendingUsers] : pagedUsers).map((u) => {
              const sel = pendingSelections[u.id] || {};
              const err = pendingErrors[u.id];
              return (
                <div key={u.id} className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <button
                      type="button"
                      onClick={() => setViewingUserId(u.id)}
                      className="flex items-center gap-2.5 min-w-0 text-left hover:opacity-80 transition"
                      title="View full profile / bio-data"
                    >
                      <Avatar name={u.name} avatar={u.avatar} />
                      <div className="min-w-0">
                        <p className={`font-semibold text-sm truncate ${cardText}`}>{u.name}</p>
                        <p className={`text-xs truncate ${subtleText}`}>{u.email}</p>
                      </div>
                    </button>
                    <StatusBadge status={u.status} />
                  </div>

                  {u.status === "pending" ? (
                    <div className="space-y-2">
                      <PendingFields selection={sel} error={err} onChange={(v) => updateSelection(u.id, v)} inputCls={inputCls} rowId={u.id} />
                      <div className="flex items-center gap-2 pt-1">
                        <button onClick={() => approveUser(u.id)} className="flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold py-2 rounded-lg bg-emerald-50 text-emerald-600">
                          <Check className="w-4 h-4" /> Approve
                        </button>
                        <button onClick={() => rejectUser(u.id)} className="flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold py-2 rounded-lg bg-rose-50 text-rose-600">
                          <X className="w-4 h-4" /> Reject
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs ${mutedText}`}>
                        <RoleBadge role={u.role} />
                        <DepartmentChip department={u.department} />
                        <span>Joined {u.joinedOn}</span>
                        <span>Last login {u.lastLogin}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-2">
                        <button type="button" onClick={() => setAccessModalUserId(u.id)}>
                          <AccessBadge effective={getEffectivePages(u)} />
                        </button>
                        <button onClick={() => toggleStatus(u.id)} className="text-violet-600 text-xs font-semibold">
                          {u.status === "active" ? "Deactivate" : "Reactivate"}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
            {flatFiltered.length === 0 && <p className={`text-center py-10 text-sm ${subtleText}`}>No users match these filters.</p>}
          </div>

          {/* Pagination */}
          {!isAllTab && (
            <div className={`flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t text-sm ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
              <p className={`text-xs ${subtleText}`}>
                Showing {flatFiltered.length === 0 ? 0 : pageStart + 1} to {Math.min(pageStart + rowsPerPage, flatFiltered.length)} of {flatFiltered.length} users
              </p>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className={`w-8 h-8 flex items-center justify-center rounded-lg border disabled:opacity-40 ${inputCls}`}>‹</button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).slice(0, 5).map((p) => (
                  <button key={p} onClick={() => setPage(p)} className={`w-8 h-8 rounded-lg text-sm font-semibold ${page === p ? "bg-violet-600 text-white" : inputCls}`}>
                    {p}
                  </button>
                ))}
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className={`w-8 h-8 flex items-center justify-center rounded-lg border disabled:opacity-40 ${inputCls}`}>›</button>
              </div>
              <div className={`flex items-center gap-2 text-xs ${subtleText}`}>
                Rows per page:
                <select value={rowsPerPage} onChange={(e) => setRowsPerPage(Number(e.target.value))} className={`border rounded-lg px-2 py-1 outline-none ${inputCls}`}>
                  {[10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: role + permissions panels */}
        <div className="space-y-4 min-w-0" ref={roleManagementRef}>
          <div className={`rounded-2xl p-4 ${card}`}>
            <h3 className={`font-bold mb-1 ${cardText}`}>Role Management</h3>
            <p className={`text-xs mb-3 ${subtleText}`}>Create and manage roles for your organization. Roles stay saved until you delete them.</p>
            <ul className="space-y-2 mb-3">
              {roles.map((r) => (
                <li key={r.id ?? r.name} className="flex items-center justify-between text-sm gap-2">
                  <span className={`font-semibold flex items-center gap-2 min-w-0 ${cardText}`}>
                    <span className="truncate">{r.name}</span>
                    {r.tag && <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ${darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-500"}`}>{r.tag}</span>}
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs ${subtleText}`}>{r.access}</span>
                    {!r.locked && (
                      <button
                        onClick={() => deleteRole(r)}
                        className="w-6 h-6 flex items-center justify-center rounded-md text-rose-500 hover:bg-rose-50"
                        aria-label={`Delete ${r.name} role`}
                        title="Delete role"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>

            {newRoleForm ? (
              <div className={`space-y-2 border-t pt-3 ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
                <input
                  autoFocus
                  value={newRoleForm.name}
                  onChange={(e) => setNewRoleForm({ ...newRoleForm, name: e.target.value })}
                  placeholder="Role name"
                  className={`w-full text-sm border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-violet-400 ${inputCls}`}
                />
                <select value={newRoleForm.access} onChange={(e) => setNewRoleForm({ ...newRoleForm, access: e.target.value })} className={`w-full text-sm border rounded-lg px-3 py-2 outline-none ${inputCls}`}>
                  <option>Full Access</option>
                  <option>Custom Access</option>
                  <option>Limited Access</option>
                </select>
                <div className="flex gap-2">
                  <button onClick={createRole} className="flex-1 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold py-2 rounded-lg">Save role</button>
                  <button onClick={() => setNewRoleForm(null)} className={`flex-1 border text-sm font-semibold py-2 rounded-lg ${inputCls}`}>Cancel</button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setNewRoleForm({ name: "", access: "Custom Access" })}
                className="w-full flex items-center justify-center gap-1.5 text-sm font-semibold text-violet-600 border border-dashed border-violet-300 rounded-lg py-2 hover:bg-violet-50 transition"
              >
                <Plus className="w-4 h-4" /> Create New Role
              </button>
            )}
          </div>

          <div className={`rounded-2xl p-4 ${card}`}>
            <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
              <h3 className={`font-bold ${cardText}`}>Module Access Control</h3>
              <select
                value={moduleAccessRole}
                onChange={(e) => setModuleAccessRole(e.target.value)}
                className={`text-xs font-semibold border rounded-lg px-2 py-1.5 outline-none ${inputCls}`}
                aria-label="Role to edit module permissions for"
              >
                {PAGE_ACCESS_ROLES.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <p className={`text-xs mb-3 ${subtleText}`}>
              Real access control — unticking Create/Edit for a role removes that button from every screen for
              every user with that role; they can still open and view the module. Unticking View hides the module
              entirely. Changes are saved and enforced immediately.
            </p>
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-xs min-w-[300px]">
                <thead>
                  <tr className={subtleText}>
                    <th className="text-left font-semibold pb-2 pl-1">Module</th>
                    <th className="font-semibold pb-2">View</th>
                    <th className="font-semibold pb-2">Create</th>
                    <th className="font-semibold pb-2">Edit</th>
                    <th className="font-semibold pb-2">Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {ALL_PAGES.map((moduleName) => {
                    const flags = getModulePermissions(moduleAccessRole, moduleName);
                    return (
                      <tr key={moduleName} className={`border-t ${darkMode ? "border-slate-800" : "border-slate-50"}`}>
                        <td className={`py-2 pl-1 font-medium whitespace-nowrap ${cardText}`}>{moduleName}</td>
                        {["view", "create", "edit", "delete"].map((flag) => (
                          <td key={flag} className="py-2 text-center">
                            <input
                              type="checkbox"
                              checked={!!flags[flag]}
                              onChange={() => toggleModuleFlag(moduleName, flag)}
                              className="rounded border-slate-300 accent-violet-600"
                              aria-label={`${moduleAccessRole} ${flag} access to ${moduleName}`}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className={`text-[10.5px] mt-3 ${subtleText}`}>
              Saved automatically — no separate "Save" button needed for this table.
            </p>
          </div>

          <div className={`rounded-2xl p-4 ${card}`}>
            <h3 className={`font-bold mb-1 ${cardText}`}>Page Access Control</h3>
            <p className={`text-xs mb-3 ${subtleText}`}>
              Real access control — tick which pages each role can see in the sidebar. Changes apply immediately to
              every approved user with that role, next time they load the app. Admin always has full access.
            </p>
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-xs min-w-[420px]">
                <thead>
                  <tr className={subtleText}>
                    <th className="text-left font-semibold pb-2 pl-1">Page</th>
                    {PAGE_ACCESS_ROLES.map((r) => (
                      <th key={r.key} className="font-semibold pb-2 px-1">
                        {r.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ALL_PAGES.map((page) => (
                    <tr key={page} className={`border-t ${darkMode ? "border-slate-800" : "border-slate-50"}`}>
                      <td className={`py-2 pl-1 font-medium whitespace-nowrap ${cardText}`}>{page}</td>
                      {PAGE_ACCESS_ROLES.map((r) => (
                        <td key={r.key} className="py-2 text-center">
                          <input
                            type="checkbox"
                            checked={(rolePermissions[r.key] || []).includes(page)}
                            onChange={() => togglePageAccess(r.key, page)}
                            className="rounded border-slate-300 accent-violet-600"
                            aria-label={`${r.label} access to ${page}`}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={`text-[10.5px] mt-3 ${subtleText}`}>
              Saved automatically — no separate "Save" button needed for this table.
            </p>
          </div>

          <div className={`rounded-2xl p-4 ${card}`}>
            <h3 className={`font-bold mb-1 ${cardText}`}>Individual User Access</h3>
            <p className={`text-xs mb-3 ${subtleText}`}>
              Override the role rules above for one specific person — hand-pick exactly which pages they see, grant
              full Admin-style access, or block them from every page. Takes priority over their role, and over each
              other user's own role, until you reset them back to default.
            </p>
            <div className="flex flex-col sm:flex-row gap-2 mb-3">
              <select
                value={quickAccessUserId}
                onChange={(e) => setQuickAccessUserId(e.target.value)}
                className={`flex-1 min-w-0 text-sm border rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-violet-400 ${inputCls}`}
                aria-label="Choose a user to manage access for"
              >
                <option value="">Select a user…</option>
                {users
                  .filter((u) => u.status !== "pending")
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} — {u.email}{u.department ? ` (${u.department})` : ""}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                disabled={!quickAccessUserId}
                onClick={() => setAccessModalUserId(quickAccessUserId)}
                className="shrink-0 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
              >
                Manage Access
              </button>
            </div>

            {overriddenUsers.length > 0 ? (
              <ul className="space-y-2">
                {overriddenUsers.map(({ user, effective }) => (
                  <li key={user.id} className="flex items-center justify-between gap-2 text-sm">
                    <button
                      type="button"
                      onClick={() => setAccessModalUserId(user.id)}
                      className={`flex items-center gap-2 min-w-0 text-left hover:opacity-80 transition ${cardText}`}
                    >
                      <Avatar name={user.name} avatar={user.avatar} size="w-8 h-8" />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{user.name}</span>
                        <span className={`block truncate text-xs font-normal ${subtleText}`}>
                          {user.email}
                          {user.department ? ` · ${user.department}` : ""}
                        </span>
                      </span>
                    </button>
                    <span className="flex items-center gap-2 shrink-0">
                      <AccessBadge effective={effective} />
                      <button
                        onClick={() => clearUserAccessOverride(user.id)}
                        className="w-6 h-6 flex items-center justify-center rounded-md text-rose-500 hover:bg-rose-50"
                        title="Reset to role default"
                        aria-label={`Reset access override for ${user.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={`text-xs italic ${subtleText}`}>No individual overrides yet — everyone follows their role's default access.</p>
            )}
          </div>

          <div className={`rounded-2xl p-4 ${card}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className={`font-bold ${cardText}`}>AI Assistant Visibility</h3>
                <p className={`text-xs mt-1 ${subtleText}`}>
                  When off, only Admin can see the AI Assistant panel. Everyone else (Manager, Employee, Client,
                  Accountant) loses it immediately, no matter what their Page Access above allows.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={aiAssistantEnabled}
                aria-label="Toggle AI Assistant visibility for non-admin users"
                onClick={() => setAiAssistantEnabled(!aiAssistantEnabled)}
                className={`shrink-0 w-11 h-6 rounded-full transition-colors duration-200 relative ${
                  aiAssistantEnabled ? "bg-violet-600" : darkMode ? "bg-slate-700" : "bg-slate-200"
                }`}
              >
                <span
                  className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200"
                  style={{ transform: aiAssistantEnabled ? "translateX(22px)" : "translateX(0px)" }}
                />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* BOTTOM BANNER */}
      <div className={`rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row items-center gap-4 ${card}`}>
        <span className="w-12 h-12 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
          <ShieldCheck className="w-6 h-6" />
        </span>
        <div className="flex-1 min-w-0 text-center lg:text-left">
          <h4 className={`font-bold mb-1 ${cardText}`}>New User Approval Process</h4>
          <p className={`text-sm max-w-xl ${mutedText}`}>
            New users can only access the system after admin approval. You can assign roles and departments during approval.
          </p>
        </div>
        <div className="flex items-center flex-wrap justify-center gap-4 sm:gap-6 shrink-0">
          <div className="text-center">
            <p className={`text-xl font-extrabold ${cardText}`}>{counts.pending}</p>
            <p className={`text-xs ${subtleText}`}>Pending Approval</p>
          </div>
          <div className="text-center">
            <p className={`text-xl font-extrabold ${cardText}`}>{approvedToday}</p>
            <p className={`text-xs ${subtleText}`}>Approved Today</p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full lg:w-auto shrink-0">
          <button onClick={() => setBlockedPreviewOpen(true)} className={`flex items-center justify-center gap-1.5 border text-sm font-semibold px-4 py-2 rounded-full transition ${inputCls}`}>
            <Info className="w-4 h-4" /> Preview Blocked Login
          </button>
          <button onClick={() => scrollToTable("pending")} className="flex items-center justify-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-4 py-2 rounded-full transition">
            Review Pending Users
          </button>
        </div>
      </div>

      {inviteOpen && <InviteUserModal onClose={() => setInviteOpen(false)} onSubmit={handleInviteSubmit} darkMode={darkMode} />}
      {blockedPreviewOpen && <BlockedLoginModal onClose={() => setBlockedPreviewOpen(false)} darkMode={darkMode} />}

      {accessModalUser && (
        <UserAccessModal
          user={accessModalUser}
          allPages={ALL_PAGES}
          override={getUserAccessOverride(accessModalUser.id)}
          defaultPages={defaultPagesForRole(accessModalUser.role)}
          subAccessPages={SUB_ACCESS_PAGES}
          subAccess={Object.fromEntries(SUB_ACCESS_PAGES.map((p) => [p, getSubPageAccess(accessModalUser.id, p)]))}
          onSave={(mode, pages, subAccess) => handleSaveUserAccess(accessModalUser.id, mode, pages, subAccess)}
          onClose={() => setAccessModalUserId(null)}
          darkMode={darkMode}
        />
      )}

      {/* Full bio-data detail modal — everything the user filled in on
          CompleteProfilePage.jsx, plus role/department assignment. */}
      {rawViewingUser && (
        <UserDetailModal
          rawUser={rawViewingUser}
          onApprove={handleModalApprove}
          onUpdateRole={handleModalRoleUpdate}
          onUpdateSalary={handleModalSalaryUpdate}
          onClose={() => setViewingUserId(null)}
          darkMode={darkMode}
        />
      )}

      {/* Row action popup — rendered fixed at the document level (not
          inside the scrolling table div) so overflow/scroll clipping
          can no longer push it outside its wrapper or in the wrong spot. */}
      {openActionMenu && actionMenuUser && (
        <div
          ref={actionMenuRef}
          style={{ position: "fixed", top: openActionMenu.top, left: openActionMenu.left, width: 160 }}
          className={`z-[100] rounded-xl shadow-lg py-1 text-left ${card}`}
        >
          <button
            onClick={() => { setViewingUserId(openActionMenu.id); setOpenActionMenu(null); }}
            className={`w-full text-left px-3 py-2 text-sm ${mutedText} ${rowHover}`}
          >
            Edit user
          </button>
          <button
            onClick={() => { setAccessModalUserId(actionMenuUser.id); setOpenActionMenu(null); }}
            className={`w-full text-left px-3 py-2 text-sm ${mutedText} ${rowHover}`}
          >
            Manage access
          </button>
          <button onClick={() => toggleStatus(actionMenuUser.id)} className={`w-full text-left px-3 py-2 text-sm ${mutedText} ${rowHover}`}>
            {actionMenuUser.status === "active" ? "Deactivate" : "Reactivate"}
          </button>
          <button onClick={() => removeUser(actionMenuUser.id)} className="w-full text-left px-3 py-2 text-sm text-rose-600 hover:bg-rose-50">
            Remove (deactivate)
          </button>
        </div>
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
   MODALS
====================================================================== */

function InviteUserModal({ onClose, onSubmit, darkMode }) {
  const [form, setForm] = useState({ name: "", email: "", role: "", department: "" });
  const canSubmit = form.name.trim() && form.email.trim();
  const modalCard = darkMode ? "bg-slate-900 text-slate-100" : "bg-white";
  const inputCls = darkMode ? "bg-slate-800 border-slate-700 text-slate-200" : "border-slate-200";

  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`rounded-2xl w-full max-w-md p-6 shadow-2xl ${modalCard}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">Invite User</h3>
          <button onClick={onClose} className={`w-8 h-8 flex items-center justify-center rounded-lg ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-100"}`}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Full name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Bilal Ahmed" className={`w-full text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-400 ${inputCls}`} />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Email address</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@company.com" className={`w-full text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-400 ${inputCls}`} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">Role (optional)</label>
              <RoleDeptInput
                listId="role-options-invite"
                options={ROLE_OPTIONS}
                value={form.role}
                onChange={(v) => setForm({ ...form, role: v })}
                placeholder="Pick or type a role"
                className={`w-full text-sm border rounded-lg px-2.5 py-2.5 outline-none ${inputCls}`}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">Department</label>
              <RoleDeptInput
                listId="dept-options-invite"
                options={DEPARTMENTS}
                value={form.department}
                onChange={(v) => setForm({ ...form, department: v })}
                placeholder="Pick or type dept."
                className={`w-full text-sm border rounded-lg px-2.5 py-2.5 outline-none ${inputCls}`}
              />
            </div>
          </div>
          <p className={`text-xs rounded-lg px-3 py-2 ${darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-50 text-slate-400"}`}>
            The invited user is added as <b>Pending</b>. They won&apos;t be able to log in until you approve them.
          </p>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className={`flex-1 border text-sm font-semibold py-2.5 rounded-full ${inputCls}`}>Cancel</button>
          <button disabled={!canSubmit} onClick={() => onSubmit(form)} className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-full transition">
            Send Invite
          </button>
        </div>
      </div>
    </div>
  );
}

function BlockedLoginModal({ onClose, darkMode }) {
  const modalCard = darkMode ? "bg-slate-900 text-slate-100" : "bg-white";
  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`rounded-2xl w-full max-w-sm p-6 shadow-2xl text-center ${modalCard}`} onClick={(e) => e.stopPropagation()}>
        <div className="w-14 h-14 rounded-full bg-rose-50 text-rose-500 flex items-center justify-center mx-auto mb-4">
          <Lock className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold mb-1.5">Account pending approval</h3>
        <p className={`text-sm mb-5 ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
          This is what a pending user sees. Your account is waiting on admin approval. You&apos;ll get an email as soon as you&apos;re approved and can sign in.
        </p>
        <button onClick={onClose} className="w-full bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold py-2.5 rounded-full">Got it</button>
      </div>
    </div>
  );
}

/* Per-user access override modal — opened from a row's ⋮ menu, the Access
   badge in the table, or the Individual User Access card's picker.
   "default" removes any override (falls back to the role's Page Access
   Control); "custom" lets the admin tick exactly which pages this one
   person can see; "full" mirrors Admin-level access; "none" hides every
   page. Fully keyboard/touch friendly and scrolls internally on small
   screens, matching the other modals in this file. */
function UserAccessModal({ user, allPages, override, defaultPages, subAccessPages, subAccess, onSave, onClose, darkMode }) {
  const [mode, setMode] = useState(override?.mode || "default");
  const [pages, setPages] = useState(override?.mode === "custom" ? override.pages : defaultPages);
  // Independent of `mode` above — `mode` controls which PAGES this person
  // can see (including whether "Settings"/"Reports" show up in their
  // sidebar at all); this controls what they see once they're actually
  // INSIDE one of those pages (e.g. Settings' General/Profile/Security
  // only vs every tab; Reports' "just my own log" vs the admin-wide
  // view). One entry per page in `subAccessPages`, e.g.
  // { Settings: "full", Reports: "default" }.
  const [subAccessState, setSubAccessState] = useState(() => ({ ...subAccess }));

  const modalCard = darkMode ? "bg-slate-900 text-slate-100" : "bg-white";
  const inputCls = darkMode ? "bg-slate-800 border-slate-700 text-slate-200" : "border-slate-200";

  const MODE_OPTIONS = [
    { key: "default", label: "Default", desc: `This role's normal access (${defaultPages.length} page${defaultPages.length === 1 ? "" : "s"}).` },
    { key: "custom", label: "Custom", desc: "Pick exactly which pages this person can see." },
    { key: "full", label: "Full Access", desc: "See everything, same as Admin." },
    { key: "none", label: "No Access", desc: "Hide every page from this user." },
  ];

  const togglePage = (p) => {
    setPages((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  const setSubAccess = (pageName, value) => {
    setSubAccessState((prev) => ({ ...prev, [pageName]: value }));
  };

  // Which of the "has its own admin view" pages are actually reachable
  // under whatever's currently selected — so this section only ever shows
  // toggles that would actually do something. "full" mode already implies
  // full access to every page's internals too (see AuthContext's
  // hasFullSubPageAccess), so there's nothing extra to grant there;
  // "none" means nothing is reachable at all.
  const effectivePages = mode === "full" ? allPages : mode === "none" ? [] : mode === "custom" ? pages : defaultPages;
  const applicableSubPages = mode === "full" ? [] : (subAccessPages || []).filter((p) => effectivePages.includes(p));

  const handleSave = () => {
    onSave(mode, mode === "custom" ? pages : undefined, subAccessState);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[95] bg-black/40 flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div
        className={`rounded-2xl w-full max-w-lg my-8 p-6 shadow-2xl max-h-[85vh] overflow-y-auto ${modalCard}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar name={user.name} avatar={user.avatar} size="w-10 h-10" />
            <div className="min-w-0">
              <h3 className="text-base font-bold truncate">Access for {user.name}</h3>
              <p className="text-xs text-slate-500 truncate">
                {user.email}
                {user.department ? ` · ${user.department}` : ""}
              </p>
            </div>
          </div>
          <button onClick={onClose} className={`w-8 h-8 flex items-center justify-center rounded-lg shrink-0 ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-100"}`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-4">
          {MODE_OPTIONS.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMode(m.key)}
              className={`text-left rounded-xl border p-3 transition ${
                mode === m.key ? "border-violet-500 bg-violet-50" : inputCls
              }`}
            >
              <p className={`text-sm font-semibold ${mode === m.key ? "text-violet-600" : darkMode ? "text-slate-200" : "text-slate-800"}`}>
                {m.label}
              </p>
              <p className={`text-[11px] mt-0.5 ${darkMode ? "text-slate-500" : "text-slate-400"}`}>{m.desc}</p>
            </button>
          ))}
        </div>

        {mode === "custom" && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-wider text-violet-500">Pages this person can see</p>
              <div className="flex gap-3 shrink-0">
                <button type="button" onClick={() => setPages(allPages)} className="text-xs font-semibold text-violet-600">
                  Select all
                </button>
                <button type="button" onClick={() => setPages([])} className="text-xs font-semibold text-rose-500">
                  Clear
                </button>
              </div>
            </div>
            <div className={`grid sm:grid-cols-2 gap-1.5 rounded-xl border p-3 max-h-64 overflow-y-auto ${inputCls}`}>
              {allPages.map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pages.includes(p)}
                    onChange={() => togglePage(p)}
                    className="rounded border-slate-300 accent-violet-600"
                  />
                  {p}
                </label>
              ))}
            </div>
            <p className={`text-[11px] mt-2 ${darkMode ? "text-slate-500" : "text-slate-400"}`}>
              {pages.length} of {allPages.length} pages selected.
            </p>
          </div>
        )}

        {mode === "full" && (
          <p className={`text-xs rounded-lg px-3 py-2 ${darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-50 text-slate-500"}`}>
            This user will see every page and module in the app — the same as Admin — regardless of their assigned role.
          </p>
        )}
        {mode === "none" && (
          <p className={`text-xs rounded-lg px-3 py-2 ${darkMode ? "bg-rose-950/30 text-rose-300" : "bg-rose-50 text-rose-500"}`}>
            This user won&apos;t see any page after logging in. Use this to fully suspend visibility without
            deactivating their account.
          </p>
        )}
        {mode === "default" && (
          <p className={`text-xs rounded-lg px-3 py-2 ${darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-50 text-slate-500"}`}>
            Falls back to whatever Page Access Control (left panel) grants their role — currently {defaultPages.length} page(s).
          </p>
        )}

        {/* Per-page "Full X Access / Default" toggles — only shown for
            pages that both (a) support their own internal admin view
            (Settings, Reports, ...) and (b) are actually reachable under
            whatever's picked above, so this never shows a toggle that
            wouldn't do anything. */}
        {applicableSubPages.length > 0 && (
          <div className="mt-5 pt-4 border-t border-dashed border-slate-200 dark:border-slate-800 space-y-4">
            {applicableSubPages.map((pageName) => (
              <div key={pageName}>
                <p className="text-xs font-bold uppercase tracking-wider text-violet-500 mb-2">Inside the {pageName} page</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: "default", label: `Default ${pageName}`, desc: `This person's normal, everyday-user view of ${pageName}.` },
                    { key: "full", label: `Full ${pageName} Access`, desc: `Everything ${pageName} shows an Admin — same as Admin, just for this page.` },
                  ].map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setSubAccess(pageName, m.key)}
                      className={`text-left rounded-xl border p-3 transition ${
                        (subAccessState[pageName] || "default") === m.key ? "border-violet-500 bg-violet-50" : inputCls
                      }`}
                    >
                      <p className={`text-sm font-semibold ${(subAccessState[pageName] || "default") === m.key ? "text-violet-600" : darkMode ? "text-slate-200" : "text-slate-800"}`}>
                        {m.label}
                      </p>
                      <p className={`text-[11px] mt-0.5 ${darkMode ? "text-slate-500" : "text-slate-400"}`}>{m.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <p className={`text-[11px] ${darkMode ? "text-slate-500" : "text-slate-400"}`}>
              These are separate from the page access above — they only matter once this person can already open that page, and control how much they see once they're in it.
            </p>
          </div>
        )}

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className={`flex-1 border text-sm font-semibold py-2.5 rounded-full ${inputCls}`}>
            Cancel
          </button>
          <button onClick={handleSave} className="flex-1 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold py-2.5 rounded-full transition">
            Save Access
          </button>
        </div>
      </div>
    </div>
  );
}