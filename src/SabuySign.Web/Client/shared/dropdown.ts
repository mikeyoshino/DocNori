/** Shared accessible listbox with native top-layer placement and outside dismissal. */
export function setupDropdown(
  trigger: HTMLButtonElement,
  menu: HTMLElement,
  bridge: { invokeMethodAsync(method: string, value: string): Promise<void> },
) {
  const controller = new AbortController();
  const { signal } = controller;
  const options = () => [
    ...menu.querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ];
  const isOpen = () => menu.matches(":popover-open");
  const selected = () =>
    Math.max(
      0,
      options().findIndex(
        (option) => option.getAttribute("aria-selected") === "true",
      ),
    );
  function position() {
    const bounds = trigger.getBoundingClientRect();
    const roomBelow = innerHeight - bounds.bottom - 8;
    const roomAbove = bounds.top - 8;
    const available = Math.max(
      110,
      Math.min(320, Math.max(roomBelow, roomAbove)),
    );
    menu.style.minWidth = `${Math.min(Math.max(bounds.width, 120), innerWidth - 16)}px`;
    menu.style.maxWidth = `${Math.max(120, innerWidth - 16)}px`;
    menu.style.maxHeight = `${available}px`;
    menu.style.left = `${Math.max(8, Math.min(bounds.left, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top =
      roomBelow >= Math.min(available, 160)
        ? `${bounds.bottom + 6}px`
        : `${Math.max(8, bounds.top - Math.min(menu.scrollHeight, available) - 6)}px`;
  }
  function open(focusIndex = selected()) {
    if (trigger.disabled || isOpen()) return;
    menu.showPopover();
    position();
    const list = options();
    list[Math.min(Math.max(0, focusIndex), list.length - 1)]?.focus();
  }
  function close(restoreFocus = false) {
    if (isOpen()) menu.hidePopover();
    if (restoreFocus) trigger.focus();
  }
  function choose(option: HTMLButtonElement) {
    const value = option.dataset.value;
    if (value === undefined) return;
    close(true);
    void bridge.invokeMethodAsync("SelectOption", value);
  }
  trigger.addEventListener("click", () => (isOpen() ? close() : open()), {
    signal,
  });
  trigger.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        open(selected() + (event.key === "ArrowUp" ? -1 : 0));
      }
    },
    { signal },
  );
  menu.addEventListener(
    "click",
    (event) => {
      const option = (event.target as HTMLElement).closest<HTMLButtonElement>(
        '[role="option"]',
      );
      if (option && menu.contains(option)) choose(option);
    },
    { signal },
  );
  menu.addEventListener(
    "keydown",
    (event) => {
      const list = options();
      if (!list.length) return;
      const active = list.indexOf(document.activeElement as HTMLButtonElement);
      let next = active;
      if (
        [
          "ArrowDown",
          "ArrowUp",
          "Home",
          "End",
          "Enter",
          " ",
          "Escape",
        ].includes(event.key)
      )
        event.stopPropagation();
      if (event.key === "ArrowDown") next = (active + 1) % list.length;
      else if (event.key === "ArrowUp")
        next = (active - 1 + list.length) % list.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = list.length - 1;
      else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (active >= 0) choose(list[active]);
        return;
      } else if (event.key === "Escape") {
        event.preventDefault();
        close(true);
        return;
      } else if (event.key === "Tab") {
        close();
        return;
      } else if (
        event.key.length === 1 &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        const query = event.key.toLocaleLowerCase();
        const match = list.find((option) =>
          option.textContent?.trim().toLocaleLowerCase().startsWith(query),
        );
        if (match) {
          event.preventDefault();
          match.focus();
        }
        return;
      } else return;
      event.preventDefault();
      list[next]?.focus();
    },
    { signal },
  );
  menu.addEventListener(
    "toggle",
    () => trigger.setAttribute("aria-expanded", String(isOpen())),
    { signal },
  );
  addEventListener(
    "resize",
    () => {
      if (isOpen()) position();
    },
    { signal },
  );
  addEventListener(
    "scroll",
    (event) => {
      const target = event.target;
      if (
        isOpen() &&
        (target === window ||
          (target instanceof Node && target.contains(trigger)))
      )
        close();
    },
    { signal, capture: true },
  );
  return {
    dispose() {
      controller.abort();
      close();
    },
  };
}
