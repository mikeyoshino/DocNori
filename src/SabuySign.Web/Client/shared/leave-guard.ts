/** Shared in-app departure guard. Reload/closing remains browser protected. */
export function guardUnsavedWork(
  hasWork: () => boolean,
  signal: AbortSignal,
  message = "ไฟล์และสิ่งที่แก้ไขไว้จะหายไป หากยังไม่ได้ดาวน์โหลด กรุณากลับไปบันทึกก่อน",
) {
  let approved = false;
  let pending = false;
  let close: (() => void) | undefined;
  const reset = () => {
    approved = false;
  };
  window.addEventListener("pageshow", reset, { signal });
  window.addEventListener(
    "beforeunload",
    (e) => {
      if (approved) {
        approved = false;
        return;
      }
      if (hasWork()) {
        e.preventDefault();
        e.returnValue = "";
      }
    },
    { signal },
  );
  window.addEventListener(
    "click",
    async (e: MouseEvent) => {
      const link =
        e.target instanceof Element
          ? e.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        e.shiftKey ||
        !link ||
        link.hasAttribute("download") ||
        (link.target && link.target !== "_self") ||
        !hasWork()
      )
        return;
      const url = new URL(link.href, location.href);
      if (!/^https?:$/.test(url.protocol)) return;
      // Anchors within the current document do not discard its work.
      if (
        url.origin === location.origin &&
        url.pathname === location.pathname &&
        url.search === location.search &&
        url.hash
      )
        return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (pending) return;
      pending = true;
      const previous =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      const dialog = document.createElement("dialog");
      dialog.className = "leave-dialog";
      const id = `leave-${crypto.randomUUID()}`;
      dialog.setAttribute("aria-labelledby", `${id}-title`);
      dialog.setAttribute("aria-describedby", `${id}-description`);
      dialog.innerHTML = `<div class="leave-dialog-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5"/></svg></div><h2 id="${id}-title">ออกจากหน้านี้หรือไม่?</h2><p id="${id}-description"></p><div class="leave-dialog-actions"><button type="button" class="leave-dialog-stay" autofocus>อยู่หน้านี้ต่อ</button><button type="button" class="leave-dialog-exit">ออกจากหน้านี้</button></div>`;
      dialog.querySelector("p")!.textContent = message;
      const accepted = await new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (value: boolean) => {
          if (settled) return;
          settled = true;
          dialog.close();
          dialog.remove();
          close = undefined;
          if (!value && previous?.isConnected) previous.focus();
          resolve(value);
        };
        close = () => finish(false);
        dialog
          .querySelector(".leave-dialog-stay")!
          .addEventListener("click", () => finish(false));
        dialog
          .querySelector(".leave-dialog-exit")!
          .addEventListener("click", () => finish(true));
        dialog.addEventListener("cancel", (e) => {
          e.preventDefault();
          finish(false);
        });
        dialog.addEventListener("close", () => finish(false));
        document.body.append(dialog);
        dialog.showModal();
      });
      pending = false;
      if (accepted && !signal.aborted) {
        approved = true;
        try {
          location.assign(url.href);
        } catch {
          approved = false;
        }
      }
    },
    { signal, capture: true },
  );
  signal.addEventListener("abort", () => close?.(), { once: true });
  window.addEventListener("pagehide", () => close?.(), { signal });
}
