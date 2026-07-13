import { generateSW } from "workbox-build";

const { count, size, warnings } = await generateSW({
  globDirectory: "dist",
  globPatterns: ["**/*.{html,js,css,json,png,jpg,jpeg,webp,svg,ico,ttf,woff,woff2}"],
  globIgnores: ["sw.js", "workbox-*.js", "**/*.map"],
  swDest: "dist/sw.js",
  cleanupOutdatedCaches: true,
  clientsClaim: true,
  skipWaiting: true,
  navigateFallback: "/index.html",
  ignoreURLParametersMatching: [/^utm_/, /^fbclid$/],
  runtimeCaching: [
    {
      urlPattern: ({ url }) => url.hostname.endsWith("supabase.co") && url.pathname.startsWith("/rest/"),
      handler: "NetworkOnly"
    },
    {
      urlPattern: ({ url }) => url.hostname.endsWith("supabase.co") && url.pathname.startsWith("/storage/"),
      handler: "CacheFirst",
      options: {
        cacheName: "briland-catalog-images",
        expiration: { maxEntries: 250, maxAgeSeconds: 30 * 24 * 60 * 60 },
        cacheableResponse: { statuses: [0, 200] }
      }
    }
  ]
});

for (const warning of warnings) console.warn(warning);
console.log(`PWA pronta: ${count} arquivos, ${Math.round(size / 1024)} KB em precache.`);
