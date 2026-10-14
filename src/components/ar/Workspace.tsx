import { Link } from "@tanstack/react-router";
import {
  Box,
  FolderOpen,
  LayoutTemplate,
  BookOpen,
  CircleHelp,
  HardDrive,
  ChevronRight,
  ArrowUpRight,
  ShieldCheck,
  Camera,
  Scan,
  Menu,
  X,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState, type ReactNode } from "react";

export function Workspace({
  children,
  page = "My projects",
}: {
  children: ReactNode;
  page?: string;
}) {
  const [usage, setUsage] = useState("Calculating…");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    navigator.storage
      ?.estimate()
      .then((s) => setUsage(`${((s.usage || 0) / 1048576).toFixed(1)} MB used locally`))
      .catch(() => setUsage("Local browser storage"));
  }, []);

  return (
    <div className="app-shell">
      {/* Desktop Sidebar (hidden on mobile via CSS) */}
      <aside className="sidebar">
        <Link to="/" className="brand">
          <img src="/logo.png" alt="Addis AR logo" />
          <span>
            Addis AR<small>CREATIVE WORKSPACE</small>
          </span>
        </Link>

        <div className="side-label">WORKSPACE</div>
        <nav className="side-nav">
          <Button asChild variant="ghost" className={page === "My projects" ? "active" : ""}>
            <Link to="/">
              <FolderOpen />
              My projects
            </Link>
          </Button>

          <Button asChild variant="ghost" className={page === "3D Object Scanner" ? "active" : ""}>
            <Link to="/scanner">
              <Scan />
              3D Object Scanner
            </Link>
          </Button>

          <Button asChild variant="ghost" className={page === "AR Camera" ? "active" : ""}>
            <Link to="/ar">
              <Camera />
              AR Camera
            </Link>
          </Button>

          <Button asChild variant="ghost" className={page === "Templates" ? "active" : ""}>
            <Link to="/templates">
              <LayoutTemplate />
              Templates
            </Link>
          </Button>

          <Button asChild variant="ghost" className={page === "About Addis AR" ? "active" : ""}>
            <Link to="/welcome">
              <Box />
              Explore Addis AR
            </Link>
          </Button>
        </nav>

        <div className="side-label">RESOURCES</div>
        <nav className="side-nav secondary-nav">
          <Button asChild variant="ghost" className={page === "Documentation" ? "active" : ""}>
            <Link to="/docs">
              <BookOpen />
              Documentation
              <ArrowUpRight className="ml-auto" />
            </Link>
          </Button>
          <Button asChild variant="ghost">
            <Link to="/docs">
              <CircleHelp />
              Help & support
            </Link>
          </Button>
        </nav>

        <div className="sidebar-foot">
          <div className="flex items-center gap-2 text-xs">
            <HardDrive size={14} />
            Local storage
          </div>
          <div className="storage-track">
            <span />
          </div>
          <p className="text-[10px] text-muted-foreground">{usage}</p>
          <div className="mt-6 flex items-center gap-2 text-[10px] text-success">
            <ShieldCheck size={13} />
            Your workspace. Your data.
          </div>
        </div>
      </aside>

      {/* Main Workspace Area */}
      <div className="workspace">
        {/* Mobile Header (visible on mobile only) */}
        <header className="mobile-header">
          <Link to="/" className="mobile-brand">
            <img src="/logo.png" alt="Addis AR logo" />
            <span>Addis AR</span>
          </Link>

          <div className="flex items-center gap-2">
            <span className="mobile-status-dot" title="Saved on device" />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-foreground"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={18} />
            </Button>
          </div>
        </header>

        {/* Desktop Topbar */}
        <header className="topbar">
          <div className="crumb">
            <span>Workspace</span>
            <ChevronRight size={13} />
            <span className="text-foreground">{page}</span>
          </div>
          <div className="top-actions">
            <span className="local-status">Saved on this device</span>
            <span className="avatar">A</span>
          </div>
        </header>

        {/* Page Content */}
        <div className="workspace-content">{children}</div>

        {/* Mobile Bottom Navigation Bar (Docked to bottom on small screens) */}
        <nav className="mobile-bottom-nav">
          <Link to="/" className={`mobile-nav-item ${page === "My projects" ? "active" : ""}`}>
            <FolderOpen size={18} />
            <span>Projects</span>
          </Link>

          <Link
            to="/scanner"
            className={`mobile-nav-item ${page === "3D Object Scanner" ? "active" : ""}`}
          >
            <Scan size={18} />
            <span>Scanner</span>
          </Link>

          <Link to="/ar" className={`mobile-nav-item ${page === "AR Camera" ? "active" : ""}`}>
            <Camera size={18} />
            <span>AR Camera</span>
          </Link>

          <Link
            to="/templates"
            className={`mobile-nav-item ${page === "Templates" ? "active" : ""}`}
          >
            <LayoutTemplate size={18} />
            <span>Templates</span>
          </Link>

          <button
            onClick={() => setMobileMenuOpen(true)}
            className={`mobile-nav-item ${page === "Documentation" || page === "About Addis AR" ? "active" : ""}`}
          >
            <Box size={18} />
            <span>More</span>
          </button>
        </nav>
      </div>

      {/* Mobile Menu Drawer / Scrim */}
      {mobileMenuOpen && (
        <div className="dialog-scrim" onClick={() => setMobileMenuOpen(false)}>
          <div className="dialog-box mobile-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-3 border-b border-border mb-4">
              <div className="flex items-center gap-2.5">
                <img
                  src="/logo.png"
                  alt="Addis AR logo"
                  className="w-7 h-7 object-contain rounded"
                />
                <span className="font-bold text-sm text-foreground">Addis AR Studio</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setMobileMenuOpen(false)}
              >
                <X size={16} />
              </Button>
            </div>

            <div className="space-y-1 text-xs">
              <Link
                to="/"
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-3 p-2.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary ${
                  page === "My projects" ? "bg-accent text-accent-foreground font-semibold" : ""
                }`}
              >
                <FolderOpen size={16} />
                My projects
              </Link>

              <Link
                to="/scanner"
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-3 p-2.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary ${
                  page === "3D Object Scanner"
                    ? "bg-accent text-accent-foreground font-semibold"
                    : ""
                }`}
              >
                <Scan size={16} />
                3D Object Scanner
              </Link>

              <Link
                to="/ar"
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-3 p-2.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary ${
                  page === "AR Camera" ? "bg-accent text-accent-foreground font-semibold" : ""
                }`}
              >
                <Camera size={16} />
                Camera AR Workspace
              </Link>

              <Link
                to="/templates"
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-3 p-2.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary ${
                  page === "Templates" ? "bg-accent text-accent-foreground font-semibold" : ""
                }`}
              >
                <LayoutTemplate size={16} />
                3D Starter Templates
              </Link>

              <Link
                to="/welcome"
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-3 p-2.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary ${
                  page === "About Addis AR" ? "bg-accent text-accent-foreground font-semibold" : ""
                }`}
              >
                <Sparkles size={16} />
                Explore Addis AR
              </Link>

              <div className="pt-3 border-t border-border mt-3">
                <Link
                  to="/docs"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-3 p-2.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary ${
                    page === "Documentation" ? "bg-accent text-accent-foreground font-semibold" : ""
                  }`}
                >
                  <BookOpen size={16} />
                  Documentation & Guides
                </Link>
              </div>
            </div>

            <div className="mt-6 pt-3 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <HardDrive size={13} />
                {usage}
              </span>
              <span className="flex items-center gap-1 text-success text-[10px]">
                <ShieldCheck size={12} />
                Local & Private
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
