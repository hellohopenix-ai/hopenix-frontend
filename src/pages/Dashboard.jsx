import React, { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth, getRoleCategory } from "../AuthContext.jsx";
import { MessagingSocketProvider } from "../MessagingSocketContext.jsx";
import BirthdayCelebration from "../BirthdayCelebration.jsx";
import {
  Home,
  FolderKanban,
  CheckSquare,
  Users,
  UserCog,
  UserCircle2,
  DollarSign,
  Receipt,
  ShoppingBag,
  FileBarChart2,
  MessageSquare,
  Bell,
  Settings,
  Search,
  Calendar,
  Download,
  Moon,
  Sun,
  ChevronDown,
  MoreHorizontal,
  ShoppingCart,
  ClipboardCheck,
  UserPlus2,
  Sparkles,
  Send,
  Mic,
  Menu,
  X,
  LogOut,
  UserPlus,
  CircleCheck,
  Clock,
  ExternalLink,
  Archive,
  Lock,
  CalendarDays,
  Armchair,
} from "lucide-react";
/* ------------------------------------------------------------------ */
/*  The Hopenix eagle logo - already sitting in src/assets/.            */
/* ------------------------------------------------------------------ */
import logo from "../assets/phoenix-logo.png";
import birthdayTune from "../assets/happy-birthday-voice.mp3";
import MessagesPage, { sendReportMessage } from "./MessagesPage";
import {
  isBirthdayToday,
  queueEmployeeBirthdayMessage,
  getPendingEmployeeBirthdayMessages,
  markBirthdayMessageDelivered,
  isBirthdayMessageAlreadyInConversations,
} from "../birthdayMessageDelivery.js";
import UserPage from "./UserPage";
import TasksPage from "./TasksPage";
import ProjectsPage from "./ProjectsPage";
import EmployeesPage from "./EmployeesPage";
import ClientsPage from "./ClientsPage";
import ExpensesPage from "./ExpensesPage";
import IncomePage from "./IncomePage";
import SalesPage from "./SalesPage";
import SettingsPage from "./SettingsPage";
import ReportsPage from "./ReportsPage";
import ZipFilesPage from "./ZipFilesPage";
import MeetingsPage from "./Meetings";
import CoworkingSpacePage from "./CoworkingSpacePage";
import VisitorsPage from "./VisitorsPage";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

/* ------------------------------------------------------------------ */
/*  REAL BACKEND — Dashboard stats / Most Order by Country.             */
/*  Talks to the Django "dashboard" app (see /api/dashboard/...).       */
/*  Uses the same auth token AuthContext.jsx saves on login             */
/*  ("hopenix_auth_token", sent as "Authorization: Token <key>").       */
/*  If the request fails (backend down, no data yet, etc.) the caller   */
/*  just keeps showing the mock STATS_BY_RANGE / COUNTRY_ORDERS data     */
/*  below, so the UI never breaks.                                      */
/* ------------------------------------------------------------------ */
const DASHBOARD_API_BASE = (import.meta.env?.VITE_API_BASE_URL || "http://127.0.0.1:8000") + "/api/dashboard";

async function dashboardFetch(path) {
  const token = localStorage.getItem("hopenix_auth_token");
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Token ${token}`;
  const res = await fetch(`${DASHBOARD_API_BASE}${path}`, { headers });
  if (!res.ok) throw new Error(`Dashboard API error ${res.status}`);
  return res.json();
}

/* Maps the DATE_RANGE_OPTIONS labels used by the dropdown to the
   ?period= query param the backend understands. */
function rangeToPeriod(range) {
  const r = range.toLowerCase();
  if (r.includes("year")) return "year";
  if (r.includes("quarter")) return "quarter";
  if (r.includes("week")) return "week";
  return "month";
}

/* Maps the growth widget's "2h"/"32h"/"A Week"/"Month" tab labels to the
   backend's ?period= query param. */
function growthPeriodToQuery(p) {
  if (p === "2h") return "2h";
  if (p === "32h") return "32h";
  if (p === "A Week") return "week";
  return "month";
}

/* ------------------------------------------------------------------ */
/*  The Hopenix eagle logo is imported below as logo.png and used in    */
/*  both the sidebar header and the login page.                         */
/* ------------------------------------------------------------------ */

/* Real, simplified world landmass path (equirectangular, viewBox 0 0 200 118) */
const WORLD_MAP_PATH =
  "M74.915,100.594L75.927,101.693L70.007,101.802ZM61.971,96.655L58.783,97.438L60.971,95.5ZM0,104.298L0,104.298L0,104.298L5.582,103.837L12.182,104.665L20.616,104.218L14.674,103.728L18.46,101.639L13.706,101.159L15.926,100.234L24.88,98.514L33.498,98.612L36.698,98.188L44.086,99.069L42.398,97.578L46.48,98.133L50.877,97.796L57.655,98.329L62.573,97.501L62.367,94.638L65.827,96.728L65.577,98.59L60.777,99.81L57.089,99.853L58.133,101.823L66.839,102.999L76.217,102.836L84.139,101.867L80.125,100.757L87.523,99.515L94.281,96.826L99.873,97.033L105.291,96.13L116.195,96.239L118.817,95.292L122.233,95.629L131.309,93.888L134.659,95.02L138.271,94.976L137.749,97.153L148.881,94.018L155.4,94.595L163.114,93.833L167.15,94.562L174.866,94.018L180.828,94.41L190.382,96.533L195.114,97.066L191.242,99.156L192.776,100.985L188.772,102.205L196.236,104.131L199.042,104.164L200,104.298L200,107.235L100,107.235L0,107.235ZM196.122,79.967L194.074,83.147L192.804,82.297ZM197.006,77.321L199.176,78.177L197.784,80.173ZM200,66.433L199.646,66.569L199.674,66.334L200,66.161L200,66.433ZM0,66.161L0,66.161L0,66.433L0,66.433L0,66.433L0,66.161ZM127.809,64.765L126.165,71.091L124.467,71.117L124.693,66.244ZM179.756,64.881L181.326,67.767L184.92,71.272L184.94,74.813L183.332,78.027L181.288,78.922L178.132,78.357L172.96,74.733L165.57,76.715L162.996,70.781L163.416,69.321L167.142,68.17L168.34,66.349L171.312,65.495L173.532,63.417L176.084,64.097L175.238,65.41L178.264,66.884L179.176,63.161ZM174.524,57.875L180.324,59.38L182.63,62.293L179.238,62.416L172.512,57.755ZM169.578,56.446L166.768,57.103L168.424,60.202L165.982,58.792L167.16,56.508ZM158.788,60.486L156.992,59.58L152.99,54.473L154.158,54.32L157.688,57.177ZM165.486,56.22L164.528,59.464L161.236,58.865L160.606,57.49L165.072,53.386ZM178.32,36.6L177.918,37.714L172.77,38.409L177.46,36.004ZM68.815,29.075L70.751,30.826L67.075,30.788ZM98.331,24.66L100.305,29.032L96.791,29.368ZM91.939,20.315L89.635,21.959L86.485,20.784ZM127.283,34.3L127.333,36.356L129.903,36.699L127.947,32.452L125.935,32.452ZM200,21.135L199.996,21.138L199.65,22.245L194.628,23.967L190.856,23.975L190.066,26.76L187.106,28.895L186.352,26.467L190.928,23.268L187.068,23.105L185.676,24.036L179,24.435L175.07,26.83L178.526,27.741L177.812,30.32L174.928,33.125L170.852,35.147L171.922,36.799L170.27,38.129L169.036,35.053L165.296,35.714L167.83,40.661L164.384,44.578L160.29,45.17L158.702,46.647L160.668,50.753L158.376,51.724L155.61,49.786L155.086,51.7L157.434,54.538L157.512,56.554L154.528,52.596L153.98,47.829L150.788,44.587L148.319,45.292L144.625,48.402L143.077,52.809L140.851,48.351L140.349,45.371L136.873,43.11L134.165,43.303L126.653,40.582L128.775,43.89L131.331,43.387L133.225,44.84L132.105,46.642L127.043,49.455L124.157,50.214L123.695,47.915L119.517,41.644L118.185,41.288L121.815,48.389L124.509,51.432L128.395,50.554L125.869,55.648L122.369,58.665L121.555,60.832L122.653,65.397L119.325,68.226L119.467,70.834L115.677,75.442L110.897,76.579L108.451,72.285L106.467,66.497L107.575,63.923L106.619,60.034L104.887,57.852L105.441,55.527L102.403,53.751L95.823,54.824L90.771,50.474L90.521,45.568L91.977,42.649L94.687,40.605L96.705,37.369L105.283,36.485L106.171,38.739L110.603,40.42L111.585,39.064L116.063,40.085L119.037,39.89L120.083,37.334L115.357,36.868L114.539,35.31L123.029,33.543L117.083,31.355L116.003,34.426L112.675,34.748L112.039,36.765L110.855,34.057L107.301,31.825L110.209,34.815L108.563,34.986L104.939,32.587L101.723,33.304L98.807,36.861L95.057,36.752L94.781,33.331L98.943,33.111L99.101,30.21L104.889,27.223L111.815,26.574L112.967,24.353L111.699,22.452L107.191,26.478L105.753,24.196L103.147,24.686L102.773,22.806L110.657,18.448L115.647,17.687L122.385,19.494L119.413,21.449L133.639,18.429L138.061,19.406L137.053,17.774L144.251,17.057L148.425,15.503L161.71,14.618L160.778,16.023L177.706,17.519L178.038,16.763L188.332,17.865L189.412,18.658L194.696,18.291L199.222,18.679L200,18.921L200,21.135ZM0,18.921L0,18.921L0,18.921L5.612,20.581L3.394,21.522L0,21.135L0,21.135L0,18.921ZM200,17.69L200,17.883L199.292,17.736L200,17.504L200,17.69ZM0,17.504L0,17.504L0,17.504L0,17.69L0,17.504ZM49.696,18.625L51.473,19.902L52.489,18.412L54.785,19.951L52.351,20.258L47.644,23.402L48.724,25.52L54.293,26.597L54.777,28.258L57.477,25.827L56.607,22.613L61.339,23.312L62.417,24.894L64.121,23.715L65.667,25.935L69.065,28.264L66.649,29.322L63.113,29.33L64.183,31.547L66.777,31.724L63.687,33.043L61.047,32.966L57.933,36.158L57.929,37.484L54.727,40.162L54.905,43.234L53.495,40.603L47.394,40.857L45.906,42.024L45.626,44.766L47.54,47.154L51.639,45.266L50.595,48.409L53.807,48.903L54.757,52.353L60.333,51.141L65.623,51.281L68.251,53.916L70.621,54.229L72.989,57.365L80.425,60.271L80.485,62.233L78.359,64.898L76.673,69.996L74.183,70.618L72.841,73.165L68.451,77.736L65.369,78.806L63.533,83.477L60.553,87.142L58.363,86.269L57.975,83.15L60.313,75.245L60.905,67.428L57.773,65.373L54.773,59.866L55.505,56.808L57.151,55.096L55.553,53.042L51.295,50.063L47.394,48.234L42.5,47.073L41.094,44.583L36.292,40.478L39.216,44.254L36.408,42.156L34.836,38.876L31.262,35.595L30.796,30.358L25.512,24.944L18.27,23.41L11.982,26.127L12.376,25.252L7.71,23.068L10.678,21.241L6.606,20.751L10.05,18.161L13.01,17.592L24.164,18.958L28.812,18.077L36.724,19.236L47.396,19.422L47.106,17.279ZM36.574,16.612L41.442,16.861L43.9,18.332L37.048,19.159L33.666,17.48ZM51.911,16.591L54.269,16.262L61.785,18.055L61.775,19.057L65.639,20.089L63.881,22.416L61.735,22.607L56.725,20.952L59.271,19.418L56.135,18.253L50.733,18.118ZM33.078,17.568L30.04,17.308L30.6,15.961L35.826,16.416ZM39.882,14.901L40.936,15.566L34.604,15.444ZM131.963,17.945L128.667,17.527L130.907,15.523L137.865,14.491L130.789,17.029ZM47.398,14.402L54.473,15.878L48.654,15.659ZM110.139,12.956L109.511,14.563L105.803,12.983ZM155.522,13.412L150.656,12.601L153.3,12.096ZM51.657,12.98L48.402,13.71L46.272,12.702L48.66,12.092ZM61.945,11.064L65.615,11.478L55.245,14.914L50.283,14.75L52.725,13.154L49.118,11.738L55.941,11.051ZM84.945,10.835L88.419,11.276L82.277,11.568L87.129,12.15L93.217,12.073L89.053,13.484L89.237,15.96L86.513,16.903L87.585,18.274L77.883,20.869L75.901,23.847L73.187,23.425L70.017,19.908L69.601,16.909L67.453,15.281L61.943,14.979L59.357,13.661L68.219,11.573L80.507,10.765Z";

/* Approximate [lat, lon] for common country codes (flagcdn.com's lowercase
   ISO 3166-1 alpha-2, same codes the backend already sends as countryCode) —
   used to place the "Most Order by Country" map marker on whichever country
   actually tops the real data, instead of it always being the US. Falls
   back to the original US position for any code not in this table. */
const COUNTRY_COORDS = {
  us: [38.9, -77.0], gb: [51.5, -0.13], ca: [45.4, -75.7], au: [-35.3, 149.1],
  de: [52.5, 13.4], fr: [48.85, 2.35], es: [40.4, -3.7], it: [41.9, 12.5],
  nl: [52.4, 4.9], pk: [33.7, 73.1], in: [28.6, 77.2], cn: [39.9, 116.4],
  jp: [35.7, 139.7], kr: [37.6, 127.0], ae: [24.5, 54.4], sa: [24.7, 46.7],
  qa: [25.3, 51.5], tr: [39.9, 32.9], eg: [30.0, 31.2], za: [-25.7, 28.2],
  ng: [9.1, 7.5], br: [-15.8, -47.9], mx: [19.4, -99.1], ru: [55.75, 37.6],
  se: [59.3, 18.1], no: [59.9, 10.75], dk: [55.7, 12.6], ch: [46.9, 7.45],
  sg: [1.35, 103.8], my: [3.15, 101.7], id: [-6.2, 106.85], ph: [14.6, 121.0],
  th: [13.75, 100.5], vn: [21.0, 105.85], bd: [23.8, 90.4], ir: [35.7, 51.4],
  iq: [33.3, 44.4], kw: [29.4, 48.0], nz: [-41.3, 174.8], ie: [53.35, -6.25],
  pl: [52.25, 21.0], pt: [38.7, -9.1], gr: [37.98, 23.7], be: [50.85, 4.35],
};

function projectLatLon(lat, lon) {
  return { xPct: ((lon + 180) / 360) * 100, yPct: ((90 - lat) / 180) * 100 };
}

// Kept as the fallback position (and name for this file's original
// comments) — the projected US point above, used when a country's code
// isn't in COUNTRY_COORDS or no order data has loaded at all yet.
const USA_MARKER = projectLatLon(...COUNTRY_COORDS.us);

function countryMarkerPosition(countryCode) {
  const coords = COUNTRY_COORDS[(countryCode || "").toLowerCase()];
  return coords ? projectLatLon(coords[0], coords[1]) : USA_MARKER;
}

/* Builds a "Sep 1 - Sep 30, 2026" style label for a given month, using
   the REAL current date instead of a hardcoded string. */
function formatMonthRange(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const startLabel = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const endLabel = end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${startLabel} - ${endLabel}`;
}

const TODAY = new Date();
const DATE_RANGE_OPTIONS = [
  formatMonthRange(TODAY),
  formatMonthRange(new Date(TODAY.getFullYear(), TODAY.getMonth() - 1, 1)),
  formatMonthRange(new Date(TODAY.getFullYear(), TODAY.getMonth() - 2, 1)),
  "This Week",
  "This Month",
  "This Quarter",
  "This Year",
];

/* ------------------------------------------------------------------ */
/*  SIDEBAR "NEW ACTIVITY" RED DOTS                                    */
/*  ProjectsPage and TasksPage each already maintain their own          */
/*  localStorage flag map + CustomEvent whenever someone new gets       */
/*  assigned (see ASSIGNMENT_STORAGE_KEY/ASSIGNMENT_EVENT in            */
/*  ProjectsPage.jsx and TASK_NOTIFY_STORAGE_KEY/"tasks:assignment" in  */
/*  TasksPage.jsx). This dashboard just needs to read those same keys   */
/*  for the logged-in user's name and light up a dot on the matching    */
/*  sidebar item — the pages themselves already clear their own flag    */
/*  the moment that user opens Projects/Tasks (see the clear-on-mount   */
/*  effects in those files), which re-fires the same events and lets    */
/*  this component pick up the "cleared" state automatically.           */
/* ------------------------------------------------------------------ */
const PROJECTS_ASSIGNMENT_KEY = "hopenix_new_assignments_v1";
const PROJECTS_ASSIGNMENT_EVENT = "hopenix:assignments-changed";
const TASKS_ASSIGNMENT_KEY = "sidebar_task_notifications_v1";
const TASKS_ASSIGNMENT_EVENT = "tasks:assignment";

function hasFlagForUser(storageKey, name) {
  if (!name) return false;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return false;
    const flags = JSON.parse(raw);
    return !!flags[name];
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  GENERIC "SOMETHING HAPPENED HERE" DOT — any sidebar page             */
/*  NEW: the flags above only ever cover Projects/Tasks (assignment)     */
/*  and Messages (unread count). This adds ONE shared, page-label-keyed  */
/*  store that ANY page can write to via flagPageActivity() so a red dot */
/*  can show up next to ANY sidebar item (Clients, Employees, Income,    */
/*  Sales, ...) whenever something happens there — not just those three. */
/*  A flag can target one specific person (forUser — e.g. "you were      */
/*  assigned this client") and/or every admin/manager (forAdmin — e.g.   */
/*  "a new client signed up"), so both roles can be told apart, matching */
/*  the ask that admin AND the affected user both get an easy visual cue.*/
/*  Clearing happens generically right here in Dashboard the moment that */
/*  nav item is clicked — see the onClick below — so no other page file  */
/*  needs its own "clear on open" effect for this layer to work.         */
/*  NOTE: this only lights up for pages whose own file actually calls    */
/*  flagPageActivity(...) when something happens — Projects/Tasks/       */
/*  Messages keep working exactly as before via the flags above; wiring  */
/*  this into any OTHER page (Clients, Employees, Income, ...) means     */
/*  adding one flagPageActivity(...) call in that page's own file.       */
/* ------------------------------------------------------------------ */
const PAGE_ACTIVITY_KEY = "hopenix_page_activity_v1";
const PAGE_ACTIVITY_EVENT = "hopenix:page-activity-changed";

function readPageActivity() {
  try {
    const raw = localStorage.getItem(PAGE_ACTIVITY_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writePageActivity(map) {
  try {
    localStorage.setItem(PAGE_ACTIVITY_KEY, JSON.stringify(map));
    window.dispatchEvent(new Event(PAGE_ACTIVITY_EVENT));
  } catch {
    // storage unavailable — dot just won't persist/cross-tab this time
  }
}

// Any page can call this when something happens that admin and/or a
// specific person should notice, e.g.:
//   flagPageActivity("Clients", { forUser: "Ali Raza" })   // assigned to Ali
//   flagPageActivity("Sales", { forAdmin: true })          // new sale, tell admins
export function flagPageActivity(pageLabel, { forUser, forAdmin } = {}) {
  const map = readPageActivity();
  const entry = map[pageLabel] || { byUser: {}, forAdmin: false };
  const nextEntry = { ...entry, byUser: { ...entry.byUser } };
  if (forUser) nextEntry.byUser[forUser] = true;
  if (forAdmin) nextEntry.forAdmin = true;
  writePageActivity({ ...map, [pageLabel]: nextEntry });
}

function clearPageActivity(pageLabel, { name, isAdminOrManager }) {
  const map = readPageActivity();
  const entry = map[pageLabel];
  if (!entry) return;
  const nextEntry = { ...entry, byUser: { ...entry.byUser } };
  if (name) delete nextEntry.byUser[name];
  if (isAdminOrManager) nextEntry.forAdmin = false;
  writePageActivity({ ...map, [pageLabel]: nextEntry });
}

function hasPageActivityFlag(pageLabel, { name, isAdminOrManager }) {
  const entry = readPageActivity()[pageLabel];
  if (!entry) return false;
  if (name && entry.byUser && entry.byUser[name]) return true;
  if (isAdminOrManager && entry.forAdmin) return true;
  return false;
}

// Every real "this page's own data changed" localStorage key, gathered
// straight from each page's own file (ClientsPage.jsx, EmployeesPage.jsx,
// ProjectsPage.jsx, ReportsPage.jsx, SalesPage.jsx, ExpensesPage.jsx,
// UserPage.jsx, SettingsPage.jsx, ClientPortal.jsx) — mapped key -> the
// sidebar label that data belongs to. This lets Dashboard watch every page
// directly, with zero edits to any of those files: the native "storage"
// event only ever fires for a change made in a DIFFERENT tab, which is
// exactly "someone else just did something there".
//   - IncomePage.jsx saves nothing of its own (purely derived), so there's
//     no key to watch for Income.
//   - hopenix_projects_data_v1 is written by BOTH ProjectsPage.jsx and
//     ZipFilesPage.jsx (a zip upload writes the whole projects array back)
//     — there's no separate "zip files only" key, so a zip upload currently
//     surfaces as a Projects dot too.
//   - UserPage.jsx only owns its own ROLES_STORAGE_KEY here; the actual
//     user-account list lives in AuthContext.jsx, which wasn't shared, so
//     new-user-approval activity itself isn't covered yet.
//   - Purely-session/UI-focus keys (zip files' unlock session, reports'
//     "last viewed project" pointer, client portal's remembered-login /
//     session token) are left out on purpose — those aren't someone DOING
//     something, just navigating around.
const KNOWN_PAGE_STORAGE_KEYS = {
  // Clients
  clientspage_clients_v1: "Clients",
  // Employees (main list + announcements + holidays)
  employeespage_employees_v2: "Employees",
  employeespage_announcements_v1: "Employees",
  employeespage_holidays_v1: "Employees",
  // Projects (see zip-files note above)
  hopenix_projects_data_v1: "Projects",
  // Tasks — on top of the existing, more precise per-assignment dot
  taskspage_tasks_v1: "Tasks",
  // Reports
  reportspage_daily_reports_v1: "Reports",
  // Sales
  sales_data_v1: "Sales",
  // Expenses (entries + custom categories)
  expenses_data_v1: "Expenses",
  expenses_custom_categories_v1: "Expenses",
  // Users (role changes)
  userpage_roles_v1: "Users",
  // Settings — every section this page saves
  hopenix_company: "Settings",
  hopenix_profile: "Settings",
  settingspage_team_demo_v1: "Settings",
  hopenix_departments: "Settings",
  hopenix_project_settings: "Settings",
  hopenix_task_settings: "Settings",
  hopenix_income_settings: "Settings",
  hopenix_expense_settings: "Settings",
  hopenix_sales_settings: "Settings",
  hopenix_notifications: "Settings",
  hopenix_security: "Settings",
  hopenix_billing: "Settings",
  hopenix_storage_used: "Settings",
  // Client Portal — a client sending a message from their own portal login
  clientportal_messages_v1: "Client Portal",
};

const NAV_ITEMS = [
  { label: "Dashboard", icon: Home },
  { label: "Projects", icon: FolderKanban },
  { label: "Messages", icon: MessageSquare },
  { label: "Zip Files", icon: Archive },
  { label: "Tasks", icon: CheckSquare },
  { label: "Meetings", icon: CalendarDays },
  { label: "Visitors", icon: UserPlus2 },
  { label: "Clients", icon: Users },
  { label: "Client Portal", icon: ExternalLink },
  { label: "Employees", icon: UserCog },
  { label: "Users", icon: UserCircle2 },
  { label: "Income", icon: DollarSign },
  { label: "Expenses", icon: Receipt },
  { label: "Sales", icon: ShoppingBag },
  { label: "Reports", icon: FileBarChart2 },
  { label: "Coworking Space", icon: Armchair },
  { label: "Settings", icon: Settings },
];

const STAT_CARDS = [
  { label: "Total Sales", icon: ShoppingCart, hero: true, page: "Sales" },
  { label: "Total Purchase", icon: ShoppingCart, hero: false, page: "Expenses" },
  { label: "Total Profit", icon: ClipboardCheck, hero: false, page: "Income" },
  { label: "New Customers", icon: UserPlus2, hero: false, page: "Clients" },
];

/* Per-date-range values for the stat cards, keyed the same way as
   DATE_RANGE_OPTIONS. Order within each array matches STAT_CARDS
   (Total Sales, Total Purchase, Total Profit, New Customers). Selecting
   a different date range swaps these values into the cards above. */
const STATS_BY_RANGE = {
  "May 1 - May 31, 2025": [
    { value: "$542,376", delta: "+ 22%" },
    { value: "$275,920", delta: "+ 8%" },
    { value: "$266,456", delta: "+ 18%" },
    { value: "145", delta: "+ 25%" },
  ],
  "Apr 1 - Apr 30, 2025": [
    { value: "$498,120", delta: "+ 15%" },
    { value: "$261,340", delta: "+ 5%" },
    { value: "$236,780", delta: "+ 12%" },
    { value: "128", delta: "+ 18%" },
  ],
  "Mar 1 - Mar 31, 2025": [
    { value: "$431,860", delta: "+ 9%" },
    { value: "$248,910", delta: "+ 3%" },
    { value: "$182,950", delta: "+ 7%" },
    { value: "112", delta: "+ 11%" },
  ],
  "This Week": [
    { value: "$38,240", delta: "+ 4%" },
    { value: "$19,860", delta: "+ 2%" },
    { value: "$18,380", delta: "+ 3%" },
    { value: "9", delta: "+ 6%" },
  ],
  "This Month": [
    { value: "$542,376", delta: "+ 22%" },
    { value: "$275,920", delta: "+ 8%" },
    { value: "$266,456", delta: "+ 18%" },
    { value: "145", delta: "+ 25%" },
  ],
  "This Quarter": [
    { value: "$1,472,356", delta: "+ 17%" },
    { value: "$786,170", delta: "+ 6%" },
    { value: "$686,186", delta: "+ 14%" },
    { value: "385", delta: "+ 19%" },
  ],
  "This Year": [
    { value: "$5,614,902", delta: "+ 31%" },
    { value: "$2,984,510", delta: "+ 11%" },
    { value: "$2,630,392", delta: "+ 26%" },
    { value: "1,540", delta: "+ 34%" },
  ],
};

const SALES_DATA = [
  { day: "May 1", sales: 4200, base: 3000 },
  { day: "May 3", sales: 9800, base: 5200 },
  { day: "May 6", sales: 15200, base: 9000 },
  { day: "May 9", sales: 19000, base: 12500 },
  { day: "May 11", sales: 16500, base: 15200 },
  { day: "May 14", sales: 24000, base: 17600 },
  { day: "May 16", sales: 30500, base: 20200 },
  { day: "May 19", sales: 27000, base: 23400 },
  { day: "May 21", sales: 33500, base: 26000 },
  { day: "May 24", sales: 38200, base: 28800 },
  { day: "May 26", sales: 34800, base: 31200 },
  { day: "May 29", sales: 40500, base: 33600 },
  { day: "May 31", sales: 37200, base: 36000 },
];

/* User Growth card: total users, % change, progress-bar fill and note text
   for each selectable period ("2h", "32h", "A Week", "Month"). Clicking a
   period button swaps in the matching dataset below. */
const USER_GROWTH_BY_PERIOD = {
  "2h": { total: "1,240", delta: "+ 4%", progress: 22, note: "Checking last 2 hours", highlightNote: "+18 just now" },
  "32h": { total: "18,650", delta: "+ 12%", progress: 45, note: "Checking last 32 hours", highlightNote: "+640 today" },
  "A Week": { total: "142,300", delta: "+ 19%", progress: 58, note: "Checking this week", highlightNote: "+5,120 this week" },
  "Month": { total: "205,890", delta: "+ 22%", progress: 68, note: "Checking totally", highlightNote: "+210 today" },
};

/* Statistics card: two metrics ("Customer Satisfaction" / "Visitor height"),
   each with a Weekly / Monthly / Yearly breakdown. Switching the metric
   toggle or the period dropdown swaps in the matching dataset. */
const STATS_DATASETS = {
  "Customer Satisfaction": {
    Weekly: {
      headline: "+76%",
      note: "Customer satisfaction increases every week",
      bars: [
        { day: "Mon", value: 30, delta: "+10%" },
        { day: "Tue", value: 42, delta: "+18%" },
        { day: "Wed", value: 55, delta: "+28%" },
        { day: "Thu", value: 92, delta: "+48%" },
        { day: "Fri", value: 68, delta: "+60%" },
        { day: "Sat", value: 50, delta: "+78%" },
        { day: "Sun", value: 78, delta: "+89%" },
      ],
    },
    Monthly: {
      headline: "+64%",
      note: "Customer satisfaction increases every month",
      bars: [
        { day: "Week 1", value: 40, delta: "+12%" },
        { day: "Week 2", value: 55, delta: "+24%" },
        { day: "Week 3", value: 70, delta: "+41%" },
        { day: "Week 4", value: 85, delta: "+58%" },
      ],
    },
    Yearly: {
      headline: "+58%",
      note: "Customer satisfaction increases year over year",
      bars: [
        { day: "Q1", value: 45, delta: "+9%" },
        { day: "Q2", value: 58, delta: "+22%" },
        { day: "Q3", value: 70, delta: "+35%" },
        { day: "Q4", value: 82, delta: "+50%" },
      ],
    },
  },
  "Visitor height": {
    Weekly: {
      headline: "+41%",
      note: "Visitor height increases every week",
      bars: [
        { day: "Mon", value: 25, delta: "+3%" },
        { day: "Tue", value: 38, delta: "+9%" },
        { day: "Wed", value: 50, delta: "+15%" },
        { day: "Thu", value: 64, delta: "+22%" },
        { day: "Fri", value: 72, delta: "+29%" },
        { day: "Sat", value: 46, delta: "+33%" },
        { day: "Sun", value: 58, delta: "+41%" },
      ],
    },
    Monthly: {
      headline: "+35%",
      note: "Visitor height increases every month",
      bars: [
        { day: "Week 1", value: 32, delta: "+8%" },
        { day: "Week 2", value: 48, delta: "+16%" },
        { day: "Week 3", value: 60, delta: "+26%" },
        { day: "Week 4", value: 74, delta: "+35%" },
      ],
    },
    Yearly: {
      headline: "+29%",
      note: "Visitor height increases year over year",
      bars: [
        { day: "Q1", value: 38, delta: "+6%" },
        { day: "Q2", value: 46, delta: "+14%" },
        { day: "Q3", value: 55, delta: "+21%" },
        { day: "Q4", value: 63, delta: "+29%" },
      ],
    },
  },
};

const STATS_PERIOD_OPTIONS = ["Weekly", "Monthly", "Yearly"];

/* Real avatars + real flag images (flagcdn.com) instead of colored initials
   and a lone emoji, so the "Most Order by Country" card reads as genuine data. */
const COUNTRY_ORDERS = [
  {
    name: "Jenny",
    text: "placed a large order value in",
    amount: "$120",
    rank: 1,
    city: "San Francisco",
    countryCode: "us",
    avatar: "https://i.pravatar.cc/64?img=47",
  },
  {
    name: "Paul",
    text: "purchase item value order in",
    amount: "$980",
    rank: 2,
    city: "Los Angeles",
    countryCode: "us",
    avatar: "https://i.pravatar.cc/64?img=12",
  },
  {
    name: "Mike",
    text: "made repeat order value order in",
    amount: "$820",
    rank: 3,
    city: "San Diego",
    countryCode: "us",
    avatar: "https://i.pravatar.cc/64?img=33",
  },
];

const NOTIFICATIONS = [
  { id: 1, title: "New order received", desc: "Jenny placed an order worth $120", time: "2m ago" },
  { id: 2, title: "Payment completed", desc: "Invoice #2291 has been paid", time: "1h ago" },
  { id: 3, title: "New client added", desc: "Paul was added as a new client", time: "3h ago" },
];

// Turns the real notifications endpoint's ISO timestamp into the same
// "2m ago" / "3h ago" style the (now fallback-only) mock array above
// used, so the dropdown's rendering doesn't need two different code
// paths for real vs demo data.
function timeAgo(isoString) {
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const STATUS_STYLES = {
  pending: "bg-amber-50 text-amber-600",
  approved: "bg-emerald-50 text-emerald-600",
  rejected: "bg-rose-50 text-rose-600",
};

/* -------------------------------------------------------------------------
 * SEED_CONVERSATIONS — the Messages data. This used to live inside
 * MessagesPage.jsx as local state, but it's lifted up here so the AI
 * Assistant panel (below) and the Messages page both read/write the same
 * data: sending a message from the AI Assistant shows up instantly in
 * Messages, and vice versa.
 * ---------------------------------------------------------------------- */
/* FIX (fictional auto DPs): every "avatar" in this app used to default to
   a randomly-picked stranger's stock photo from i.pravatar.cc whenever a
   user/contact had no real uploaded picture — Ali Raza, Sara Khan, the
   logged-in admin, any newly added user, all got a fictional face that
   isn't actually them. Every one of those fallbacks now uses this
   instead: a small, locally-generated image containing just that
   person's initials on a colored circle. It's still a real `data:` image
   (not a broken link), so every existing `<img src={avatar} />` in the
   app keeps working exactly as before — it just never shows a fake photo
   of someone who doesn't exist. A person's actual uploaded profile photo
   (via Settings) always takes priority over this. */
const AVATAR_COLORS = ["#7c3aed", "#2563eb", "#0891b2", "#059669", "#d97706", "#dc2626", "#db2777", "#4f46e5"];
function avatarInitials(name) {
  return (name || "?")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";
}
function avatarColorFor(name) {
  const s = name || "";
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
function initialsAvatarDataUrl(name) {
  const bg = avatarColorFor(name);
  const label = avatarInitials(name);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" rx="64" fill="${bg}"/><text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="52" font-weight="700" fill="#ffffff">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const SEED_CONVERSATIONS = [
  {
    id: "usman-ahmad",
    name: "Usman Ahmad",
    role: "Backend Developer",
    avatar: initialsAvatarDataUrl("Usman Ahmad"),
    status: "Active",
    time: "10:30 AM",
    unread: 2,
    email: "usman.ahmad@hopenix.com",
    phone: "+92 300 1234567",
    location: "Lahore, Pakistan",
    files: [
      { name: "Project_Update_May_2025.pdf", size: "2.4 MB", date: "May 26, 2025", type: "pdf" },
      { name: "API_Documentation.docx", size: "1.1 MB", date: "May 24, 2025", type: "doc" },
      { name: "Design_Reference.png", size: "3.2 MB", date: "May 20, 2025", type: "img" },
    ],
    assignments: [
      { name: "E-commerce Website", status: "In Progress" },
      { name: "CRM System", status: "Completed" },
      { name: "Inventory Management", status: "In Progress" },
    ],
    messages: [
      { id: 1, text: "Hi Usman, please review the project update I've shared and let me know your feedback.", time: "10:25 AM", outgoing: true },
      { id: 2, text: "Sure, I'll check it and get back to you.", time: "10:26 AM", outgoing: false },
      { id: 3, file: { name: "Project_Update_May_2025.pdf", size: "2.4 MB", isImage: false }, time: "10:27 AM", outgoing: true },
      { id: 4, text: "Thanks! I've reviewed it. Everything looks good. Just one small change in the API response.", time: "10:28 AM", outgoing: false },
      { id: 5, text: "Noted. Please update the task in the project and assign it to the team.", time: "10:29 AM", outgoing: true },
      { id: 6, text: "Done. Task updated.", time: "10:30 AM", outgoing: false },
    ],
  },
  {
    id: "ali-raza",
    name: "Ali Raza",
    role: "UI/UX Designer",
    avatar: initialsAvatarDataUrl("Ali Raza"),
    status: "Away",
    time: "10:15 AM",
    unread: 1,
    email: "ali.raza@hopenix.com",
    phone: "+92 301 5551234",
    location: "Karachi, Pakistan",
    files: [{ name: "Design_Handoff.fig", size: "5.6 MB", date: "May 24, 2025", type: "doc" }],
    assignments: [{ name: "E-commerce Website", status: "In Progress" }],
    messages: [{ id: 1, text: "The design is complete, sharing the files now.", time: "10:15 AM", outgoing: false }],
  },
  {
    id: "sara-khan",
    name: "Sara Khan",
    role: "Project Manager",
    avatar: initialsAvatarDataUrl("Sara Khan"),
    status: "Active",
    time: "Yesterday",
    unread: 3,
    email: "sara.khan@hopenix.com",
    phone: "+92 302 5559876",
    location: "Islamabad, Pakistan",
    files: [],
    assignments: [{ name: "CRM System", status: "Completed" }],
    messages: [{ id: 1, text: "Can we schedule a meeting for tomorrow?", time: "Yesterday", outgoing: false }],
  },
  {
    id: "zain-ali",
    name: "Zain Ali",
    role: "QA Engineer",
    avatar: initialsAvatarDataUrl("Zain Ali"),
    status: "Offline",
    time: "Yesterday",
    unread: 0,
    email: "zain.ali@hopenix.com",
    phone: "+92 303 5552468",
    location: "Faisalabad, Pakistan",
    files: [],
    assignments: [{ name: "Inventory Management", status: "In Progress" }],
    messages: [{ id: 1, text: "Task status updated.", time: "Yesterday", outgoing: false }],
  },
  {
    id: "ayesha-noor",
    name: "Ayesha Noor",
    role: "Accountant",
    avatar: initialsAvatarDataUrl("Ayesha Noor"),
    status: "Active",
    time: "May 25",
    unread: 0,
    email: "ayesha.noor@hopenix.com",
    phone: "+92 304 5553698",
    location: "Lahore, Pakistan",
    files: [],
    assignments: [],
    messages: [{ id: 1, text: "Income report for May is ready.", time: "May 25", outgoing: false }],
  },
].map((c) => ({ unreadForUser: 0, ...c }));

const QUICK_COMMANDS = [
  "Give me sales report of last month",
  "Send message to all members: Team meeting today at 5 PM",
  "Send message to Usman Ahmad: Please review the update",
  "Show me this month profit",
  "Add expense of 100 petrol",
];

const INITIAL_MESSAGES = [
  { from: "ai", text: "Sure! I can help with that. What would you like to do?", time: "10:30 AM" },
];

/* -------------------------------------------------------------------------
 * Seed data used by the AI Assistant panel's own expense/income commands
 * (see pushExpense / pushIncome below) and by the PDF export. The
 * Expenses and Income *pages* themselves are now the full standalone
 * ExpensesPage.jsx / IncomePage.jsx components (imported above, same
 * pattern as Users/Tasks/Projects/Employees/Clients) and manage their own
 * display data — this seed just keeps the AI Assistant + PDF export
 * working without needing to reach into those pages' internals.
 * ---------------------------------------------------------------------- */
const SEED_EXPENSES = [
  { id: 1, note: "Office rent", category: "Rent", amount: 1200, date: "May 1, 2025", addedVia: "Manual" },
  { id: 2, note: "Team lunch", category: "Food", amount: 85, date: "May 6, 2025", addedVia: "Manual" },
  { id: 3, note: "Software subscriptions", category: "Software", amount: 249, date: "May 12, 2025", addedVia: "Manual" },
  { id: 4, note: "Office supplies", category: "Supplies", amount: 60, date: "May 18, 2025", addedVia: "Manual" },
];

const SEED_INCOME = [
  { id: 1, note: "Website project — Al Falah Traders", category: "Project", amount: 3200, date: "May 3, 2025", addedVia: "Manual" },
  { id: 2, note: "CRM System — final payment", category: "Project", amount: 1800, date: "May 15, 2025", addedVia: "Manual" },
  { id: 3, note: "Consulting retainer", category: "Retainer", amount: 900, date: "May 20, 2025", addedVia: "Manual" },
];

/* -------------------------------------------------------------------------
 * AI ASSISTANT COMMAND PARSING
 * The assistant recognises these kinds of typed commands:
 *   1. Broadcast — "send message to all members: ..." / "broadcast: ..." /
 *      "sab ko bhej do ..." -> appends the message to every conversation.
 *   2. Individual — "send message to <Name>: ..." / "<Name> ko bhej do: ..."
 *      -> appends the message to just that person's conversation.
 *   3. Add expense — "add expense of 100 petrol" / "expense of $50 for fuel"
 *      -> appends a real row to the Expenses ledger.
 *   4. Add income — "add income of 500 from client x" -> appends a real
 *      row to the Income ledger.
 *   5. Sales report — "give me sales report" / "show sales" etc. -> answers
 *      with the real numbers for whatever date range is currently selected
 *      on the Dashboard, instead of a canned line.
 * Anything else falls through to the existing keyword-based respond().
 * ---------------------------------------------------------------------- */
const BROADCAST_TRIGGERS = [
  /^send\s+(this\s+|the\s+)?(msg|message)?\s*to\s+all(\s+members)?[:\-,]?\s*/i,
  /^send\s+(this\s+|the\s+)?(msg|message)?\s*to\s+everyone[:\-,]?\s*/i,
  /^(msg|message)\s+all(\s+members)?[:\-,]?\s*/i,
  /^(msg|message)\s+everyone[:\-,]?\s*/i,
  /^broadcast[:\-,]?\s*/i,
  /^send\s+to\s+all(\s+members)?[:\-,]?\s*/i,
  /* Roman-Urdu: "sab/tamam/pura/poora/all" + optional "members/logo/team/staff"
     + "ko" + any of bhej do / bhejo / send karo / msg karo / message karo /
     karo / kro (with or without a leading verb word). Covers phrasings like
     "sab ko msg karo", "sab members ko msg karo", "tamam logo ko bhej do". */
  /^(sab|tamam|pura|poora|all)\s*(members|logo|logon|team|staff)?\s*ko\s*(bhej\s*|send\s*|msg\s*|message\s*)?(kar(o|do)?|kro|do|bhejo)[:\-,]?\s*/i,
];

/* Matches: "add expense of 100 petrol", "expense of $50 for fuel",
   "add expense 200 for office supplies", "expense 100 petrol",
   "3000 ka kharcha hua petrol ka", "kharcha kiya 500 lunch ka". */
const EXPENSE_PATTERNS = [
  /^add\s+expense\s+(?:of\s+)?\$?(\d+(?:\.\d+)?)\s*(?:for\s+|on\s+)?(.*)$/i,
  /^expense\s+(?:of\s+)?\$?(\d+(?:\.\d+)?)\s*(?:for\s+|on\s+)?(.*)$/i,
  /^add\s+(\d+(?:\.\d+)?)\s*(?:rs\.?|rupees|pkr|dollars?|\$)?\s*expense\s*(?:for\s+|on\s+)?(.*)$/i,
  // Roman Urdu, amount can come before OR after the keyword: "3000 ka
  // kharcha hua (petrol ka)" / "kharcha kiya 3000 (petrol ke liye)".
  /\b(\d+(?:\.\d+)?)\s*(?:rs\.?|rupees|pkr|\$)?\s*(?:ka|ki|ke)?\s*(?:kharcha|kharch|expense)\b\s*(?:hua|kiya|kia|tha)?\s*(?:for\s+|on\s+)?(.*)$/i,
  /\b(?:kharcha|kharch|expense)\b\s*(?:hua|kiya|kia|tha)?\s*(?:of\s+|for\s+|on\s+)?\$?(\d+(?:\.\d+)?)\s*(?:rs\.?|rupees|pkr|\$)?\s*(?:for\s+|on\s+|ka\s+|ki\s+|ke\s+liye\s+)?(.*)$/i,
];

/* Matches: "add income of 500 from client x", "income of $300 from acme",
   "add income 500 for consulting", "aj mujhe hand payment mein 5000 aye",
   "cash mein 3000 mile", "5000 ki income hui". */
const INCOME_PATTERNS = [
  /^add\s+income\s+(?:of\s+)?\$?(\d+(?:\.\d+)?)\s*(?:for\s+|from\s+)?(.*)$/i,
  /^income\s+(?:of\s+)?\$?(\d+(?:\.\d+)?)\s*(?:for\s+|from\s+)?(.*)$/i,
  // "... hand payment/cash/nakad mein <amount> aye/mile/mila/receive(d)"
  // or "... <amount> hand payment/cash mein aye" — either order.
  /\b(?:hand\s*payment|cash|nakad)\s*(?:mein|me)?\s*\$?(\d+(?:\.\d+)?)\s*(?:rs\.?|rupees|pkr|\$)?\s*(?:aye|aaye|mila|mile|mili|receive[d]?)?/i,
  /\b\$?(\d+(?:\.\d+)?)\s*(?:rs\.?|rupees|pkr|\$)?\s*(?:hand\s*payment|cash|nakad)\s*(?:mein|me)?\s*(?:aye|aaye|mila|mile|mili|receive[d]?)?/i,
  // "<amount> ki/ka income/amdani hui/hua"
  /\b\$?(\d+(?:\.\d+)?)\s*(?:rs\.?|rupees|pkr|\$)?\s*(?:ki|ka)?\s*(?:income|amdani|aamdani)\b\s*(?:hui|hua)?\s*(?:for\s+|from\s+|ka\s+|ki\s+)?(.*)$/i,
];

function findConversationByName(candidate, conversations) {
  const needle = candidate.trim().toLowerCase();
  if (!needle) return null;
  // Peer conversations (direct chats between two non-admin users) carry no
  // single top-level `name` in the raw state — their display identity is
  // only resolved per-viewer in visibleConversations — so they're not
  // something the (admin-only) AI Assistant command parser can target.
  const named = conversations.filter((c) => typeof c.name === "string");
  return (
    named.find((c) => c.name.toLowerCase() === needle) ||
    named.find((c) => c.name.toLowerCase().includes(needle)) ||
    named.find((c) => needle.includes(c.name.toLowerCase().split(" ")[0])) ||
    null
  );
}

/* Turns "petrol" / "for petrol" / "" into a clean, capitalized note used
   both in the ledger row and in the AI's reply. */
function cleanNote(raw, fallback) {
  const trimmed = (raw || "").trim();
  if (!trimmed) return fallback;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/* Returns one of:
 *   { type: "broadcast", message }
 *   { type: "broadcast_empty" }  // broadcast phrase used but no message text followed
 *   { type: "individual", targetId, targetName, message }
 *   { type: "individual_empty", targetId, targetName }  // name matched but no message text followed
 *   { type: "add_expense", amount, note }
 *   { type: "add_income", amount, note }
 *   { type: "sales_report" }
 *   { type: "none" }
 */
function parseAiCommand(rawText, conversations) {
  const trimmed = rawText.trim();
  const lower = trimmed.toLowerCase();

  for (const pattern of BROADCAST_TRIGGERS) {
    if (pattern.test(trimmed)) {
      const message = trimmed.replace(pattern, "").trim();
      if (message) return { type: "broadcast", message };
      return { type: "broadcast_empty" };
    }
  }

  let m = trimmed.match(/^send\s+(?:this\s+|the\s+)?(?:msg|message)?\s*to\s+(.+?)[:,\-]\s*(.+)$/i);
  if (m) {
    const target = findConversationByName(m[1], conversations);
    if (target && m[2].trim()) {
      return { type: "individual", targetId: target.id, targetName: target.name, message: m[2].trim() };
    }
  }

  /* Roman-Urdu: "<Name> ko bhej do / bhejo / send karo / msg karo /
     message karo / karo / kro ..." — same flexible verb set as the
     broadcast trigger, just aimed at one person instead of "sab/all". */
  m = trimmed.match(/^(.+?)\s+ko\s+(?:bhej\s*|send\s*|msg\s*|message\s*)?(?:kar(?:o|do)?|kro|do|bhejo)[:,\-]?\s*(.*)$/i);
  if (m) {
    const target = findConversationByName(m[1], conversations);
    if (target) {
      const message = m[2].trim();
      if (message) return { type: "individual", targetId: target.id, targetName: target.name, message };
      return { type: "individual_empty", targetId: target.id, targetName: target.name };
    }
  }

  for (const pattern of EXPENSE_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      const amount = parseFloat(match[1]);
      if (!Number.isNaN(amount)) {
        return { type: "add_expense", amount, note: cleanNote(match[2], "General expense") };
      }
    }
  }

  for (const pattern of INCOME_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      const amount = parseFloat(match[1]);
      if (!Number.isNaN(amount)) {
        const defaultNote = /\b(hand\s*payment|cash|nakad)\b/i.test(trimmed) ? "Hand payment" : "General income";
        return { type: "add_income", amount, note: cleanNote(match[2], defaultNote) };
      }
    }
  }

  if (/\bsales\s*report\b|\breport\s+of\s+sales\b|\bshow\s+(me\s+)?sales\b/i.test(lower)) {
    return { type: "sales_report" };
  }

  // NEW — expense/income QUERIES ("expense kitna hua is month?", "how
  // much expense this month", "income kitni hui", "expense/income
  // report/batao") — answered from the real ledger, not a canned line.
  // Checked only after the ADD patterns above so an actual amount in the
  // message (e.g. "3000 ka kharcha hua") is always logged as a new entry
  // first, not mistaken for a question about existing totals.
  const asksHowMuch = /\b(kitna|kitni|kitne|how\s*much|total)\b/i.test(lower);
  const asksToShow = /\b(batao|bata\s*do|dikhao|dikha\s*do|show|report)\b/i.test(lower);
  if (/\b(expense|kharcha|kharch)\b/i.test(lower) && (asksHowMuch || asksToShow)) {
    return { type: "expense_summary" };
  }
  if (/\b(income|amdani|aamdani)\b/i.test(lower) && (asksHowMuch || asksToShow)) {
    return { type: "income_summary" };
  }

  return { type: "none" };
}

/* NEW — the AI's self-service leave automation ("AI, meri leave de do" /
   "I need leave tomorrow"). Recognised for EVERYONE (admin or not) since
   requesting your own leave is a personal action, not an admin one —
   unlike broadcast/DM/expense/income/sales-report above, which stay
   admin-only (see the isAdmin gate in sendMessage). Only the admin can
   additionally grant leave to someone ELSE by name, the same way they can
   already message someone else by name above. */
function parseLeaveCommand(rawText, conversations, isAdmin) {
  const lower = rawText.toLowerCase();
  const mentionsLeave = /\b(leave|chutti|chhutti)\b/.test(lower);
  if (!mentionsLeave) return null;

  // Needs to actually read as a REQUEST for leave, not just a sentence
  // that happens to contain the word (e.g. "I'm already on leave today").
  const requestish = /\b(de\s*do|dedo|do\b|chahiye|chahiy|lena\s*hai|book|apply|approve|grant|need|want|give\s*me|mark\s*me|mujhe|please)\b/.test(lower);
  if (!requestish) return null;

  const dayMatch = lower.match(/\b(kal|aaj|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  const when = dayMatch ? dayMatch[1] : "today";

  // Admin only: "<name> ko/ke liye ... leave/chutti de do" grants leave to
  // someone else instead of the admin's own account.
  if (isAdmin) {
    const m = rawText.match(/^(.+?)\s+(?:ko|ke\s+liye|for)\s+.*\b(?:leave|chutti|chhutti)\b/i);
    if (m) {
      const target = findConversationByName(m[1], conversations);
      if (target) return { type: "leave", targetSelf: false, targetId: target.id, targetName: target.name, when, raw: rawText.trim() };
    }
  }

  return { type: "leave", targetSelf: true, when, raw: rawText.trim() };
}

/* ------------------------------------------------------------------ */

function lerpColor(a, b, t) {
  const ah = a.match(/\w\w/g).map((x) => parseInt(x, 16));
  const bh = b.match(/\w\w/g).map((x) => parseInt(x, 16));
  const rh = ah.map((c, i) => Math.round(c + (bh[i] - c) * t));
  return `rgb(${rh[0]},${rh[1]},${rh[2]})`;
}

/* Keyword-based fallback replies. Now takes a `context` object so a few of
   these (profit, sales) can answer with the real numbers for whatever date
   range is currently selected on the Dashboard, instead of always quoting
   the same fixed month. */
function respond(command, context = {}) {
  const c = command.toLowerCase();
  const range = context.selectedDateRange || "This Month";
  const stats = STATS_BY_RANGE[range] || STATS_BY_RANGE["This Month"];
  const [salesStat, purchaseStat, profitStat, customersStat] = stats;

  if (c.includes("expense")) return "Got it — I've logged that expense to your Expenses ledger.";
  if (c.includes("income")) return "Done. That income has been added to the project total.";
  if (c.includes("profit")) return `For ${range}, your total profit is ${profitStat.value} (${profitStat.delta} vs the previous period).`;
  if (c.includes("project") || c.includes("website")) return "Started a new project workspace for that client. Check Projects to add details.";
  if (c.includes("sales")) {
    const first = SALES_DATA[0];
    const last = SALES_DATA[SALES_DATA.length - 1];
    return (
      `Here's the sales report for ${range}:\n` +
      `• Total Sales: ${salesStat.value} (${salesStat.delta} vs the previous period)\n` +
      `• Daily trend: $${first.sales.toLocaleString()} on ${first.day} → $${last.sales.toLocaleString()} on ${last.day}\n` +
      `• Total Purchases: ${purchaseStat.value} · New Customers: ${customersStat.value}`
    );
  }
  return "Working on it — I'll have that ready in your dashboard shortly.";
}

/* NEW — what a non-admin sees for anything that ISN'T a recognised
   self-service action (leave). The admin's AI can answer "har cheez"
   (anything: sales, expenses, broadcasting, reports) because `respond()`
   above has real access to that company-wide data — an employee's AI
   only ever answers with what's actually theirs (their own tasks,
   profile, messages) or points them to their admin/HR for anything
   company-wide, instead of quoting the same financial figures back. */
function respondForEmployee(text) {
  const c = text.toLowerCase();
  if (/\b(task|assignment|kaam|kam)\b/.test(c)) return "You can see everything assigned to you on the Tasks page — I can help with quick things here like requesting leave.";
  if (/\b(profile|avatar|photo|picture|phone|contact)\b/.test(c)) return "You can update your name, photo, and contact details from Settings.";
  if (/\b(message|chat|conversation)\b/.test(c)) return "Head to Messages to see your conversations — I don't have access to send messages on your behalf, but I can log a leave request for you here.";
  if (/\b(expense|income|profit|sales|revenue|report|purchase|customer)\b/.test(c)) return "That's company-wide data, so only the admin's assistant can pull that up. I can help with things related to your own account here instead.";
  return "I can help with things related to your own account here — like requesting leave (just say \"give me leave tomorrow\" or \"mujhe kal chutti de do\"), or pointing you to the right page for your tasks and messages.";
}

/* NEW — answers "expense/income kitna hua is month?" style queries with
   the REAL current-month total from the actual ledger (expenses/income
   state), broken down by category, instead of a canned line. `kind` is
   just "expense" or "income" for the wording. */
function summarizeLedger(entries, kind) {
  const now = new Date();
  const thisMonth = (entries || []).filter((e) => {
    const d = new Date(e.date);
    return !Number.isNaN(d.getTime()) && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const monthName = now.toLocaleDateString([], { month: "long", year: "numeric" });
  if (thisMonth.length === 0) {
    return `No ${kind} logged yet for ${monthName}.`;
  }
  const total = thisMonth.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const byCategory = {};
  thisMonth.forEach((e) => {
    const key = e.category || "Other";
    byCategory[key] = (byCategory[key] || 0) + (Number(e.amount) || 0);
  });
  const breakdown = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, amt]) => `• ${cat}: $${amt.toLocaleString()}`)
    .join("\n");
  return `Total ${kind} for ${monthName}: $${total.toLocaleString()} across ${thisMonth.length} ${thisMonth.length === 1 ? "entry" : "entries"}.\n${breakdown}`;
}

/* Fan-style gauge with a genuine 3D "pipe" look: each bar gets a
   top-to-bottom gradient plus an inset highlight/shadow pair. */
function CustomerGauge({ value = 145, label = "New Customers", dark, animate = true }) {
  const bars = 28;
  return (
    <div className="relative w-full h-[128px] flex items-end justify-center overflow-hidden">
      <div className="relative w-full h-full" style={{ transform: "scale(1.85)", transformOrigin: "bottom center" }}>
        {Array.from({ length: bars }).map((_, i) => {
          const angle = -90 + (i / (bars - 1)) * 180;
          const t = i / (bars - 1);
          const base = lerpColor("#8b5cf6", "#38bdf8", t);
          const light = lerpColor("#c4b5fd", "#bae6fd", t);
          return (
            <span
              key={i}
              className="absolute bottom-0 left-1/2 rounded-full transition-transform ease-out"
              style={{
                width: 5,
                height: 40,
                background: `linear-gradient(180deg, ${light} 0%, ${base} 55%, rgba(0,0,0,0.25) 100%)`,
                boxShadow: "inset -1px 0 1px rgba(255,255,255,0.55), inset 1px 0 1px rgba(0,0,0,0.12), 0 2px 3px rgba(30,20,60,0.18)",
                transformOrigin: "bottom center",
                transform: `translateX(-50%) rotate(${angle}deg) scaleY(${animate ? 1 : 0})`,
                transitionDuration: "550ms",
                transitionDelay: `${i * 22}ms`,
              }}
            />
          );
        })}
        <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center pb-0.5">
          <span className={`text-2xl font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>{value}</span>
          <span className={`text-[11px] ${dark ? "text-slate-500" : "text-slate-400"}`}>{label}</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Simple placeholder page for nav items that don't have a full        */
/*  build-out yet, so every sidebar link is at least "workable".        */
/* ------------------------------------------------------------------ */
function PlaceholderPage({ title, darkMode }) {
  return (
    <div className={`rounded-xl p-10 shadow-sm flex flex-col items-center text-center gap-2 ${darkMode ? "bg-slate-900 border border-slate-800" : "bg-white"}`}>
      <span className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-600/10 to-indigo-600/10 text-violet-500 flex items-center justify-center mb-1">
        <Sparkles size={20} />
      </span>
      <h2 className={`text-base font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>{title}</h2>
      <p className={`text-xs max-w-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
        This section is set up and ready to be filled in — hook up your {title.toLowerCase()} data here whenever you're ready.
      </p>
    </div>
  );
}

/* If RegisterPage.jsx has an internal error, this stops it from silently
   looking like "Logout did nothing" — it shows what actually went wrong. */
class AuthErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen w-full flex items-center justify-center bg-[#f4f5fa] px-6 text-center">
          <div className="max-w-md">
            <p className="text-rose-600 font-semibold text-sm mb-2">RegisterPage.jsx failed to render</p>
            <p className="text-slate-500 text-xs">
              The Logout click worked — the app switched views — but RegisterPage.jsx itself threw an error:
            </p>
            <pre className="text-[10px] text-left bg-white rounded-lg p-3 mt-3 overflow-auto text-rose-500">
              {String(this.state.error?.message || this.state.error)}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { logout, user, getAllowedPages, approvedUsers, updateUserProfile, canUseAiAssistant } = useAuth();

  // Pages this logged-in user's role is actually allowed to see. Admin
  // always gets ALL_PAGES (handled inside getAllowedPages), everyone else
  // gets whatever AuthContext's role-permissions map says — unless this
  // specific user has an individual access override (UserPage's
  // Individual User Access), which getAllowedPages checks first when
  // given their id.
  const allowedPages = getAllowedPages(user?.role, user?.id);
  const visibleNavItems = NAV_ITEMS.filter((item) => allowedPages.includes(item.label));
  // Used by the generic page-activity dot system below to decide whether
  // this logged-in person should see "forAdmin" flags (broadcast activity)
  // in addition to any flag aimed specifically at their own name.
  const isAdminOrManager = user?.role === "admin" || getRoleCategory(user?.role) === "manager";
  // sidebarCollapsed -> single source of truth for the sidebar's width.
  //   Collapsed (default): narrow icon-only rail is shown — always visible, never
  //     hidden — and the content sits right next to it (no overlay, nothing covered).
  //   Expanded: sidebar widens to show icons + labels, content shifts over to make room.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  // mobileSidebarOpen -> below the lg breakpoint the sidebar is an off-canvas
  // drawer (hidden by default). Tapping the hamburger ("3 bar") icon in the
  // header slides it in as an overlay; it never eats into page width the way
  // the old always-visible icon rail did. Desktop (lg+) behavior is untouched.
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [active, setActive] = useState(() => {
    const tab = searchParams.get("tab");
    return tab && NAV_ITEMS.some((item) => item.label === tab) ? tab : "Dashboard";
  });

  /* ------------------------------------------------------------------ */
  /*  Dashboard charts "fill in" animation.                              */
  /*  chartsPlay starts false, then flips true a beat after the           */
  /*  Dashboard tab becomes active, so the Statistics bars / Customer     */
  /*  gauge bars / Sales line all animate from empty -> filled every       */
  /*  time the dashboard is opened (including the very first load).       */
  /*  chartsAnimKey changes on every "opening" so the Recharts line        */
  /*  chart is forced to remount and replay its draw-in animation.         */
  /* ------------------------------------------------------------------ */
  const [chartsPlay, setChartsPlay] = useState(false);
  const [chartsAnimKey, setChartsAnimKey] = useState(0);
  useEffect(() => {
    if (active !== "Dashboard") {
      setChartsPlay(false);
      return;
    }
    setChartsPlay(false);
    setChartsAnimKey((k) => k + 1);
    const t = setTimeout(() => setChartsPlay(true), 60);
    return () => clearTimeout(t);
  }, [active]);

  // Red dots for "you were just assigned something" on Projects/Tasks,
  // PLUS the generic per-page activity flags (see flagPageActivity above)
  // — recomputed on mount, whenever ProjectsPage/TasksPage/any other page
  // fires its own assignment/activity event (new activity OR that page
  // clearing its flag), and on cross-tab storage changes, so a dot appears
  // the moment something happens and disappears the moment the relevant
  // page is actually opened.
  const [sidebarDots, setSidebarDots] = useState({});

  useEffect(() => {
    const name = user?.name;

    const recompute = () => {
      const generic = {};
      NAV_ITEMS.forEach((item) => {
        generic[item.label] = hasPageActivityFlag(item.label, { name, isAdminOrManager });
      });
      setSidebarDots({
        ...generic,
        Projects: generic.Projects || hasFlagForUser(PROJECTS_ASSIGNMENT_KEY, name),
        Tasks: generic.Tasks || hasFlagForUser(TASKS_ASSIGNMENT_KEY, name),
      });
    };

    recompute();

    const handleStorage = (e) => {
      if (e.key === PROJECTS_ASSIGNMENT_KEY || e.key === TASKS_ASSIGNMENT_KEY || e.key === PAGE_ACTIVITY_KEY) {
        recompute();
        return;
      }
      const knownLabel = KNOWN_PAGE_STORAGE_KEYS[e.key];
      if (knownLabel && e.newValue !== e.oldValue) {
        flagPageActivity(knownLabel, { forAdmin: true });
        (approvedUsers || []).forEach((u) => {
          if (u.name) flagPageActivity(knownLabel, { forUser: u.name });
        });
        // flagPageActivity's own write already dispatches PAGE_ACTIVITY_EVENT,
        // which recompute() above is already listening for.
      }
    };

    window.addEventListener(PROJECTS_ASSIGNMENT_EVENT, recompute);
    window.addEventListener(TASKS_ASSIGNMENT_EVENT, recompute);
    window.addEventListener(PAGE_ACTIVITY_EVENT, recompute);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(PROJECTS_ASSIGNMENT_EVENT, recompute);
      window.removeEventListener(TASKS_ASSIGNMENT_EVENT, recompute);
      window.removeEventListener(PAGE_ACTIVITY_EVENT, recompute);
      window.removeEventListener("storage", handleStorage);
    };
  }, [user?.name, isAdminOrManager, approvedUsers]);

  // If the current tab isn't allowed for this user's role (role changed,
  // permissions were edited, or a non-admin somehow lands on "Users"),
  // bounce back to a tab they ARE allowed to see instead of showing a page
  // they shouldn't have access to.
  //
  // FIX: this used to hardcode setActive("Dashboard") — but if an admin has
  // turned "Dashboard" itself off for this role, "Dashboard" isn't in
  // allowedPages either, so the very next render would still fail the
  // `!allowedPages.includes(active)` check and the content below (gated
  // only by `active === "Dashboard"`, not by permissions) would still
  // render. Falling back to the first page this role is actually allowed
  // to see fixes both the loop and the leak.
  useEffect(() => {
    if (allowedPages.length && !allowedPages.includes(active)) {
      setActive(allowedPages[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedPages.join(",")]);
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  // Persisted independently of login/logout — dark mode is a device/browser
  // preference, not part of the auth session, so it must survive logout
  // until the user explicitly flips it off themselves.
  const [darkMode, setDarkMode] = useState(() => {
    try {
      return localStorage.getItem("hopenix_dark_mode_v1") === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("hopenix_dark_mode_v1", darkMode ? "true" : "false");
    } catch {
      // ignore storage errors (e.g. private browsing)
    }
  }, [darkMode]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [listening, setListening] = useState(false);
  const [dateRangeOpen, setDateRangeOpen] = useState(false);
  const [selectedDateRange, setSelectedDateRange] = useState(DATE_RANGE_OPTIONS[0]);

  /* ------------------------------------------------------------------ */
  /*  Real data from the Django backend for the 4 stat cards and the      */
  /*  "Most Order by Country" card. null = not loaded yet / fetch failed, */
  /*  in which case the JSX below falls back to the mock arrays.          */
  /* ------------------------------------------------------------------ */
  const [liveStats, setLiveStats] = useState(null);
  const [liveCountryOrders, setLiveCountryOrders] = useState(null);

  // True until each widget's FIRST real fetch settles (success or fail).
  // The JSX below shows a skeleton placeholder while these are true, and
  // only ever falls back to the mock arrays once a fetch has actually
  // failed — never just because the response hasn't arrived yet. That's
  // what stops the old "fake numbers for a second, then real ones swap
  // in" flash on page load.
  const [statsLoading, setStatsLoading] = useState(true);
  const [countryOrdersLoading, setCountryOrdersLoading] = useState(true);

  /* Real Sales Overview chart data (approved orders per day/month) —
     refetched whenever the date-range dropdown changes. Falls back to
     the mock SALES_DATA array if the call fails. */
  const [liveSales, setLiveSales] = useState(null);
  const [salesLoading, setSalesLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    dashboardFetch(`/sales-overview/?period=${rangeToPeriod(selectedDateRange)}`)
      .then((data) => {
        if (!cancelled) setLiveSales(data);
      })
      .catch((err) => {
        console.error("Sales overview fetch failed, showing demo data instead:", err);
      })
      .finally(() => {
        if (!cancelled) setSalesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDateRange]);

  useEffect(() => {
    let cancelled = false;
    dashboardFetch(`/stats/?period=${rangeToPeriod(selectedDateRange)}`)
      .then((data) => {
        if (!cancelled) setLiveStats(data.map((d) => ({ value: d.value, delta: d.delta })));
      })
      .catch((err) => {
        console.error("Dashboard stats fetch failed, showing demo data instead:", err);
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDateRange]);

  useEffect(() => {
    let cancelled = false;
    dashboardFetch(`/most-orders-by-country/?limit=3`)
      .then((data) => {
        if (!cancelled) {
          // FIX: this used to overwrite the backend's own `text` with a
          // hardcoded ORDER_TEXT guess-by-rank array, and fall back to
          // a random fake pravatar.cc photo whenever `avatar` was
          // empty — so even after the backend started returning real,
          // country-specific text/photos, this page kept showing made-
          // up ones anyway. Just use what the backend actually sent.
          setLiveCountryOrders(
            data.map((o) => ({
              name: o.name,
              text: o.text || "client from",
              amount: o.amount,
              rank: o.rank,
              city: o.city,
              countryCode: o.countryCode,
              avatar: o.avatar || "",
            }))
          );
        }
      })
      .catch((err) => {
        console.error("Most-orders-by-country fetch failed, showing demo data instead:", err);
      })
      .finally(() => {
        if (!cancelled) setCountryOrdersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* Real notifications (bell icon dropdown) — new clients, received
     payments, and anything genuinely awaiting review, newest first. */
  const [liveNotifications, setLiveNotifications] = useState(null);

  useEffect(() => {
    let cancelled = false;
    dashboardFetch(`/notifications/?limit=6`)
      .then((data) => {
        if (!cancelled) setLiveNotifications(data);
      })
      .catch((err) => {
        console.error("Notifications fetch failed, showing demo data instead:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [growthPeriod, setGrowthPeriod] = useState("Month");

  /* Real "User Growth" widget data (actual registered users) —
     refetched whenever the 2h/32h/A Week/Month tab changes. Falls
     back to USER_GROWTH_BY_PERIOD mock data if the call fails. */
  const [liveGrowth, setLiveGrowth] = useState(null);
  const [growthLoading, setGrowthLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    dashboardFetch(`/user-growth/?period=${growthPeriodToQuery(growthPeriod)}`)
      .then((data) => {
        if (!cancelled) setLiveGrowth(data);
      })
      .catch((err) => {
        console.error("User growth fetch failed, showing demo data instead:", err);
      })
      .finally(() => {
        if (!cancelled) setGrowthLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [growthPeriod]);
  const [statsMetric, setStatsMetric] = useState("Customer Satisfaction");
  const [statsPeriod, setStatsPeriod] = useState("Weekly");
  const [statsPeriodOpen, setStatsPeriodOpen] = useState(false);

  /* Real "Customer Satisfaction" data (order approval rate) from the
     backend — refetched whenever the Weekly/Monthly/Yearly toggle
     changes. "Visitor height" has no real data source yet, so it keeps
     using the mock STATS_DATASETS below. */
  const [liveSatisfaction, setLiveSatisfaction] = useState(null);
  // Only the "Customer Satisfaction" metric has a real endpoint, so this
  // only gates that one — "Visitor height" was already always-mock and
  // stays that way, no flash to fix there.
  const [satisfactionLoading, setSatisfactionLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    dashboardFetch(`/customer-satisfaction/?period=${statsPeriod.toLowerCase()}`)
      .then((data) => {
        if (!cancelled) setLiveSatisfaction(data);
      })
      .catch((err) => {
        console.error("Customer satisfaction fetch failed, showing demo data instead:", err);
      })
      .finally(() => {
        if (!cancelled) setSatisfactionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [statsPeriod]);
  const [exporting, setExporting] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  // The user's own avatar/DP. Now backed by the REAL per-user record in
  // AuthContext (so Messages/Employees can show the same real photo),
  // with localStorage only as a same-browser fallback for the very first
  // render before `user` is available.
  const [avatar, setAvatar] = useState(
    () => user?.avatar || initialsAvatarDataUrl(user?.name || user?.email || "guest")
  );

  // Whenever the logged-in ACCOUNT changes, or that person's real avatar
  // updates, resync to THAT user's own photo. No shared/global
  // localStorage fallback — that let one user's cached photo leak into
  // another user's session.
  useEffect(() => {
    setAvatar(user?.avatar || initialsAvatarDataUrl(user?.name || user?.email || "guest"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.avatar]);
  // Only admin can see every conversation/message on everyone's behalf —
  // every employee AND every project pairing. A project manager is no
  // longer treated as "sees everything": they fall through to the same
  // "only my own stuff" branch below as any other employee, only seeing
  // their own project-linked 1:1 threads (see the projectIds check in
  // visibleConversations further down).
  const canSeeAllConversations = user?.role === "admin";
  // Conversations live here (not inside MessagesPage) so the AI Assistant
  // panel can read/write them too — see parseAiCommand / sendMessage below.
  const CONVERSATIONS_STORAGE_KEY = "hopenix_conversations_v1";

  function sanitizeConversationsForStorage(list) {
    if (!Array.isArray(list)) return [];
    return list.map((c) => {
      if (!c || !Array.isArray(c.messages)) return c;
      let modified = false;
      const cleanMessages = c.messages.map((m) => {
        if (m?.file?.url && typeof m.file.url === "string" && m.file.url.startsWith("data:")) {
          modified = true;
          const { url, ...cleanFile } = m.file;
          return { ...m, file: cleanFile };
        }
        return m;
      });
      return modified ? { ...c, messages: cleanMessages } : c;
    });
  }

  const [conversations, setConversations] = useState(() => {
    try {
      const saved = localStorage.getItem(CONVERSATIONS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return sanitizeConversationsForStorage(parsed);
      }
    } catch (err) {
      console.error("Could not restore saved conversations:", err);
    }
    return [];
  });

  useEffect(() => {
    try {
      const clean = sanitizeConversationsForStorage(conversations);
      localStorage.setItem(CONVERSATIONS_STORAGE_KEY, JSON.stringify(clean));
    } catch (err) {
      console.warn("Could not save conversations to localStorage:", err);
    }
  }, [conversations]);

  // Cross-tab/cross-session live sync: conversations only loaded from
  // localStorage ONCE, in the useState initializer above — so without
  // this, an admin sending a message (e.g. from a daily report on the
  // Reports page) writes it to localStorage fine, and the admin's OWN tab
  // shows it as sent, but an employee already logged in on a different
  // tab/browser session never picks it up, because their in-memory
  // `conversations` state was never told anything changed. The native
  // `storage` event fires in every OTHER tab/session sharing this origin
  // the instant one of them writes to localStorage, so re-reading here
  // keeps everyone's view live without needing a real backend.
  useEffect(() => {
    function handleConversationsStorage(e) {
      if (e.key !== CONVERSATIONS_STORAGE_KEY || !e.newValue) return;
      try {
        const parsed = JSON.parse(e.newValue);
        if (Array.isArray(parsed)) setConversations(parsed);
      } catch (err) {
        console.error("Could not sync conversations from another tab:", err);
      }
    }
    window.addEventListener("storage", handleConversationsStorage);
    return () => window.removeEventListener("storage", handleConversationsStorage);
  }, []);

  // NEW — leave requests granted through the AI Assistant's automation
  // ("AI, meri leave de do" / "give me leave tomorrow"). Stored the same
  // shared, cross-tab-synced way as `conversations` above so any other
  // part of the app (a future Leave/HR page, Employees, etc.) can read
  // the exact same record of who took leave and when, not just whatever
  // happened to be in this one browser tab's memory.
  const LEAVE_REQUESTS_STORAGE_KEY = "hopenix_leave_requests_v1";
  const [leaveRequests, setLeaveRequests] = useState(() => {
    try {
      const saved = localStorage.getItem(LEAVE_REQUESTS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (err) {
      console.error("Could not restore saved leave requests:", err);
    }
    return [];
  });
  useEffect(() => {
    try {
      localStorage.setItem(LEAVE_REQUESTS_STORAGE_KEY, JSON.stringify(leaveRequests));
    } catch (err) {
      console.error("Could not save leave requests:", err);
    }
  }, [leaveRequests]);
  useEffect(() => {
    function handleLeaveRequestsStorage(e) {
      if (e.key !== LEAVE_REQUESTS_STORAGE_KEY || !e.newValue) return;
      try {
        const parsed = JSON.parse(e.newValue);
        if (Array.isArray(parsed)) setLeaveRequests(parsed);
      } catch (err) {
        console.error("Could not sync leave requests from another tab:", err);
      }
    }
    window.addEventListener("storage", handleLeaveRequestsStorage);
    return () => window.removeEventListener("storage", handleLeaveRequestsStorage);
  }, []);

  // What MessagesPage is actually allowed to show this viewer: everything
  // for admin/manager, or just their own thread (matched by authId) for
  // everyone else. `conversations` itself (the full list) stays untouched
  // so admin/manager still see and manage every contact.
  //
  // IMPORTANT: for a non-admin viewer, the conversation object stored in
  // `conversations` describes THEM (their own name/avatar/role — that's
  // what the admin sees in their contact list). If we handed that object
  // to MessagesPage as-is, the employee would see their OWN name/photo
  // in their own chat header/list instead of the person they're actually
  // talking to (the Admin). So for non-admins we relabel the thread to
  // show the ADMIN's real name/avatar instead — the messages inside are
  // untouched, only the display identity of "who this thread is with".
  const adminIdentity = useMemo(() => {
    const adminUser =
      approvedUsers.find((u) => (u.email || "").toLowerCase() === "hamnaarooj784@gmail.com") ||
      approvedUsers.find((u) => (u.role || "").toLowerCase() === "admin");
    return {
      name: adminUser?.name || "Admin",
      avatar: adminUser?.avatar || initialsAvatarDataUrl(adminUser?.name || adminUser?.email || "Admin"),
      role: "Admin",
      email: adminUser?.email || "",
      phone: adminUser?.phone || "",
      location: adminUser?.department || "Head Office",
    };
  }, [approvedUsers]);

  const visibleConversations = useMemo(() => {
    if (canSeeAllConversations) {
      return conversations.filter((c) => !c.peerAuthIds);
    }
    return conversations
      .filter(
        (c) =>
          // Compared with String() because `c.authId` (set from
          // approvedUsers' `u.id`) and `user?.id` (from AuthContext) can
          // come through as different types (e.g. one a string, one a
          // number) for the same underlying account — a strict `===`
          // would then never match, so the employee's own thread with
          // Admin silently fails to show up at all.
          String(c.authId) === String(user?.id) ||
          (c.peerAuthIds &&
            c.peerAuthIds.some((id) => String(id) === String(user?.id)) &&
            (c.projectIds || []).length > 0)
      )
      .map((c) => {
        if (c.peerAuthIds) {
          const otherId = c.peerAuthIds.find((id) => String(id) !== String(user?.id));
          const other = approvedUsers.find((u) => String(u.id) === String(otherId));
          return {
            ...c,
            name: other?.name || "Member",
            avatar: other?.avatar || initialsAvatarDataUrl(other?.name || other?.email || "Member"),
            role: other?.role ? other.role.charAt(0).toUpperCase() + other.role.slice(1) : "Member",
            email: other?.email || "",
            phone: other?.phone || "",
            location: other?.department || "",
          };
        }
        return { ...c, ...adminIdentity };
      });
  }, [canSeeAllConversations, conversations, user?.id, approvedUsers, adminIdentity]);

  // Total unread messages across every conversation this user can see —
  // drives the Messages sidebar red dot. Conversations already carry an
  // `unread` count each, and MessagesPage zeroes a conversation's count
  // (via the shared setConversations it's given) the moment its thread is
  // opened, so this stays accurate without any extra event plumbing.
  const messagesUnreadTotal = useMemo(
    () =>
      visibleConversations.reduce((sum, c) => {
        if (c.peerAuthIds) return sum + ((c.unreadFor && c.unreadFor[user?.id]) || 0);
        return sum + (canSeeAllConversations ? c.unread || 0 : c.unreadForUser || 0);
      }, 0),
    [visibleConversations, canSeeAllConversations, user?.id]
  );

  // Keep Messages in sync with real approved accounts: whenever someone
  // gets approved in Users & Roles (UserPage/AuthContext), they should
  // immediately show up here as a contact you can text. Matched by email
  // so re-running this never duplicates a contact that's already there.
  // Also keeps already-synced contacts' real DP/phone/role/department up
  // to date whenever that person changes them in Settings or an admin
  // edits their role/department in Users & Roles.
  //
  // IMPORTANT: this now also DROPS any conversation whose account is no
  // longer approved (rejected, deactivated, or deleted entirely via
  // "Remove user" in Users & Roles) — Messages should only ever show
  // people currently approved, and removing someone from Users & Roles
  // should remove them from Messages too, not just leave a stale row
  // behind. Any conversation with no authId at all (e.g. an old static
  // demo contact from before this app was wired to real accounts) is
  // dropped the same way, since it was never a real approved user.
  useEffect(() => {
    setConversations((prev) => {
      let changed = false;

      let next = prev
        // Group conversations (project teams) have no single `authId` —
        // they're kept regardless, but their member list is pruned below
        // the same way a removed person disappears from a 1:1 thread.
        // Peer conversations (direct chats between two non-admin users)
        // are kept only while BOTH participants are still approved.
        .filter((c) => {
          if (c.isGroup) return true;
          if (c.peerAuthIds) return c.peerAuthIds.every((aid) => approvedUsers.some((u) => String(u.id) === String(aid)));
          return c.authId && approvedUsers.some((u) => String(u.id) === String(c.authId));
        })
        .map((c) => {
          // Peer conversations have no single owner to sync a name/avatar
          // from — each side's display identity (the OTHER participant's
          // real name/photo) is resolved per-viewer in visibleConversations
          // below instead, so there's nothing to update here.
          if (c.peerAuthIds) return c;
          if (c.isGroup) {
            const nextMemberAuthIds = (c.memberAuthIds || []).filter((aid) => approvedUsers.some((u) => String(u.id) === String(aid)));
            const nextMembers = nextMemberAuthIds.map((aid) => approvedUsers.find((u) => String(u.id) === String(aid))?.name).filter(Boolean);
            const memberListChanged =
              nextMembers.length !== (c.members || []).length || nextMembers.some((n, i) => n !== c.members?.[i]);
            if (memberListChanged) {
              changed = true;
              return {
                ...c,
                memberAuthIds: nextMemberAuthIds,
                members: nextMembers,
                role: `Project Group • ${nextMembers.length} member${nextMembers.length === 1 ? "" : "s"}`,
              };
            }
            return c;
          }
          const au = approvedUsers.find((u) => String(u.id) === String(c.authId));
          const nextRole = au.role ? au.role.charAt(0).toUpperCase() + au.role.slice(1) : c.role;
          const nextAvatar = au.avatar || c.avatar;
          const nextPhone = au.phone || "";
          const nextLocation = au.department || c.location;
          if (
            au.name !== c.name ||
            nextRole !== c.role ||
            nextAvatar !== c.avatar ||
            nextPhone !== c.phone ||
            nextLocation !== c.location
          ) {
            changed = true;
            return { ...c, name: au.name, email: au.email, role: nextRole, avatar: nextAvatar, phone: nextPhone, location: nextLocation };
          }
          return c;
        });

      if (next.length !== prev.length) changed = true;

      const existingAuthIds = new Set(next.filter((c) => c.authId != null).map((c) => String(c.authId)));
      const existingEmails = new Set(next.map((c) => (c.email || "").toLowerCase()).filter(Boolean));
      const newContacts = approvedUsers
        .filter((u) => u.role !== "admin")
        // Matched by authId FIRST — email alone isn't reliable (a
        // conversation can already exist for this user with a blank or
        // stale email), and falling through to email-only used to let a
        // second `auth-<id>` conversation get created for the same
        // person. That duplicate then got prepended ahead of the real
        // one, so `.find()` calls elsewhere (e.g. sendReportMessage's
        // birthday-wish delivery) picked the empty duplicate instead of
        // the real thread — messages looked like they vanished, when
        // they were actually sitting in the real (now-shadowed) entry.
        // Compared with String() since `u.id` and a conversation's stored
        // `authId` can come through as different types for the same
        // account, which previously made this check miss an existing
        // thread and silently spawn a duplicate (or never create the
        // thread's counterpart the user could see at all).
        .filter((u) => !existingAuthIds.has(String(u.id)) && !existingEmails.has((u.email || "").toLowerCase()))
        .map((u) => ({
          id: `auth-${u.id}`,
          authId: u.id,
          name: u.name,
          role: u.role ? u.role.charAt(0).toUpperCase() + u.role.slice(1) : "Member",
          // Real uploaded DP if this person has set one (via Settings);
          // only falls back to a generated placeholder avatar if they
          // haven't uploaded a real photo yet.
          avatar: u.avatar || initialsAvatarDataUrl(u.name || u.email),
          status: "Offline",
          time: "",
          unread: 0,
          unreadForUser: 0,
          email: u.email,
          phone: u.phone || "",
          location: u.department || "",
          files: [],
          assignments: [],
          messages: [],
        }));
      if (newContacts.length) {
        changed = true;
        next = [...newContacts, ...next];
      }

      // Peer-to-peer contacts: every non-admin user should also be able to
      // see and message every OTHER non-admin user directly, not just
      // Admin. One conversation object per unique pair, keyed by both
      // authIds so it's stable regardless of who messages first.
      const nonAdminUsers = approvedUsers.filter((u) => u.role !== "admin");
      const existingPeerIds = new Set(next.filter((c) => c.peerAuthIds).map((c) => c.id));
      const newPeers = [];
      for (let i = 0; i < nonAdminUsers.length; i++) {
        for (let j = i + 1; j < nonAdminUsers.length; j++) {
          const peerId = `peer-${[nonAdminUsers[i].id, nonAdminUsers[j].id].sort().join("_")}`;
          if (!existingPeerIds.has(peerId)) {
            newPeers.push({
              id: peerId,
              peerAuthIds: [nonAdminUsers[i].id, nonAdminUsers[j].id],
              status: "Active",
              time: "",
              unreadFor: {},
              files: [],
              assignments: [],
              messages: [],
            });
          }
        }
      }
      if (newPeers.length) {
        changed = true;
        next = [...next, ...newPeers];
      }

      return changed ? next : prev;
    });
  }, [approvedUsers]);

  // Auto-queue and deliver birthday messages to employee threads in conversations
  useEffect(() => {
    // 1. Queue birthday message if logged in user has birthday today
    const currentDob = user?.dateOfBirth || user?.date_of_birth || user?.dob;
    if (user && (user.id || user.id === 0) && isBirthdayToday(currentDob)) {
      queueEmployeeBirthdayMessage(user);
    }
    // 2. Also queue for any approved user whose birthday is today
    if (Array.isArray(approvedUsers)) {
      approvedUsers.forEach((u) => {
        const uDob = u.dateOfBirth || u.date_of_birth || u.dob;
        if (u && (u.id || u.id === 0) && isBirthdayToday(uDob)) {
          queueEmployeeBirthdayMessage(u);
        }
      });
    }
    // 3. Deliver pending employee birthday messages directly to conversation thread
    const pending = getPendingEmployeeBirthdayMessages();
    if (!pending || pending.length === 0) return;

    pending.forEach((msg) => {
      if (!isBirthdayMessageAlreadyInConversations(conversations, msg.userId, msg.dateKey)) {
        sendReportMessage(conversations, setConversations, {
          userId: msg.userId,
          userName: msg.name,
          text: msg.text,
        });
      }
      markBirthdayMessageDelivered(msg.userId, msg.dateKey);
    });
  }, [user, approvedUsers, conversations, setConversations]);
  // Expenses / Income seed data feeds the AI Assistant's own commands and
  // the PDF export — see the note above SEED_EXPENSES/SEED_INCOME.
  const [expenses, setExpenses] = useState(SEED_EXPENSES);
  const [income, setIncome] = useState(SEED_INCOME);
  // When the AI Assistant asks a follow-up question ("what would you like
  // to send to everyone?"), this remembers what it's waiting for so the
  // user's very next message is used as the answer instead of being
  // re-parsed as a brand-new command.
  const [pendingAction, setPendingAction] = useState(null);
  const scrollRef = useRef(null);
  const recognitionRef = useRef(null);
  const transcriptRef = useRef("");

  const currentGrowth = liveGrowth || USER_GROWTH_BY_PERIOD[growthPeriod];
  const currentStats =
    statsMetric === "Customer Satisfaction" && liveSatisfaction
      ? liveSatisfaction
      : STATS_DATASETS[statsMetric][statsPeriod];
  const maxStatValue = Math.max(...currentStats.bars.map((b) => b.value));
  // Only "Customer Satisfaction" has a real endpoint — "Visitor height"
  // was always mock data and has nothing to wait for.
  const isStatsWidgetLoading = statsMetric === "Customer Satisfaction" && satisfactionLoading;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, typing]);

  /* Updates the shared avatar everywhere it's used (header, Messages,
     Employees...) and persists it to the REAL per-user AuthContext record
     — not just this browser's localStorage — so it's actually this
     person's photo wherever they're looked up from now on. */
  function updateAvatar(dataUrl) {
    setAvatar(dataUrl);
    // Persisted to the real per-user AuthContext record only.
    if (user) updateUserProfile(user.id, { avatar: dataUrl });
  }

  // Users, Tasks, Projects, Employees, Clients, Sales, Settings, Reports,
  // Expenses and Income all have their own dedicated right-hand layout /
  // header (stat cards, filters, tables, their own action bars) — the
  // global AI Assistant panel doesn't belong there.
  //
  // On top of that page-based rule, canUseAiAssistant(user?.role) applies
  // the admin-controlled global switch (UserPage's "AI Assistant
  // Visibility" toggle): admin always sees it, everyone else only if the
  // admin has left it turned on.
  const showAiAssistant =
    active !== "Users" &&
    active !== "Tasks" &&
    active !== "Projects" &&
    active !== "Employees" &&
    active !== "Clients" &&
    active !== "Sales" &&
    active !== "Settings" &&
    active !== "Reports" &&
    active !== "Expenses" &&
    active !== "Income" &&
    canUseAiAssistant(user?.role);
  useEffect(() => {
    if (!showAiAssistant) setAiOpen(false);
  }, [showAiAssistant]);

  const searchResults = searchQuery
    ? NAV_ITEMS.filter((item) => item.label.toLowerCase().includes(searchQuery.toLowerCase()))
    : [];

  function goToSearchResult(label) {
    setActive(label);
    setSearchQuery("");
    setSearchFocused(false);
  }

  /* Voice input for the AI Assistant — uses the browser's built-in
     SpeechRecognition API, so no server or extra package is needed. */
  function toggleVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setMessages((m) => [
        ...m,
        {
          from: "ai",
          text: "Voice input isn't supported in this browser — try Chrome or Edge, or type your command instead.",
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
      return;
    }

    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((r) => r[0].transcript)
        .join("");
      transcriptRef.current = transcript;
      setInput(transcript);
    };

    recognition.onerror = () => setListening(false);

    recognition.onend = () => {
      setListening(false);
      const finalTranscript = transcriptRef.current.trim();
      if (finalTranscript) sendMessage(finalTranscript);
      transcriptRef.current = "";
    };

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  /* Appends an outgoing message to a single conversation by id. Used by
     the AI Assistant's "send to <name>" command. */
  function pushMessageToConversation(id, text) {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setConversations((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              time: "Just now",
              // Sent as admin (via the AI Assistant), so the employee on the
              // other end of this thread hasn't seen it yet — bump their
              // counter so their sidebar picks up the Messages red dot.
              unreadForUser: (c.unreadForUser || 0) + 1,
              messages: [
                ...c.messages,
                { id: (c.messages[c.messages.length - 1]?.id || 0) + 1, text, time, outgoing: true, sender: "admin" },
              ],
            }
          : c
      )
    );
  }

  /* Appends the same outgoing message to every conversation. Used by the
     AI Assistant's "send to all members" / broadcast command. */
  function pushMessageToAll(text) {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setConversations((prev) =>
      prev.map((c) => {
        // Peer conversations (direct chats between two non-admin users)
        // are outside admin's own inbox — same reasoning as
        // visibleConversations excluding them from admin's list — so a
        // "message all members" broadcast from admin shouldn't inject a
        // message into someone else's private 1:1 thread.
        if (c.peerAuthIds) return c;
        return {
          ...c,
          time: "Just now",
          unreadForUser: (c.unreadForUser || 0) + 1,
          messages: [
            ...c.messages,
            { id: (c.messages[c.messages.length - 1]?.id || 0) + 1, text, time, outgoing: true, sender: "admin" },
          ],
        };
      })
    );
  }

  /* Appends a real row to the Expenses seed list (used by the AI
     Assistant's "add expense of ..." command and reflected in the PDF
     export). */
  function pushExpense(amount, note) {
    const now = new Date();
    setExpenses((prev) => [
      {
        id: (prev[prev.length - 1]?.id || 0) + 1,
        note,
        category: "AI Assistant",
        amount,
        date: now.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }),
        addedVia: "AI Assistant",
      },
      ...prev,
    ]);
  }

  /* Same idea for Income. */
  function pushIncome(amount, note) {
    const now = new Date();
    setIncome((prev) => [
      {
        id: (prev[prev.length - 1]?.id || 0) + 1,
        note,
        category: "AI Assistant",
        amount,
        date: now.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }),
        addedVia: "AI Assistant",
      },
      ...prev,
    ]);
  }

  /* NEW — records one leave grant from the AI Assistant's automation.
     Always auto-approved: the ask was for the AI to actually grant the
     leave when asked ("wo leave de deta hai"), not just log a pending
     request someone else has to act on later. */
  function pushLeaveRequest(entry) {
    setLeaveRequests((prev) => [entry, ...prev]);
  }

  function sendMessage(text) {
    const clean = text.trim();
    if (!clean) return;
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setMessages((m) => [...m, { from: "user", text: clean, time }]);
    setInput("");
    setTyping(true);

    // NEW — the AI recognizes the admin account and gates its own actions
    // by it: the admin can ask the AI to do "anything" (broadcast/DM as
    // admin, log expenses/income, pull a sales report), while everyone
    // else only ever gets answers/actions scoped to their OWN account
    // (their own leave, their own tasks/profile/messages) — see
    // adminOnlyTypes below and respondForEmployee().
    const isAdmin = user?.role === "admin";

    setTimeout(() => {
      setTyping(false);

      let replyText;
      const cancelWords = /^(cancel|nevermind|never\s*mind|nvm|no|skip|stop)$/i;

      /* If the AI Assistant just asked "what would you like to send to
         everyone / <name>?", treat this entire message as the answer —
         don't re-run it through parseAiCommand, or a plain reply like
         "Hi" falls through to the generic fallback line. These
         continuations only ever get set up for admin in the first place
         (see the adminOnlyTypes gate below), but the isAdmin check here
         is kept as a second line of defense. */
      if (pendingAction && cancelWords.test(clean)) {
        replyText = "No problem — cancelled.";
        setPendingAction(null);
      } else if (isAdmin && pendingAction?.type === "broadcast") {
        pushMessageToAll(clean);
        replyText = `Done — sent "${clean}" to all ${conversations.filter((c) => !c.peerAuthIds).length} members. Open Messages to see it.`;
        setPendingAction(null);
      } else if (isAdmin && pendingAction?.type === "individual") {
        pushMessageToConversation(pendingAction.targetId, clean);
        replyText = `Done — sent "${clean}" to ${pendingAction.targetName}. Open Messages to see the conversation.`;
        setPendingAction(null);
      } else {
        const command = parseAiCommand(clean, conversations);
        // Requesting your OWN leave (or, for admin, granting someone
        // else's) is a personal action available to everyone — checked
        // before the admin-only gate below so it's never blocked.
        const leave = parseLeaveCommand(clean, conversations, isAdmin);
        const adminOnlyTypes = ["broadcast", "broadcast_empty", "individual", "individual_empty", "add_expense", "add_income", "sales_report", "expense_summary", "income_summary"];

        if (leave) {
          const now = new Date();
          if (leave.targetSelf) {
            pushLeaveRequest({
              id: `${user?.id || "guest"}-${now.getTime()}`,
              userId: user?.id || null,
              userName: user?.name || "You",
              role: user?.role || "member",
              when: leave.when,
              note: leave.raw,
              status: "Approved",
              requestedVia: "AI Assistant",
              createdOn: now.toISOString(),
            });
            replyText = `Done — your leave for ${leave.when} has been recorded and approved. ✅`;
          } else {
            pushLeaveRequest({
              id: `${leave.targetId}-${now.getTime()}`,
              userId: leave.targetId,
              userName: leave.targetName,
              role: "member",
              when: leave.when,
              note: leave.raw,
              status: "Approved",
              requestedVia: "AI Assistant (granted by admin)",
              createdOn: now.toISOString(),
            });
            replyText = `Done — approved leave for ${leave.targetName} (${leave.when}).`;
          }
        } else if (adminOnlyTypes.includes(command.type) && !isAdmin) {
          replyText = "That's an admin-only action, so I can't do that from your account here — I can help with your own tasks, leave, or account instead.";
        } else if (command.type === "broadcast") {
          pushMessageToAll(command.message);
          replyText = `Done — sent "${command.message}" to all ${conversations.filter((c) => !c.peerAuthIds).length} members. Open Messages to see it.`;
        } else if (command.type === "broadcast_empty") {
          replyText = "Sure — what would you like me to send to everyone? Just type the message and I'll send it.";
          setPendingAction({ type: "broadcast" });
        } else if (command.type === "individual") {
          pushMessageToConversation(command.targetId, command.message);
          replyText = `Done — sent "${command.message}" to ${command.targetName}. Open Messages to see the conversation.`;
        } else if (command.type === "individual_empty") {
          replyText = `Sure — what would you like me to send to ${command.targetName}? Just type the message and I'll send it.`;
          setPendingAction({ type: "individual", targetId: command.targetId, targetName: command.targetName });
        } else if (command.type === "add_expense") {
          pushExpense(command.amount, command.note);
          replyText = `Done — logged a $${command.amount.toLocaleString()} expense for "${command.note}" to your Expenses ledger. Open Expenses to see it.`;
        } else if (command.type === "add_income") {
          pushIncome(command.amount, command.note);
          replyText = `Done — logged $${command.amount.toLocaleString()} of income for "${command.note}" to your Income ledger. Open Income to see it.`;
        } else if (command.type === "sales_report") {
          replyText = respond("sales report", { selectedDateRange });
        } else if (command.type === "expense_summary") {
          replyText = summarizeLedger(expenses, "expense");
        } else if (command.type === "income_summary") {
          replyText = summarizeLedger(income, "income");
        } else {
          replyText = isAdmin ? respond(clean, { selectedDateRange }) : respondForEmployee(clean);
        }
      }

      setMessages((m) => [
        ...m,
        { from: "ai", text: replyText, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) },
      ]);
    }, 700);
  }

  function exportReport() {
    setExporting(true);

    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const marginX = 40;
    const violet = [124, 58, 237]; // matches the app's violet-600 accent
    const slate = [71, 85, 105];

    // ---------- Header ----------
    doc.setFillColor(...violet);
    doc.rect(0, 0, pageWidth, 70, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text("Hopenix Report", marginX, 40);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(selectedDateRange, marginX, 58);
    doc.setTextColor(0, 0, 0);

    let cursorY = 95;

    const sectionTitle = (title) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(...violet);
      doc.text(title, marginX, cursorY);
      doc.setTextColor(0, 0, 0);
      cursorY += 8;
    };

    const runTable = (head, body) => {
      autoTable(doc, {
        startY: cursorY,
        head: [head],
        body,
        margin: { left: marginX, right: marginX },
        theme: "striped",
        headStyles: { fillColor: violet, textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [245, 243, 255] },
        styles: { fontSize: 9, cellPadding: 5, textColor: slate },
        didDrawPage: () => {
          cursorY = 60; // reset after an automatic page break
        },
      });
      cursorY = doc.lastAutoTable.finalY + 24;
    };

    // ---------- Summary ----------
    sectionTitle("Summary");
    const summaryStats = STATS_BY_RANGE[selectedDateRange] || STATS_BY_RANGE["This Month"];
    runTable(
      ["Metric", "Value", "Change vs last month"],
      STAT_CARDS.map((s, i) => [s.label, String(summaryStats[i].value), String(summaryStats[i].delta)])
    );

    // ---------- Sales Overview ----------
    sectionTitle("Sales Overview");
    runTable(
      ["Day", "Sales", "Base"],
      SALES_DATA.map((s) => [s.day, String(s.sales), String(s.base)])
    );

    // ---------- Weekly Statistics ----------
    sectionTitle(`Statistics — ${statsMetric} (${statsPeriod})`);
    runTable(
      ["Day", "Value (%)", "Change"],
      currentStats.bars.map((s) => [s.day, String(s.value), String(s.delta)])
    );

    // ---------- Most Orders by Country ----------
    sectionTitle("Most Orders by Country");
    runTable(
      ["Name", "City", "Amount", "Rank"],
      COUNTRY_ORDERS.map((o) => [o.name, o.city, String(o.amount), String(o.rank)])
    );

    // ---------- Expenses ----------
    sectionTitle("Expenses");
    runTable(
      ["Note", "Category", "Amount", "Date", "Added Via"],
      expenses.map((e) => [e.note, e.category, String(e.amount), e.date, e.addedVia])
    );

    // ---------- Income ----------
    sectionTitle("Income");
    runTable(
      ["Note", "Category", "Amount", "Date", "Added Via"],
      income.map((e) => [e.note, e.category, String(e.amount), e.date, e.addedVia])
    );

    // ---------- Footer page numbers ----------
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(
        `Hopenix — ${selectedDateRange} — Page ${i} of ${pageCount}`,
        pageWidth / 2,
        doc.internal.pageSize.getHeight() - 20,
        { align: "center" }
      );
    }

    const safeRange = selectedDateRange.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    doc.save(`hopenix-report-${safeRange}.pdf`);

    setTimeout(() => setExporting(false), 600);
  }


  function handleLogout() {
    setAiOpen(false);
    setNotifOpen(false);
    // Clear the shared auth state (in-memory + persisted session) and send
    // the user back to the real /login route (ProtectedRoute will also
    // catch this automatically if handleLogout is ever skipped).
    logout();
    navigate("/login");
  }

  const card = darkMode ? "bg-slate-900 border border-slate-800" : "bg-white";
  const cardText = darkMode ? "text-slate-200" : "text-slate-800";
  const subtleText = darkMode ? "text-slate-500" : "text-slate-400";
  const mutedText = darkMode ? "text-slate-400" : "text-slate-500";
  const headingText = darkMode ? "text-white" : "text-slate-900";

  const isCustomPage = [
    "Dashboard",
    "Users",
    "Tasks",
    "Projects",
    "Zip Files",
    "Employees",
    "Clients",
    "Messages",
    "Expenses",
    "Income",
    "Sales",
    "Settings",
    "Reports",
    "Meetings",
    "Coworking Space",
    "Visitors",
  ].includes(active);

  // If this account has been fully locked out — UserPage's Individual
  // User Access panel set to "No Access" (mode: "none"), or a role whose
  // page list is just empty — `allowedPages` resolves to []. That used
  // to leave the dashboard shell rendering as normal (nothing below was
  // actually gated on it, so `active` just stayed on whatever it last
  // was, "Dashboard" most of the time, and its content showed anyway).
  // Block the entire shell here instead: no sidebar, no page content,
  // nothing — just this message and a way to log out. This has to be a
  // plain `if` + early return placed AFTER every hook above (not before
  // it), so hook order never changes between renders.
  if (user && allowedPages.length === 0) {
    return (
      <div className={`h-screen w-full flex items-center justify-center px-4 font-sans transition-colors ${darkMode ? "bg-slate-950 text-slate-200" : "bg-[#f4f5fa] text-slate-800"}`}>
        <div className={`w-full max-w-sm rounded-2xl p-8 text-center shadow-xl ${card}`}>
          <div className="w-14 h-14 mx-auto rounded-full bg-rose-50 text-rose-500 flex items-center justify-center mb-4">
            <Lock className="w-6 h-6" />
          </div>
          <h1 className={`text-base font-bold ${headingText}`}>You are not able to access this website</h1>
          <p className={`text-xs mt-2 leading-relaxed ${mutedText}`}>
            Your account currently doesn&apos;t have access to any page. Please contact an admin if you think this is a mistake.
          </p>
          <button
            onClick={handleLogout}
            className="mt-6 w-full flex items-center justify-center gap-2 text-sm font-semibold py-2.5 rounded-full bg-rose-600 hover:bg-rose-500 text-white transition"
          >
            <LogOut className="w-4 h-4" /> Logout
          </button>
        </div>
      </div>
    );
  }

  return (
    <MessagingSocketProvider darkMode={darkMode}>
    <div className={`h-screen w-full font-sans flex overflow-hidden text-[13px] transition-colors ${darkMode ? "bg-slate-950 text-slate-200" : "bg-[#f4f5fa] text-slate-800"}`}>
      <BirthdayCelebration user={user} soundSrc={birthdayTune} />
      {/* -------------------------------------------------- Sidebar */}
      {/* Mobile (<lg): fixed off-canvas drawer, hidden unless mobileSidebarOpen
          is toggled from the header's hamburger button — it overlays the page
          instead of squeezing the content. Desktop (lg+): unchanged, always
          in-flow, collapse/expand exactly as before. */}
      <aside
        className={`fixed lg:relative inset-y-0 left-0 z-[60] h-screen w-64 shrink-0 bg-[#100c2a] text-slate-300 flex flex-col overflow-hidden transition-all duration-300 ${
          mobileSidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        } ${sidebarCollapsed ? "lg:w-20" : "lg:w-60"}`}
      >
        <div className={`flex items-center shrink-0 px-5 py-5 ${sidebarCollapsed ? "flex-col gap-3 justify-center px-0" : "justify-between"}`}>
          {sidebarCollapsed && (
            <button
              className="hidden lg:flex text-slate-400 hover:text-white"
              onClick={() => setSidebarCollapsed(false)}
              aria-label="Expand menu"
            >
              <Menu size={18} />
            </button>
          )}
          <div
            className={`flex items-center gap-2 min-w-0 ${sidebarCollapsed ? "cursor-pointer lg:cursor-default" : ""}`}
            onClick={() => {
              if (sidebarCollapsed) setSidebarCollapsed(false);
            }}
          >
            <span className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center overflow-hidden shrink-0">
              <img src={logo} alt="Hopenix logo" className="w-full h-full object-contain" />
            </span>
            {!sidebarCollapsed && (
              <span className="text-base font-bold text-white tracking-wide whitespace-nowrap">
                HOPE<span className="text-violet-400">NIX</span>
              </span>
            )}
          </div>
          {!sidebarCollapsed && (
            <button
              className="text-slate-400 hover:text-white"
              onClick={() => {
                setSidebarCollapsed(true);
                setMobileSidebarOpen(false);
              }}
              aria-label="Close menu"
            >
              <X size={18} />
            </button>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 space-y-0.5">
          {visibleNavItems.map(({ label, icon: Icon }) => {
            const isActive = active === label;
            // Red dot: lights up when this user has a new project/task
            // assignment (sidebarDots, fed by ProjectsPage/TasksPage's own
            // notification system), an unread message (messagesUnreadTotal,
            // derived straight from the shared conversations state), or the
            // generic "something happened on this page" flag any page can
            // set via flagPageActivity() (see hasPageActivityFlag above —
            // already folded into sidebarDots[label] for Projects/Tasks too).
            const showDot =
              (label === "Projects" && sidebarDots.Projects) ||
              (label === "Tasks" && sidebarDots.Tasks) ||
              (label === "Messages" && messagesUnreadTotal > 0) ||
              !!sidebarDots[label];
            return (
              <button
                key={label}
                title={sidebarCollapsed ? label : undefined}
                onClick={() => {
                  // Client Portal is a separate client-facing page with its
                  // own login (Client ID + email + password) — it isn't one of the
                  // in-dashboard tabs, so open it in a new tab instead of
                  // switching `active`.
                  if (label === "Client Portal") {
                    window.open("/client-portal", "_blank", "noopener,noreferrer");
                    clearPageActivity(label, { name: user?.name, isAdminOrManager });
                    return;
                  }
                  setActive(label);
                  // Opening a page clears its own generic activity dot for
                  // whoever just opened it — same "seen it, dot goes away"
                  // behavior Projects/TasksPage already handle themselves
                  // for their own assignment flags.
                  clearPageActivity(label, { name: user?.name, isAdminOrManager });
                  // On mobile the sidebar is an overlay drawer — picking a
                  // page should close it so the page underneath is visible.
                  setMobileSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-lg text-[12.5px] font-medium transition-colors ${
                  sidebarCollapsed ? "justify-center px-0" : ""
                } ${
                  isActive
                    ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-900/30"
                    : "text-slate-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                <span className="relative shrink-0">
                  <Icon size={16} />
                  {showDot && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-[#100c2a]" />
                  )}
                </span>
                {!sidebarCollapsed && <span className="truncate">{label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="p-3 shrink-0 space-y-2">
          <button
            type="button"
            title={sidebarCollapsed ? "Logout" : undefined}
            onClick={() => {
              setLogoutConfirmOpen(true);
              // Close the mobile drawer so it doesn't sit on top of (or behind)
              // the confirmation popup — the popup should be the only thing showing.
              setMobileSidebarOpen(false);
            }}
            className={`relative z-10 w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-[12.5px] font-medium text-rose-300 hover:bg-rose-500/10 hover:text-rose-200 transition-colors border border-white/5 cursor-pointer ${
              sidebarCollapsed ? "justify-center px-0" : ""
            }`}
          >
            <LogOut size={16} />
            {!sidebarCollapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>

      {/* Backdrop behind the mobile sidebar drawer — tap outside to close.
          Sits above the header (z-50) but below the drawer itself (z-60). */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-[55] lg:hidden"
          onClick={() => {
            setMobileSidebarOpen(false);
            setSidebarCollapsed(true);
          }}
        />
      )}

      {/* -------------------------------------------------- Right side (header + main + AI) */}
      <div className="flex-1 min-w-0 h-screen flex flex-col overflow-hidden">
        {/* Header spans the full width of main + AI assistant columns */}
        <header className={`relative shrink-0 border-b shadow-sm px-4 sm:px-6 py-3 flex items-center justify-between gap-2 sm:gap-4 z-50 lg:z-[75] ${darkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-100"}`}>
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {/* Hamburger ("3 bar") button — mobile-only trigger for the
                off-canvas sidebar drawer. Sidebar stays hidden until tapped. */}
            <button
              onClick={() => {
                setMobileSidebarOpen(true);
                setSidebarCollapsed(false);
              }}
              className={`lg:hidden shrink-0 -ml-1 p-1.5 rounded-lg ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-100"} ${mutedText}`}
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>
            <div className="min-w-0">
              <p className={`hidden sm:flex text-[11px] items-center gap-1 ${mutedText}`}>
                Welcome back, {user?.name || "there"} <span>👋</span>
              </p>
              <h1 className={`text-base sm:text-xl font-bold leading-tight truncate ${headingText}`}>{active}</h1>
            </div>
          </div>

          <div className="relative hidden md:block w-full max-w-[240px]">
            <div className={`flex items-center gap-2 rounded-lg px-3 py-2 ${darkMode ? "bg-slate-800" : "bg-slate-50"}`}>
              <Search size={14} className={`shrink-0 ${subtleText}`} />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && searchResults.length > 0) {
                    goToSearchResult(searchResults[0].label);
                  } else if (e.key === "Escape") {
                    setSearchFocused(false);
                  }
                }}
                placeholder="Search anything..."
                className="flex-1 outline-none text-xs placeholder:text-slate-400 bg-transparent min-w-0"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className={subtleText} aria-label="Clear search">
                  <X size={12} />
                </button>
              )}
            </div>

            {searchFocused && searchQuery && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setSearchFocused(false)} />
                <div className={`absolute left-0 right-0 top-full mt-1.5 rounded-lg shadow-xl z-50 overflow-hidden ${card}`}>
                  {searchResults.length > 0 ? (
                    searchResults.map(({ label, icon: Icon }) => (
                      <button
                        key={label}
                        onClick={() => goToSearchResult(label)}
                        className={`w-full flex items-center gap-2.5 text-left px-3 py-2 text-[11.5px] font-medium transition-colors ${
                          darkMode ? "text-slate-300 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        <Icon size={13} className="text-violet-500 shrink-0" />
                        {label}
                      </button>
                    ))
                  ) : (
                    <p className={`px-3 py-2.5 text-[11px] ${subtleText}`}>No matching pages for &quot;{searchQuery}&quot;</p>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            {/* Notifications — real data from /api/dashboard/notifications/
                (new clients, received payments, pending expenses/module
                requests), falling back to the demo array only if that
                fetch hasn't resolved yet or failed. */}
            {(() => {
              const notifications = liveNotifications || NOTIFICATIONS;
              return (
            <div className="relative">
              <button
                onClick={() => setNotifOpen((v) => !v)}
                className={`relative shrink-0 ${darkMode ? "text-slate-400 hover:text-white" : "text-slate-500 hover:text-slate-800"}`}
                aria-label="Notifications"
              >
                <Bell size={18} />
                {notifications.length > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white text-[9px] font-bold w-3.5 h-3.5 rounded-full flex items-center justify-center">
                    {notifications.length}
                  </span>
                )}
              </button>

              {notifOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
                  {/* Mobile: fixed banner pinned by left/right margins so it can
                      never overflow the viewport, regardless of where the bell
                      icon sits in the header. Desktop (sm+): reverts to the
                      original anchored dropdown right under the bell icon. */}
                  <div
                    className={`fixed top-16 right-3 w-64 max-w-[85vw] sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-72 sm:max-w-none rounded-xl shadow-xl z-50 overflow-hidden ${card}`}
                  >
                    <div className={`px-3.5 py-2.5 border-b ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
                      <p className={`text-xs font-semibold ${cardText}`}>Notifications</p>
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {notifications.map((n) => (
                        <button
                          key={n.id}
                          onClick={() => setNotifOpen(false)}
                          className={`w-full text-left px-3.5 py-2.5 flex gap-2.5 border-b last:border-b-0 transition-colors ${
                            darkMode ? "border-slate-800 hover:bg-slate-800/60" : "border-slate-50 hover:bg-slate-50"
                          }`}
                        >
                          <span className="mt-0.5 shrink-0 w-6 h-6 rounded-full bg-violet-50 text-violet-600 flex items-center justify-center">
                            <CircleCheck size={12} />
                          </span>
                          <span className="flex-1 min-w-0">
                            <p className={`text-[11.5px] font-semibold ${cardText}`}>{n.title}</p>
                            <p className={`text-[10.5px] mt-0.5 ${subtleText}`}>{n.desc}</p>
                            <p className={`text-[9.5px] mt-1 flex items-center gap-1 ${subtleText}`}>
                              <Clock size={9} /> {liveNotifications ? timeAgo(n.time) : n.time}
                            </p>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
              );
            })()}

            {/* Dark mode toggle — now functional, visible on all screen sizes */}
            <button
              onClick={() => setDarkMode((v) => !v)}
              className={`shrink-0 ${mutedText}`}
              aria-label="Toggle dark mode"
            >
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            <div className="relative shrink-0">
              <button
                onClick={() => {
                  setProfileMenuOpen((v) => !v);
                  setNotifOpen(false);
                }}
                className="flex items-center gap-2"
                aria-label="Open profile menu"
              >
                <img src={avatar} alt={user?.name || "Profile"} className="w-8 h-8 rounded-full object-cover shrink-0" />
                <span className="hidden sm:flex flex-col items-start leading-tight">
                  <span className={`text-xs font-semibold ${cardText}`}>{user?.name || "User"}</span>
                  <span className={`text-[10px] capitalize ${subtleText}`}>{user?.role || "Member"}</span>
                </span>
                <ChevronDown size={12} className={`hidden sm:block transition-transform ${profileMenuOpen ? "rotate-180" : ""} ${subtleText}`} />
              </button>

              {profileMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setProfileMenuOpen(false)} />
                  <div className={`absolute right-0 top-full mt-2 w-52 max-w-[85vw] rounded-xl shadow-xl z-50 overflow-hidden ${card}`}>
                    {/* Person name */}
                    <div className={`px-4 py-2.5 border-b ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
                      <p className={`text-xs font-semibold truncate ${cardText}`}>{user?.name || "User"}</p>
                      <p className={`text-[10px] capitalize ${subtleText}`}>{user?.role || "Member"}</p>
                    </div>

                    {/* Menu actions */}
                    <div className="py-1.5">
                      <button
                        onClick={() => {
                          setActive("Settings");
                          setProfileMenuOpen(false);
                        }}
                        className={`w-full flex items-center gap-2.5 text-left px-4 py-2 text-[11.5px] font-medium transition-colors ${
                          darkMode ? "text-slate-300 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        <Settings size={14} className="shrink-0" />
                        Settings
                      </button>
                      <button
                        onClick={() => {
                          setProfileMenuOpen(false);
                          setLogoutConfirmOpen(true);
                        }}
                        className="w-full flex items-center gap-2.5 text-left px-4 py-2 text-[11.5px] font-medium text-rose-600 hover:bg-rose-50 transition-colors"
                      >
                        <LogOut size={14} className="shrink-0" />
                        Logout
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
            {showAiAssistant && (
              <button
                onClick={() => setAiOpen((v) => !v)}
                className="lg:hidden w-8 h-8 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 text-white flex items-center justify-center shrink-0"
                aria-label={aiOpen ? "Close AI Assistant" : "Open AI Assistant"}
              >
                {aiOpen ? <X size={16} /> : <Sparkles size={14} />}
              </button>
            )}
          </div>
        </header>

        {/* Below the header: scrollable main content + AI assistant, side by side */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* -------------------------------------------------- Main */}
          <main className="flex-1 min-w-0 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
            {!isCustomPage && <PlaceholderPage title={active} darkMode={darkMode} />}
            {active === "Users" && <UserPage darkMode={darkMode} />}
            {/* `conversations`/`setConversations` passed down so newly
                assigning a task to someone also sends them a real message
                over on the Messages page — see notifyAssigneesOfTask in
                TasksPage.jsx. Same shared state ProjectsPage already gets
                for its own manager↔member 1:1 threads. */}
            {active === "Tasks" && (
              <TasksPage darkMode={darkMode} conversations={conversations} setConversations={setConversations} />
            )}
            {/* `conversations`/`setConversations` (the full, unfiltered list —
                same one MessagesPage's admin view gets) are passed down so a
                project's manager automatically gets a 1:1 thread linked with
                each of their team members over on the Messages page — see
                syncProjectPeerConversations in ProjectsPage.jsx. */}
            {active === "Projects" && (
              <ProjectsPage darkMode={darkMode} conversations={conversations} setConversations={setConversations} approvedUsers={approvedUsers} onNavigate={setActive} />
            )}
            {active === "Zip Files" && <ZipFilesPage darkMode={darkMode} />}
            {active === "Meetings" && <MeetingsPage darkMode={darkMode} />}
            {active === "Visitors" && <VisitorsPage darkMode={darkMode} />}
            {active === "Employees" && <EmployeesPage darkMode={darkMode} />}
            {active === "Clients" && <ClientsPage darkMode={darkMode} />}
            {active === "Expenses" && <ExpensesPage darkMode={darkMode} />}
            {active === "Income" && <IncomePage darkMode={darkMode} />}
            {active === "Sales" && <SalesPage darkMode={darkMode} />}
            {active === "Settings" && (
              <SettingsPage darkMode={darkMode} setDarkMode={setDarkMode} avatar={avatar} onAvatarChange={updateAvatar} />
            )}
            {/* `conversations`/`setConversations` (the full, unfiltered list —
                same one TasksPage/ProjectsPage get above) are passed down so
                the admin-only "Message" action on a daily report can send
                straight into that employee's Messages thread. */}
            {active === "Reports" && <ReportsPage darkMode={darkMode} onNavigate={setActive} conversations={conversations} setConversations={setConversations} />}
            {active === "Coworking Space" && <CoworkingSpacePage darkMode={darkMode} onNavigate={setActive} role={getRoleCategory(user?.role)} />}
            {active === "Messages" && (
              <MessagesPage
                darkMode={darkMode}
                conversations={visibleConversations}
                setConversations={setConversations}
                isPrivilegedViewer={canSeeAllConversations}
                viewerId={user?.id}
              />
            )}

            {active === "Dashboard" && (
              <>
                <div className="flex justify-end gap-2 flex-wrap">
                  <div className="relative">
                    <button
                      onClick={() => setDateRangeOpen((v) => !v)}
                      className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium shadow-sm ${card} ${mutedText}`}
                    >
                      <Calendar size={13} />
                      <span className="max-w-[140px] sm:max-w-none truncate">{selectedDateRange}</span>
                      <ChevronDown size={12} className={`shrink-0 transition-transform ${dateRangeOpen ? "rotate-180" : ""}`} />
                    </button>

                    {dateRangeOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setDateRangeOpen(false)} />
                        <div className={`absolute right-0 sm:left-0 top-full mt-1.5 w-48 rounded-lg shadow-xl z-50 overflow-hidden ${card}`}>
                          {DATE_RANGE_OPTIONS.map((opt) => (
                            <button
                              key={opt}
                              onClick={() => {
                                setSelectedDateRange(opt);
                                setDateRangeOpen(false);
                              }}
                              className={`w-full text-left px-3 py-2 text-[11.5px] font-medium transition-colors ${
                                opt === selectedDateRange
                                  ? "bg-violet-600 text-white"
                                  : darkMode
                                  ? "text-slate-300 hover:bg-slate-800"
                                  : "text-slate-600 hover:bg-slate-50"
                              }`}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  <button
                    onClick={exportReport}
                    disabled={exporting}
                    className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-lg px-3 py-1.5 text-xs font-medium shadow-sm disabled:opacity-70"
                  >
                    {exporting ? (
                      <span className="w-3 h-3 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                    ) : (
                      <Download size={13} />
                    )}
                    Export Report
                  </button>
                </div>

                {/* Stat cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                  {STAT_CARDS.map(({ label, hero, icon: Icon, page }, i) => {
                    const stat = (liveStats || STATS_BY_RANGE[selectedDateRange] || STATS_BY_RANGE["This Month"])[i];
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => setActive(page)}
                        className={`text-left rounded-xl p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-violet-400 ${
                          hero ? "bg-gradient-to-br from-violet-600 to-indigo-600 text-white" : `${card} ${cardText}`
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <span className={`text-xs font-medium ${hero ? "text-violet-100" : mutedText}`}>{label}</span>
                          {hero ? (
                            <MoreHorizontal size={16} className="text-violet-100" />
                          ) : (
                            <span className="w-7 h-7 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center">
                              <Icon size={14} />
                            </span>
                          )}
                        </div>
                        {statsLoading ? (
                          <>
                            <div className={`h-6 sm:h-7 w-16 rounded-md mt-2.5 animate-pulse ${hero ? "bg-white/20" : darkMode ? "bg-slate-700/60" : "bg-slate-200/70"}`} />
                            <div className={`h-4 w-24 rounded-md mt-2 animate-pulse ${hero ? "bg-white/10" : darkMode ? "bg-slate-700/40" : "bg-slate-100"}`} />
                          </>
                        ) : (
                          <>
                            <p className="text-xl sm:text-2xl font-bold mt-2.5">{stat.value}</p>
                            <div className="flex items-center gap-2 mt-2">
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${hero ? "bg-white/20 text-white" : "bg-emerald-50 text-emerald-600"}`}>
                                {stat.delta}
                              </span>
                              <span className={`text-[10px] ${hero ? "text-violet-100" : subtleText}`}>
                                vs last {selectedDateRange.toLowerCase().includes("year") ? "year" : selectedDateRange.toLowerCase().includes("quarter") ? "quarter" : selectedDateRange.toLowerCase().includes("week") ? "week" : "month"}
                              </span>
                            </div>
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Charts row */}
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 xl:items-stretch">
                  {/* Sales overview */}
                  <div className={`rounded-xl p-4 shadow-sm flex flex-col ${card}`}>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <h3 className={`font-semibold text-sm ${cardText}`}>Sales Overview</h3>
                        <p className={`text-[10px] mt-0.5 ${subtleText}`}>Your current sales summary and activity</p>
                      </div>
                      <button className={`flex items-center gap-1 text-[10px] font-medium border rounded-md px-2 py-1 ${mutedText} ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                        Default View <ChevronDown size={10} />
                      </button>
                    </div>
                    <div className="h-[260px] mt-2 -ml-2 flex-1">
                      {salesLoading ? (
                        <div className={`w-full h-full rounded-lg animate-pulse ${darkMode ? "bg-slate-800/60" : "bg-slate-100"}`} />
                      ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart key={chartsAnimKey} data={liveSales || SALES_DATA} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                          <CartesianGrid vertical={false} stroke={darkMode ? "#1e293b" : "#eef0f6"} />
                          <XAxis dataKey="day" tick={{ fontSize: 9, fill: darkMode ? "#64748b" : "#94a3b8" }} tickLine={false} axisLine={false} interval={2} />
                          <YAxis tick={{ fontSize: 9, fill: darkMode ? "#64748b" : "#94a3b8" }} tickLine={false} axisLine={false} width={30} />
                          <Tooltip
                            contentStyle={{
                              borderRadius: 10,
                              border: "none",
                              boxShadow: "0 4px 14px rgba(0,0,0,0.1)",
                              fontSize: 11,
                              background: darkMode ? "#1e293b" : "#fff",
                              color: darkMode ? "#e2e8f0" : "#1e293b",
                            }}
                          />
                          <Line
                            type="monotone"
                            dataKey="base"
                            stroke="#c7d2fe"
                            strokeWidth={2}
                            strokeDasharray="4 4"
                            dot={false}
                            isAnimationActive={true}
                            animationDuration={1400}
                            animationEasing="ease-out"
                          />
                          <Line
                            type="monotone"
                            dataKey="sales"
                            stroke="#6366f1"
                            strokeWidth={2.5}
                            dot={{ r: 2.5, fill: "#6366f1" }}
                            activeDot={{ r: 4 }}
                            isAnimationActive={true}
                            animationDuration={1400}
                            animationEasing="ease-out"
                          />
                        </LineChart>
                      </ResponsiveContainer>
                      )}
                    </div>
                  </div>

                  {/* User Growth */}
                  <div className={`rounded-xl p-4 shadow-sm flex flex-col ${card}`}>
                    <div className="flex items-center justify-between">
                      <h3 className={`font-semibold text-sm ${cardText}`}>User Growth</h3>
                      <MoreHorizontal size={16} className={subtleText} />
                    </div>
                    <div className="flex gap-1.5 mt-2.5 flex-wrap">
                      {Object.keys(USER_GROWTH_BY_PERIOD).map((t) => (
                        <button
                          key={t}
                          onClick={() => setGrowthPeriod(t)}
                          className={`text-[10px] font-medium px-2.5 py-1 rounded-md transition-colors ${
                            t === growthPeriod
                              ? "bg-violet-600 text-white"
                              : darkMode
                              ? "bg-slate-800 text-slate-400 hover:bg-slate-700"
                              : "bg-slate-50 text-slate-500 hover:bg-slate-100"
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                    {growthLoading ? (
                      <>
                        <div className="flex items-end gap-2 mt-5 flex-wrap">
                          <div className={`h-7 w-14 rounded-md animate-pulse ${darkMode ? "bg-slate-700/60" : "bg-slate-200/70"}`} />
                          <div className={`h-4 w-12 rounded-full mb-1 animate-pulse ${darkMode ? "bg-slate-700/40" : "bg-slate-100"}`} />
                        </div>
                        <div className={`w-full h-2.5 rounded-full mt-4 overflow-hidden animate-pulse ${darkMode ? "bg-slate-800" : "bg-slate-100"}`} />
                        <div className={`h-3 w-3/4 rounded-md mt-3 animate-pulse ${darkMode ? "bg-slate-700/40" : "bg-slate-100"}`} />
                      </>
                    ) : (
                      <>
                        <div className="flex items-end gap-2 mt-5 flex-wrap">
                          <span className={`text-2xl font-bold ${headingText}`}>{currentGrowth.total}</span>
                          <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full mb-1">{currentGrowth.delta}</span>
                        </div>
                        <div className={`w-full h-2.5 rounded-full mt-4 overflow-hidden ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}>
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-violet-600 to-sky-400 transition-all duration-500"
                            style={{ width: `${currentGrowth.progress}%` }}
                          />
                        </div>
                        <div className={`flex items-center justify-between mt-3 text-[10px] gap-2 ${subtleText}`}>
                          <span className="truncate">{currentGrowth.note}</span>
                          <span className="text-emerald-600 font-medium whitespace-nowrap">{currentGrowth.highlightNote}</span>
                        </div>
                      </>
                    )}
                    <div className="flex-1" />
                  </div>

                  {/* Customers Volume */}
                  <div className={`rounded-xl p-4 shadow-sm flex flex-col ${card}`}>
                    <div className="flex items-center justify-between">
                      <h3 className={`font-semibold text-sm ${cardText}`}>Customers Volume</h3>
                      <MoreHorizontal size={16} className={subtleText} />
                    </div>
                    <div className="flex-1 flex flex-col justify-center">
                      {statsLoading ? (
                        <div className="flex flex-col items-center justify-center gap-2 py-4">
                          <div className={`w-24 h-24 rounded-full animate-pulse ${darkMode ? "bg-slate-700/50" : "bg-slate-200/70"}`} />
                          <div className={`h-3 w-20 rounded-md animate-pulse ${darkMode ? "bg-slate-700/40" : "bg-slate-100"}`} />
                        </div>
                      ) : (
                        <CustomerGauge
                          value={liveStats ? liveStats[3].value : 145}
                          label="New Customers"
                          dark={darkMode}
                          animate={chartsPlay}
                        />
                      )}
                    </div>
                    <div className={`flex items-center justify-between mt-1 text-[10px] gap-2 ${subtleText}`}>
                      <span>Your customer volume has increased</span>
                      {statsLoading ? (
                        <span className={`h-4 w-12 rounded-full animate-pulse ${darkMode ? "bg-slate-700/40" : "bg-slate-100"}`} />
                      ) : (
                        <span className="text-emerald-600 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                          {liveStats ? liveStats[3].delta : "+ 25%"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Statistics + Most order */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Statistics */}
                  <div className={`rounded-xl p-4 shadow-sm ${card}`}>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <h3 className={`font-semibold text-sm ${cardText}`}>Statistics</h3>
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className={`flex rounded-md p-0.5 ${darkMode ? "bg-slate-800" : "bg-slate-50"}`}>
                          {Object.keys(STATS_DATASETS).map((metric) => (
                            <button
                              key={metric}
                              onClick={() => setStatsMetric(metric)}
                              className={`text-[10px] font-semibold px-2.5 py-1 rounded-md transition-colors ${
                                metric === statsMetric ? "bg-violet-600 text-white" : mutedText
                              }`}
                            >
                              {metric}
                            </button>
                          ))}
                        </div>
                        <div className="relative">
                          <button
                            onClick={() => setStatsPeriodOpen((v) => !v)}
                            className={`flex items-center gap-1 text-[10px] font-medium border rounded-md px-2 py-1 ${mutedText} ${darkMode ? "border-slate-700" : "border-slate-200"}`}
                          >
                            {statsPeriod}
                            <ChevronDown size={10} className={`transition-transform ${statsPeriodOpen ? "rotate-180" : ""}`} />
                          </button>
                          {statsPeriodOpen && (
                            <>
                              <div className="fixed inset-0 z-40" onClick={() => setStatsPeriodOpen(false)} />
                              <div className={`absolute right-0 top-full mt-1.5 w-28 rounded-lg shadow-xl z-50 overflow-hidden ${card}`}>
                                {STATS_PERIOD_OPTIONS.map((opt) => (
                                  <button
                                    key={opt}
                                    onClick={() => {
                                      setStatsPeriod(opt);
                                      setStatsPeriodOpen(false);
                                    }}
                                    className={`w-full text-left px-3 py-2 text-[11px] font-medium transition-colors ${
                                      opt === statsPeriod
                                        ? "bg-violet-600 text-white"
                                        : darkMode
                                        ? "text-slate-300 hover:bg-slate-800"
                                        : "text-slate-600 hover:bg-slate-50"
                                    }`}
                                  >
                                    {opt}
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {isStatsWidgetLoading ? (
                      <div className="flex flex-col sm:flex-row items-center sm:items-end gap-4 mt-5">
                        <div className="shrink-0 text-center sm:text-left">
                          <div className={`h-8 w-16 rounded-md mx-auto sm:mx-0 animate-pulse ${darkMode ? "bg-slate-700/60" : "bg-slate-200/70"}`} />
                          <div className={`h-3 w-24 rounded-md mt-2 mx-auto sm:mx-0 animate-pulse ${darkMode ? "bg-slate-700/40" : "bg-slate-100"}`} />
                        </div>
                        <div className="flex-1 w-full flex items-end justify-between gap-2 h-32">
                          {Array.from({ length: 7 }).map((_, i) => (
                            <div key={i} className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
                              <div className="w-full flex items-end h-20">
                                <div
                                  className={`w-full rounded-t-md animate-pulse ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}
                                  style={{ height: `${30 + (i % 4) * 15}%` }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                    <div className="flex flex-col sm:flex-row items-center sm:items-end gap-4 mt-5">
                      <div className="shrink-0 text-center sm:text-left">
                        <p className={`text-3xl font-bold ${headingText}`}>{currentStats.headline}</p>
                        <p className={`text-[10px] mt-1.5 max-w-[130px] ${subtleText}`}>{currentStats.note}</p>
                      </div>
                      <div className="flex-1 w-full flex items-end justify-between gap-2 h-32">
                        {currentStats.bars.map(({ day, value, delta }, barIdx) => (
                          <div key={day} className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
                            <span className={`text-[9px] font-semibold ${subtleText}`}>{delta}</span>
                            <div className="w-full flex items-end h-20">
                              <div
                                className={`w-full rounded-t-md transition-all ease-out ${
                                  value === maxStatValue ? "bg-gradient-to-t from-violet-600 to-violet-400" : darkMode ? "bg-violet-900/40" : "bg-violet-100"
                                }`}
                                style={{
                                  height: chartsPlay ? `${value}%` : "0%",
                                  transitionDuration: "600ms",
                                  transitionDelay: `${barIdx * 45}ms`,
                                }}
                              />
                            </div>
                            <span className={`text-[9px] truncate w-full text-center ${subtleText}`}>{day}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    )}
                  </div>

                  {/* Most Order by Country */}
                  <div className={`rounded-xl p-4 shadow-sm ${card}`}>
                    <div className="flex items-center justify-between">
                      <h3 className={`font-semibold text-sm ${cardText}`}>Most Order by Country</h3>
                      <MoreHorizontal size={16} className={subtleText} />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                      <div className="space-y-3">
                        {countryOrdersLoading
                          ? Array.from({ length: 3 }).map((_, i) => (
                              <div key={i} className="flex items-center gap-2.5">
                                <div className={`w-8 h-8 rounded-full shrink-0 animate-pulse ${darkMode ? "bg-slate-700/50" : "bg-slate-200/70"}`} />
                                <div className={`h-3 flex-1 rounded-md animate-pulse ${darkMode ? "bg-slate-700/40" : "bg-slate-100"}`} />
                              </div>
                            ))
                          : (liveCountryOrders || COUNTRY_ORDERS).map((o) => (
                          <div key={o.name} className="flex items-center gap-2.5">
                            {o.avatar ? (
                              <img
                                src={o.avatar}
                                alt={o.name}
                                className="w-8 h-8 rounded-full object-cover shrink-0 ring-2 ring-white/50"
                              />
                            ) : (
                              // FIX: no more random pravatar.cc fallback
                              // photo for a country with no uploaded
                              // client photo — a plain initials circle
                              // instead, same idea as the rest of the
                              // app's real AvatarCircle components.
                              <div
                                className="w-8 h-8 rounded-full shrink-0 ring-2 ring-white/50 flex items-center justify-center text-white text-[11px] font-bold bg-violet-500"
                                aria-hidden="true"
                              >
                                {(o.name || "?").trim().charAt(0).toUpperCase()}
                              </div>
                            )}
                            <p className={`text-[11px] flex-1 min-w-0 leading-snug ${mutedText}`}>
                              <span className={`font-semibold ${cardText}`}>{o.name}</span> {o.text}{" "}
                              <span className={`font-semibold ${cardText}`}>{o.amount}</span>
                            </p>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="w-[18px] h-[18px] rounded-full bg-violet-600 text-white text-[9px] font-bold flex items-center justify-center">
                                {o.rank}
                              </span>
                              <img
                                src={`https://flagcdn.com/w20/${o.countryCode}.png`}
                                alt={o.countryCode}
                                className="w-3.5 h-2.5 rounded-[2px] object-cover shrink-0"
                              />
                              <span className={`text-[10px] font-medium whitespace-nowrap ${cardText}`}>{o.city}</span>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Real (simplified) world map with a flag badge over
                          whichever country actually tops the data below —
                          not hardcoded to the US any more. */}
                      <div className={`relative rounded-lg min-h-[150px] overflow-hidden ${darkMode ? "bg-slate-800/60" : "bg-[#f7f8fc]"}`}>
                        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 118" preserveAspectRatio="xMidYMid meet">
                          <path d={WORLD_MAP_PATH} fill={darkMode ? "#334155" : "#c7cdf0"} stroke={darkMode ? "#475569" : "#b7bfe8"} strokeWidth="0.3" />
                        </svg>
                        {(() => {
                          const topCountry = (liveCountryOrders || COUNTRY_ORDERS)[0];
                          const marker = countryMarkerPosition(topCountry?.countryCode);
                          return (
                            <span
                              className="absolute flex flex-col items-center"
                              style={{ left: `${marker.xPct}%`, top: `${marker.yPct}%`, transform: "translate(-50%,-100%)" }}
                            >
                              <img
                                src={`https://flagcdn.com/w40/${topCountry?.countryCode || "us"}.png`}
                                alt={topCountry?.name || "Top country"}
                                className="w-6 h-4 rounded-[3px] object-cover shadow ring-1 ring-white mb-1"
                              />
                              <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 ring-4 ring-indigo-200 shadow" />
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </main>

          {/* -------------------------------------------------- AI Assistant panel
              (hidden on Users/Tasks/Projects/Employees/Clients/Sales/Settings/
              Reports/Expenses/Income — those pages have their own dedicated
              right-hand layout instead) */}
          {showAiAssistant && (
          <aside
            className={`fixed lg:static z-[70] lg:z-0 inset-y-0 right-0 w-full max-w-sm lg:w-[300px] lg:h-auto lg:shrink-0 border-l flex flex-col shadow-xl lg:shadow-none transition-transform duration-300 ${card} ${
              aiOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0"
            } ${darkMode ? "border-slate-800" : "border-slate-100"}`}
          >
            <div className={`flex items-center justify-between px-4 pt-4 pb-3 shrink-0 border-b ${darkMode ? "border-slate-800" : "border-slate-50"}`}>
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white">
                  <Sparkles size={14} />
                </span>
                <div>
                  <p className={`font-semibold text-xs ${cardText}`}>AI Assistant</p>
                  <p className={`text-[10px] ${subtleText}`}>Powered by Hopenix AI</p>
                </div>
              </div>
              <button
                className={`lg:hidden -mr-1.5 p-1.5 rounded-lg ${darkMode ? "hover:bg-slate-800 hover:text-white" : "hover:bg-slate-100 hover:text-slate-700"} ${subtleText}`}
                onClick={() => setAiOpen(false)}
                aria-label="Close AI Assistant"
              >
                <X size={18} />
              </button>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5 min-h-0">
              <p className={`text-[10px] ${subtleText}`}>You can type commands like:</p>
              {QUICK_COMMANDS.map((cmd) => (
                <button
                  key={cmd}
                  onClick={() => sendMessage(cmd)}
                  className={`w-full flex items-center justify-between gap-2 text-left text-[11px] font-medium rounded-lg px-3 py-2.5 transition-colors ${
                    darkMode ? "text-slate-300 bg-slate-800 hover:bg-violet-900/30 hover:text-violet-300" : "text-slate-600 bg-slate-50 hover:bg-violet-50 hover:text-violet-700"
                  }`}
                >
                  <span>{cmd}</span>
                  <Send size={12} className="shrink-0 text-violet-500" />
                </button>
              ))}

              <div className="pt-1.5 space-y-2.5">
                {messages.map((m, i) => (
                  <div key={i} className={`flex ${m.from === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[85%] rounded-xl px-3 py-2.5 text-[11px] whitespace-pre-line ${
                        m.from === "user"
                          ? "bg-gradient-to-br from-violet-600 to-indigo-600 text-white rounded-br-sm"
                          : darkMode
                          ? "bg-slate-800 text-slate-300 rounded-bl-sm"
                          : "bg-slate-50 text-slate-600 rounded-bl-sm"
                      }`}
                    >
                      {m.from === "ai" && (
                        <p className="font-semibold text-violet-500 mb-1 flex items-center gap-1 text-[10.5px]">
                          <Sparkles size={10} /> AI Assistant
                        </p>
                      )}
                      <p>{m.text}</p>
                      <p className={`mt-1 text-[9px] ${m.from === "user" ? "text-violet-100" : subtleText}`}>{m.time}</p>
                    </div>
                  </div>
                ))}
                {typing && (
                  <div className="flex justify-start">
                    <div className={`rounded-xl rounded-bl-sm px-3 py-2.5 flex gap-1 items-center ${darkMode ? "bg-slate-800" : "bg-slate-50"}`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.3s]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.15s]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className={`p-3 border-t shrink-0 ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
              <div className={`flex items-center gap-2 rounded-xl px-3 py-1.5 ${darkMode ? "bg-slate-800" : "bg-slate-50"}`}>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendMessage(input)}
                  placeholder={listening ? "Listening..." : "Type your command..."}
                  className="flex-1 bg-transparent text-[11px] outline-none placeholder:text-slate-400 min-w-0"
                />
                <button
                  onClick={toggleVoiceInput}
                  className={`shrink-0 rounded-full p-1 transition-colors ${
                    listening ? "text-rose-500 bg-rose-50 animate-pulse" : `hover:${darkMode ? "text-slate-200" : "text-slate-600"} ${subtleText}`
                  }`}
                  aria-label={listening ? "Stop recording" : "Record voice command"}
                  title={listening ? "Listening… tap to stop" : "Tap to speak"}
                >
                  <Mic size={14} />
                </button>
                <button
                  onClick={() => sendMessage(input)}
                  className="w-7 h-7 shrink-0 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 text-white flex items-center justify-center hover:opacity-90"
                  aria-label="Send"
                >
                  <Send size={12} />
                </button>
              </div>
            </div>
          </aside>
          )}

          {showAiAssistant && aiOpen && (
            <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={() => setAiOpen(false)} />
          )}
        </div>
      </div>

      {/* -------------------------------------------------- Logout confirmation popup */}
      {/* z-[80] — must sit above the mobile sidebar drawer (z-60) and the
          AI Assistant panel (z-70), or it renders hidden underneath them. */}
      {logoutConfirmOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 px-4">
          <div className={`w-full max-w-xs rounded-xl p-5 shadow-xl ${darkMode ? "bg-slate-900 border border-slate-800" : "bg-white"}`}>
            <h3 className={`text-sm font-semibold ${darkMode ? "text-white" : "text-slate-900"}`}>Logout?</h3>
            <p className={`text-xs mt-1.5 ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
              Are you sure you want to logout?
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => {
                  setLogoutConfirmOpen(false);
                  handleLogout();
                }}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700"
              >
                Yes
              </button>
              <button
                onClick={() => setLogoutConfirmOpen(false)}
                className={`text-xs font-medium px-3 py-1.5 rounded-lg ${
                  darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </MessagingSocketProvider>
  );
}