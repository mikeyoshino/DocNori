import { guardUnsavedWork } from "../shared/leave-guard";
import { createFileSourcePicker } from "../shared/file-source-picker";
import { MAX_BYTES, MAX_FILES, MAX_PAGES } from "../merge/pdf";
import { PageHistory, movePage, type OrganizePage } from "./state";
import { OrganizePreview } from "./preview";
const sessions = new WeakMap<HTMLElement, () => void>();
const icons: Record<string, string> = {
  rotate: "M20 11a8 8 0 1 1-3-6M20 3v6h-6",
  delete: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  copy: "M9 9h12v12H9zM15 9V3H3v12h6",
  left: "m14 6-6 6 6 6",
  right: "m10 6 6 6-6 6",
  zoom: "M10 6v8M6 10h8m2 6 5 5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
};
function iconButton(action: string, label: string) {
  const b = document.createElement("button");
  b.type = "button";
  b.dataset.action = action;
  b.setAttribute("aria-label", label);
  b.title = label;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", icons[action]);
  svg.append(path);
  b.append(svg);
  return b;
}
export function init(root: HTMLElement) {
  dispose(root);
  const lifetime = new AbortController(),
    { signal } = lifetime;
  const get = <T extends HTMLElement>(name: string) =>
    root.querySelector<T>(`[data-${name}]`)!;
  const input = get<HTMLInputElement>("files"),
    list = get<HTMLOListElement>("pages"),
    dialog = get<HTMLDialogElement>("preview");
  const history = new PageHistory(),
    preview = new OrganizePreview();
  let sources: {
      id: string;
      name: string;
      bytes: Uint8Array;
      count: number;
    }[] = [],
    originals: OrganizePage[] = [],
    selected = new Set<string>(),
    busy = false,
    showResult = false,
    downloaded = false,
    generation = 0,
    resultUrl = "",
    resultSize = 0,
    dragged: string | undefined,
    previewBusy = false;
  let cancelWorker: (() => void) | undefined;
  const picker = createFileSourcePicker(
    root.querySelector<HTMLElement>("[data-file-picker]")!,
    () => {
      if (!busy) input.click();
    },
  );
  const fail = (message: string) => {
    get("error").textContent = message;
    get("error").hidden = !message;
  };
  const revoke = () => {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = "";
  };
  function worker<T>(payload: object): Promise<T> {
    return new Promise((resolve, reject) => {
      const w = new Worker(new URL("./organize.worker.js", import.meta.url), {
        type: "module",
      });
      const finish = () => {
        clearTimeout(timer);
        w.terminate();
        cancelWorker = undefined;
      };
      const timer = setTimeout(() => {
        finish();
        reject(new Error("เอกสารใช้เวลานานเกินไป กรุณาลองเลือกไฟล์น้อยลง"));
      }, 90000);
      cancelWorker = () => {
        finish();
        reject(new DOMException("Cancelled", "AbortError"));
      };
      w.onmessage = ({ data }) => {
        finish();
        data.error ? reject(new Error(data.error)) : resolve(data);
      };
      w.onerror = () => {
        finish();
        reject(new Error("เปิดเอกสารไม่สำเร็จ กรุณาลองอีกครั้ง"));
      };
      w.postMessage(payload);
    });
  }
  const currentSource = (p: OrganizePage) =>
    sources.find((s) => s.id === p.sourceId);
  function render() {
    selected = new Set(
      [...selected].filter((id) => history.pages.some((p) => p.id === id)),
    );
    const hasWork = sources.length > 0 || history.pages.length > 0;
    root.classList.toggle("has-documents", hasWork && !showResult);
    get("intro").hidden = hasWork || showResult;
    get("workspace").hidden = !hasWork || showResult;
    get("result").hidden = !showResult;
    get("summary").textContent =
      `${sources.length} ไฟล์ · ${history.pages.length} หน้า`;
    get("page-count").textContent = `${history.pages.length} หน้า`;
    get("selected-label").textContent = selected.size
      ? `เลือกแล้ว ${selected.size} หน้า`
      : "เลือกหน้าที่ต้องการ";
    root.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
      b.disabled = busy;
    });
    input.disabled = busy;
    get<HTMLButtonElement>("undo").disabled = busy || !history.canUndo;
    get<HTMLButtonElement>("redo").disabled = busy || !history.canRedo;
    for (const key of ["rotate", "delete", "deselect"])
      get<HTMLButtonElement>(key).disabled = busy || !selected.size;
    get<HTMLButtonElement>("export").disabled = busy || !history.pages.length;
    get<HTMLButtonElement>("blank").disabled =
      busy || history.pages.length >= MAX_PAGES;
    get<HTMLButtonElement>("reverse").disabled =
      busy || history.pages.length < 2;
    get<HTMLButtonElement>("reset").disabled = busy || !sources.length;
    picker.update(sources.length, busy);
    get("empty").hidden = history.pages.length > 0;
    const fileList = get("sources");
    fileList.replaceChildren();
    for (const [index, source] of sources.entries()) {
      const li = document.createElement("li");
      li.className = `organize-source source-${index % 4}`;
      const name = document.createElement("strong"),
        count = document.createElement("span");
      name.textContent = source.name;
      name.title = source.name;
      count.textContent = `${history.pages.filter((p) => p.sourceId === source.id).length} หน้าในเอกสาร`;
      li.append(name, count);
      fileList.append(li);
    }
    list.querySelectorAll("canvas").forEach((c) => {
      c.width = c.height = 0;
    });
    list.replaceChildren();
    history.pages.forEach((p, index) => {
      const card = document.createElement("li");
      card.className = `organize-page source-${
        Math.max(
          0,
          sources.findIndex((s) => s.id === p.sourceId),
        ) % 4
      }`;
      card.dataset.id = p.id;
      card.draggable = !busy;
      if (selected.has(p.id)) card.classList.add("is-selected");
      const top = document.createElement("div");
      top.className = "organize-page-top";
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = selected.has(p.id);
      check.disabled = busy;
      check.setAttribute("aria-label", `เลือกหน้า ${index + 1}`);
      check.onchange = () => {
        if (check.checked) selected.add(p.id);
        else selected.delete(p.id);
        render();
        list.querySelector<HTMLElement>(`[data-id="${p.id}"] input`)?.focus();
      };
      const actions = document.createElement("div");
      for (const [action, label] of [
        ["zoom", "ขยาย"],
        ["rotate", "หมุน"],
        ["delete", "ลบ"],
      ]) {
        const b = iconButton(action, `${label}หน้า ${index + 1}`);
        b.disabled = busy;
        actions.append(b);
      }
      top.append(check, actions);
      const image = document.createElement("div");
      image.className = "organize-page-image";
      image.append(preview.thumbnail(p));
      image.addEventListener("click", () => {
        if (busy) return;
        selected.has(p.id) ? selected.delete(p.id) : selected.add(p.id);
        render();
      });
      image.addEventListener("dblclick", () => void enlarge(p));
      const label = document.createElement("strong");
      label.className = "organize-page-number";
      label.textContent = String(index + 1);
      const source = document.createElement("span");
      source.className = "organize-page-origin";
      source.textContent = p.sourceId
        ? `${currentSource(p)?.name} · หน้า ${p.pageIndex + 1}`
        : "หน้าว่าง A4";
      source.title = source.textContent;
      const bottom = document.createElement("div");
      bottom.className = "organize-page-bottom";
      for (const [action, text] of [
        ["left", "เลื่อนก่อน"],
        ["copy", "ทำสำเนา"],
        ["right", "เลื่อนหลัง"],
      ]) {
        const b = iconButton(action, `${text}หน้า ${index + 1}`);
        b.disabled =
          busy ||
          (action === "left" && index === 0) ||
          (action === "right" && index === history.pages.length - 1) ||
          (action === "copy" && history.pages.length === MAX_PAGES);
        bottom.append(b);
      }
      card.append(top, image, label, source, bottom);
      list.append(card);
    });
  }
  function change(pages: OrganizePage[], focusId?: string) {
    if (busy) return;
    try {
      history.apply(pages);
      revoke();
      downloaded = false;
      fail("");
      render();
      if (focusId)
        list
          .querySelector<HTMLElement>(`[data-id="${focusId}"] input`)
          ?.focus();
    } catch (e) {
      fail((e as Error).message);
    }
  }
  function rotate(ids: Set<string>) {
    change(
      history.pages.map((p) =>
        ids.has(p.id) ? { ...p, rotation: (p.rotation + 90) % 360 } : p,
      ),
    );
  }
  async function enlarge(p: OrganizePage) {
    if (busy || previewBusy) return;
    previewBusy = true;
    const version = generation;
    get("preview-title").textContent =
      `ตัวอย่างหน้า ${history.pages.findIndex((v) => v.id === p.id) + 1}`;
    get("preview-status").textContent = "กำลังเปิดตัวอย่าง…";
    dialog.showModal();
    try {
      await preview.enlarge(p, dialog.querySelector("canvas")!);
      if (version === generation) get("preview-status").textContent = "";
    } catch {
      if (version === generation)
        get("preview-status").textContent =
          "แสดงภาพตัวอย่างไม่ได้ แต่ยังจัดหน้าและดาวน์โหลดได้";
    } finally {
      previewBusy = false;
    }
  }
  async function add(files: File[]) {
    if (busy || !files.length) return;
    busy = true;
    const version = generation;
    fail("");
    get("status").textContent = "กำลังเปิด PDF…";
    render();
    const errors: string[] = [];
    try {
      for (const file of files) {
        if (version !== generation || signal.aborted) return;
        try {
          if (!/\.pdf$/i.test(file.name)) throw new Error("เลือกเฉพาะไฟล์ PDF");
          if (
            !file.size ||
            sources.reduce((n, s) => n + s.bytes.length, 0) + file.size >
              MAX_BYTES
          )
            throw new Error("ขนาดรวมต้องไม่เกิน 25 MB");
          if (sources.length >= MAX_FILES)
            throw new Error("เพิ่มได้สูงสุด 20 ไฟล์");
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (version !== generation) return;
          const { count } = await worker<{ count: number }>({ inspect: bytes });
          if (version !== generation) return;
          if (
            sources.reduce((n, s) => n + s.count, 0) + count > MAX_PAGES ||
            history.pages.length + count > MAX_PAGES
          )
            throw new Error("จำนวนหน้ารวมต้องไม่เกิน 100 หน้า");
          const id = crypto.randomUUID();
          try {
            await preview.load(id, bytes, (page) => {
              if (version === generation)
                get("status").textContent =
                  `กำลังสร้างภาพตัวอย่าง ${page} / ${count}`;
            });
          } catch {
            errors.push(
              `${file.name}: บางหน้าไม่มีภาพตัวอย่าง แต่ยังจัดหน้าได้`,
            );
          }
          if (version !== generation) return;
          sources.push({ id, name: file.name, bytes, count });
          showResult = false;
          const pages = Array.from({ length: count }, (_, pageIndex) => ({
            id: crypto.randomUUID(),
            sourceId: id,
            pageIndex,
            rotation: 0,
          }));
          originals.push(...pages);
          history.apply([...history.pages, ...pages]);
          revoke();
          downloaded = false;
          render();
        } catch (e) {
          if (version !== generation) return;
          errors.push(`${file.name}: ${(e as Error).message}`);
        }
      }
    } finally {
      if (version === generation && !signal.aborted) {
        busy = false;
        get("status").textContent = "";
        fail(errors.join(" · "));
        input.value = "";
        render();
      }
    }
  }
  function reset() {
    generation++;
    cancelWorker?.();
    preview.clear();
    sources = [];
    originals = [];
    history.clear();
    selected.clear();
    busy = false;
    showResult = false;
    downloaded = false;
    revoke();
    dialog.close();
    const large = dialog.querySelector("canvas")!;
    large.width = large.height = 0;
    input.value = "";
    fail("");
    get("status").textContent = "";
    render();
  }
  async function exportPdf() {
    if (busy || !history.pages.length) return;
    busy = true;
    const version = generation;
    fail("");
    get("status").textContent = "กำลังจัดหน้า PDF…";
    render();
    try {
      const { bytes } = await worker<{ bytes: Uint8Array }>({
        sources: sources.map(({ id, bytes }) => ({ id, bytes })),
        pages: history.pages,
      });
      if (version !== generation) return;
      revoke();
      resultUrl = URL.createObjectURL(
        new Blob([bytes as BlobPart], { type: "application/pdf" }),
      );
      resultSize = bytes.length;
      showResult = true;
      get("result-summary").textContent =
        `${history.pages.length} หน้า · ${(resultSize / 1024 / 1024).toFixed(2)} MB`;
      root.scrollIntoView({ block: "start" });
    } catch (e) {
      if (version === generation) fail((e as Error).message);
    } finally {
      if (version === generation) {
        busy = false;
        get("status").textContent = "";
        render();
      }
    }
  }
  input.addEventListener(
    "change",
    () => void add(Array.from(input.files ?? [])),
    { signal },
  );
  get("choose").addEventListener(
    "click",
    () => {
      if (!busy) input.click();
    },
    { signal },
  );
  root.addEventListener(
    "dragover",
    (e) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        root.classList.add("is-file-drag");
      }
    },
    { signal },
  );
  root.addEventListener(
    "dragleave",
    (e) => {
      if (!root.contains(e.relatedTarget as Node))
        root.classList.remove("is-file-drag");
    },
    { signal },
  );
  root.addEventListener(
    "drop",
    (e) => {
      root.classList.remove("is-file-drag");
      if (e.dataTransfer?.files.length) {
        e.preventDefault();
        void add(Array.from(e.dataTransfer.files));
      }
    },
    { signal },
  );
  list.addEventListener(
    "dragstart",
    (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>("[data-id]");
      if (busy || !card) return;
      dragged = card.dataset.id;
      e.dataTransfer?.setData("text/plain", dragged!);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      card.classList.add("is-dragging");
    },
    { signal },
  );
  list.addEventListener(
    "dragover",
    (e) => {
      if (!dragged || busy) return;
      e.preventDefault();
      list
        .querySelectorAll(".is-drop-target")
        .forEach((el) => el.classList.remove("is-drop-target"));
      (e.target as HTMLElement)
        .closest("[data-id]")
        ?.classList.add("is-drop-target");
    },
    { signal },
  );
  list.addEventListener(
    "drop",
    (e) => {
      if (!dragged || busy) return;
      e.preventDefault();
      e.stopPropagation();
      const target = (e.target as HTMLElement).closest<HTMLElement>("[data-id]")
        ?.dataset.id;
      const from = history.pages.findIndex((p) => p.id === dragged),
        to = history.pages.findIndex((p) => p.id === target);
      dragged = undefined;
      if (from >= 0 && to >= 0) change(movePage(history.pages, from, to));
    },
    { signal },
  );
  list.addEventListener(
    "dragend",
    () => {
      dragged = undefined;
      list
        .querySelectorAll(".is-dragging,.is-drop-target")
        .forEach((el) => el.classList.remove("is-dragging", "is-drop-target"));
    },
    { signal },
  );
  list.addEventListener(
    "click",
    (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>(
        "button[data-action]",
      );
      if (!b || busy || b.disabled) return;
      const id = b.closest<HTMLElement>("[data-id]")!.dataset.id,
        index = history.pages.findIndex((p) => p.id === id),
        p = history.pages[index];
      if (!p) return;
      if (b.dataset.action === "zoom") void enlarge(p);
      if (b.dataset.action === "rotate") rotate(new Set([p.id]));
      if (b.dataset.action === "delete")
        change(history.pages.filter((v) => v.id !== p.id));
      if (b.dataset.action === "copy") {
        const pages = [...history.pages];
        pages.splice(index + 1, 0, { ...p, id: crypto.randomUUID() });
        change(pages);
      }
      if (b.dataset.action === "left" || b.dataset.action === "right")
        change(
          movePage(
            history.pages,
            index,
            index + (b.dataset.action === "left" ? -1 : 1),
          ),
          p.id,
        );
    },
    { signal },
  );
  const on = (name: string, fn: () => void) =>
    get(name).addEventListener("click", fn, { signal });
  const historyAction = (redo = false) => {
    if (busy) return;
    redo ? history.redo() : history.undo();
    revoke();
    downloaded = false;
    fail("");
    render();
  };
  on("undo", () => historyAction());
  on("redo", () => historyAction(true));
  on("reverse", () => change([...history.pages].reverse()));
  on("reset", () => change(originals.map((p) => ({ ...p }))));
  on("rotate", () => rotate(selected));
  on("delete", () => change(history.pages.filter((p) => !selected.has(p.id))));
  on("select-all", () => {
    selected = new Set(history.pages.map((p) => p.id));
    render();
  });
  on("deselect", () => {
    selected.clear();
    render();
  });
  on("blank", () => {
    const indices = history.pages.map((p, i) => (selected.has(p.id) ? i : -1)),
      after = Math.max(-1, ...indices),
      pages = [...history.pages];
    pages.splice(after < 0 ? pages.length : after + 1, 0, {
      id: crypto.randomUUID(),
      sourceId: null,
      pageIndex: 0,
      rotation: 0,
    });
    change(pages);
  });
  on("export", () => void exportPdf());
  on("back", () => {
    showResult = false;
    render();
  });
  on("download", () => {
    if (!resultUrl) return;
    const a = document.createElement("a");
    a.href = resultUrl;
    a.download = `${sources.length === 1 ? sources[0].name.replace(/\.pdf$/i, "") : "document"}-organized.pdf`;
    a.click();
    downloaded = true;
  });
  root.querySelectorAll("[data-restart]").forEach((b) =>
    b.addEventListener(
      "click",
      () => {
        if (busy) return;
        if (
          !downloaded &&
          history.pages.length &&
          !confirm("เริ่มใหม่หรือไม่? หน้าที่จัดไว้จะถูกล้าง")
        )
          return;
        reset();
      },
      { signal },
    ),
  );
  on("preview-close", () => dialog.close());
  document.addEventListener(
    "keydown",
    (e) => {
      if (
        !root.isConnected ||
        dialog.open ||
        busy ||
        showResult ||
        (e.target as HTMLElement).matches("input,textarea,select")
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        historyAction(e.shiftKey);
      }
    },
    { signal },
  );

  guardUnsavedWork(() => sources.length > 0 && !downloaded, signal);
  window.addEventListener("pagehide", reset, { signal });
  sessions.set(root, () => {
    reset();
    picker.dispose();
    lifetime.abort();
  });
  render();
}
export function dispose(root: HTMLElement) {
  sessions.get(root)?.();
  sessions.delete(root);
}
