const lifetimes = new WeakMap<HTMLElement, () => void>();
export function init(header: HTMLElement) {
  dispose(header);
  const abort = new AbortController(),
    { signal } = abort;
  const menus = [
    ...header.querySelectorAll<HTMLDetailsElement>(".nav-disclosure"),
  ];
  const toggle = header.querySelector<HTMLButtonElement>(".nav-mobile-toggle")!;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => clearTimeout(timer);
  const close = () => {
    cancel();
    for (const menu of menus) menu.open = false;
  };
  const mobileClose = () => {
    header.classList.remove("nav-expanded");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "เปิดเมนูเครื่องมือ");
  };
  const open = (menu: HTMLDetailsElement) => {
    close();
    menu.open = true;
  };
  for (const menu of menus) {
    const summary = menu.querySelector("summary")!;
    summary.addEventListener(
      "click",
      () => {
        cancel();
        for (const other of menus) if (other !== menu) other.open = false;
      },
      { signal },
    );
    summary.addEventListener(
      "pointerenter",
      (e) => {
        if (
          e.pointerType !== "mouse" ||
          !matchMedia("(min-width: 1001px)").matches
        )
          return;
        cancel();
        timer = setTimeout(() => open(menu), 160);
      },
      { signal },
    );
  }
  header.addEventListener("pointerenter", cancel, { signal });
  header.addEventListener(
    "pointerleave",
    (e) => {
      if (
        e.pointerType === "mouse" &&
        matchMedia("(min-width: 1001px)").matches
      ) {
        cancel();
        timer = setTimeout(close, 180);
      }
    },
    { signal },
  );
  header.addEventListener(
    "focusout",
    (e) => {
      if (!header.contains(e.relatedTarget as Node)) {
        close();
        mobileClose();
      }
    },
    { signal },
  );
  header.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape") return;
      const active = menus.find((m) => m.open);
      close();
      if (active) active.querySelector("summary")!.focus();
      else {
        mobileClose();
        toggle.focus();
      }
      e.preventDefault();
    },
    { signal },
  );
  toggle.addEventListener(
    "click",
    () => {
      close();
      const expanded = header.classList.toggle("nav-expanded");
      toggle.setAttribute("aria-expanded", String(expanded));
      toggle.setAttribute(
        "aria-label",
        expanded ? "ปิดเมนูเครื่องมือ" : "เปิดเมนูเครื่องมือ",
      );
    },
    { signal },
  );
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!header.contains(e.target as Node)) {
        close();
        mobileClose();
      }
    },
    { signal },
  );
  lifetimes.set(header, () => {
    cancel();
    abort.abort();
  });
}
export function dispose(header: HTMLElement) {
  lifetimes.get(header)?.();
  lifetimes.delete(header);
}
