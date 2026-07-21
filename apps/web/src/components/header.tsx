import { Link } from "@tanstack/react-router";

import UserMenu from "./user-menu";

const internalLinks = [
  { to: "/", label: "\uD83C\uDF4A" },
  { to: "/mailboxes", label: "Mailboxes" },
  { to: "/team", label: "Team" },
  { to: "/keys", label: "Keys" },
] as const;

const externalLinks = [
  { href: "https://github.com/hackclub/marmalade", label: "Repo" },
] as const;

export default function Header() {
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
          {externalLinks.map(({ href, label }) => (
            <a key={href} href={href} target="_blank" rel="noopener noreferrer">
              {label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <UserMenu />
        </div>
      </div>
      <hr />
    </div>
  );
}
