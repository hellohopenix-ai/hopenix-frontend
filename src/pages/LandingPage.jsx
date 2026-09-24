import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  ArrowRight,
  UserPlus,
  ShieldCheck,
  LayoutGrid,
  Sparkles,
  Briefcase,
  ListChecks,
  Users,
  Wallet,
  UserCog,
  BarChart3,
  CheckCircle2,
  Menu,
  X,
  LogIn,
  Search,
  Bell,
  Calendar,
  Home as HomeIcon,
  FolderKanban,
  CheckSquare,
  Receipt,
  FileBarChart2,
  Settings,
  MessageSquare,
  Cloud,
  Grid3x3,
  Layers,
  Globe2,
  Star,
  LayoutTemplate,
} from "lucide-react";
import PhoenixIcon from "../components/PhoenixIcon";

const NAV_LINKS = [
  { label: "Home", id: "home" },
  { label: "Features", id: "features" },
  { label: "Solutions", id: "solutions" },
  { label: "Pricing", id: "pricing" },
  { label: "About Us", id: "about" },
  { label: "Contact", id: "contact" },
];

const TRUST_LOGOS = [
  { name: "Cloudly", icon: Cloud },
  { name: "PixaLab", icon: Grid3x3 },
  { name: "Layers", icon: Layers },
  { name: "GlobalTech", icon: Globe2 },
  { name: "Starline", icon: Star },
  { name: "HexaLab", icon: LayoutTemplate },
];

const FEATURES = [
  {
    icon: Briefcase,
    title: "Project Management",
    desc: "Plan, track and deliver projects on time, every time.",
  },
  {
    icon: ListChecks,
    title: "Task Management",
    desc: "Organize tasks, set priorities and get things done.",
  },
  {
    icon: Users,
    title: "Clients & CRM",
    desc: "Manage leads, clients and relationships effortlessly.",
  },
  {
    icon: Wallet,
    title: "Finance Management",
    desc: "Track income, expenses, sales and profitability in real time.",
  },
  {
    icon: UserCog,
    title: "Employees Management",
    desc: "Manage teams, roles, attendance and performance.",
  },
  {
    icon: BarChart3,
    title: "Reports & Analytics",
    desc: "Powerful insights to help you make better decisions.",
  },
];

// Six birds flying out of the phoenix's glow. Sizes bumped up a lot so
// they read clearly (not tiny specks), each with its own path/delay/
// depth so they scatter believably instead of moving as one flat layer.
// blurPx now only used for the *farthest* couple of birds (soft depth),
// everything else stays crisp and bright.
const MINI_BIRD_PATHS = [
  { anim: "birdFly1", delay: "0s", size: 84, blurPx: 0, opacity: 1, gradientId: "miniPhoenix1", glow: 30, spin: "3.6s" },
  { anim: "birdFly2", delay: "0.6s", size: 62, blurPx: 0.2, opacity: 0.92, gradientId: "miniPhoenix2", glow: 24, spin: "2.8s" },
  { anim: "birdFly3", delay: "1.2s", size: 92, blurPx: 0, opacity: 1, gradientId: "miniPhoenix3", glow: 32, spin: "4.2s" },
  { anim: "birdFly4", delay: "1.8s", size: 54, blurPx: 0.3, opacity: 0.88, gradientId: "miniPhoenix4", glow: 20, spin: "2.4s" },
  { anim: "birdFly5", delay: "0.3s", size: 72, blurPx: 0, opacity: 0.97, gradientId: "miniPhoenix5", glow: 26, spin: "3.2s" },
  { anim: "birdFly6", delay: "2.1s", size: 48, blurPx: 0.35, opacity: 0.85, gradientId: "miniPhoenix6", glow: 18, spin: "2.1s" },
];

const STATS = [
  { value: "150+", label: "Happy Clients" },
  { value: "500+", label: "Projects Completed" },
  { value: "10K+", label: "Tasks Completed" },
  { value: "99.9%", label: "Uptime & Reliable" },
  { value: "24/7", label: "Support & Assistance" },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const location = useLocation();

  // If we arrived here via a link like "/#features" (e.g. from the
  // Contact page's nav/footer), scroll to that section once mounted -
  // a plain hash in the URL doesn't auto-scroll on route change.
  useEffect(() => {
    if (!location.hash) return;
    const id = location.hash.replace("#", "");
    const el = document.getElementById(id);
    if (el) {
      // Slight delay so layout/images have settled before measuring position.
      setTimeout(() => el.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }, [location.hash]);

  return (
    <div className="bg-[#07060f] min-h-screen">
      <StickyNavbar navigate={navigate} />

      {/* overflow-x-hidden lives here (below the sticky header), not on
          the outer wrapper. Putting it on the same ancestor as a sticky
          element breaks position:sticky in most browsers - the header
          would scroll away instead of staying pinned to the top. */}
      <div className="overflow-x-hidden">

      {/* HERO */}
      <section id="home" className="relative px-5 pt-6 pb-16">
        <div
          className="pointer-events-none absolute -top-20 right-0 w-[600px] h-[500px] rounded-full blur-3xl opacity-40"
          style={{ background: "radial-gradient(circle, rgba(124,58,237,0.35), transparent 65%)" }}
        />
        <div
          className="pointer-events-none absolute top-40 -left-20 w-[500px] h-[400px] rounded-full blur-3xl opacity-30"
          style={{ background: "radial-gradient(circle, rgba(91,15,222,0.3), transparent 65%)" }}
        />

        <div className="relative max-w-6xl mx-auto grid lg:grid-cols-[1.15fr,1fr] gap-10 items-start">
          <div className="lg:-mt-2 lg:pr-6">
            <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-violet-300 bg-violet-600/10 border border-violet-500/30 rounded-full px-4 py-1.5 mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shadow-[0_0_8px_theme(colors.violet.400)]" />
              All-in-One Business Management Platform
            </span>

            <h1 className="text-4xl sm:text-5xl font-extrabold text-white leading-[1.1] mb-5">
              Manage Everything.
              <br />
              <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
                Grow Without Limits.
              </span>
            </h1>

            <p className="text-slate-400 text-base leading-relaxed max-w-md mb-8">
              Hopenix helps you manage projects, clients, employees, finance and more — all
              in one smart platform. Simple to use. Powerful to scale.
            </p>

            <div className="flex flex-wrap gap-3 mb-10">
              <button
                onClick={() => navigate("/login")}
                className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-fuchsia-500 hover:from-violet-500 hover:to-fuchsia-400 text-white font-semibold px-6 py-3.5 rounded-full shadow-lg shadow-violet-900/40 transition"
              >
                Get Started <ArrowRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => navigate("/register")}
                className="flex items-center gap-2 border border-[#2a2740] text-slate-200 font-semibold px-6 py-3.5 rounded-full hover:bg-[#141225] transition"
              >
                <UserPlus className="w-4 h-4" /> Register Now
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              <Badge icon={ShieldCheck} title="Smart & Secure" desc="Enterprise-grade security" />
              <Badge icon={LayoutGrid} title="All-in-One" desc="Everything you need in one place" />
              <Badge icon={Sparkles} title="AI Powered" desc="Work smarter with AI assistance" />
            </div>
          </div>

          {/* Phoenix mascot, with the info card sitting clearly below it.
              overflow-visible so the bigger birds have room to fly
              outside the 96x96 core without getting clipped. Height
              trimmed down (was 620px) and the gap to the card tightened
              so the card doesn't sit way too low under the bird. */}
          <div className="relative flex flex-col items-center min-h-[500px] pt-4">
            <div
              className="relative flex items-center justify-center w-96 h-96 overflow-visible"
              style={{ perspective: "900px" }}
            >
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-80 h-80 rounded-full blur-3xl bg-violet-600/30 animate-pulse" />
              </div>
              {/* Second, wider aura ring pulsing on its own slower cycle so
                  the light reads as radiating outward in waves rather than
                  one flat pulsing disc. */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div
                  className="w-[26rem] h-[26rem] rounded-full blur-[70px]"
                  style={{
                    background: "radial-gradient(circle, rgba(196,140,255,0.28), transparent 60%)",
                    animation: "auraRadiate 3.4s ease-in-out infinite",
                  }}
                />
              </div>

              {/* Birds bursting out of the glow around the phoenix.
                  Each has its own path/timing/size/glow so they read as
                  flying off at different depths instead of one flat layer. */}
              {MINI_BIRD_PATHS.map((mb, i) => (
                <MiniBird key={i} {...mb} />
              ))}

              {/* Main phoenix now gets real 3D depth: a perspective wrapper
                  drives a slow rotateY/rotateX tilt (animate-heroTilt) so
                  the mark reads as a solid object turning in space, plus a
                  stacked multi-layer drop-shadow for volume instead of one
                  flat glow, and a soft "ground" shadow beneath it that
                  breathes with the float to sell the depth. */}
              <div
                className="relative z-10 w-72 h-72 sm:w-80 sm:h-80 animate-[heroTilt_7s_ease-in-out_infinite]"
                style={{ transformStyle: "preserve-3d" }}
              >
                {/* Purple inner light: a softly blurred, saturated copy of
                    the phoenix sitting directly behind/under the icon. It
                    bleeds purple light through every gap and negative
                    space in the silhouette (between feathers, wingtips,
                    etc.) so the bird reads as lit from within rather than
                    just haloed from outside. Screen blend keeps it additive
                    against the dark background instead of muddying it. */}
                <div
                  className="absolute inset-0 mix-blend-screen"
                  style={{
                    filter: "blur(9px) saturate(2.6) brightness(1.6)",
                    animation: "innerCorePulse 3.2s ease-in-out infinite",
                  }}
                >
                  <PhoenixIcon className="w-full h-full" gradientId="heroPhoenixInner" />
                </div>

                {/* Purple sketch outline: the icon's alpha silhouette
                    traced with a thin glowing lavender line, built by
                    stacking zero-blur drop-shadows in 8 directions around
                    the shape. Reads as a hand-inked outline of light
                    wrapped around the phoenix, animated with its own
                    gentle pulse independent of the body glow. */}
                <div
                  className="absolute inset-0"
                  style={{
                    filter:
                      "drop-shadow(1.5px 0 0.5px rgba(216,180,254,0.95)) drop-shadow(-1.5px 0 0.5px rgba(216,180,254,0.95)) drop-shadow(0 1.5px 0.5px rgba(216,180,254,0.95)) drop-shadow(0 -1.5px 0.5px rgba(216,180,254,0.95)) drop-shadow(1.2px 1.2px 0.5px rgba(216,180,254,0.9)) drop-shadow(-1.2px -1.2px 0.5px rgba(216,180,254,0.9)) drop-shadow(1.2px -1.2px 0.5px rgba(216,180,254,0.9)) drop-shadow(-1.2px 1.2px 0.5px rgba(216,180,254,0.9))",
                    animation: "sketchPulse 3s ease-in-out infinite",
                  }}
                >
                  <PhoenixIcon className="w-full h-full opacity-95" gradientId="heroPhoenixOutline" />
                </div>

                <PhoenixIcon
                  className="w-full h-full animate-[float_6s_ease-in-out_infinite] drop-shadow-[0_0_20px_rgba(139,92,246,0.9)] drop-shadow-[0_0_55px_rgba(139,92,246,0.55)] drop-shadow-[0_35px_40px_rgba(0,0,0,0.55)]"
                  gradientId="heroPhoenix"
                />
              </div>
              <div className="absolute bottom-6 w-40 h-8 rounded-full bg-black/50 blur-xl animate-[groundShadow_6s_ease-in-out_infinite]" />
            </div>

            {/* Gap under the phoenix tightened so the card sits right
                below it instead of floating far down the page. */}
            <div className="relative mt-4 w-72 bg-[#0d0c18]/90 backdrop-blur border border-[#232134] rounded-2xl p-5 shadow-2xl">
              <p className="text-sm font-bold text-white mb-3">Your Business, In Perfect Control</p>
              <ul className="space-y-2.5 text-sm text-slate-400">
                {["Projects", "Tasks", "Finance", "Employees", "Reports"].map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" /> {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* TRUSTED BY */}
      <section className="max-w-6xl mx-auto px-5 py-10 text-center">
        <p className="text-[11px] font-bold uppercase tracking-wider text-violet-400 mb-2">
          Trusted by businesses worldwide
        </p>
        <p className="text-slate-400 text-sm mb-8">
          Join thousands of teams already growing with Hopenix.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4 opacity-70">
          {TRUST_LOGOS.map((brand) => (
            <span key={brand.name} className="flex items-center gap-2 text-slate-500 font-bold text-sm">
              <brand.icon className="w-4 h-4" /> {brand.name}
            </span>
          ))}
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="max-w-6xl mx-auto px-5 py-20">
        <div className="max-w-xl mx-auto text-center mb-12">
          <span className="inline-block text-[11px] font-bold uppercase tracking-wider text-violet-400 bg-violet-600/10 border border-violet-500/30 rounded-full px-4 py-1.5 mb-4">
            Powerful Features
          </span>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-3">
            Everything you need to run your business{" "}
            <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
              smarter
            </span>
          </h2>
          <p className="text-slate-400 text-sm">One platform. Endless possibilities.</p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="bg-[#0d0c18] border border-[#232134] rounded-2xl p-6 hover:border-violet-500/40 hover:-translate-y-1 transition"
            >
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-600/30 to-violet-900/40 border border-violet-500/20 flex items-center justify-center mb-4">
                <f.icon className="w-5 h-5 text-violet-300" />
              </div>
              <h3 className="text-white font-semibold text-base mb-1.5">{f.title}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>

        <div className="text-center mt-10">
          <button
            onClick={() => document.getElementById("solutions")?.scrollIntoView({ behavior: "smooth" })}
            className="border border-[#2a2740] text-slate-200 font-semibold px-6 py-3 rounded-full hover:bg-[#141225] transition"
          >
            Explore All Features
          </button>
        </div>
      </section>

      {/* SOLUTIONS / DASHBOARD PREVIEW */}
      <section id="solutions" className="max-w-6xl mx-auto px-5 py-20 grid lg:grid-cols-[1.35fr,1fr] gap-14 items-center">
        <div className="rounded-2xl border border-violet-500/20 bg-[#0d0c18] shadow-2xl overflow-hidden flex text-[10px]">
          {/* Mini sidebar */}
          <div className="hidden sm:flex flex-col w-11 shrink-0 bg-[#0a0913] border-r border-[#1a1826] py-3 items-center gap-3">
            <PhoenixIcon className="w-5 h-5 mb-1" gradientId="dashSidebarPhoenix" />
            {[HomeIcon, FolderKanban, CheckSquare, Users, Wallet, Receipt, FileBarChart2, Calendar, MessageSquare, Settings].map(
              (Icon, i) => (
                <div
                  key={i}
                  className={`w-6 h-6 rounded-md flex items-center justify-center ${
                    i === 0 ? "bg-violet-600/25 text-violet-300" : "text-slate-600"
                  }`}
                >
                  <Icon className="w-3 h-3" />
                </div>
              )
            )}
          </div>

          <div className="flex-1 min-w-0 p-3">
            {/* Top bar */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5 bg-[#151328] rounded-md px-2 py-1.5 text-slate-600 w-28">
                <Search className="w-2.5 h-2.5" />
                <span>Search...</span>
              </div>
              <div className="flex items-center gap-2">
                <Bell className="w-3 h-3 text-slate-500" />
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500" />
              </div>
            </div>

            <p className="text-white font-semibold mb-2">Dashboard</p>

            <div className="grid grid-cols-4 gap-2 mb-2">
              {[
                { label: "Total Projects", value: "24", delta: "+12%", up: true },
                { label: "Total Tasks", value: "156", delta: "+8%", up: true },
                { label: "Total Income", value: "PKR 1.25M", delta: "+15%", up: true },
                { label: "Total Expenses", value: "PKR 520K", delta: "-5%", up: false },
              ].map((s) => (
                <div key={s.label} className="bg-[#151328] rounded-lg p-2">
                  <p className="text-slate-500 mb-1 truncate">{s.label}</p>
                  <p className="text-white font-semibold">{s.value}</p>
                  <p className={`mt-0.5 ${s.up ? "text-emerald-400" : "text-red-400"}`}>{s.delta} this month</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2 mb-2">
              <div className="col-span-2 bg-[#151328] rounded-lg p-2">
                <p className="text-slate-500 mb-1.5">Income Overview</p>
                <svg viewBox="0 0 300 80" className="w-full h-14" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.35" />
                      <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <polyline
                    fill="url(#incomeFill)"
                    stroke="none"
                    points="0,70 30,55 60,60 90,35 120,45 150,20 180,38 210,25 240,40 270,18 300,30 300,80 0,80"
                  />
                  <polyline
                    fill="none"
                    stroke="#8b5cf6"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points="0,70 30,55 60,60 90,35 120,45 150,20 180,38 210,25 240,40 270,18 300,30"
                  />
                </svg>
              </div>
              <div className="bg-[#151328] rounded-lg p-2 flex flex-col items-center">
                <p className="text-slate-500 mb-1.5 self-start">Tasks by Status</p>
                <div
                  className="w-11 h-11 rounded-full"
                  style={{ background: "conic-gradient(#8b5cf6 0% 62%, #22d3ee 62% 87%, #3d3d55 87% 100%)" }}
                >
                  <div className="w-full h-full rounded-full flex items-center justify-center">
                    <div className="w-6 h-6 rounded-full bg-[#151328]" />
                  </div>
                </div>
                <div className="flex flex-col gap-0.5 mt-1.5 self-start text-[8px] text-slate-500">
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-500" /> Completed 62%
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" /> In Progress 25%
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="bg-[#151328] rounded-lg p-2">
                <p className="text-slate-500 mb-1.5">Recent Projects</p>
                <ul className="space-y-1.5">
                  {[
                    { name: "E-commerce Website", status: "In Progress", color: "text-amber-400" },
                    { name: "Mobile App Development", status: "In Progress", color: "text-amber-400" },
                    { name: "Branding Design", status: "Completed", color: "text-emerald-400" },
                  ].map((p) => (
                    <li key={p.name} className="flex items-center justify-between text-slate-400">
                      <span className="truncate pr-2">{p.name}</span>
                      <span className={`${p.color} shrink-0`}>{p.status}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-[#151328] rounded-lg p-2">
                <p className="text-slate-500 mb-1.5">Recent Activities</p>
                <ul className="space-y-1.5 text-slate-400">
                  <li className="truncate">Task "Design Homepage" completed</li>
                  <li className="truncate">New project "Mobile App" created</li>
                  <li className="truncate">Payment received from ABC Ltd.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <div>
          <span className="inline-block text-[11px] font-bold uppercase tracking-wider text-violet-400 bg-violet-600/10 border border-violet-500/30 rounded-full px-4 py-1.5 mb-4">
            Why Choose Hopenix?
          </span>
          <h2 className="text-3xl font-extrabold text-white mb-4">
            All your business{" "}
            <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
              at a glance
            </span>
          </h2>
          <p className="text-slate-400 mb-6 leading-relaxed">
            Hopenix gives you a real-time overview of your projects, tasks, finance and team
            performance — so you can focus on what truly matters.
          </p>
          <ul className="space-y-3 mb-8">
            {["Real-time Dashboard", "Key Metrics & Insights", "Smart Analytics", "AI Assistant"].map((item) => (
              <li key={item} className="flex items-center gap-2.5 text-slate-200 text-sm">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" /> {item}
              </li>
            ))}
          </ul>
          <button
            onClick={() => navigate("/login")}
            className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-fuchsia-500 hover:from-violet-500 hover:to-fuchsia-400 text-white font-semibold px-6 py-3.5 rounded-full shadow-lg shadow-violet-900/40 transition"
          >
            See Dashboard in Action <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </section>

      {/* STATS / PRICING ANCHOR */}
      <section id="pricing" className="max-w-6xl mx-auto px-5 py-16">
        <div className="text-center mb-10">
          <span className="inline-block text-[11px] font-bold uppercase tracking-wider text-violet-400 bg-violet-600/10 border border-violet-500/30 rounded-full px-4 py-1.5">
            Why Choose Hopenix?
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {STATS.map((s) => (
            <div key={s.label} className="bg-[#0d0c18] border border-[#232134] rounded-2xl p-6 text-center">
              <p className="text-2xl font-extrabold bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent mb-1">
                {s.value}
              </p>
              <p className="text-slate-400 text-xs">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ABOUT */}
      <section id="about" className="max-w-6xl mx-auto px-5 py-20 grid lg:grid-cols-[1.3fr,0.7fr] gap-10 items-center">
        <div>
          <span className="inline-block text-[11px] font-bold uppercase tracking-wider text-violet-400 bg-violet-600/10 border border-violet-500/30 rounded-full px-4 py-1.5 mb-4">
            About Us
          </span>
          <h2 className="text-3xl font-extrabold text-white mb-4">Built by operators, for operators</h2>
          <p className="text-slate-400 leading-relaxed">
            Hopenix started with a simple idea: growing businesses shouldn&apos;t need ten
            disconnected tools to stay organized. We bring projects, clients, finance and
            people into one calm, capable platform — so your team can spend less time
            switching tabs and more time building.
          </p>
        </div>
        <div className="flex items-center justify-center bg-gradient-to-br from-violet-600/10 to-fuchsia-600/10 border border-[#232134] rounded-2xl p-10">
          <PhoenixIcon className="w-24 h-24 drop-shadow-[0_0_25px_rgba(139,92,246,0.5)]" gradientId="aboutPhoenix" />
        </div>
      </section>

      {/* CTA */}
      <section id="contact" className="max-w-4xl mx-auto px-5 pb-20">
        <div className="relative rounded-3xl border border-violet-500/30 bg-gradient-to-br from-violet-600/15 to-[#140a28]/60 px-8 py-14 text-center overflow-hidden">
          <PhoenixIcon className="absolute top-6 left-6 w-7 h-7 opacity-40" gradientId="ctaPhoenix" />
          <span className="inline-block text-[11px] font-bold uppercase tracking-wider text-violet-300 mb-3">
            Ready to Take Control?
          </span>
          <h2 className="text-3xl font-extrabold text-white mb-3">Let&apos;s grow your business together</h2>
          <p className="text-slate-400 max-w-md mx-auto mb-8">
            Join Hopenix today and experience the power of smart business management.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <button
              onClick={() => navigate("/login")}
              className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-fuchsia-500 hover:from-violet-500 hover:to-fuchsia-400 text-white font-semibold px-6 py-3.5 rounded-full shadow-lg shadow-violet-900/40 transition"
            >
              Get Started <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => navigate("/register")}
              className="border border-[#2a2740] text-slate-200 font-semibold px-6 py-3.5 rounded-full hover:bg-[#141225] transition"
            >
              Register Now
            </button>
          </div>
          <p className="text-slate-500 text-sm mt-6">
            Have a question first?{" "}
            <button onClick={() => navigate("/contact")} className="text-violet-400 font-medium hover:text-violet-300">
              Get in touch with us
            </button>
          </p>
          <p className="text-slate-500 text-sm mt-2">
            Already have an account?{" "}
            <button onClick={() => navigate("/login")} className="text-violet-400 font-medium hover:text-violet-300">
              Login
            </button>
          </p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-[#1a1826] px-5 pt-14 pb-8">
        <div className="max-w-6xl mx-auto grid sm:grid-cols-2 lg:grid-cols-6 gap-10">
          <div className="lg:col-span-1 sm:col-span-2">
            <div className="flex items-center gap-2 mb-3">
              <PhoenixIcon className="w-7 h-7" gradientId="footerPhoenix" />
              <span className="text-base font-extrabold text-white">
                HOPE<span className="text-violet-400">NIX</span>
              </span>
            </div>
            <p className="text-slate-500 text-sm max-w-xs">
              All-in-one business management platform to help you manage, automate and grow
              your business smarter.
            </p>
          </div>

          <FooterCol
            title="Product"
            links={[
              { label: "Features", id: "features" },
              { label: "Pricing", id: "pricing" },
            ]}
          />
          <FooterCol
            title="Company"
            links={[
              { label: "About Us", id: "about" },
              { label: "Contact", to: "/contact" },
            ]}
            navigate={navigate}
          />
          <FooterCol
            title="Resources"
            links={[
              { label: "Help Center", to: "/contact" },
              { label: "Documentation" },
            ]}
            navigate={navigate}
          />
          <FooterCol
            title="Legal"
            links={[
              { label: "Privacy Policy", to: "/privacy-policy" },
              { label: "Terms of Service", to: "/terms-of-service" },
            ]}
            navigate={navigate}
          />

          <div>
            <h4 className="text-white font-semibold text-sm mb-4">Contact Us</h4>
            <ul className="space-y-2.5 text-slate-500 text-sm">
              <li>hello@hopenix.com</li>
              <li>+92 300 1234567</li>
              <li>Lahore, Pakistan</li>
            </ul>
          </div>
        </div>

        <div className="max-w-6xl mx-auto flex items-center justify-between border-t border-[#1a1826] mt-10 pt-6 text-xs text-slate-600">
          <span>© {new Date().getFullYear()} Hopenix. All rights reserved.</span>
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="w-9 h-9 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white flex items-center justify-center"
            aria-label="Back to top"
          >
            ↑
          </button>
        </div>
      </footer>

      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-14px); }
        }

        /* Each bird starts at the glow center (scale 0, invisible),
           bursts outward on its own path while rotating slightly to
           mimic wing-flap banking, then fades before looping.
           Distances increased to match the larger bird sizes so they
           clear the phoenix and read as flying well away from it. */
        @keyframes birdFly1 {
          0% { transform: translate(-50%,-50%) translate(0,0) scale(0.3) rotate(-8deg); opacity: 0; }
          20% { opacity: 1; }
          70% { opacity: 0.6; }
          100% { transform: translate(-50%,-50%) translate(-190px,-140px) scale(1.1) rotate(-20deg); opacity: 0; }
        }
        @keyframes birdFly2 {
          0% { transform: translate(-50%,-50%) translate(0,0) scale(0.3) rotate(10deg); opacity: 0; }
          25% { opacity: 0.85; }
          75% { opacity: 0.5; }
          100% { transform: translate(-50%,-50%) translate(210px,-80px) scale(1) rotate(18deg); opacity: 0; }
        }
        @keyframes birdFly3 {
          0% { transform: translate(-50%,-50%) translate(0,0) scale(0.25) rotate(-4deg); opacity: 0; }
          18% { opacity: 1; }
          70% { opacity: 0.55; }
          100% { transform: translate(-50%,-50%) translate(-140px,120px) scale(1.15) rotate(-14deg); opacity: 0; }
        }
        @keyframes birdFly4 {
          0% { transform: translate(-50%,-50%) translate(0,0) scale(0.3) rotate(6deg); opacity: 0; }
          22% { opacity: 0.75; }
          75% { opacity: 0.4; }
          100% { transform: translate(-50%,-50%) translate(190px,110px) scale(0.95) rotate(16deg); opacity: 0; }
        }
        @keyframes birdFly5 {
          0% { transform: translate(-50%,-50%) translate(0,0) scale(0.28) rotate(-12deg); opacity: 0; }
          20% { opacity: 0.9; }
          72% { opacity: 0.5; }
          100% { transform: translate(-50%,-50%) translate(-85px,-200px) scale(1.05) rotate(-22deg); opacity: 0; }
        }
        @keyframes birdFly6 {
          0% { transform: translate(-50%,-50%) translate(0,0) scale(0.25) rotate(9deg); opacity: 0; }
          24% { opacity: 0.7; }
          75% { opacity: 0.35; }
          100% { transform: translate(-50%,-50%) translate(110px,-195px) scale(1) rotate(20deg); opacity: 0; }
        }

        /* Continuous 3D tumble applied to each mini phoenix while it
           flies - wider rotateY/rotateX/rotateZ swing than before, plus a
           depth-scale dip at the 90/270deg points (where it's edge-on)
           so it visibly shrinks/thins there like a real object turning,
           not just a texture sliding across a flat plane. */
        @keyframes birdSpin3d {
          0%   { transform: rotateY(0deg)   rotateX(10deg) rotateZ(0deg)  scale(1); }
          25%  { transform: rotateY(90deg)  rotateX(-6deg) rotateZ(6deg)  scale(0.72); }
          50%  { transform: rotateY(180deg) rotateX(-14deg) rotateZ(0deg) scale(1); }
          75%  { transform: rotateY(270deg) rotateX(6deg)  rotateZ(-6deg) scale(0.72); }
          100% { transform: rotateY(360deg) rotateX(10deg) rotateZ(0deg)  scale(1); }
        }

        /* Wing-flap layer: an independent skew/rotateX riding on top of
           the tumble so the silhouette pulses in width, mimicking a wing
           beat rather than a rigid spin. */
        @keyframes birdFlap {
          0%, 100% { transform: rotateX(0deg) skewY(0deg) scaleX(1); }
          50% { transform: rotateX(22deg) skewY(4deg) scaleX(0.85); }
        }

        /* Soft pulsing glow that trails behind each bird, so it looks
           genuinely lit from within rather than just a flat icon. */
        @keyframes birdGlowPulse {
          0%, 100% { opacity: 0.55; transform: scale(0.85); }
          50% { opacity: 1; transform: scale(1.2); }
        }

        /* Purple light bleeding through each mini bird's own body (not
           just the halo behind it) - saturates and brightens a blurred
           copy of the icon so light shows through every gap in the
           silhouette as it tumbles. */
        @keyframes birdInnerLight {
          0%, 100% { opacity: 0.5; filter: blur(2px) saturate(2.2) brightness(1.4); }
          50% { opacity: 0.95; filter: blur(1px) saturate(3) brightness(1.9); }
        }

        /* Thin glowing outline pulse for the mini birds' sketched edge. */
        @keyframes birdOutlinePulse {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 1; }
        }

        /* Slow 3D tilt for the hero phoenix itself, so the main mark
           reads as a solid object gently turning in space rather than a
           flat sticker that only bobs up and down. */
        @keyframes heroTilt {
          0%, 100% { transform: rotateY(-10deg) rotateX(4deg); }
          50% { transform: rotateY(10deg) rotateX(-4deg); }
        }

        /* Purple light bleeding through the hero phoenix's own body,
           via a blurred, saturated duplicate sitting directly under it. */
        @keyframes innerCorePulse {
          0%, 100% { opacity: 0.55; filter: blur(9px) saturate(2.6) brightness(1.6); }
          50% { opacity: 1; filter: blur(5px) saturate(3.4) brightness(2.1); }
        }

        /* Gentle pulse for the hero phoenix's sketched purple outline. */
        @keyframes sketchPulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }

        /* Wide, slow-breathing aura ring radiating out from behind the
           hero phoenix, layered on top of the existing static glow disc. */
        @keyframes auraRadiate {
          0%, 100% { transform: scale(0.85); opacity: 0.35; }
          50% { transform: scale(1.08); opacity: 0.7; }
        }

        /* Contact shadow beneath the hero phoenix that breathes in sync
           with the float, selling the sense that it's lifting off a
           surface rather than floating with no relation to the ground. */
        @keyframes groundShadow {
          0%, 100% { transform: scale(1); opacity: 0.55; }
          50% { transform: scale(0.7); opacity: 0.3; }
        }

        @media (prefers-reduced-motion: reduce) {
          [style*="birdFly"], [style*="birdSpin3d"], [style*="birdGlowPulse"], [style*="heroTilt"], [style*="groundShadow"], [style*="birdFlap"], [style*="birdInnerLight"], [style*="birdOutlinePulse"], [style*="innerCorePulse"], [style*="sketchPulse"], [style*="auraRadiate"] { animation: none !important; opacity: 0 !important; }
        }
      `}</style>
      </div>
    </div>
  );
}

function MiniBird({ anim, delay, size, blurPx, opacity, gradientId, glow = 16, spin = "2.2s" }) {
  return (
    // Outer layer (perspective host) handles the flight path - translate/
    // scale/fade outward from the glow. Inner layer does the actual 3D
    // tumble on its own perspective, with a second counter-rotating
    // "wing flap" skew layered on top so the silhouette visibly changes
    // width as it turns, the way a real 3D object foreshortens - a flat
    // rotateY alone still reads as a sprite spinning in place.
    <div
      className="absolute left-1/2 top-1/2 pointer-events-none"
      style={{
        width: size,
        height: size,
        opacity,
        filter: blurPx ? `blur(${blurPx}px)` : undefined,
        animation: `${anim} 4.5s ease-in-out infinite`,
        animationDelay: delay,
        perspective: "300px",
      }}
    >
      {/* Glow layer sits behind the bird and pulses independently, giving
          each one a bright HD halo instead of reading as a flat cutout. */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: "radial-gradient(circle, rgba(168,85,247,1), rgba(139,92,246,0.65) 45%, rgba(124,58,237,0.35) 65%, transparent 80%)",
          filter: `blur(${glow}px)`,
          animation: "birdGlowPulse 1.6s ease-in-out infinite",
          animationDelay: delay,
        }}
      />
      <div
        className="relative w-full h-full"
        style={{
          animation: `birdSpin3d ${spin} linear infinite`,
          animationDelay: delay,
          transformStyle: "preserve-3d",
        }}
      >
        <div
          className="w-full h-full"
          style={{
            animation: `birdFlap ${spin} ease-in-out infinite`,
            animationDelay: delay,
            transformStyle: "preserve-3d",
          }}
        >
          {/* Purple light bleeding through this bird's own body, same
              technique as the hero phoenix but scaled down: a saturated,
              blurred duplicate underneath the crisp icon so light shows
              through the silhouette's own gaps as it tumbles. */}
          <div
            className="absolute inset-0 mix-blend-screen"
            style={{
              animation: "birdInnerLight 1.8s ease-in-out infinite",
              animationDelay: delay,
            }}
          >
            <PhoenixIcon className="w-full h-full" gradientId={`${gradientId}Inner`} />
          </div>

          {/* Thin sketched purple outline tracing this bird's silhouette,
              same 8-direction drop-shadow stack as the hero bird, just
              thinner to suit the smaller size. */}
          <div
            className="absolute inset-0"
            style={{
              filter:
                "drop-shadow(1px 0 0.4px rgba(216,180,254,0.9)) drop-shadow(-1px 0 0.4px rgba(216,180,254,0.9)) drop-shadow(0 1px 0.4px rgba(216,180,254,0.9)) drop-shadow(0 -1px 0.4px rgba(216,180,254,0.9))",
              animation: "birdOutlinePulse 1.8s ease-in-out infinite",
              animationDelay: delay,
            }}
          >
            <PhoenixIcon
              className="w-full h-full drop-shadow-[0_0_10px_rgba(255,255,255,0.9)] drop-shadow-[0_0_28px_rgba(196,140,255,1)] drop-shadow-[0_8px_14px_rgba(0,0,0,0.5)]"
              gradientId={gradientId}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function StickyNavbar({ navigate }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [active, setActive] = useState("home");

  // Adds a subtle background/shadow once the page has scrolled a bit,
  // so the bar reads as "floating" over content instead of blending in.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Highlights whichever section is currently in view, so "Features"
  // lights up once you've scrolled to it - same as most SaaS marketing sites.
  useEffect(() => {
    const sections = NAV_LINKS.map((l) => document.getElementById(l.id)).filter(Boolean);
    if (!sections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] }
    );

    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  const goTo = (id) => {
    setMobileOpen(false);
    // "Contact" is a dedicated page, not a section on this page - route
    // there instead of scrolling. Every other link still scrolls to its
    // in-page section as before.
    if (id === "contact") {
      navigate("/contact");
      return;
    }
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <header
      className={`sticky top-0 z-50 transition-colors duration-300 ${
        scrolled
          ? "bg-[#07060f]/90 backdrop-blur-md border-b border-[#1a1826] shadow-[0_4px_24px_rgba(0,0,0,0.35)]"
          : "bg-transparent border-b border-transparent"
      }`}
    >
      <div className="w-full px-6 sm:px-10 h-24 flex items-center justify-between">
        <button
          onClick={() => goTo("home")}
          className="flex items-center gap-3 shrink-0 mr-auto"
          aria-label="Hopenix home"
        >
          <PhoenixIcon className="w-14 h-14" gradientId="navPhoenix" />
          <span className="text-3xl font-extrabold text-white tracking-tight">
            HOPE<span className="text-violet-400">NIX</span>
          </span>
        </button>

        {/* Desktop links */}
        <nav className="hidden lg:flex items-center gap-10 mx-10">
          {NAV_LINKS.map((link) => (
            <button
              key={link.id}
              onClick={() => goTo(link.id)}
              className={`relative text-base font-semibold py-1.5 whitespace-nowrap transition ${
                active === link.id ? "text-white" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {link.label}
              {active === link.id && (
                <span className="absolute left-0 -bottom-0.5 w-full h-0.5 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400" />
              )}
            </button>
          ))}
        </nav>

        <div className="hidden lg:flex items-center gap-4 shrink-0">
          <button
            onClick={() => navigate("/login")}
            className="flex items-center gap-2 text-slate-200 text-base font-semibold px-7 py-3.5 rounded-full border border-[#2a2740] hover:bg-[#141225] transition"
          >
            <LogIn className="w-4 h-4" /> Login
          </button>
          <button
            onClick={() => navigate("/register")}
            className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-fuchsia-500 hover:from-violet-500 hover:to-fuchsia-400 text-white text-base font-semibold px-7 py-3.5 rounded-full shadow-lg shadow-violet-900/30 transition"
          >
            Get Started <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {/* Mobile toggle */}
        <button
          onClick={() => setMobileOpen((v) => !v)}
          className="lg:hidden w-9 h-9 flex items-center justify-center rounded-lg border border-[#2a2740] text-slate-200"
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="lg:hidden bg-[#07060f]/98 backdrop-blur-md border-t border-[#1a1826] px-6 py-6">
          <nav className="flex flex-col gap-1 mb-6">
            {NAV_LINKS.map((link) => (
              <button
                key={link.id}
                onClick={() => goTo(link.id)}
                className={`text-left text-base font-semibold px-3 py-3 rounded-lg transition ${
                  active === link.id
                    ? "bg-violet-600/15 text-white"
                    : "text-slate-400 hover:bg-[#141225] hover:text-slate-200"
                }`}
              >
                {link.label}
              </button>
            ))}
          </nav>
          <div className="flex flex-col gap-3">
            <button
              onClick={() => {
                setMobileOpen(false);
                navigate("/login");
              }}
              className="flex items-center justify-center gap-2 text-slate-200 text-base font-semibold px-5 py-3.5 rounded-full border border-[#2a2740]"
            >
              <LogIn className="w-4 h-4" /> Login
            </button>
            <button
              onClick={() => {
                setMobileOpen(false);
                navigate("/register");
              }}
              className="flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white text-base font-semibold px-5 py-3.5 rounded-full"
            >
              Get Started <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </header>
  );
}

function Badge({ icon: Icon, title, desc }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="w-5 h-5 text-violet-400 mt-0.5 shrink-0" />
      <div>
        <p className="text-white text-sm font-semibold">{title}</p>
        <p className="text-slate-500 text-xs mt-0.5">{desc}</p>
      </div>
    </div>
  );
}

function FooterCol({ title, links, navigate }) {
  // Links can point to an in-page section (id, scrolls) or a separate
  // route (to, navigates) - Contact now uses "to" since it opens its
  // own page instead of scrolling to a section here.
  const handleClick = (link) => (e) => {
    if (!link.id && !link.to) return;
    e.preventDefault();
    if (link.to) {
      navigate?.(link.to);
      return;
    }
    document.getElementById(link.id)?.scrollIntoView({ behavior: "smooth" });
  };
  return (
    <div>
      <h4 className="text-white font-semibold text-sm mb-4">{title}</h4>
      <ul className="space-y-2.5">
        {links.map((link) => (
          <li key={link.label}>
            <a
              href={link.to || (link.id ? `#${link.id}` : "#")}
              onClick={handleClick(link)}
              className="text-slate-500 text-sm hover:text-slate-300 transition"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}