import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  Clock,
  Send,
  CheckCircle2,
  Menu,
  X,
  LogIn,
  MessageCircle,
  Headset,
  Building2,
} from "lucide-react";
import PhoenixIcon from "../components/PhoenixIcon";

// Same section anchors as the landing page - every link here except
// "Contact" (which is this page) routes back to "/" and scrolls to the
// matching section once the home page has mounted.
const NAV_LINKS = [
  { label: "Home", id: "home" },
  { label: "Features", id: "features" },
  { label: "Solutions", id: "solutions" },
  { label: "Pricing", id: "pricing" },
  { label: "About Us", id: "about" },
  { label: "Contact", id: "contact" },
];

const CONTACT_CARDS = [
  {
    icon: Mail,
    title: "Email Us",
    detail: "hello@hopenix.com",
    sub: "We reply within 24 hours",
  },
  {
    icon: Phone,
    title: "Call Us",
    detail: "+92 300 1234567",
    sub: "Mon - Sat, 9am to 7pm PKT",
  },
  {
    icon: MapPin,
    title: "Visit Us",
    detail: "Lahore, Pakistan",
    sub: "Gulberg III, Main Boulevard",
  },
];

const REASONS = [
  {
    icon: MessageCircle,
    title: "General Inquiry",
    desc: "Questions about Hopenix, how it works, or which plan fits your team.",
  },
  {
    icon: Headset,
    title: "Product Support",
    desc: "Already a customer? Our support team can help you get unstuck fast.",
  },
  {
    icon: Building2,
    title: "Enterprise & Partnerships",
    desc: "Looking for custom onboarding, integrations, or a partnership? Let's talk.",
  },
];

const SUBJECT_OPTIONS = ["General Inquiry", "Product Support", "Sales & Pricing", "Partnership", "Other"];

const API_BASE_URL = "http://127.0.0.1:8000/api/auth";

async function submitContactMessage({ name, email, subject, message }) {
  const res = await fetch(`${API_BASE_URL}/contact/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, subject, message }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not send your message. Please try again.");
  return data;
}

export default function ContactPage() {
  const navigate = useNavigate();

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  return (
    <div className="bg-[#07060f] min-h-screen">
      <StickyNavbar navigate={navigate} />

      <div className="overflow-x-hidden">
        {/* HERO */}
        <section className="relative px-5 pt-14 pb-16">
          <div
            className="pointer-events-none absolute -top-16 right-0 w-[550px] h-[450px] rounded-full blur-3xl opacity-40"
            style={{ background: "radial-gradient(circle, rgba(124,58,237,0.35), transparent 65%)" }}
          />
          <div
            className="pointer-events-none absolute top-52 -left-24 w-[450px] h-[380px] rounded-full blur-3xl opacity-30"
            style={{ background: "radial-gradient(circle, rgba(91,15,222,0.3), transparent 65%)" }}
          />

          <div className="relative max-w-3xl mx-auto text-center">
            <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-violet-300 bg-violet-600/10 border border-violet-500/30 rounded-full px-4 py-1.5 mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shadow-[0_0_8px_theme(colors.violet.400)]" />
              Get In Touch
            </span>

            <h1 className="text-4xl sm:text-5xl font-extrabold text-white leading-[1.1] mb-5">
              We&apos;re here to
              <br />
              <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
                help, anytime.
              </span>
            </h1>

            <p className="text-slate-400 text-base leading-relaxed max-w-xl mx-auto">
              Got a question, ran into an issue, or just want to talk to a real person? Reach
              out and our team will get back to you as soon as possible.
            </p>
          </div>
        </section>

        {/* CONTACT CARDS */}
        <section className="max-w-6xl mx-auto px-5 pb-16">
          <div className="grid sm:grid-cols-3 gap-5">
            {CONTACT_CARDS.map((c) => (
              <div
                key={c.title}
                className="bg-[#0d0c18] border border-[#232134] rounded-2xl p-6 hover:border-violet-500/40 hover:-translate-y-1 transition"
              >
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-600/30 to-violet-900/40 border border-violet-500/20 flex items-center justify-center mb-4">
                  <c.icon className="w-5 h-5 text-violet-300" />
                </div>
                <h3 className="text-white font-semibold text-base mb-1">{c.title}</h3>
                <p className="text-slate-200 text-sm font-medium mb-1">{c.detail}</p>
                <p className="text-slate-500 text-xs">{c.sub}</p>
              </div>
            ))}
          </div>
        </section>

        {/* FORM + SIDE INFO */}
        <section className="max-w-6xl mx-auto px-5 pb-20 grid lg:grid-cols-[1.2fr,0.8fr] gap-8 items-start">
          <ContactForm />

          <div className="flex flex-col gap-6">
            {/* Phoenix visual card, matching the About section treatment */}
            <div className="flex flex-col items-center justify-center text-center bg-gradient-to-br from-violet-600/10 to-fuchsia-600/10 border border-[#232134] rounded-2xl p-8">
              <PhoenixIcon
                className="w-16 h-16 mb-4 drop-shadow-[0_0_25px_rgba(139,92,246,0.5)]"
                gradientId="contactPhoenix"
              />
              <p className="text-white font-semibold text-sm mb-1.5">We&apos;re quick to respond</p>
              <p className="text-slate-400 text-xs leading-relaxed">
                Most messages get a reply from a real person on our team within one business day.
              </p>
            </div>

            {/* Reasons to reach out */}
            <div className="bg-[#0d0c18] border border-[#232134] rounded-2xl p-6">
              <p className="text-white font-semibold text-sm mb-4">How can we help?</p>
              <ul className="space-y-4">
                {REASONS.map((r) => (
                  <li key={r.title} className="flex items-start gap-3">
                    <div className="w-9 h-9 shrink-0 rounded-lg bg-violet-600/15 border border-violet-500/20 flex items-center justify-center">
                      <r.icon className="w-4 h-4 text-violet-300" />
                    </div>
                    <div>
                      <p className="text-slate-200 text-sm font-medium">{r.title}</p>
                      <p className="text-slate-500 text-xs leading-relaxed mt-0.5">{r.desc}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {/* Office hours */}
            <div className="bg-[#0d0c18] border border-[#232134] rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-4 h-4 text-violet-300" />
                <p className="text-white font-semibold text-sm">Office Hours</p>
              </div>
              <ul className="space-y-1.5 text-sm text-slate-400">
                <li className="flex justify-between">
                  <span>Monday - Friday</span>
                  <span className="text-slate-300">9:00 AM - 7:00 PM</span>
                </li>
                <li className="flex justify-between">
                  <span>Saturday</span>
                  <span className="text-slate-300">10:00 AM - 4:00 PM</span>
                </li>
                <li className="flex justify-between">
                  <span>Sunday</span>
                  <span className="text-slate-500">Closed</span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="max-w-4xl mx-auto px-5 pb-20">
          <div className="relative rounded-3xl border border-violet-500/30 bg-gradient-to-br from-violet-600/15 to-[#140a28]/60 px-8 py-14 text-center overflow-hidden">
            <PhoenixIcon className="absolute top-6 left-6 w-7 h-7 opacity-40" gradientId="contactCtaPhoenix" />
            <span className="inline-block text-[11px] font-bold uppercase tracking-wider text-violet-300 mb-3">
              Ready When You Are
            </span>
            <h2 className="text-3xl font-extrabold text-white mb-3">Prefer to just dive in?</h2>
            <p className="text-slate-400 max-w-md mx-auto mb-8">
              Skip the form and create your account — you can always reach us from inside the app.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <button
                onClick={() => navigate("/register")}
                className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-fuchsia-500 hover:from-violet-500 hover:to-fuchsia-400 text-white font-semibold px-6 py-3.5 rounded-full shadow-lg shadow-violet-900/40 transition"
              >
                Get Started <ArrowRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => navigate("/login")}
                className="flex items-center gap-2 border border-[#2a2740] text-slate-200 font-semibold px-6 py-3.5 rounded-full hover:bg-[#141225] transition"
              >
                <LogIn className="w-4 h-4" /> Login
              </button>
            </div>
          </div>
        </section>

        {/* FOOTER */}
        <footer className="border-t border-[#1a1826] px-5 pt-14 pb-8">
          <div className="max-w-6xl mx-auto grid sm:grid-cols-2 lg:grid-cols-6 gap-10">
            <div className="lg:col-span-1 sm:col-span-2">
              <div className="flex items-center gap-2 mb-3">
                <PhoenixIcon className="w-7 h-7" gradientId="contactFooterPhoenix" />
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
                { label: "Features", to: "/#features" },
                { label: "Pricing", to: "/#pricing" },
              ]}
              navigate={navigate}
            />
            <FooterCol
              title="Company"
              links={[
                { label: "About Us", to: "/#about" },
                { label: "Contact", to: "/contact" },
              ]}
              navigate={navigate}
            />
            <FooterCol title="Resources" links={[{ label: "Help Center", to: "/contact" }, { label: "Documentation" }]} navigate={navigate} />
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
      </div>
    </div>
  );
}

function ContactForm() {
  const [form, setForm] = useState({ name: "", email: "", subject: SUBJECT_OPTIONS[0], message: "" });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.message) return;
    setError("");
    setSubmitting(true);
    try {
      await submitContactMessage(form);
      setSubmitted(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="bg-[#0d0c18] border border-[#232134] rounded-2xl p-10 flex flex-col items-center text-center">
        <div className="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mb-4">
          <CheckCircle2 className="w-7 h-7 text-emerald-400" />
        </div>
        <h3 className="text-white font-bold text-lg mb-2">Message sent</h3>
        <p className="text-slate-400 text-sm max-w-sm mb-6">
          Thanks, {form.name.split(" ")[0]}. We&apos;ve got your message and someone from our
          team will get back to you within one business day.
        </p>
        <button
          onClick={() => {
            setForm({ name: "", email: "", subject: SUBJECT_OPTIONS[0], message: "" });
            setSubmitted(false);
            setError("");
          }}
          className="border border-[#2a2740] text-slate-200 font-semibold px-6 py-3 rounded-full hover:bg-[#141225] transition text-sm"
        >
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-[#0d0c18] border border-[#232134] rounded-2xl p-6 sm:p-8"
    >
      <h2 className="text-white font-bold text-xl mb-1.5">Send us a message</h2>
      <p className="text-slate-500 text-sm mb-6">Fill out the form and we&apos;ll get back to you shortly.</p>

      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        <Field label="Full Name" required>
          <input
            type="text"
            required
            value={form.name}
            onChange={update("name")}
            placeholder="John Doe"
            className="w-full bg-[#151328] border border-[#232134] focus:border-violet-500/60 outline-none rounded-xl px-4 py-3 text-sm text-white placeholder:text-slate-600 transition"
          />
        </Field>
        <Field label="Email Address" required>
          <input
            type="email"
            required
            value={form.email}
            onChange={update("email")}
            placeholder="john@company.com"
            className="w-full bg-[#151328] border border-[#232134] focus:border-violet-500/60 outline-none rounded-xl px-4 py-3 text-sm text-white placeholder:text-slate-600 transition"
          />
        </Field>
      </div>

      <div className="mb-4">
        <Field label="Subject">
          <select
            value={form.subject}
            onChange={update("subject")}
            className="w-full bg-[#151328] border border-[#232134] focus:border-violet-500/60 outline-none rounded-xl px-4 py-3 text-sm text-white transition appearance-none"
          >
            {SUBJECT_OPTIONS.map((opt) => (
              <option key={opt} value={opt} className="bg-[#151328]">
                {opt}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mb-6">
        <Field label="Message" required>
          <textarea
            required
            rows={5}
            value={form.message}
            onChange={update("message")}
            placeholder="Tell us a bit about what you need..."
            className="w-full bg-[#151328] border border-[#232134] focus:border-violet-500/60 outline-none rounded-xl px-4 py-3 text-sm text-white placeholder:text-slate-600 transition resize-none"
          />
        </Field>
      </div>

      {error && <p className="text-sm text-rose-400 mb-4">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="flex items-center justify-center gap-2 w-full sm:w-auto bg-gradient-to-r from-violet-600 to-fuchsia-500 hover:from-violet-500 hover:to-fuchsia-400 disabled:opacity-60 text-white font-semibold px-7 py-3.5 rounded-full shadow-lg shadow-violet-900/40 transition"
      >
        {submitting ? "Sending..." : "Send Message"}
        {!submitting && <Send className="w-4 h-4" />}
      </button>
    </form>
  );
}

function Field({ label, required, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-slate-400 mb-1.5">
        {label} {required && <span className="text-violet-400">*</span>}
      </span>
      {children}
    </label>
  );
}

function StickyNavbar({ navigate }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Every link routes back to the home page and scrolls to its section
  // there, except "Contact" which is the page we're already on.
  const goTo = (id) => {
    setMobileOpen(false);
    if (id === "contact") return;
    navigate(`/#${id}`);
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
        <div className="flex items-center gap-4 sm:gap-5 shrink-0 mr-auto">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-3"
            aria-label="Hopenix home"
          >
            <PhoenixIcon className="w-14 h-14" gradientId="contactNavPhoenix" />
            <span className="text-3xl font-extrabold text-white tracking-tight">
              HOPE<span className="text-violet-400">NIX</span>
            </span>
          </button>

          {/* Back to Home, right next to the logo since Contact is a
              standalone page rather than a section on the landing page. */}
          <button
            onClick={() => navigate("/")}
            className="hidden sm:flex items-center gap-1.5 text-sm font-medium text-slate-400 hover:text-slate-200 border-l border-[#232134] pl-4 sm:pl-5 transition"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Home
          </button>
        </div>

        {/* Desktop links */}
        <nav className="hidden lg:flex items-center gap-10 mx-10">
          {NAV_LINKS.map((link) => (
            <button
              key={link.id}
              onClick={() => goTo(link.id)}
              className={`relative text-base font-semibold py-1.5 whitespace-nowrap transition ${
                link.id === "contact" ? "text-white" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {link.label}
              {link.id === "contact" && (
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
          <button
            onClick={() => {
              setMobileOpen(false);
              navigate("/");
            }}
            className="flex items-center gap-1.5 text-sm font-medium text-slate-400 hover:text-slate-200 transition mb-5"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Home
          </button>
          <nav className="flex flex-col gap-1 mb-6">
            {NAV_LINKS.map((link) => (
              <button
                key={link.id}
                onClick={() => goTo(link.id)}
                className={`text-left text-base font-semibold px-3 py-3 rounded-lg transition ${
                  link.id === "contact"
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

function FooterCol({ title, links, navigate }) {
  const handleClick = (link) => (e) => {
    if (!link.to) return;
    e.preventDefault();
    navigate?.(link.to);
  };
  return (
    <div>
      <h4 className="text-white font-semibold text-sm mb-4">{title}</h4>
      <ul className="space-y-2.5">
        {links.map((link) => (
          <li key={link.label}>
            <a
              href={link.to || "#"}
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