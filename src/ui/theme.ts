export type Theme = "dark" | "light" | "system";

const SAVED = "query-profiler:theme";
const THEMES: [Theme, string][] = [
  ["dark", "Dark"],
  ["light", "Light"],
  ["system", "Auto"],
];

const isTheme = (value: unknown): value is Theme => THEMES.some(([theme]) => theme === value);

/** The theme picked before on this site, else the one the page asks for with data-theme, else dark. */
export function initialTheme(element: HTMLElement): Theme {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(SAVED);
  } catch {
    // Private windows can refuse storage; the page's choice or the default still apply.
  }
  if (isTheme(saved)) return saved;
  return isTheme(element.dataset.theme) ? element.dataset.theme : "dark";
}

/** Applies a theme to the bar or the page, and remembers it for both on this site. */
export function chooseTheme(element: HTMLElement, theme: Theme): void {
  element.dataset.theme = theme;
  try {
    localStorage.setItem(SAVED, theme);
  } catch {
    // The choice still holds until the page reloads.
  }
}

/** The three buttons that pick the theme. */
export const themeSwitch = (current: Theme) =>
  `<span class="themes" role="group" aria-label="Theme">${THEMES.map(
    ([theme, label]) =>
      `<button type="button" data-action="theme" data-choice="${theme}" aria-pressed="${theme === current}"${theme === current ? ' class="on"' : ""}>${label}</button>`,
  ).join("")}</span>`;

export const choiceOf = (target: HTMLElement): Theme | undefined =>
  isTheme(target.dataset.choice) ? target.dataset.choice : undefined;
