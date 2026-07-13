import { Link } from "@tanstack/react-router";

import UserMenu from "./user-menu";

export default function Header() {
  const links = [
    { to: "/", label: "🍊" },
    // { to: "/dashboard", label: "Admin" },
    { to: "/mailboxes", label: "Mailboxes" },
    { to: "/team", label: "Team" },
    { to: "/keys", label: "Keys" },
    // { to: "/audit", label: "Audit" },
    { to: "divider", label: "divider" },
    { to: "/docs", label: "Docs" },
    { to: "https://github.com/quackclub/marmalade", label: "Repo" },
  ] as const;

  return (
    <div className="z-10">
      <div className="flex flex-row items-center justify-between px-2 py-1">
        <nav className="flex gap-4 text-lg">
          {links.map(({ to, label }) => {
            if (to === "divider") {
              return (
                <hr
                  key={to}
                  className="h-[20px] self-center border border-gray-600"
                />
              );
            }
            return (
              <Link key={to} to={to}>
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          <UserMenu />
        </div>
      </div>
      <hr />
    </div>
  );
}
