"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/showcase", label: "Showcase" },
  { href: "/products", label: "Khai báo loại" },
  { href: "/admin", label: "Admin" },
];

/** Thanh điều hướng chung cho mọi trang */
export default function Navbar() {
  const pathname = usePathname();
  return (
    <nav className="navbar">
      <span className="navbar-brand">Patient Art</span>
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={pathname === l.href || pathname.startsWith(`${l.href}/`) ? "active" : ""}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
