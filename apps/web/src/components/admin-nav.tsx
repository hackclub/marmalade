import { Link } from "@tanstack/react-router";

const links = [
  { to: "/admin/dashboard", label: "Health" },
  { to: "/admin/usage", label: "Usage" },
  { to: "/admin/actions", label: "Queue" },
  { to: "/admin/audit", label: "Audit" },
] as const;

export function AdminNav() {
  return (
    <nav className="mb-4 flex gap-4 border-b pb-2 text-sm">
      {links.map(({ to, label }) => (
        <Link
          key={to}
          to={to}
          className="text-muted-foreground hover:text-foreground"
          activeProps={{ className: "font-medium text-foreground" }}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function relativeTime(value: Date | string | null | undefined): string {
  if (!value) return "never";
  const date = typeof value === "string" ? new Date(value) : value;
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

export function duration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}
