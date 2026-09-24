import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, ArrowLeft, Menu, X, LogIn, ShieldCheck } from "lucide-react";
import PhoenixIcon from "../components/PhoenixIcon";

const NAV_LINKS = [
  { label: "Home", id: "home" },
  { label: "Features", id: "features" },
  { label: "Solutions", id: "solutions" },
  { label: "Pricing", id: "pricing" },
  { label: "About Us", id: "about" },
  { label: "Contact", id: "contact" },
];

const LAST_UPDATED = "August 23, 2026";

const SECTIONS = [
  {
    title: "1. Introduction",
    body: [
      "Hopenix (\"we\", \"us\", or \"our\") provides an all-in-one business management platform covering projects, tasks, clients, finance, employees and reporting. This Privacy Policy explains what information we collect, how we use it, and the choices you have.",
      "By creating an account or otherwise using Hopenix, you agree to the collection and use of information as described here.",
    ],
  },
  {
    title: "2. Information We Collect",
    body: [
      "Account information: your name, email address, password, company name, and role when you register.",
      "Business data: projects, tasks, client records, financial entries, and employee information that you or your team enter into the platform.",
      "Usage data: pages visited, features used, device and browser type, IP address, and timestamps, collected automatically to help us operate and improve the service.",
      "Payment information: billing details processed securely by our payment provider — Hopenix does not store full card numbers on its own servers.",
    ],
  },
  {
    title: "3. How We Use Your Information",
    body: [
      "To provide, maintain, and improve the core features of Hopenix.",
      "To personalize your dashboard and recommend relevant features or workflows.",
      "To communicate with you about your account, updates, and support requests.",
      "To detect, investigate, and prevent fraudulent or unauthorized activity.",
      "To meet legal and regulatory obligations.",
    ],
  },
  {
    title: "4. Cookies & Tracking",
    body: [
      "We use cookies and similar technologies to keep you signed in, remember your preferences, and understand how the platform is used. You can control cookies through your browser settings, though some features may not work correctly if cookies are disabled.",
    ],
  },
  {
    title: "5. Data Sharing & Third Parties",
    body: [
      "We do not sell your personal or business data. We may share information with trusted service providers who help us run Hopenix — such as hosting, payment processing, and analytics providers — under agreements that require them to protect your data.",
      "We may also disclose information if required by law, or to protect the rights, property, or safety of Hopenix, our users, or the public.",
    ],
  },
  {
    title: "6. Data Security",
    body: [
      "We use industry-standard safeguards, including encryption in transit, access controls, and regular security reviews, to protect your data. No system is completely secure, so we encourage you to use a strong, unique password and enable any additional account protections we offer.",
    ],
  },
  {
    title: "7. Your Rights & Choices",
    body: [
      "You can access, update, or delete most of your account and business information directly from your Hopenix settings.",
      "You may request a copy of your data, or ask us to delete your account and associated data, by contacting our support team.",
      "Depending on your location, you may have additional rights under applicable data protection laws, such as the right to object to certain processing or to lodge a complaint with a supervisory authority.",
    ],
  },
  {
    title: "8. Data Retention",
    body: [
      "We retain your information for as long as your account is active or as needed to provide the service. If you close your account, we delete or anonymize your data within a reasonable period, except where we're required to keep it longer for legal, accounting, or security reasons.",
    ],
  },
  {
    title: "9. Children's Privacy",
    body: [
      "Hopenix is intended for businesses and professional use. It is not directed at children, and we do not knowingly collect personal information from anyone under the age of 16.",
    ],
  },
  {
    title: "10. Changes to This Policy",
    body: [
      "We may update this Privacy Policy from time to time. If we make material changes, we'll notify you by email or through a notice inside the platform before the changes take effect.",
    ],
  },
];

export default function PrivacyPolicyPage() {
  const navigate = useNavigate();

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  return (
    <div className="bg-[#07060f] min-h-screen">
      <StickyNavbar navigate={navigate} />

      <div className="overflow-x-hidden">
        {/* HERO */}
        <section className="relative px-5 pt-14 pb-12">
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
              <ShieldCheck className="w-3.5 h-3.5" />
              Legal
            </span>

            <h1 className="text-4xl sm:text-5xl font-extrabold text-white leading-[1.1] mb-4">
              Privacy{" "}
              <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
                Policy
              </span>
            </h1>
            <p className="text-slate-500 text-sm">Last updated: {LAST_UPDATED}</p>
          </div>
        </section>

        {/* CONTENT */}
        <section className="max-w-3xl mx-auto px-5 pb-20">
          <div className="bg-[#0d0c18] border border-[#232134] rounded-2xl p-6 sm:p-10">
            <p className="text-slate-400 leading-relaxed mb-10">
              This policy describes how Hopenix collects, uses, and protects information when
              you use our website and platform. If anything here isn&apos;t clear, our team is
              happy to walk you through it.
            </p>

            <div className="flex flex-col gap-9">
              {SECTIONS.map((s) => (
                <div key={s.title}>
                  <h2 className="text-white font-bold text-lg mb-3">{s.title}</h2>
                  <div className="flex flex-col gap-2.5">
                    {s.body.map((p, i) => (
                      <p key={i} className="text-slate-400 text-sm leading-relaxed">
                        {p}
                      </p>
                    ))}
                  </div>
                </div>
              ))}

              <div>
                <h2 className="text-white font-bold text-lg mb-3">11. Contact Us</h2>
                <p className="text-slate-400 text-sm leading-relaxed">
                  If you have questions about this Privacy Policy or how your data is handled,{" "}
                  <button
                    onClick={() => navigate("/contact")}
                    className="text-violet-400 font-medium hover:text-violet-300"
                  >
                    reach out to our team
                  </button>{" "}
                  and we&apos;ll get back to you promptly.
                </p>
              </div>
            </div>
          </div>
        </section>

        <Footer navigate={navigate} />
      </div>
    </div>
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

  const goTo = (id) => {
    setMobileOpen(false);
    if (id === "contact") {
      navigate("/contact");
      return;
    }
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
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-3 shrink-0 mr-auto"
          aria-label="Hopenix home"
        >
          <PhoenixIcon className="w-14 h-14" gradientId="privacyNavPhoenix" />
          <span className="text-3xl font-extrabold text-white tracking-tight">
            HOPE<span className="text-violet-400">NIX</span>
          </span>
          <span className="hidden sm:inline-flex items-center gap-1 text-sm font-medium text-slate-500 ml-2">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to home
          </span>
        </button>

        <nav className="hidden lg:flex items-center gap-10 mx-10">
          {NAV_LINKS.map((link) => (
            <button
              key={link.id}
              onClick={() => goTo(link.id)}
              className="relative text-base font-semibold py-1.5 whitespace-nowrap text-slate-400 hover:text-slate-200 transition"
            >
              {link.label}
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

        <button
          onClick={() => setMobileOpen((v) => !v)}
          className="lg:hidden w-9 h-9 flex items-center justify-center rounded-lg border border-[#2a2740] text-slate-200"
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="lg:hidden bg-[#07060f]/98 backdrop-blur-md border-t border-[#1a1826] px-6 py-6">
          <nav className="flex flex-col gap-1 mb-6">
            {NAV_LINKS.map((link) => (
              <button
                key={link.id}
                onClick={() => goTo(link.id)}
                className="text-left text-base font-semibold px-3 py-3 rounded-lg transition text-slate-400 hover:bg-[#141225] hover:text-slate-200"
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

function Footer({ navigate }) {
  return (
    <footer className="border-t border-[#1a1826] px-5 pt-14 pb-8">
      <div className="max-w-6xl mx-auto grid sm:grid-cols-2 lg:grid-cols-6 gap-10">
        <div className="lg:col-span-1 sm:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <PhoenixIcon className="w-7 h-7" gradientId="privacyFooterPhoenix" />
            <span className="text-base font-extrabold text-white">
              HOPE<span className="text-violet-400">NIX</span>
            </span>
          </div>
          <p className="text-slate-500 text-sm max-w-xs">
            All-in-one business management platform to help you manage, automate and grow your
            business smarter.
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