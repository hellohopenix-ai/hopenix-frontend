import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Menu, X } from "lucide-react";
import PhoenixIcon from "./PhoenixIcon";

const LINKS = [
  { id: "home", label: "Home" },
  { id: "features", label: "Features" },
  { id: "solutions", label: "Solutions" },
  { id: "pricing", label: "Pricing" },
  { id: "about", label: "About Us" },
  { id: "contact", label: "Contact" },
];

export default function Navbar() {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState("home");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const sections = LINKS.map((l) => document.getElementById(l.id)).filter(Boolean);
    if (!sections.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActive(entry.target.id);
        });
      },
      { rootMargin: "-40% 0px -50% 0px", threshold: 0 }
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  const handleNavClick = (id) => (e) => {
    e.preventDefault();
    setMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-[#07060f]/85 backdrop-blur-lg border-b border-[#1e1c2e] py-3"
          : "bg-transparent py-5"
      }`}
    >
      <div className="max-w-6xl mx-auto px-5 flex items-center justify-between gap-6">
        <a href="#home" onClick={handleNavClick("home")} className="flex items-center gap-2.5 shrink-0">
          <PhoenixIcon className="w-8 h-8" gradientId="navPhoenix" />
          <span className="text-lg font-extrabold tracking-tight text-white">
            HOPE<span className="text-violet-400">NIX</span>
          </span>
        </a>

        <nav className="hidden md:flex items-center gap-7">
          {LINKS.map((link) => (
            <a
              key={link.id}
              href={`#${link.id}`}
              onClick={handleNavClick(link.id)}
              className={`relative text-sm py-1 transition ${
                active === link.id ? "text-white" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {link.label}
              {active === link.id && (
                <span className="absolute left-0 right-0 -bottom-1 h-0.5 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500" />
              )}
            </a>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-3 shrink-0">
          <button
            onClick={() => navigate("/login")}
            className="text-sm font-medium text-slate-200 border border-[#2a2740] rounded-full px-5 py-2.5 hover:bg-[#141225] transition"
          >
            Login
          </button>
          <button
            onClick={() => navigate("/login")}
            className="flex items-center gap-1.5 text-sm font-semibold text-white bg-gradient-to-r from-violet-600 to-fuchsia-500 hover:from-violet-500 hover:to-fuchsia-400 rounded-full px-5 py-2.5 shadow-lg shadow-violet-900/40 transition"
          >
            Get Started <ArrowIcon />
          </button>
        </div>

        <button
          className="md:hidden w-10 h-10 flex items-center justify-center rounded-lg border border-[#2a2740] text-slate-200"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
        >
          {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {menuOpen && (
        <div className="md:hidden mx-5 mt-3 rounded-2xl border border-[#232134] bg-[#0d0c18] p-4">
          <nav className="flex flex-col gap-1">
            {LINKS.map((link) => (
              <a
                key={link.id}
                href={`#${link.id}`}
                onClick={handleNavClick(link.id)}
                className={`px-3 py-2.5 rounded-lg text-sm ${
                  active === link.id ? "bg-violet-600/15 text-white" : "text-slate-400"
                }`}
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className="flex flex-col gap-2 mt-3 pt-3 border-t border-[#232134]">
            <button
              onClick={() => {
                setMenuOpen(false);
                navigate("/login");
              }}
              className="text-sm font-medium text-slate-200 border border-[#2a2740] rounded-full px-5 py-2.5"
            >
              Login
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                navigate("/login");
              }}
              className="flex items-center justify-center gap-1.5 text-sm font-semibold text-white bg-gradient-to-r from-violet-600 to-fuchsia-500 rounded-full px-5 py-2.5"
            >
              Get Started <ArrowIcon />
            </button>
          </div>
        </div>
      )}
    </header>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none">
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
