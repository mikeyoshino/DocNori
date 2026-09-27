import { leaveAfterConfirmation } from "../shared/leave-guard";
import { api, post, confirmAction } from "../templates/api";
const lifetimes = new WeakMap<HTMLElement, () => void>();
export function init(header: HTMLElement) {
  dispose(header);
  const abort = new AbortController(),
    { signal } = abort;
  const menus = [
    ...header.querySelectorAll<HTMLDetailsElement>(".nav-disclosure"),
  ];
  const toggle = header.querySelector<HTMLButtonElement>(".nav-mobile-toggle")!;
  const accountMenu = header.querySelector<HTMLDetailsElement>(".account-menu");
  let loadingAccount = false;
  accountMenu?.addEventListener(
    "toggle",
    async () => {
      if (!accountMenu.open || loadingAccount) return;
      loadingAccount = true;
      try {
        const me = await api("/api/account/me");
        if (signal.aborted) return;
        const email = header.querySelector<HTMLElement>(
          "[data-account-email]",
        )!;
        email.hidden = !me.authenticated;
        email.textContent = me.email ?? "";
        header.querySelector<HTMLAnchorElement>("[data-template-app]")!.href =
          me.authenticated ? "/workspace/templates" : "/templates";
        header.querySelector<HTMLElement>("[data-account-login]")!.hidden =
          !!me.authenticated;
        header.querySelector<HTMLElement>("[data-account-logout]")!.hidden =
          !me.authenticated;
      } catch {
        /* Login link remains usable when the account service is unavailable. */
      } finally {
        loadingAccount = false;
      }
    },
    { signal },
  );
  header.querySelector("[data-account-logout]")?.addEventListener(
    "click",
    async () => {
      if (
        !(await confirmAction(
          "ออกจากระบบ?",
          "กรุณาบันทึกแม่แบบและดาวน์โหลดเอกสารก่อนออกจากระบบ",
        ))
      )
        return;
      try {
        await post("/api/account/logout");
        leaveAfterConfirmation("/account/login");
      } catch {
        header.querySelector<HTMLElement>(
          "[data-account-status]",
        )!.textContent = "ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง";
      }
    },
    { signal },
  );
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
        if (menu === accountMenu) return;
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
        timer = setTimeout(() => {
          for (const menu of menus) if (menu !== accountMenu) menu.open = false;
        }, 180);
      }
    },
    { signal },
  );
  header.addEventListener(
    "focusout",
    (e) => {
      // Safari can blur a summary without focusing the tapped link. Hiding
      // the menu then removes the link before its click can navigate.
      // Outside pointer presses are handled separately below.
      if (e.relatedTarget && !header.contains(e.relatedTarget as Node)) {
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
