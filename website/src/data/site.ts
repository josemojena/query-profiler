export const GITHUB = "https://github.com/josemojena/query-profiler";
export const NPM = "https://www.npmjs.com/package/query-profiler";
export const INSTALL = "npm i -D query-profiler";

/** A path inside the site, under the base it is deployed at. */
export const link = (path = "") => `${import.meta.env.BASE_URL.replace(/\/$/, "")}/${path}`;
