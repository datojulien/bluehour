import {
  BarChart3,
  CalendarDays,
  Eye,
  EyeOff,
  FileText,
  Home,
  Landmark,
  LayoutDashboard,
  ListChecks,
  Plus,
  ReceiptText,
  RefreshCcw,
  Search,
  Settings
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useDemoData } from "../providers/DemoDataProvider";
import { usePrivacy } from "../providers/PrivacyProvider";

const navigation = [
  { label: "Overview", to: "/", icon: LayoutDashboard },
  { label: "Transactions", to: "/transactions", icon: ReceiptText },
  { label: "Plan", to: "/plan", icon: CalendarDays },
  { label: "Budgets", to: "/budgets", icon: BarChart3 },
  { label: "Subscriptions", to: "/subscriptions", icon: FileText },
  { label: "Net Worth", to: "/net-worth", icon: Landmark },
  { label: "Review", to: "/review", icon: ListChecks },
  { label: "Settings", to: "/settings", icon: Settings }
];

const mobileNavigation = navigation.slice(0, 5);

export function AppShell() {
  const { privacyMode, togglePrivacyMode } = usePrivacy();
  const { snapshot } = useDemoData();
  const navigate = useNavigate();
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const syncState = snapshot?.syncState.find((state) => state.key === "google");
  const syncLabel = syncState?.message ?? syncState?.status?.replaceAll("_", " ") ?? "Saved locally";

  function openTransactionComposer() {
    navigate("/transactions?new=1");
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.metaKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        openTransactionComposer();
      }
      if (event.metaKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandMenuOpen(true);
      }
      if (event.key === "Escape") {
        setCommandMenuOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            B
          </div>
          <div>
            <div className="brand-name">Bluehour</div>
            <div className="brand-state">Demo · local</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navigation.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
              <item.icon size={18} aria-hidden="true" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button" type="button" aria-label="Open command menu" title="Command menu" onClick={() => setCommandMenuOpen(true)}>
              <Search size={18} aria-hidden="true" />
            </button>
            <div className={`sync-pill sync-${syncState?.status ?? "saved_locally"}`}>
              <span className="sync-dot" aria-hidden="true" />
              {syncLabel}
            </div>
          </div>

          <div className="topbar-actions">
            <button className="icon-button" type="button" aria-label="Open sync settings" title="Sync" onClick={() => navigate("/settings")}>
              <RefreshCcw size={18} aria-hidden="true" />
            </button>
            <button
              className={`icon-button${privacyMode ? " active" : ""}`}
              type="button"
              aria-label={privacyMode ? "Disable privacy mode" : "Enable privacy mode"}
              title="Privacy mode"
              onClick={togglePrivacyMode}
            >
              {privacyMode ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
            </button>
            <button className="primary-action" type="button" onClick={openTransactionComposer}>
              <Plus size={18} aria-hidden="true" />
              <span>Transaction</span>
            </button>
          </div>
        </header>

        <main className="main-surface">
          <Outlet />
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Primary navigation">
        {mobileNavigation.map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
            <item.icon size={20} aria-hidden="true" />
            <span>{item.label}</span>
          </NavLink>
        ))}
        <NavLink to="/settings" className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
          <Home size={20} aria-hidden="true" />
          <span>More</span>
        </NavLink>
      </nav>

      {commandMenuOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setCommandMenuOpen(false)}>
          <section className="command-menu" aria-label="Command menu" onMouseDown={(event) => event.stopPropagation()}>
            <div className="command-header">
              <p className="eyebrow">Command menu</p>
              <h2>Go to</h2>
            </div>
            <div className="command-list">
              <button
                type="button"
                onClick={() => {
                  openTransactionComposer();
                  setCommandMenuOpen(false);
                }}
              >
                New transaction
              </button>
              {navigation.map((item) => (
                <button
                  type="button"
                  key={item.to}
                  onClick={() => {
                    navigate(item.to);
                    setCommandMenuOpen(false);
                  }}
                >
                  {item.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  navigate("/settings#google");
                  setCommandMenuOpen(false);
                }}
              >
                Sync settings
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
