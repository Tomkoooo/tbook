import type { MetadataRoute } from "next";

/** Makes the console installable (Add to Home Screen) and opens it standalone at the role-aware home page. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "tBook",
    short_name: "tBook",
    description: "Event booking, check-in and stand mode",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
