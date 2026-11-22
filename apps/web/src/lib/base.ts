/** Set for the static GitHub Pages build (see apps/demo): the API runs inside the browser. */
export const DEMO = process.env.NEXT_PUBLIC_DEMO === "1";

/** Path prefix the app is served under, e.g. "/windgaurd" on GitHub Pages; empty otherwise. */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Prefixes a root-relative path for places Next does not handle automatically (plain <a>, window.location, metadata). */
export const withBase = (path: string) => `${BASE_PATH}${path}`;
