import { init, dispose } from "./navigation";
// Public pages remain Static SSR: small progressive enhancements do not start WASM.
const headers = new Set<HTMLElement>();
function navigation() {
  for (const header of headers)
    if (!header.isConnected) {
      dispose(header);
      headers.delete(header);
    }
  document
    .querySelectorAll<HTMLElement>(".site-navigation")
    .forEach((header) => {
      if (!headers.has(header)) {
        init(header);
        headers.add(header);
      }
    });
}
navigation();
new MutationObserver(navigation).observe(document.body, {
  childList: true,
  subtree: true,
});
const directory = document.querySelector<HTMLElement>("[data-tool-directory]");
if (directory) {
  const container = directory.querySelector(".tool-groups")!;
  const groups = [
    ...container.querySelectorAll<HTMLElement>("[data-tool-category]"),
  ];
  const buttons = [
    ...directory.querySelectorAll<HTMLButtonElement>("[data-filter]"),
  ];
  for (const button of buttons)
    button.addEventListener("click", () => {
      const category = button.dataset.filter;
      for (const option of buttons) {
        const selected = option === button;
        option.setAttribute("aria-pressed", String(selected));
        option.classList.toggle("selected", selected);
      }
      container.replaceChildren(
        ...groups.filter(
          (group) =>
            category === "all" || group.dataset.toolCategory === category,
        ),
      );
      directory.querySelector(".directory-count")!.textContent =
        `${container.querySelectorAll(".document-tool").length} เครื่องมือ`;
    });
}
