// src/components/Navbar.jsx
// src/components/Navbar.jsx
import React, { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import "../styles/Navbar.css";

const Navbar = () => {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "light");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const items = [
    { label: "Voice Assistant", path: "/voice-assistant", emoji: "🗣️" },
    { label: "Text Chat", path: "/text-chat", emoji: "💬" },
    { label: "Talk to Avatar", path: "/avatar", emoji: "🤖" },
  ];

  const closeMenu = () => setOpen(false);

  return (
    <header className="nav">
      <div className="nav__inner">
        {/* Brand (left) */}
        <a href="/voice-assistant" className="nav__brand" onClick={closeMenu}>
          <img src="/logo.png" alt="Logo" className="nav__logo" />
          <span className="nav__title">AI Patient Assistant</span>
        </a>

        {/* Primary links (desktop/tablet) */}
        <nav className="nav__bar" aria-label="Primary">
          {items.map((it) => (
            <NavLink
              key={it.path}
              to={it.path}
              className={({ isActive }) => `nav__link ${isActive ? "is-active" : ""}`}
              onClick={closeMenu}
              end={it.path === "/voice-assistant"}
            >
              <span className="nav__emoji" aria-hidden="true">{it.emoji}</span>
              <span>{it.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Tools (far right) */}
        <div className="nav__tools">
          {/* Theme toggle stays OUTSIDE on desktop/tablet */}
          <label className="theme-toggle theme-toggle--inline" title="Toggle theme">
            <input
              type="checkbox"
              checked={theme === "dark"}
              onChange={(e) => setTheme(e.target.checked ? "dark" : "light")}
              aria-label="Toggle dark mode"
            />
            <span className="toggle-track">
              <span className="toggle-icon sun" aria-hidden>☀️</span>
              <span className="toggle-thumb" />
              <span className="toggle-icon moon" aria-hidden>🌙</span>
            </span>
          </label>

          {/* Burger ONLY for mobile — always pinned far right */}
          <button
            className={`nav__burger ${open ? "is-open" : ""}`}
            onClick={() => setOpen(!open)}
            aria-label="Toggle menu"
            aria-expanded={open}
            aria-controls="nav-mobile"
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>

      {/* Mobile drawer (hamburger only on small screens) */}
      <div
        id="nav-mobile"
        className={`nav__mobile ${open ? "is-open" : ""}`}
        onClick={closeMenu}
      >
        <div
          className="nav__mobile-inner"
          onClick={(e) => e.stopPropagation()}
          role="menu"
        >
          <div className="nav__mobile-head">
            <div className="nav__mobile-title">Menu</div>
            <button
              className="nav__drawer-close"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
            >
              ✕
            </button>
          </div>

          <div className="nav__mobile-section">
            {items.map((it) => (
              <NavLink
                key={it.path}
                to={it.path}
                className={({ isActive }) =>
                  `nav__mobile-link ${isActive ? "is-active" : ""}`
                }
                onClick={closeMenu}
                role="menuitem"
                end={it.path === "/voice-assistant"}
              >
                <span className="nav__emoji" aria-hidden="true">{it.emoji}</span>
                <span>{it.label}</span>
              </NavLink>
            ))}
          </div>

          {/* Theme switch INSIDE drawer on mobile */}
          <div className="nav__mobile-section">
            <div className="drawer-row">
              <span className="drawer-row-label">Theme</span>
              <label className="theme-toggle" title="Toggle theme">
                <input
                  type="checkbox"
                  checked={theme === "dark"}
                  onChange={(e) => setTheme(e.target.checked ? "dark" : "light")}
                  aria-label="Toggle dark mode"
                />
                <span className="toggle-track">
                  <span className="toggle-icon sun" aria-hidden>☀️</span>
                  <span className="toggle-thumb" />
                  <span className="toggle-icon moon" aria-hidden>🌙</span>
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Backdrop */}
        <div className="nav__mobile-backdrop" />
      </div>
    </header>
  );
};

export default Navbar;



