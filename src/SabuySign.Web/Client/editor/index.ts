import { unlockPdf } from "./password";
import { guardUnsavedWork } from "../shared/leave-guard";
import { SigningSession } from "../signing-sessions/client";
import { formatDate, localDate, type DateStamp } from "./dates";
import { installGestureZoom } from "./gesture-zoom";
import { isMark, markSvg, type MarkKind } from "./marks";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import { Signatures } from "../signatures/desktop";
import { signatureSvg } from "../signatures/data";
import { createTextFitter } from "./text-layout";
import { Session, type TextItem } from "./session";
import { validatePdf, LIMIT_BYTES } from "./pdf";
GlobalWorkerOptions.workerSrc = new URL(
  "./pdf.worker.min.mjs",
  import.meta.url,
).href;
const options = {
  isEvalSupported: false,
  useSystemFonts: false,
  wasmUrl: new URL("./wasm/", import.meta.url).href,
  cMapUrl: new URL("./cmaps/", import.meta.url).href,
  cMapPacked: true,
  standardFontDataUrl: new URL("./standard_fonts/", import.meta.url).href,
};
type Bridge = {
  invokeMethodAsync(name: string, state: unknown): Promise<void>;
};
let fitText: (item: TextItem) => TextItem = (item) => item;
let signatures: Signatures;
let shared: SigningSession;
let bridge: Bridge,
  session = new Session(layoutTextItem),
  original: Uint8Array | null = null,
  filename = "",
  task: PDFDocumentLoadingTask | null = null,
  doc: PDFDocumentProxy | null = null;
let pageNumber = 1,
  zoom = 1,
  tool = "select",
  busy = false,
  error = "",
  width = 595,
  height = 842,
  downloadedRevision = -1;
let dateStamp: DateStamp = {
  value: localDate(),
  calendar: "buddhist",
  format: "numeric",
};
let dateColor = "#172433";
let editingTextId: string | null = null;
let markKind: MarkKind = "check",
  markSize = 24,
  markColor = "#172c40",
  continuous = true,
  fitZoom = true;
let renderTask: RenderTask | null = null,
  renderGeneration = 0,
  previewTask: PDFDocumentLoadingTask | null = null,
  previewDoc: PDFDocumentProxy | null = null,
  previewPage = 1;
let output: Uint8Array | null = null,
  outputRevision = -1,
  font: Uint8Array,
  exportWorker: Worker | null = null;
let lifetime: AbortController,
  thumbnailObserver: IntersectionObserver | null = null;
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const frame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const dirty = () =>
  !shared?.closed &&
  ((session.revision > 0 && session.revision !== downloadedRevision) ||
    !!signatures?.count);
async function notify() {
  const selected = session.items.find((i) => i.id === session.selected);
  shared?.update();
  await bridge.invokeMethodAsync("Changed", {
    shared: shared?.active ?? false,
    sharedClosed: shared?.closed ?? false,
    sharedExpired: shared?.expired ?? false,
    loaded: !!doc,
    busy,
    filename,
    error,
    tool,
    pages: doc?.numPages ?? 0,
    page: pageNumber,
    count: session.items.length + (shared?.confirmed.length ?? 0),
    zoom,
    fitZoom,
    markKind,
    markSize,
    markColor,
    continuous,
    date: selected?.date ?? dateStamp,
    datePreview: formatDate(selected?.date ?? dateStamp),
    dateSize: selected?.date ? selected.size : session.defaultTextSize,
    dateColor: selected?.date ? selected.color : dateColor,
    canUndo: session.canUndo,
    canRedo: session.canRedo,
    selected: selected
      ? {
          ...selected,
          signature: undefined,
          isSignature: !!selected.signature,
          isMark: !!selected.mark,
        }
      : null,
  });
}
function friendly(e: unknown) {
  const message = e instanceof Error ? e.message : "";
  return /[ก-๙]/.test(message)
    ? message
    : "ไม่สามารถเปิดหรือประมวลผล PDF นี้ได้ ไฟล์อาจเสียหายหรือมีรหัสผ่าน กรุณาลองไฟล์อื่น";
}
async function report(e: unknown) {
  error = friendly(e);
  await notify();
}
let resetGestureZoom: (() => void) | undefined;
export async function init(ref: Bridge) {
  bridge = ref;
  lifetime = new AbortController();
  const { signal } = lifetime;
  const workspace = document.querySelector<HTMLElement>(".workspace")!;
  resetGestureZoom = installGestureZoom(
    workspace,
    signal,
    () => !!doc && !busy && !document.querySelector("dialog[open]"),
    async (factor, clientX, clientY) => {
      const surface = $("page-surface");
      const before = surface.getBoundingClientRect();
      const pointX = (clientX - before.left) / zoom;
      const pointY = (clientY - before.top) / zoom;
      zoom = Math.max(0.1, Math.min(4, zoom * factor));
      fitZoom = false;
      await renderPage(() => {
        const after = surface.getBoundingClientRect();
        workspace.scrollLeft += after.left + pointX * zoom - clientX;
        workspace.scrollTop += after.top + pointY * zoom - clientY;
      });
      await notify();
    },
    report,
  );

  signatures = new Signatures((id) => {
    if (busy || shared?.locked || !doc) return;
    tool = `signature:${id}`;
    renderObjects();
    void notify();
  });
  $("page-surface").addEventListener(
    "dragover",
    (e) => {
      if (e.dataTransfer?.types.includes("application/x-sabuysign-signature")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    },
    { signal },
  );
  $("page-surface").addEventListener(
    "drop",
    (e) => {
      e.preventDefault();
      const id = e.dataTransfer?.getData("application/x-sabuysign-signature");
      if (id) placeSignature(id, e.clientX, e.clientY);
    },
    { signal },
  );
  await document.fonts.load("16px Sarabun");
  font = new Uint8Array(
    await (await fetch("./fonts/Sarabun-Regular.ttf")).arrayBuffer(),
  );
  fitText = createTextFitter(font);
  $("pdf-file").addEventListener(
    "change",
    async (e) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = "";
      if (file) await openFile(file);
    },
    { signal },
  );
  const drop = $("drop-zone");
  drop.addEventListener(
    "dragover",
    (e) => {
      e.preventDefault();
      drop.classList.add("drag-over");
    },
    { signal },
  );
  drop.addEventListener("dragleave", () => drop.classList.remove("drag-over"), {
    signal,
  });
  drop.addEventListener(
    "drop",
    (e) => {
      e.preventDefault();
      drop.classList.remove("drag-over");
      if (e.dataTransfer?.files[0]) void openFile(e.dataTransfer.files[0]);
    },
    { signal },
  );
  $("page-surface").addEventListener(
    "click",
    (e) => {
      if (
        busy ||
        shared?.locked ||
        (e.target as HTMLElement).closest(".text-object")
      )
        return;
      if (tool.startsWith("signature:")) {
        placeSignature(tool.slice(10), e.clientX, e.clientY);
      } else if (tool === "mark") {
        const rect = $("page-surface").getBoundingClientRect();
        session.addMark(
          pageNumber - 1,
          Math.max(
            0,
            Math.min(
              width - markSize,
              (e.clientX - rect.left) / zoom - markSize / 2,
            ),
          ),
          Math.max(
            0,
            Math.min(
              height - markSize,
              (e.clientY - rect.top) / zoom - markSize / 2,
            ),
          ),
          markKind,
          markSize,
          markColor,
        );
        if (matchMedia("(max-width: 700px)").matches || !continuous)
          tool = "select";
        else session.selected = null;
        changed();
      } else if (tool === "text" || tool === "date") {
        const rect = $("page-surface").getBoundingClientRect();
        session.add(
          pageNumber - 1,
          Math.max(0, Math.min(width - 220, (e.clientX - rect.left) / zoom)),
          Math.max(0, Math.min(height - 54, (e.clientY - rect.top) / zoom)),
          tool === "date" ? dateStamp : undefined,
          tool === "date" ? dateColor : undefined,
        );
        editingTextId = tool === "text" ? session.selected : null;
        tool = "select";
        changed();
      } else {
        editingTextId = null;
        session.selected = null;
        renderObjects();
        void notify();
      }
    },
    { signal },
  );
  guardUnsavedWork(dirty, signal);
  window.addEventListener(
    "keydown",
    (e) => {
      const typing = (e.target as HTMLElement).closest(
        "input,textarea,select,[contenteditable]",
      );
      if (
        typing ||
        busy ||
        shared?.locked ||
        !doc ||
        document.querySelector("dialog[open]")
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        void command(e.shiftKey ? "redo" : "undo");
      } else if (
        (e.key === "Delete" || e.key === "Backspace") &&
        session.selected
      ) {
        e.preventDefault();
        void command("delete");
      } else if (e.key === "Escape") {
        session.selected = null;
        tool = "select";
        renderObjects();
        void notify();
      } else if (
        session.selected &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
      ) {
        e.preventDefault();
        const i = session.items.find((i) => i.id === session.selected)!;
        const step = e.shiftKey ? 10 : 1;
        session.update(i.id, {
          x: Math.max(
            0,
            Math.min(
              width - i.width,
              i.x +
                (e.key === "ArrowRight"
                  ? step
                  : e.key === "ArrowLeft"
                    ? -step
                    : 0),
            ),
          ),
          y: Math.max(
            0,
            Math.min(
              height - i.height,
              i.y +
                (e.key === "ArrowDown"
                  ? step
                  : e.key === "ArrowUp"
                    ? -step
                    : 0),
            ),
          ),
        });
        changed();
      }
    },
    { signal },
  );
  $("preview-dialog").addEventListener(
    "close",
    () => {
      void clearPreview();
    },
    { signal },
  );
  window.addEventListener(
    "resize",
    () => {
      if (doc && fitZoom && !busy) void renderPage().then(notify).catch(report);
    },
    { signal },
  );
  $("page-surface").addEventListener(
    "pointermove",
    (e) => {
      const ghost = $("mark-ghost");
      if (!ghost) return;
      ghost.hidden =
        tool !== "mark" ||
        !!(e.target as HTMLElement).closest(".text-object") ||
        e.pointerType === "touch";
      const r = $("page-surface").getBoundingClientRect();
      ghost.style.left = `${Math.max(0, Math.min(width - markSize, (e.clientX - r.left) / zoom - markSize / 2)) * zoom}px`;
      ghost.style.top = `${Math.max(0, Math.min(height - markSize, (e.clientY - r.top) / zoom - markSize / 2)) * zoom}px`;
    },
    { signal },
  );
  $("page-surface").addEventListener(
    "pointerleave",
    () => {
      const ghost = $("mark-ghost");
      if (ghost) ghost.hidden = true;
    },
    { signal },
  );
  shared = new SigningSession({
    document: async () => {
      if (!doc) throw new Error("กรุณาเปิด PDF ก่อน");
      return { bytes: await generate(), name: filename };
    },
    open: async (file) => {
      await openFile(file, true);
      if (!doc) throw new Error("เปิดเอกสารไม่ได้");
    },
    drafts: () => session.items,
    clear: () => {
      session = new Session(layoutTextItem);
      output = null;
      outputRevision = -1;
    },
    refresh: () => {
      output = null;
      outputRevision = -1;
      if (doc) renderObjects();
      void notify();
    },
    pages: () => doc?.numPages ?? 0,
    pageBounds: async (page) => {
      const viewport = (await doc!.getPage(page + 1)).getViewport({ scale: 1 });
      return { width: viewport.width, height: viewport.height };
    },
    go: (page) => {
      void command("page", String(page + 1));
    },
    draw: () => {
      if (!shared?.locked) signatures.create();
    },
  });
  await shared.restore();
  await notify();
}
export function pick() {
  if (!busy && !shared?.active) $<HTMLInputElement>("pdf-file").click();
}
async function openFile(file: File, internal = false) {
  const openSignal = lifetime.signal;
  let unlocked = false;
  if (shared?.active && !internal) return;
  if (busy || (!internal && shared?.locked)) return;
  if (
    !internal &&
    dirty() &&
    !confirm("เปิดไฟล์ใหม่? งานที่ยังไม่ดาวน์โหลดในไฟล์ปัจจุบันจะหาย")
  )
    return;
  busy = true;
  error = "";
  await notify();
  let candidate: PDFDocumentLoadingTask | null = null;
  try {
    if (file.size > LIMIT_BYTES)
      throw new Error("ไฟล์ใหญ่เกิน 25 MB กรุณาใช้ไฟล์ที่เล็กลง");
    let bytes = new Uint8Array(await file.arrayBuffer());
    try {
      await validatePdf(bytes);
    } catch (e) {
      // pdf-lib's ES5 Error subclass does not retain instanceof identity.
      if (
        !(e instanceof Error) ||
        !e.message.startsWith(
          "Input document to `PDFDocument.load` is encrypted.",
        )
      )
        throw e;
      const opened = await unlockPdf(bytes, openSignal);
      if (!opened || openSignal.aborted) return;
      unlocked = true;
      bytes = new Uint8Array(opened);
      await validatePdf(bytes);
    }
    if (openSignal.aborted) return;
    candidate = getDocument({ ...options, data: bytes.slice() });
    const loaded = await candidate.promise;
    if (openSignal.aborted) {
      await candidate.destroy();
      candidate = null;
      return;
    }
    const first = await loaded.getPage(1);
    const viewport = first.getViewport({ scale: 1 });
    if (
      viewport.width < 220 ||
      viewport.height < 80 ||
      viewport.width > 5000 ||
      viewport.height > 5000
    )
      throw new Error("ขนาดหน้ากระดาษนี้ยังไม่รองรับ");
    await releaseDocument();
    task = candidate;
    candidate = null;
    doc = loaded;
    original = bytes;
    sourceUnlocked = unlocked;
    filename = file.name;
    session = new Session(layoutTextItem);
    editingTextId = null;
    pageNumber = 1;
    zoom = 1;
    dateStamp = { value: localDate(), calendar: "buddhist", format: "numeric" };
    dateColor = "#172433";
    fitZoom = true;
    tool = "select";
    markKind = "check";
    markSize = 24;
    markColor = "#172c40";
    continuous = true;
    downloadedRevision = -1;
    await notify();
    await frame();
    await renderPage();
    setupThumbnails();
  } catch (e) {
    await candidate?.destroy();
    await report(e);
  } finally {
    busy = false;
    if (!openSignal.aborted) await notify();
  }
}
async function renderPage(onLayout?: () => void) {
  if (!doc) return;
  const generation = ++renderGeneration;
  renderTask?.cancel();
  const page = await doc.getPage(pageNumber);
  if (generation !== renderGeneration) return;
  const unit = page.getViewport({ scale: 1 });
  width = unit.width;
  height = unit.height;
  if (fitZoom) {
    const workspace = document.querySelector<HTMLElement>(".workspace")!;
    const style = getComputedStyle(workspace);
    zoom = Math.min(
      1.16,
      Math.max(
        0.05,
        (workspace.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight)) /
          width,
      ),
    );
  }
  const viewport = page.getViewport({ scale: zoom });
  const surface = $("page-surface");
  surface.style.width = `${viewport.width}px`;
  surface.style.height = `${viewport.height}px`;
  const canvas = $<HTMLCanvasElement>("page-canvas");
  const ratio = Math.min(
    devicePixelRatio,
    2,
    Math.sqrt(16000000 / (viewport.width * viewport.height)),
  );
  canvas.width = Math.ceil(viewport.width * ratio);
  canvas.height = Math.ceil(viewport.height * ratio);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  renderObjects();
  onLayout?.();
  renderTask = page.render({
    canvas,
    viewport,
    transform: [ratio, 0, 0, ratio, 0, 0],
  });
  try {
    await renderTask.promise;
  } catch (e) {
    if ((e as Error).name !== "RenderingCancelledException") throw e;
  }
  document
    .querySelectorAll(".thumbnail")
    .forEach((el) =>
      el.classList.toggle(
        "selected",
        Number((el as HTMLElement).dataset.page) === pageNumber,
      ),
    );
}
function setupThumbnails() {
  thumbnailObserver?.disconnect();
  const root = $("thumbnails");
  root.replaceChildren();
  const owner = doc!;
  thumbnailObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        thumbnailObserver?.unobserve(entry.target);
        const button = entry.target as HTMLButtonElement;
        void (async () => {
          try {
            const p = await owner.getPage(Number(button.dataset.page));
            if (doc !== owner) return;
            const viewport = p.getViewport({
              scale: 112 / p.getViewport({ scale: 1 }).width,
            });
            const canvas = button.querySelector("canvas")!;
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await p.render({ canvas, viewport }).promise;
          } catch {
            /* Session may have been closed while thumbnail rendered. */
          }
        })();
      }
    },
    { root, rootMargin: "200px" },
  );
  for (let i = 1; i <= owner.numPages; i++) {
    const button = document.createElement("button");
    button.className = `thumbnail ${i === pageNumber ? "selected" : ""}`;
    button.dataset.page = String(i);
    button.setAttribute("aria-label", `หน้า ${i}`);
    const c = document.createElement("canvas");
    c.width = 112;
    c.height = 158;
    const label = document.createElement("span");
    label.textContent = String(i);
    button.append(c, label);
    button.onclick = () => {
      if (!busy) {
        pageNumber = i;
        editingTextId = null;
        session.selected = null;
        void renderPage().then(notify).catch(report);
      }
    };
    root.append(button);
    thumbnailObserver.observe(button);
  }
}
function placeSignature(id: string, clientX: number, clientY: number) {
  if (busy || shared?.locked || !doc) return;
  const data = signatures.get(id);
  if (!data) return;
  const rect = $("page-surface").getBoundingClientRect();
  const w = Math.min(
      180,
      data.width,
      width,
      (height * data.width) / data.height,
    ),
    h = (w * data.height) / data.width;
  session.addSignature(
    pageNumber - 1,
    Math.max(0, Math.min(width - w, (clientX - rect.left) / zoom)),
    Math.max(0, Math.min(height - h, (clientY - rect.top) / zoom)),
    data,
    w,
  );
  tool = "select";
  changed();
}
function changed() {
  output = null;
  outputRevision = -1;
  renderObjects();
  void notify();
}
function layoutTextItem(item: TextItem): TextItem {
  const fitted = fitText(item);
  if (item.page !== pageNumber - 1) return fitted;
  return {
    ...fitted,
    x: Math.max(0, Math.min(item.x, width - fitted.width)),
    y: Math.max(0, Math.min(item.y, height - fitted.height)),
  };
}
function renderObjects() {
  const root = $("text-layer");
  root.replaceChildren();
  root.style.cursor = tool !== "select" ? "crosshair" : "default";
  shared?.render(root, pageNumber - 1, zoom);
  if (shared?.closed) return;
  for (const item of session.items.filter((i) => i.page === pageNumber - 1)) {
    const el = document.createElement("div");
    el.className = `text-object ${item.id === session.selected ? "selected" : ""}`;
    el.dataset.id = item.id;
    if (item.signature) el.classList.add("signature-object");
    if (item.mark) el.classList.add("mark-object");
    Object.assign(el.style, {
      left: `${item.x * zoom}px`,
      top: `${item.y * zoom}px`,
      width: `${item.width * zoom}px`,
      height: `${item.height * zoom}px`,
    });
    const actions = document.createElement("div");
    actions.className = "object-actions";
    if (item.y * zoom < 36) actions.classList.add("below");
    actions.style.left = `${Math.min(0, (width - item.x) * zoom - (item.mark ? 144 : 68))}px`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "object-delete";
    remove.setAttribute(
      "aria-label",
      item.mark ? "ลบเครื่องหมาย" : item.signature ? "ลบลายเซ็น" : "ลบข้อความ",
    );
    remove.title = item.mark
      ? "ลบเครื่องหมาย"
      : item.signature
        ? "ลบลายเซ็น"
        : "ลบข้อความ";
    remove.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';
    remove.onpointerdown = (e) => e.stopPropagation();
    remove.onclick = (e) => {
      e.stopPropagation();
      if (busy || shared?.locked) return;
      session.remove(item.id);
      changed();
      document
        .querySelector<HTMLButtonElement>('button[aria-label="ย้อนกลับ"]')
        ?.focus();
    };
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "move-handle";
    handle.textContent = "⋮⋮";
    handle.setAttribute(
      "aria-label",
      item.mark
        ? "ลากเพื่อย้ายเครื่องหมาย"
        : item.signature
          ? "ลากเพื่อย้ายลายเซ็น"
          : "ลากเพื่อย้ายข้อความ",
    );
    handle.title = "ลากเพื่อย้าย · ใช้ปุ่มลูกศรเพื่อขยับ";
    if (item.mark) {
      handle.innerHTML =
        '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 2v20M2 12h20m-14-6 4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4m12-8 4 4-4 4"/></svg>';
      const copy = document.createElement("button");
      copy.className = "object-copy";
      copy.type = "button";
      copy.setAttribute("aria-label", "ทำสำเนาเครื่องหมาย");
      copy.innerHTML =
        '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/></svg>';
      copy.onpointerdown = (e) => e.stopPropagation();
      copy.onclick = (e) => {
        e.stopPropagation();
        if (busy || shared?.locked) return;
        session.duplicate(item.id, width, height);
        changed();
      };
      actions.append(handle, copy, remove);
    } else if (item.signature) actions.append(handle, remove);
    else actions.append(remove);
    const text = document.createElement("textarea");
    text.value = item.text;
    text.spellcheck = false;
    text.wrap = "off";
    text.setAttribute(
      "aria-label",
      item.date ? "วันที่บนเอกสาร" : "ข้อความบนเอกสาร",
    );
    text.readOnly = !!item.date || item.id !== editingTextId;
    Object.assign(text.style, {
      fontSize: `${item.size * zoom}px`,
      lineHeight: "1.6",
      color: item.color,
      textAlign: item.align,
    });
    text.onpointerdown = (e) => {
      e.stopPropagation();
      if (
        busy ||
        item.signature ||
        item.mark ||
        editingTextId === item.id ||
        e.button !== 0
      )
        return;
      e.preventDefault();
      tool = "select";
      session.selected = item.id;
      document
        .querySelectorAll(".text-object")
        .forEach((n) => n.classList.remove("selected"));
      el.classList.add("selected");
      void notify();
      text.setPointerCapture(e.pointerId);
      const startX = e.clientX,
        startY = e.clientY;
      let moved = false;
      let update: Partial<TextItem> = {};
      text.onpointermove = (ev) => {
        const dx = ev.clientX - startX,
          dy = ev.clientY - startY;
        if (!moved && Math.hypot(dx, dy) < 4) return;
        moved = true;
        update = {
          x: Math.max(0, Math.min(width - item.width, item.x + dx / zoom)),
          y: Math.max(0, Math.min(height - item.height, item.y + dy / zoom)),
        };
        el.style.left = `${update.x! * zoom}px`;
        el.style.top = `${update.y! * zoom}px`;
      };
      const finish = (commit: boolean) => {
        text.onpointermove = null;
        text.onpointerup = null;
        text.onpointercancel = null;
        if (moved && commit) {
          session.update(item.id, update);
          changed();
        } else if (moved) renderObjects();
      };
      text.onpointerup = () => finish(true);
      text.onpointercancel = () => finish(false);
    };
    text.onclick = () => {
      if (session.selected !== item.id) {
        tool = "select";
        session.selected = item.id;
        document
          .querySelectorAll(".text-object")
          .forEach((n) => n.classList.remove("selected"));
        el.classList.add("selected");
        document
          .querySelectorAll<HTMLTextAreaElement>(".text-object textarea")
          .forEach((input) => (input.readOnly = true));
        text.readOnly = !!item.date || editingTextId !== item.id;
        void notify();
      }
    };
    text.ondblclick = () => {
      if (busy || item.signature || item.mark || item.date) return;
      editingTextId = item.id;
      session.selected = item.id;
      tool = "select";
      el.classList.add("selected");
      text.readOnly = false;
      text.focus();
      text.setSelectionRange(text.value.length, text.value.length);
      void notify();
    };
    text.onblur = () => {
      if (editingTextId === item.id) {
        editingTextId = null;
        text.readOnly = true;
      }
    };
    text.oninput = () => {
      session.update(item.id, { text: text.value });
      Object.assign(
        item,
        session.items.find((i) => i.id === item.id),
      );
      el.style.left = `${item.x * zoom}px`;
      el.style.top = `${item.y * zoom}px`;
      actions.classList.toggle("below", item.y * zoom < 36);
      actions.style.left = `${Math.min(0, (width - item.x) * zoom - (item.mark ? 144 : 68))}px`;
      el.style.width = `${item.width * zoom}px`;
      el.style.height = `${item.height * zoom}px`;
      text.scrollTop = 0;
      text.scrollLeft = 0;
      output = null;
      outputRevision = -1;
      void notify();
    };
    const grip = document.createElement("button");
    grip.className = "resize-handle";
    grip.setAttribute(
      "aria-label",
      item.signature ? "ปรับขนาดลายเซ็น" : "ปรับขนาดกล่องข้อความ",
    );
    for (const [node, resize] of [
      [handle, false],
      [grip, true],
      ...(item.signature ? [[el, false] as const] : []),
    ] as const)
      node.onpointerdown = (e) => {
        if (
          busy ||
          shared?.locked ||
          e.button !== 0 ||
          (resize && !item.signature)
        )
          return;
        if (node === el && (e.target as HTMLElement).closest("button")) return;
        e.preventDefault();
        e.stopPropagation();
        session.selected = item.id;
        tool = "select";
        editingTextId = null;
        document
          .querySelectorAll(".text-object.selected")
          .forEach((n) => n.classList.remove("selected"));
        el.classList.add("selected");
        void notify();
        node.setPointerCapture(e.pointerId);
        const startX = e.clientX,
          startY = e.clientY;
        let moved = false;
        let update: Partial<TextItem> = {};
        node.onpointermove = (ev) => {
          if (
            !moved &&
            Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4
          )
            return;
          moved = true;
          const dx = (ev.clientX - startX) / zoom,
            dy = (ev.clientY - startY) / zoom;
          update = resize
            ? {
                width: Math.max(30, Math.min(width - item.x, item.width + dx)),
                height: Math.max(
                  item.size * 1.6,
                  Math.min(height - item.y, item.height + dy),
                ),
              }
            : {
                x: Math.max(0, Math.min(width - item.width, item.x + dx)),
                y: Math.max(0, Math.min(height - item.height, item.y + dy)),
              };
          if (resize && item.signature) {
            const ratio = item.height / item.width;
            const w = Math.max(
              Math.min(20, width - item.x, (height - item.y) / ratio),
              Math.min(
                width - item.x,
                (height - item.y) / ratio,
                item.width + dx,
              ),
            );
            update = { width: w, height: w * ratio };
          }
          for (const [key, value] of Object.entries(update)) {
            const css = key === "x" ? "left" : key === "y" ? "top" : key;
            el.style.setProperty(css, `${Number(value) * zoom}px`);
          }
        };
        const finish = (commit: boolean) => {
          node.onpointermove = null;
          node.onpointerup = null;
          node.onpointercancel = null;
          node.onlostpointercapture = null;
          if (moved && commit && !busy && !shared?.locked) {
            session.update(item.id, update);
            changed();
          } else if (moved) renderObjects();
        };
        node.onpointerup = () => finish(true);
        node.onpointercancel = () => finish(false);
        node.onlostpointercapture = () => finish(false);
      };
    if (item.mark) {
      const mark = document.createElement("button");
      mark.className = "mark-visual";
      mark.type = "button";
      mark.setAttribute("aria-label", "เลือกเครื่องหมาย");
      mark.innerHTML = markSvg(item.mark);
      mark.style.color = item.color;
      mark.onclick = (e) => {
        e.stopPropagation();
        if (busy || shared?.locked) return;
        session.selected = item.id;
        markKind = item.mark!;
        markSize = item.size;
        markColor = item.color;
        tool = "select";
        renderObjects();
        void notify();
      };
      el.append(actions, mark);
    } else if (item.signature) {
      const img = document.createElement("img");
      img.src = `data:image/svg+xml,${encodeURIComponent(signatureSvg(item.signature))}`;
      img.alt = "ลายเซ็นบนเอกสาร";
      img.draggable = false;
      el.onclick = (e) => e.stopPropagation();
      el.append(actions, img, grip);
    } else el.append(actions, text);
    root.append(el);
  }
  if (tool === "mark") {
    const ghost = document.createElement("div");
    ghost.id = "mark-ghost";
    ghost.hidden = true;
    ghost.innerHTML = markSvg(markKind);
    ghost.style.width = ghost.style.height = `${markSize * zoom}px`;
    ghost.style.color = markColor;
    root.append(ghost);
  }
}
export async function patch(key: string, value: string) {
  if (busy || shared?.locked || !session.selected) return;
  editingTextId = null;
  const item = session.items.find((i) => i.id === session.selected)!;
  if (item.mark) return;
  if (item.signature) {
    if (!["width", "height"].includes(key)) return;
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    const ratio = item.height / item.width;
    const w = Math.max(
      Math.min(20, width - item.x, (height - item.y) / ratio),
      Math.min(
        width - item.x,
        (height - item.y) / ratio,
        key === "width" ? n : n / ratio,
      ),
    );
    session.update(item.id, { width: w, height: w * ratio });
    changed();
    return;
  }
  let change: Partial<TextItem> = {};
  if (key === "text") change = { text: value };
  else if (key === "color" && /^#[a-f0-9]{6}$/i.test(value))
    change = { color: value };
  else if (key === "align" && ["left", "center", "right"].includes(value))
    change = { align: value as TextItem["align"] };
  else if (key === "size") {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    change = { size: Math.max(8, Math.min(72, n)) };
  }
  session.update(item.id, change);
  changed();
}
function generate(): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    exportWorker = new Worker(new URL("./export.worker.js", import.meta.url), {
      type: "module",
    });
    const worker = exportWorker;
    worker.onmessage = (e) => {
      worker.terminate();
      exportWorker = null;
      e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.bytes);
    };
    worker.onerror = () => {
      worker.terminate();
      exportWorker = null;
      reject(new Error("ไม่สามารถสร้าง PDF ได้ กรุณาลดขนาดไฟล์แล้วลองใหม่"));
    };
    worker.postMessage({
      bytes: original!.slice(),
      items: [
        ...(shared?.confirmed ?? []),
        ...(shared?.closed ? [] : session.items),
      ],
      font: font.slice(),
    });
  });
}
let sourceUnlocked = false;
async function preview() {
  if (!original) return;
  busy = true;
  error = "";
  await notify();
  try {
    await clearPreview();
    const revision = session.revision;
    output = await generate();
    if (session.revision !== revision)
      throw new Error("เอกสารเปลี่ยนระหว่างสร้างตัวอย่าง กรุณาลองใหม่");
    outputRevision = revision;
    $("preview-password-note").hidden = !sourceUnlocked;
    previewTask = getDocument({ ...options, data: output.slice() });
    previewDoc = await previewTask.promise;
    previewPage = pageNumber;
    await renderPreview();
    $<HTMLDialogElement>("preview-dialog").showModal();
  } catch (e) {
    await clearPreview();
    await report(e);
  } finally {
    busy = false;
    await notify();
  }
}
async function renderPreview() {
  if (!previewDoc) return;
  const page = await previewDoc.getPage(previewPage);
  const unit = page.getViewport({ scale: 1 });
  const scale = Math.min(1.3, 750 / unit.width);
  const viewport = page.getViewport({ scale });
  const canvas = $<HTMLCanvasElement>("preview-canvas");
  canvas.width = viewport.width * 1.5;
  canvas.height = viewport.height * 1.5;
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  await page.render({ canvas, viewport, transform: [1.5, 0, 0, 1.5, 0, 0] })
    .promise;
  $("preview-page-label").textContent =
    `หน้า ${previewPage} / ${previewDoc.numPages}`;
}
async function clearPreview() {
  const previous = previewTask;
  previewTask = null;
  previewDoc = null;
  output = null;
  outputRevision = -1;
  await previous?.destroy();
  const c = $<HTMLCanvasElement>("preview-canvas");
  if (c) {
    c.width = 0;
    c.height = 0;
  }
}
export async function command(action: string, value?: string) {
  if (busy && action !== "clearError") return;
  if (shared?.active) {
    if (
      ["preview", "download"].includes(action) &&
      (!shared.closed || shared.expired)
    )
      return;
    if (action === "close") {
      if (
        !session.items.length ||
        confirm("ออกจากเอกสาร? ลายเซ็นที่ยังไม่ยืนยันจะหาย")
      )
        location.href = "/tools/fill-sign";
      return;
    }
    if (action === "tool" && value !== "select") return;
    if (
      shared.locked &&
      ["undo", "redo", "delete", "signature"].includes(action)
    )
      return;
  }
  try {
    switch (action) {
      case "share":
        shared.share();
        break;
      case "markKind":
      case "markSize":
      case "markColor": {
        const selected = session.items.find(
          (i) => i.id === session.selected && i.mark,
        );
        if (action === "markKind" && value && isMark(value)) markKind = value;
        if (action === "markSize" && Number.isFinite(Number(value)))
          markSize = Math.max(14, Math.min(48, Number(value)));
        if (action === "markColor" && value && /^#[a-f0-9]{6}$/i.test(value))
          markColor = value;
        if (selected) {
          const size = action === "markSize" ? markSize : selected.size;
          session.update(selected.id, {
            mark: action === "markKind" ? markKind : selected.mark,
            color: action === "markColor" ? markColor : selected.color,
            size,
            width: size,
            height: size,
            x: Math.max(
              0,
              Math.min(selected.x + (selected.width - size) / 2, width - size),
            ),
            y: Math.max(
              0,
              Math.min(
                selected.y + (selected.height - size) / 2,
                height - size,
              ),
            ),
          });
        }
        changed();
        break;
      }
      case "dateValue":
      case "dateToday":
      case "dateCalendar":
      case "dateFormat":
      case "dateSize":
      case "dateColor": {
        const selected = session.items.find(
          (i) => i.id === session.selected && i.date,
        );
        const next = { ...(selected?.date ?? dateStamp) };
        if (action === "dateValue") next.value = value ?? "";
        if (action === "dateToday") next.value = localDate();
        if (action === "dateCalendar")
          next.calendar = value as DateStamp["calendar"];
        if (action === "dateFormat") next.format = value as DateStamp["format"];
        formatDate(next);
        dateStamp = next;
        if (action === "dateSize") session.setDefaultTextSize(Number(value));
        if (action === "dateColor" && /^#[a-f0-9]{6}$/i.test(value ?? ""))
          dateColor = value!;
        if (selected)
          session.update(selected.id, {
            date: next,
            size:
              action === "dateSize" ? session.defaultTextSize : selected.size,
            color: action === "dateColor" ? dateColor : selected.color,
          });
        error = "";
        changed();
        break;
      }
      case "finishDate":
        session.selected = null;
        tool = "select";
        renderObjects();
        break;
      case "finishMark":
        session.selected = null;
        tool = "select";
        renderObjects();
        break;
      case "continuous":
        continuous = value === "true";
        break;
      case "duplicate":
        if (session.selected)
          session.duplicate(session.selected, width, height);
        changed();
        break;
      case "signature":
        editingTextId = null;
        if (doc) shared.choose();
        break;
      case "tool": {
        editingTextId = null;
        const selectedDate = session.items.find(
          (i) => i.id === session.selected && i.date,
        );
        if (value === "date" && selectedDate?.date) {
          dateStamp = { ...selectedDate.date };
          dateColor = selectedDate.color;
          session.setDefaultTextSize(selectedDate.size);
        }
        tool = value ?? "select";
        if (tool !== "select") session.selected = null;
        renderObjects();
        break;
      }
      case "undo":
        editingTextId = null;
        session.undo();
        changed();
        break;
      case "redo":
        editingTextId = null;
        session.redo();
        changed();
        break;
      case "delete":
        if (session.selected) session.remove(session.selected);
        changed();
        break;
      case "page":
        editingTextId = null;
        pageNumber = Math.max(
          1,
          Math.min(doc?.numPages ?? 1, Math.floor(Number(value) || 1)),
        );
        session.selected = null;
        await renderPage();
        break;
      case "zoom":
        fitZoom = value === "fit";
        zoom = Number(value) || 1;
        await renderPage();
        break;
      case "preview":
        await preview();
        break;
      case "closePreview":
        $<HTMLDialogElement>("preview-dialog").close();
        break;
      case "previewPrevious":
      case "previewNext":
        if (previewDoc) {
          busy = true;
          previewPage = Math.max(
            1,
            Math.min(
              previewDoc.numPages,
              previewPage + (action === "previewNext" ? 1 : -1),
            ),
          );
          try {
            await renderPreview();
          } finally {
            busy = false;
          }
        }
        break;
      case "download": {
        if (!output || outputRevision !== session.revision)
          throw new Error("เอกสารมีการเปลี่ยนแปลง กรุณาสร้างตัวอย่างใหม่");
        const url = URL.createObjectURL(
          new Blob([output.slice().buffer], { type: "application/pdf" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = filename.replace(/\.pdf$/i, "") + "-filled.pdf";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
        downloadedRevision = session.revision;
        break;
      }
      case "clearError":
        error = "";
        break;
      case "close":
        if (!dirty() || confirm("ปิดเอกสาร? งานที่ยังไม่ดาวน์โหลดจะหาย")) {
          await releaseDocument();
          filename = "";
          session = new Session(layoutTextItem);
          error = "";
        }
        break;
    }
    await notify();
  } catch (e) {
    await report(e);
  }
}
async function releaseDocument() {
  editingTextId = null;
  resetGestureZoom?.();
  signatures?.reset();
  renderGeneration++;
  renderTask?.cancel();
  renderTask = null;
  thumbnailObserver?.disconnect();
  await clearPreview();
  await task?.destroy();
  task = null;
  doc = null;
  original = null;
  sourceUnlocked = false;
  $("text-layer")?.replaceChildren();
  $("thumbnails")?.replaceChildren();
  const c = $<HTMLCanvasElement>("page-canvas");
  if (c) {
    c.width = 0;
    c.height = 0;
  }
}
export async function dispose() {
  lifetime?.abort();
  exportWorker?.terminate();
  await releaseDocument();
  signatures?.dispose();
  shared?.dispose();
}
