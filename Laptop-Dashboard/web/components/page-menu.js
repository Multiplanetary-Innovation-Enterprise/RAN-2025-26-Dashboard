// components/page-menu.js
// Hamburger menu that switches between the dashboard pages.
// Each page is a <div class="page" data-page="..."> in index.html; the active
// page is kept in the URL hash (#diagnostics) so a reload stays on it.
// Hidden pages stay in the DOM, so telemetry keeps updating them.

const PAGES = [
  { id: "driver", label: "Driver Station" },
  { id: "diagnostics", label: "Diagnostics" },
];
const DEFAULT_PAGE = PAGES[0].id;

class PageMenu extends HTMLElement {
  connectedCallback() {
    if (this._rendered) return;
    this._rendered = true;

    this.innerHTML = `
      <button class="menu-button" aria-haspopup="true" aria-expanded="false"
              aria-controls="page-menu-list" title="Pages">
        <span class="menu-current"></span>
        <svg class="menu-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
      </button>
      <nav id="page-menu-list" class="menu-list" hidden>
        ${PAGES.map(p => `<a href="#${p.id}" data-page="${p.id}">${p.label}</a>`).join("")}
      </nav>
    `;

    this._button = this.querySelector(".menu-button");
    this._list = this.querySelector(".menu-list");

    this._button.addEventListener("click", () => this.setOpen(this._list.hidden));
    this._list.addEventListener("click", e => {
      if (e.target.closest("a")) this.setOpen(false);
    });
    document.addEventListener("click", e => {
      if (!this.contains(e.target)) this.setOpen(false);
    });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") this.setOpen(false);
    });

    window.addEventListener("hashchange", () => this.showPage());
    this.showPage();
  }

  setOpen(open) {
    this._list.hidden = !open;
    this._button.setAttribute("aria-expanded", String(open));
  }

  showPage() {
    const requested = location.hash.slice(1);
    const page = PAGES.find(p => p.id === requested) ?? PAGES.find(p => p.id === DEFAULT_PAGE);

    for (const el of document.querySelectorAll(".page[data-page]")) {
      el.hidden = el.dataset.page !== page.id;
    }
    for (const a of this._list.querySelectorAll("a")) {
      if (a.dataset.page === page.id) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
    this.querySelector(".menu-current").textContent = page.label;
  }
}

customElements.define("page-menu", PageMenu);
