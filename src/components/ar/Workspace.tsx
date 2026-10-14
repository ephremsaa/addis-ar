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
  Menu,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import logo from "@/assets/addis-logo.png.asset.json";
import { useEffect, useState, type ReactNode } from "react";
export function Workspace({
  children,
  page = "My projects",
}: {
  children: ReactNode;
  page?: string;
}) {
  const [mobileMenu, setMobileMenu] = useState(false);
  const [usage, setUsage] = useState("Calculating…");
  useEffect(() => {
    navigator.storage
      ?.estimate()
      .then((s) => setUsage(`${((s.usage || 0) / 1048576).toFixed(1)} MB used locally`))
      .catch(() => setUsage("Local browser storage"));
  }, []);
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? "menu-open" : ""}`}>
        <Link to="/" className="brand">
          <img src={logo.url} alt="Addisweb Tech logo" />
          <span>
            Addis AR<small>CREATIVE WORKSPACE</small>
          </span>
        </Link>
        <Button
          className="mobile-menu-toggle"
          variant="ghost"
          size="icon"
          aria-label={mobileMenu ? "Close navigation" : "Open navigation"}
          aria-expanded={mobileMenu}
          onClick={() => setMobileMenu(!mobileMenu)}
        >
          {mobileMenu ? <X /> : <Menu />}
        </Button>
        <div className="side-label">WORKSPACE</div>
        <nav className="side-nav">
          <Button asChild variant="ghost" className={page === "My projects" ? "active" : ""}>
            <Link to="/">
              <FolderOpen />
              My projects
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
      <div className="workspace">
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
        {children}
      </div>
    </div>
  );
}
