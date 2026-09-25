import { MediaSession } from "../shared/media";
import { createFileSourcePicker } from "../shared/file-source-picker";
import { zipFiles } from "../shared/zip";
import { validateWord, pdfName, MAX_FILES } from "./files";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
GlobalWorkerOptions.workerSrc = new URL(
  "./pdf.worker.min.mjs",
  import.meta.url,
).href;
const sessions = new WeakMap<HTMLElement, () => void>();
type Entry = {
  file: File;
  row: HTMLElement;
  status: HTMLElement;
  blob?: Blob;
  url?: string;
  name: string;
  failed: boolean;
};
export function init(root: HTMLElement) {
  dispose(root);
  const lifetime = new AbortController(),
    { signal } = lifetime;
  const get = <T extends HTMLElement>(key: string) =>
    root.querySelector<T>(`[data-${key}]`)!;
  const input = get<HTMLInputElement>("files"),
    list = get("list"),
    dialog = get<HTMLDialogElement>("preview");
  let loading: ReturnType<typeof getDocument> | undefined;
  let entries: Entry[] = [],
    busy = false,
    alive = true,
    preview: PDFDocumentProxy | undefined,
    pageNo = 1,
    render: RenderTask | undefined,
    previewEpoch = 0;
  const session = new MediaSession(() => entries.some((e) => !!e.blob));
  const picker = createFileSourcePicker(
    root.querySelector("[data-file-picker]")!,
    () => input.click(),
  );
  const error = (message = "") => {
    get("error").textContent = message;
    get("error").hidden = !message;
  };
  const size = (n: number) =>
    n < 1_000_000
      ? `${Math.max(1, Math.round(n / 1000))} KB`
      : `${(n / 1_000_000).toFixed(1)} MB`;
  function update() {
    const ready = entries.filter((e) => e.blob).length,
      pending = entries.length - ready;
    get("intro").hidden = entries.length > 0;
    get("workspace").hidden = !entries.length;
    get("count").textContent =
      `${entries.length} / ${MAX_FILES} ไฟล์ · ไฟล์ละไม่เกิน 50 MB`;
    get("heading").textContent = busy
      ? "กำลังแปลงเอกสาร"
      : ready === entries.length && ready
        ? "PDF พร้อมแล้ว"
        : ready
          ? "แปลงเสร็จบางไฟล์"
          : "พร้อมแปลงเป็น PDF";
    get("summary").textContent = ready
      ? `พร้อมดาวน์โหลด ${ready} ไฟล์${pending ? ` · เหลือ ${pending} ไฟล์` : ""}`
      : "คงข้อความ รูปภาพ และตาราง แล้วตรวจตัวอย่างก่อนดาวน์โหลด";
    const convert = get<HTMLButtonElement>("convert");
    convert.hidden = !pending;
    convert.classList.toggle("button-blue", ready === 0);
    convert.classList.toggle("button-soft", ready > 0);
    convert.disabled = busy;
    convert.textContent = busy
      ? "กำลังแปลง…"
      : entries.some((e) => e.failed)
        ? "ลองแปลงไฟล์ที่เหลืออีกครั้ง"
        : "แปลงเป็น PDF";
    const single = get<HTMLAnchorElement>("single-download");
    single.hidden = ready !== 1 || busy;
    if (ready === 1) {
      const entry = entries.find((e) => e.blob)!;
      single.href = entry.url!;
      single.download = entry.name;
    }
    get("reset").hidden = !ready || busy;
    const zip = get<HTMLButtonElement>("zip");
    zip.hidden = ready < 2;
    zip.disabled = busy;
    picker.update(entries.length, busy || entries.length >= MAX_FILES);
    root
      .querySelectorAll<HTMLButtonElement>("[data-choose]")
      .forEach((b) => (b.disabled = busy || entries.length >= MAX_FILES));
    entries.forEach(
      (e) =>
        (e.row.querySelector<HTMLButtonElement>("[data-remove]")!.disabled =
          busy),
    );
    get("workspace").setAttribute("aria-busy", String(busy));
  }
  function add(files: File[]) {
    if (busy) return;
    const messages: string[] = [];
    const used = new Set(entries.map((e) => e.name.toLowerCase()));
    for (const file of files) {
      if (entries.length >= MAX_FILES) {
        messages.push("เลือกได้สูงสุด 10 ไฟล์ กรุณานำบางไฟล์ออกก่อน");
        break;
      }
      const invalid = validateWord(file);
      if (invalid) {
        messages.push(`${file.name}: ${invalid}`);
        continue;
      }
      const row = get("row").firstElementChild!.cloneNode(true) as HTMLElement;
      row.className = "wp-file";
      const entry: Entry = {
        file,
        row,
        status: row.querySelector("[data-file-status]")!,
        name: pdfName(file.name, used),
        failed: false,
      };
      row.querySelector("[data-name]")!.textContent = file.name;
      row.querySelector("[data-meta]")!.textContent =
        `${file.name.split(".").pop()!.toUpperCase()} · ${size(file.size)}`;
      entry.status.textContent = "พร้อมแปลง";
      row.querySelector("[data-remove]")!.addEventListener(
        "click",
        () => {
          if (busy) return;
          if (entry.url) URL.revokeObjectURL(entry.url);
          entries = entries.filter((e) => e !== entry);
          row.remove();
          update();
        },
        { signal },
      );
      row.querySelector("[data-view]")!.addEventListener(
        "click",
        () => {
          void show(entry);
        },
        { signal },
      );
      entries.push(entry);
      list.append(row);
    }
    error(messages.join(" · "));
    update();
  }
  root
    .querySelectorAll("[data-choose]")
    .forEach((b) =>
      b.addEventListener("click", () => input.click(), { signal }),
    );
  input.addEventListener(
    "change",
    () => {
      add(Array.from(input.files ?? []));
      input.value = "";
    },
    { signal },
  );
  root.addEventListener(
    "dragover",
    (e) => {
      e.preventDefault();
      if (!busy) root.classList.add("wp-dragging");
    },
    { signal },
  );
  root.addEventListener(
    "dragleave",
    (e) => {
      if (!root.contains(e.relatedTarget as Node))
        root.classList.remove("wp-dragging");
    },
    { signal },
  );
  root.addEventListener(
    "drop",
    (e) => {
      e.preventDefault();
      root.classList.remove("wp-dragging");
      add(Array.from(e.dataTransfer?.files ?? []));
    },
    { signal },
  );
  get("convert").addEventListener(
    "click",
    () => {
      void convert();
    },
    { signal },
  );
  async function convert() {
    if (busy) return;
    busy = true;
    error();
    update();
    try {
      const config = await fetch("/api/media/config", { signal }).then((r) =>
        r.json(),
      );
      if (!config.enabled)
        throw new Error("บริการแปลงไฟล์ยังไม่พร้อม กรุณาลองใหม่ภายหลัง");
      const pending = entries.filter((e) => !e.blob);
      for (const [index, entry] of pending.entries()) {
        if (!alive) return;
        entry.failed = false;
        entry.row.classList.remove("is-error");
        entry.row.classList.add("is-working");
        get("progress").textContent =
          `ไฟล์ ${index + 1} จาก ${pending.length} · เปิดหน้านี้ไว้จนเสร็จ`;
        try {
          const blob = await session.convert(
            entry.file,
            { kind: "word-pdf" },
            (text) => {
              entry.status.textContent = text;
            },
          );
          if (!alive) return;
          entry.blob = blob;
          entry.url = URL.createObjectURL(blob);
          entry.status.textContent = `แปลงสำเร็จ · PDF ${size(blob.size)}`;
          const save =
            entry.row.querySelector<HTMLAnchorElement>("[data-save]")!;
          save.href = entry.url;
          save.download = entry.name;
          save.hidden = false;
          entry.row.querySelector<HTMLElement>("[data-view]")!.hidden = false;
          entry.row.classList.add("is-ready");
        } catch (e) {
          if (!alive) return;
          entry.failed = true;
          entry.row.classList.add("is-error");
          entry.status.textContent =
            e instanceof Error ? e.message : "แปลงไม่สำเร็จ กรุณาลองใหม่";
        } finally {
          entry.row.classList.remove("is-working");
        }
      }
    } catch (e) {
      if (alive)
        error(
          e instanceof Error ? e.message : "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่",
        );
    } finally {
      if (alive) {
        busy = false;
        get("progress").textContent = "";
        update();
      }
    }
  }
  get("reset").addEventListener(
    "click",
    () => {
      if (
        busy ||
        !confirm("เริ่มชุดใหม่หรือไม่? กรุณาดาวน์โหลด PDF ที่ต้องการเก็บก่อน")
      )
        return;
      session.leave();
      entries.forEach((e) => {
        if (e.url) URL.revokeObjectURL(e.url);
      });
      entries = [];
      list.replaceChildren();
      error();
      update();
      input.click();
    },
    { signal },
  );
  get("zip").addEventListener(
    "click",
    () => {
      void downloadZip();
    },
    { signal },
  );
  async function downloadZip() {
    const button = get<HTMLButtonElement>("zip");
    if (
      entries.reduce((sum, e) => sum + (e.blob?.size ?? 0), 0) > 200_000_000
    ) {
      error("ไฟล์รวมมีขนาดใหญ่ กรุณาดาวน์โหลด PDF แยกไฟล์");
      return;
    }
    button.disabled = true;
    error();
    try {
      const files = await Promise.all(
        entries
          .filter((e) => e.blob)
          .map(async (e) => ({
            name: e.name,
            bytes: new Uint8Array(await e.blob!.arrayBuffer()),
          })),
      );
      if (!alive) return;
      const bytes = zipFiles(files);
      const url = URL.createObjectURL(
        new Blob([bytes as BlobPart], { type: "application/zip" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "DocNori-PDF.zip";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch {
      error("เตรียม ZIP ไม่สำเร็จ กรุณาดาวน์โหลด PDF แยกไฟล์");
    } finally {
      button.disabled = false;
    }
  }
  async function clearPreview() {
    previewEpoch++;
    render?.cancel();
    render = undefined;
    const old = loading;
    loading = undefined;
    preview = undefined;
    get("canvas").replaceChildren();
    if (old) await old.destroy();
  }
  async function show(entry: Entry) {
    await clearPreview();
    const epoch = previewEpoch;
    get("preview-name").textContent = entry.name;
    get("preview-error").textContent = "กำลังเปิดตัวอย่าง…";
    get<HTMLAnchorElement>("preview-download").href = entry.url!;
    get<HTMLAnchorElement>("preview-download").download = entry.name;
    get("page").textContent = "";
    get<HTMLButtonElement>("prev").disabled = true;
    get<HTMLButtonElement>("next").disabled = true;
    dialog.showModal();
    const options = {
      data: new Uint8Array(await entry.blob!.arrayBuffer()),
      isEvalSupported: false,
      useSystemFonts: false,
      wasmUrl: new URL("./wasm/", import.meta.url).href,
      cMapUrl: new URL("./cmaps/", import.meta.url).href,
      cMapPacked: true,
      standardFontDataUrl: new URL("./standard_fonts/", import.meta.url).href,
    };
    const task = getDocument(options);
    loading = task;
    try {
      const pdf = await task.promise;
      if (!alive || epoch !== previewEpoch) {
        await task.destroy();
        return;
      }
      preview = pdf;
      pageNo = 1;
      await draw();
    } catch {
      if (alive && epoch === previewEpoch)
        get("preview-error").textContent =
          "เปิดตัวอย่างไม่ได้ แต่ยังดาวน์โหลด PDF ไปเปิดได้";
      await task.destroy();
    }
  }
  async function draw() {
    if (!preview) return;
    const pdf = preview,
      epoch = previewEpoch,
      number = pageNo;
    get<HTMLButtonElement>("prev").disabled = true;
    get<HTMLButtonElement>("next").disabled = true;
    try {
      render?.cancel();
      const page = await pdf.getPage(number);
      if (epoch !== previewEpoch) return;
      const width = Math.min(960, Math.max(260, dialog.clientWidth - 48));
      const viewport = page.getViewport({
        scale: Math.min(2, width / page.getViewport({ scale: 1 }).width),
      });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      render = page.render({ canvas, viewport });
      await render.promise;
      if (epoch !== previewEpoch) return;
      get("canvas").replaceChildren(canvas);
      get("preview-error").textContent = "";
      get("page").textContent = `หน้า ${number} / ${pdf.numPages}`;
    } catch {
      if (epoch === previewEpoch)
        get("preview-error").textContent =
          "แสดงหน้านี้ไม่ได้ กรุณาดาวน์โหลด PDF เพื่อตรวจดู";
    } finally {
      if (epoch === previewEpoch) {
        get<HTMLButtonElement>("prev").disabled = pageNo <= 1;
        get<HTMLButtonElement>("next").disabled = pageNo >= pdf.numPages;
      }
    }
  }
  get("prev").addEventListener(
    "click",
    () => {
      if (preview && pageNo > 1) {
        pageNo--;
        void draw();
      }
    },
    { signal },
  );
  get("next").addEventListener(
    "click",
    () => {
      if (preview && pageNo < preview.numPages) {
        pageNo++;
        void draw();
      }
    },
    { signal },
  );
  get("close").addEventListener("click", () => dialog.close(), { signal });
  dialog.addEventListener(
    "close",
    () => {
      void clearPreview();
    },
    { signal },
  );
  sessions.set(root, () => {
    alive = false;
    lifetime.abort();
    session.dispose();
    picker.dispose();
    void clearPreview();
    dialog.close();
    entries.forEach((e) => {
      if (e.url) URL.revokeObjectURL(e.url);
    });
  });
  update();
}
export function dispose(root: HTMLElement) {
  sessions.get(root)?.();
  sessions.delete(root);
}
