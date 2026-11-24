// Build flags. Vite substitutes import.meta.env.MODE / DEV at build time, so in the printer build
// (npm run build) DEMO_BUILD is a constant false: demo branches become dead code and Rollup drops them
// together with services/demo.js.
// Demo mode (control centre switch, ?demo) is available:
//   • in the GitHub Pages build (npm run build:demo, vyron-demo repository) — starts right away;
//   • in development (npm run dev, npm run dev:demo) — the switch and ?demo, without auto-start in dev.
export const DEMO_BUILD = import.meta.env.MODE === 'demo' || import.meta.env.DEV
