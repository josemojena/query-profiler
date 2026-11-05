import type { Profile, ProfileListItem, Stats } from "../core/index.js";
import type { Editor } from "./format.js";
import type { DetailTab } from "./detail.js";
import { runnableSql } from "./format.js";
import { getJson } from "./http.js";
import { followProfiles, mergeProfiles } from "./live.js";
import { renderList, renderPage, type PageState } from "./page-view.js";
import { pageStyles } from "./styles.js";

const LIMIT = 100;

/** The profiler's own page: every request on the left, the one picked on the right, or the stats. */
export class ProfilerPage extends HTMLElement {
  #root = this.attachShadow({ mode: "open" });
  #stopFollowing?: () => void;
  #state: PageState = {
    base: "/_profiler",
    root: "",
    editor: "vscode",
    expanded: new Set(),
    list: [],
    filter: "",
    view: "requests",
    tab: "queries",
  };

  connectedCallback() {
    this.#state.base = this.dataset.base ?? this.#state.base;
    this.#state.editor = (this.dataset.editor as Editor | undefined) ?? this.#state.editor;
    this.#root.addEventListener("click", this.#onClick);
    this.#root.addEventListener("input", this.#onInput);
    addEventListener("popstate", this.#onPopState);
    void this.#load();
  }

  disconnectedCallback() {
    this.#stopFollowing?.();
    removeEventListener("popstate", this.#onPopState);
  }

  async #load() {
    const { base } = this.#state;
    const [meta, list] = await Promise.all([
      getJson<{ root: string }>(`${base}/api/meta`),
      getJson<ProfileListItem[]>(`${base}/api/profiles?limit=${LIMIT}`),
    ]);
    this.#state.root = meta?.root ?? "";
    this.#state.list = list ?? [];
    this.#stopFollowing = followProfiles(`${base}/api/stream`, {
      onProfile: (item) => this.#addToList([item]),
      onResume: () =>
        void getJson<ProfileListItem[]>(`${base}/api/profiles?limit=${LIMIT}`).then((items) =>
          this.#addToList(items ?? []),
        ),
    });
    await this.#route();
  }

  #addToList(items: ProfileListItem[]) {
    this.#state.list = mergeProfiles(items, this.#state.list, LIMIT);
    this.#renderList();
  }

  #onPopState = () => void this.#route();

  /** What the address says: the list (the newest page), a profile, or the stats. */
  async #route() {
    const state = this.#state;
    const path = location.pathname.slice(state.base.length).replace(/^\//, "");
    state.view = path === "stats" ? "stats" : "requests";
    if (state.view === "stats") state.stats = await getJson<Stats>(`${state.base}/api/stats`);
    else {
      const token = /^[0-9a-f]{6}$/.test(path)
        ? path
        : state.list.find((item) => !item.parentToken)?.token;
      state.profile = token
        ? await getJson<Profile>(`${state.base}/api/profiles/${token}`)
        : undefined;
      state.expanded = new Set();
    }
    this.#render();
  }

  #go(href: string) {
    history.pushState(null, "", href);
    void this.#route();
  }

  #onClick = (event: Event) => {
    const target = (event.target as Element).closest<HTMLElement>("[data-action]");
    if (!target) return;
    const state = this.#state;
    switch (target.dataset.action) {
      case "go": {
        const mouse = event as MouseEvent;
        if (mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.button !== 0) return;
        event.preventDefault();
        this.#go(target.getAttribute("href")!);
        return;
      }
      case "tab":
        state.tab = target.dataset.tab as DetailTab;
        break;
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
            .writeText(runnableSql(query))
            .then(() => (target.textContent = "Copied"));
        return;
      }
      default:
        return;
    }
    this.#render();
  };

  // Only the list re-renders while typing, so the filter keeps its focus.
  #onInput = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (!input.classList.contains("filter")) return;
    this.#state.filter = input.value;
    this.#renderList();
  };

  #renderList() {
    const list = this.#root.querySelector(".list");
    if (list) list.innerHTML = renderList(this.#state);
  }

  #render() {
    this.#root.innerHTML = `<style>${pageStyles}</style>${renderPage(this.#state)}`;
  }
}
