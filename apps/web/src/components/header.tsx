import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { canAdministerTeam } from "@/lib/roles";
import { orpc } from "@/utils/orpc";
import TeamSwitcher from "./team-switcher";
import UserMenu from "./user-menu";

const internalLinks = [
  { to: "/", label: "\uD83C\uDF4A" },
  { to: "/mailboxes", label: "Mailboxes" },
  { to: "/team", label: "Team" },
  { to: "/keys", label: "Keys" },
  { to: "/admin/users", label: "Users" },
] as const;

const externalLinks = [
  { href: "https://github.com/hackclub/marmalade", label: "Repo" },
] as const;

export default function Header() {
  // Admin holds the audit log, which a team admin may read, and the team
  // list, which only an operator may. Shown to either rather than to
  // operators alone, and hidden from everyone else rather than shown and
  // then refused.
  const mine = useQuery(orpc.team.listMine.queryOptions());
  const membership = useQuery(orpc.membershipInfo.queryOptions());
  const showAdmin =
    (mine.data?.isInstanceOperator ?? false) ||
    canAdministerTeam(membership.data?.role);

  return (
    <div className="z-10">
      <div className="flex flex-row items-center justify-between px-2 py-1">
        <nav className="flex gap-4 text-lg">
          {internalLinks.map(({ to, label }) => (
            <Link key={to} to={to}>
              {label}
            </Link>
          ))}
          {showAdmin && (
            <Link key="/admin" to="/admin">
              Admin
            </Link>
          )}
          <hr
            key="divider"
            className="h-[20px] self-center border border-gray-600"
          />
          <Link key="/docs" to="/docs">
            Docs
          </Link>
          {externalLinks.map(({ href, label }) => (
            <a key={href} href={href} target="_blank" rel="noopener noreferrer">
              {label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <TeamSwitcher />
          <UserMenu />
        </div>
      </div>
      <hr />
    </div>
  );
}
