export const GITHUB = "https://github.com/josemojena/query-profiler";
export const NPM = "https://www.npmjs.com/package/query-profiler";
export const INSTALL = "npm i -D query-profiler";

/** A path inside the site, under the base it is deployed at. */
export const link = (path = "") => `${import.meta.env.BASE_URL.replace(/\/$/, "")}/${path}`;

/** The image a shared link shows (Open Graph), and its description. */
export const OG_IMAGE = "og.png";
export const OG_IMAGE_ALT =
  "See every query your Prisma app makes: a request's timeline, where Post.count ran 6 times from app/routes/home.tsx:8, flagged N+1.";
