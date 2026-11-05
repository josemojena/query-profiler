import type { Profile, ProfileListItem } from "../core/index.js";
import { runnableSql, type Editor } from "./format.js";
import { formatSql } from "./sql.js";
import { clearAll, getJson } from "./http.js";
import { followProfiles, mergeProfiles } from "./live.js";
import { STRIP_HEIGHT, styles } from "./styles.js";
import { choiceOf, chooseTheme, initialTheme } from "./theme.js";
import { installTracker, type Call, type Tracker } from "./tracker.js";
import { render, type Tab, type ViewState } from "./view.js";

const SAVED = "query-profiler:ui";
const MAX_RECENT = 20;

interface Saved {
  open: boolean;
  minimized: boolean;
  tab: Tab;
  height: number;
}

export class ProfilerToolbar extends HTMLElement {
  #root = this.attachShadow({ mode: "open" });
  #stopFollowing?: () => void;
  /** The page the browser is on, as opposed to the one shown when picked from Recent. */
  #livePage?: string;
  #calls: Call[] = [];
  #tracker?: Tracker;
  /** The path navigated to, until the call that loads it is seen. */
  #navigatedTo?: string;
  #state: ViewState = {
    base: "/_profiler",
    root: "",
    editor: "vscode",
    calls: [],
    recent: [],
    open: false,
    minimized: false,
    showRecent: false,
    pinned: false,
    tab: "requests",
    height: Math.round(window.innerHeight * 0.4),
    expanded: new Set(),
    theme: "dark",
  };

  connectedCallback() {
    this.#state.base = this.dataset.base ?? this.#state.base;
    this.#state.editor = (this.dataset.editor as Editor | undefined) ?? this.#state.editor;
    Object.assign(this.#state, readSaved());
    this.#state.theme = initialTheme(this);
    this.dataset.theme = this.#state.theme;
    this.#root.addEventListener("click", this.#onClick);
    this.#root.addEventListener("pointerdown", this.#onPointerDown);
    void this.#load();
  }

  disconnectedCallback() {
    this.#stopFollowing?.();
    this.#tracker?.listeners.delete(this.#onCall);
  }

  // Shows nothing until the API answers: profiler off, or its routes not mounted.
  async #load() {
    const { base } = this.#state;
    const [meta, recent] = await Promise.all([
      getJson<{ root: string }>(`${base}/api/meta`),
      getJson<ProfileListItem[]>(`${base}/api/profiles?limit=${MAX_RECENT}`),
    ]);
    if (!meta) return;
    this.#state.root = meta.root;
    this.#state.recent = recent ?? [];
    this.#stopFollowing = followProfiles(`${base}/api/stream`, {
      onProfile: (item) => this.#onProfile(item),
      onResume: () => void this.#catchUp(),
      onClear: () => this.#emptied(),
    });
    this.#tracker = installTracker(base);
    this.#tracker.listeners.add(this.#onCall);
    onNavigation(() => {
      this.#navigatedTo = location.pathname;
      this.#settleNavigation();
    });
    const here = location.pathname + location.search;
    const page =
      this.dataset.token ??
      this.#state.recent.find((item) => item.kind === "document" && item.request.url === here)
        ?.token;
    if (page) await this.#showPage(page, true);
    else this.#render();
  }

  async #showPage(token: string, live: boolean) {
    if (live) this.#follow(token);
    this.#state.pinned = !live;
    const [page, calls] = await Promise.all([
      this.#item(token),
      getJson<ProfileListItem[]>(`${this.#state.base}/api/profiles?parent=${token}`),
    ]);
    this.#state.page = page;
    this.#state.calls = (calls ?? []).reverse();
    await this.#select(token);
  }

  async #item(token: string): Promise<ProfileListItem | undefined> {
    const known = this.#state.recent.find((item) => item.token === token);
    if (known) return known;
    const profile = await getJson<Profile>(`${this.#state.base}/api/profiles/${token}`);
    if (!profile) return undefined;
    const { operations: _operations, queries: _queries, warnings, ...rest } = profile;
    return { ...rest, warningCount: warnings.length };
  }

  async #select(token: string) {
    const profile = await getJson<Profile>(`${this.#state.base}/api/profiles/${token}`);
    if (profile) {
      this.#state.profile = profile;
      this.#state.expanded = new Set();
    }
    this.#render();
  }

  #onProfile(item: ProfileListItem) {
    const state = this.#state;
    state.recent = mergeProfiles([item], state.recent, MAX_RECENT);
    if (item.token === state.page?.token) state.page = item;
    if (state.page && item.parentToken === state.page.token)
      state.calls = [...state.calls.filter((call) => call.token !== item.token), item];
    this.#render();
  }

  /**
   * The server's lists again, after the tab was hidden: recent requests, and the calls of the page
   * shown. Not a merge, so what was cleared meanwhile does not come back.
   */
  async #catchUp() {
    const { base, page } = this.#state;
    const [recent, calls] = await Promise.all([
      getJson<ProfileListItem[]>(`${base}/api/profiles?limit=${MAX_RECENT}`),
      page && getJson<ProfileListItem[]>(`${base}/api/profiles?parent=${page.token}`),
    ]);
    const state = this.#state;
    state.recent = recent ?? [];
    if (calls && page?.token === state.page?.token) state.calls = calls.reverse();
    this.#render();
  }

  /** The profiler was emptied: its lists go, and the bar keeps only the page it is on. */
  #emptied() {
    this.#state.recent = [];
    this.#state.calls = [];
    this.#render();
  }

  /** After a client navigation, the call that loads the new location becomes the page; it may come before or after. */
  #settleNavigation() {
    const path = this.#navigatedTo;
    const call = path && [...this.#calls].reverse().find((candidate) => candidate.path === path);
    if (!call) return;
    this.#navigatedTo = undefined;
    this.#calls = [];
    if (this.#state.pinned) this.#follow(call.token);
    else void this.#showPage(call.token, true);
  }

  #onCall = (call: Call) => {
    this.#calls.push(call);
    this.#settleNavigation();
  };

  /** The page the browser is on: new calls hang under it. */
  #follow(token: string) {
    this.#livePage = token;
    if (this.#tracker) this.#tracker.page = token;
  }

  #onClick = (event: Event) => {
    const target = (event.target as Element).closest<HTMLElement>("[data-action]");
    if (!target || target.tagName === "A") return;
    event.stopPropagation();
    const state = this.#state;
    switch (target.dataset.action) {
      case "toggle":
        state.open = !state.open;
        state.showRecent = false;
        break;
      case "tab":
        state.tab = target.dataset.tab as Tab;
        break;
      case "theme": {
        const theme = choiceOf(target);
        if (theme) {
          chooseTheme(this, theme);
          state.theme = theme;
        }
        break;
      }
      case "minimize":
        state.minimized = true;
        state.open = false;
        state.showRecent = false;
        break;
      case "restore":
        state.minimized = false;
        break;
      case "recent":
        state.showRecent = !state.showRecent;
        break;
      case "clear":
        void clearAll(state.base).then((cleared) => cleared && this.#emptied());
        return;
      case "select":
        state.tab = "queries";
        void this.#select(target.dataset.token!);
        return;
      case "pick": {
        const item = state.recent.find((r) => r.token === target.dataset.token);
        state.showRecent = false;
        state.open = true;
        if (item) {
          const page = item.parentToken ?? item.token;
          void this.#showPage(page, page === this.#livePage);
        }
        return;
      }
      case "follow":
        if (this.#livePage) void this.#showPage(this.#livePage, true);
        return;
      case "expand": {
        const id = target.dataset.id!;
        const expanded = new Set(state.expanded);
        if (!expanded.delete(id)) expanded.add(id);
        state.expanded = expanded;
        break;
      }
      case "copy": {
        const query = state.profile?.queries.find((q) => q.id === target.dataset.id);
        if (query)
          void navigator.clipboard
            .writeText(formatSql(runnableSql(query)))
            .then(() => (target.textContent = "Copied"));
        return;
      }
    }
    save(state);
    this.#render();
  };

  #onPointerDown = (event: Event) => {
    const handle = (event.target as Element).closest("[data-drag]");
    if (!handle) return;
    event.preventDefault();
    const move = (moved: PointerEvent) => {
      const height = window.innerHeight - moved.clientY - STRIP_HEIGHT;
      this.#state.height = Math.min(Math.max(height, 120), window.innerHeight - STRIP_HEIGHT - 40);
      const panel = this.#root.querySelector<HTMLElement>(".panel");
      if (panel) panel.style.height = `${this.#state.height}px`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      save(this.#state);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  #render() {
    const scroll = this.#root.querySelector(".body")?.scrollTop ?? 0;
    this.#root.innerHTML = `<style>${styles}</style>${render(this.#state)}`;
    const body = this.#root.querySelector(".body");
    if (body) body.scrollTop = scroll;
  }
}

const NAVIGATED = "query-profiler:navigated";

// pushState and replaceState fire no event; a popstate here would make routers think the user went back.
function onNavigation(listener: () => void) {
  const history = window.history as History & { queryProfiler?: true };
  addEventListener("popstate", listener);
  addEventListener(NAVIGATED, listener);
  if (history.queryProfiler) return;
  history.queryProfiler = true;
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method].bind(history);
    history[method] = (...args: Parameters<History["pushState"]>) => {
      original(...args);
      dispatchEvent(new Event(NAVIGATED));
    };
  }
}

function readSaved(): Partial<Saved> {
  try {
    return JSON.parse(localStorage.getItem(SAVED) ?? "{}") as Partial<Saved>;
  } catch {
    return {};
  }
}

function save({ open, minimized, tab, height }: ViewState) {
  try {
    localStorage.setItem(SAVED, JSON.stringify({ open, minimized, tab, height } satisfies Saved));
  } catch {
    // Private windows can refuse storage; the bar works without it.
  }
}
