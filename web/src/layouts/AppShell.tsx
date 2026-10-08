import { BriefcaseBusiness, Monitor, Moon, Settings, Sun, UserRound } from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useEventInvalidation } from "@/api/events";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { type Theme, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const places = [
  { to: "/me", label: "Me", icon: UserRound },
  { to: "/jobs", label: "Jobs", icon: BriefcaseBusiness },
  { to: "/settings", label: "Settings", icon: Settings },
];
function Navigation({ mobile = false }: { mobile?: boolean }) {
  const { pathname } = useLocation();
  return (
    <nav
      aria-label={mobile ? "Main navigation on phone" : "Main navigation"}
      className={cn("flex gap-1", mobile && "w-full justify-around")}
    >
      {places.map(({ to, label, icon: Icon }) => (
        <Button
          key={to}
          variant="ghost"
          className={cn(
            "h-11",
            mobile && "h-14 flex-1",
            (pathname === to || pathname.startsWith(`${to}/`)) && "bg-accent text-accent-foreground",
          )}
          asChild
        >
          <NavLink to={to} className={cn("flex gap-2", mobile && "flex-col gap-1")}>
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        </Button>
      ))}
    </nav>
  );
}
export default function AppShell() {
  useEventInvalidation();
  const { theme, setTheme } = useTheme();
  const Icon = theme === "system" ? Monitor : theme === "light" ? Sun : Moon;
  return (
    <TooltipProvider>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-background focus:p-3"
      >
        Skip to content
      </a>
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-5 py-3 md:px-8">
          <NavLink to="/me/outline" className="font-display text-2xl font-bold tracking-tight" aria-label="Vita home">
            vita<span className="text-primary">.</span>
          </NavLink>
          <div className="mr-auto hidden md:block">
            <Navigation />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-11" aria-label="Change appearance">
                <Icon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
                <DropdownMenuRadioItem value="system">Use system theme</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto min-h-[calc(100dvh-80px)] w-full max-w-6xl px-5 pt-8 pb-28 outline-none md:px-8 md:pt-12 md:pb-16"
      >
        <Outlet />
      </main>
      <div className="fixed inset-x-0 bottom-0 border-t bg-card px-2 pb-[env(safe-area-inset-bottom)] md:hidden">
        <Navigation mobile />
      </div>
      <Toaster position="top-right" />
    </TooltipProvider>
  );
}
