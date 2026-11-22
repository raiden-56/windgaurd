import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "WINDGUARD – Workforce Attendance",
    short_name: "WINDGUARD",
    description: "Attendance, shifts and site operations for wind-energy sites. Every Shift. Every Worker. Accounted For.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "any",
    background_color: "#111C2D",
    theme_color: "#111C2D",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Mark attendance", short_name: "Attendance", url: "/attendance", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Gate register", short_name: "Gate", url: "/gate", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
