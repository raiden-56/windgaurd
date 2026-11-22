"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Tip } from "@/components/ui/overlay";
import { cn } from "@/lib/utils";

/** Inline script that applies the saved theme before first paint (no flash). */
export const themeScript = `(function(){try{var t=localStorage.getItem('wg.theme');var d=t==='dark'||(!t&&false);if(d)document.documentElement.classList.add('dark');document.documentElement.dataset.theme=d?'dark':'light'}catch(e){}})()`;

export function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("wg.theme", next);
    } catch {
      /* ignore */
    }
    setTheme(next);
  };
  return { theme, toggle };
}

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  return (
    <Tip content={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>
      <button type="button" onClick={toggle} className={cn("grid size-9 place-items-center rounded-md text-muted hover:bg-sunken hover:text-fg", className)} aria-label="Toggle theme">
        {theme === "dark" ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
      </button>
    </Tip>
  );
}
