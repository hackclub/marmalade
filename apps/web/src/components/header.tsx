import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

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
  // Instance operation is not a Jelly role, so the link is hidden from
  // everyone else rather than shown and then refused.
  const mine = useQuery(orpc.team.listMine.queryOptions());

  return (
    <div className="z-10">
      <div className="flex flex-row items-center justify-between px-2 py-1">
        <nav className="flex gap-4 text-lg">
          {internalLinks.map(({ to, label }) => (
            <Link key={to} to={to}>
              {label}
            </Link>
          ))}
          <hr
            key="divider"
            className="h-[20px] self-center border border-gray-600"
          />
          <Link key="/docs" to="/docs">
            Docs
          </Link>
          {mine.data?.isInstanceOperator && (
            <Link key="/admin/teams" to="/admin/teams">
              Teams
            </Link>
          )}
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
