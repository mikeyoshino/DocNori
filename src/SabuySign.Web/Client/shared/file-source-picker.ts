/** Reusable controller for Shared/FileSourcePicker.razor.
 * Keep onSelect synchronous (e.g. input.click()) to preserve browser activation.
 */
export function createFileSourcePicker(
  root: HTMLElement,
  onSelect: () => void,
) {
  const abort = new AbortController(),
    { signal } = abort;
  const toggle = root.querySelector<HTMLButtonElement>("[data-picker-toggle]")!;
  const sources = root.querySelector<HTMLElement>("[data-picker-sources]")!;
  const local = root.querySelector<HTMLButtonElement>("[data-picker-local]")!;
  const count = root.querySelector<HTMLElement>("[data-picker-count]")!;
  let expanded = false,
    disabled = false,
    hovered = false,
    pinned = false;
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  const setOpen = (value: boolean) => {
    expanded = value && !disabled;
    root.classList.toggle("is-open", expanded);
    toggle.setAttribute("aria-expanded", String(expanded));
    sources.setAttribute("aria-hidden", String(!expanded));
    sources.inert = !expanded;
  };
  const close = () => {
    clearTimeout(leaveTimer);
    pinned = false;
    setOpen(false);
  };
  toggle.addEventListener(
    "click",
    () => {
      // Hover already opens the menu. The first click pins it, instead of
      // immediately closing it as the pointer arrives on the plus button.
      pinned = !pinned;
      setOpen(pinned);
    },
    { signal },
  );
  root.addEventListener(
    "pointerenter",
    (e) => {
      if (e.pointerType !== "mouse") return;
      clearTimeout(leaveTimer);
      hovered = true;
      setOpen(true);
    },
    { signal },
  );
  root.addEventListener(
    "pointerleave",
    () => {
      hovered = false;
      leaveTimer = setTimeout(() => {
        if (!pinned && !root.contains(document.activeElement)) setOpen(false);
      }, 100);
    },
    { signal },
  );
  root.addEventListener(
    "focusout",
    (e) => {
      if (!root.contains(e.relatedTarget as Node) && !hovered) close();
    },
    { signal },
  );
  root.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") {
        close();
        toggle.focus();
        e.preventDefault();
      }
      if (e.key === "ArrowDown" && e.target === toggle) {
        pinned = true;
        setOpen(true);
        local.focus();
        e.preventDefault();
      }
    },
    { signal },
  );
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!root.contains(e.target as Node)) close();
    },
    { signal },
  );
  local.addEventListener(
    "click",
    () => {
      if (disabled) return;
      close();
      toggle.focus();
      onSelect();
    },
    { signal },
  );
  return {
    update(fileCount: number, busy = false) {
      disabled = busy;
      toggle.disabled = busy;
      local.disabled = busy;
      count.textContent = String(fileCount);
      count.hidden = fileCount <= 0;
      if (busy) close();
    },
    dispose() {
      close();
      abort.abort();
    },
  };
}
