import { createFileSourcePicker } from "../shared/file-source-picker";
import { cover } from "../merge/preview";
import { readPdf, MAX_BYTES, MAX_FILES, MAX_PAGES } from "../merge/pdf";
import { zipFiles } from "../shared/zip";
import {
  convertToJpg,
  type PdfInput,
  type ConversionMode,
  type Quality,
} from "./pdf";

const sessions = new WeakMap<HTMLElement, () => void>();
const fileSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
export function init(root: HTMLElement) {
  dispose(root);
  const lifetime = new AbortController(),
    { signal } = lifetime;
  const get = <T extends HTMLElement>(key: string) =>
    root.querySelector<T>(`[data-${key}]`)!;
  const input = get<HTMLInputElement>("files"),
    list = get("list"),
    error = get("error"),
    status = get("status");
  let entries: (PdfInput & { thumbnail?: HTMLCanvasElement })[] = [];
  let state: "empty" | "reading" | "options" | "converting" | "result" =
    "empty";
  let work: AbortController | undefined,
    resultUrl: string | undefined,
    resultName = "";
  const picker = createFileSourcePicker(
    root.querySelector("[data-file-picker]")!,
    () => input.click(),
  );
  const mode = () =>
    root.querySelector<HTMLInputElement>('input[name="jpg-mode"]:checked')!
      .value as ConversionMode;
  const quality = () =>
    root.querySelector<HTMLInputElement>('input[name="jpg-quality"]:checked')!
      .value as Quality;
  const fail = (message = "") => {
    error.textContent = message;
    error.hidden = !message;
  };
  const release = () => {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = undefined;
  };
  const busy = () => state === "reading" || state === "converting";
  const sync = () => {
    get("intro").hidden =
      entries.length > 0 || state === "converting" || state === "result";
    get("workspace").hidden =
      entries.length === 0 || state === "converting" || state === "result";
    get("progress-panel").hidden = state !== "converting";
    get("result").hidden = state !== "result";
    get("feedback").hidden = state === "converting" || state === "result";
    root.classList.toggle(
      "has-documents",
      entries.length > 0 && state !== "result",
    );
    const pages = entries.reduce((sum, e) => sum + e.pages, 0);
    get("summary").textContent = `${entries.length} ไฟล์ · ${pages} หน้า`;
    get("page-count").textContent =
      `สร้าง JPG ${pages} รูป แยกหนึ่งรูปต่อหนึ่งหน้า`;
    get("quality").hidden = mode() !== "pages";
    get<HTMLButtonElement>("choose").disabled = busy();
    get<HTMLButtonElement>("convert").disabled = busy() || !entries.length;
    get<HTMLButtonElement>("clear").disabled = busy();
    input.disabled = busy();
    root
      .querySelectorAll<HTMLInputElement>('input[type="radio"]')
      .forEach((el) => {
        el.disabled = busy();
      });
    list.querySelectorAll<HTMLButtonElement>("button").forEach((el) => {
      el.disabled = busy();
    });
    picker.update(entries.length, busy());
    if (entries.length) get("footer").prepend(get("feedback"));
    else root.append(get("feedback"));
  };
  const renderCards = () => {
    list.replaceChildren();
    entries.forEach((entry, i) => {
      const card = document.createElement("li"),
        preview = document.createElement("div"),
        title = document.createElement("strong"),
        meta = document.createElement("span"),
        remove = document.createElement("button");
      card.className = "conversion-file";
      preview.className = "conversion-cover";
      if (entry.thumbnail) preview.append(entry.thumbnail);
      else preview.textContent = "PDF";
      title.textContent = entry.name;
      title.title = entry.name;
      meta.textContent = `${entry.pages} หน้า · ${fileSize(entry.bytes.length)}`;
      remove.type = "button";
      remove.className = "conversion-remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `ลบ ${entry.name}`);
      remove.onclick = () => {
        if (busy()) return;
        entry.thumbnail && (entry.thumbnail.width = entry.thumbnail.height = 0);
        entries.splice(i, 1);
        fail();
        status.textContent = "";
        state = entries.length ? "options" : "empty";
        renderCards();
        sync();
        (list.querySelector("button") ?? get("choose")).focus();
      };
      card.append(preview, title, meta, remove);
      list.append(card);
    });
  };
  const reset = () => {
    work?.abort();
    release();
    entries.forEach((e) => {
      if (e.thumbnail) e.thumbnail.width = e.thumbnail.height = 0;
    });
    entries = [];
    input.value = "";
    state = "empty";
    fail();
    status.textContent = "";
    root.querySelector<HTMLInputElement>(
      'input[name="jpg-mode"][value="pages"]',
    )!.checked = true;
    root.querySelector<HTMLInputElement>(
      'input[name="jpg-quality"][value="normal"]',
    )!.checked = true;
    renderCards();
    sync();
    get("choose").focus();
  };
  const add = async (files: File[]) => {
    if (busy() || !files.length || state === "result") return;
    state = "reading";
    fail();
    status.textContent = "กำลังเปิดไฟล์และสร้างภาพตัวอย่าง…";
    sync();
    const errors: string[] = [];
    for (const file of files) {
      if (signal.aborted) return;
      try {
        if (!/\.pdf$/i.test(file.name)) throw new Error("กรุณาเลือกไฟล์ PDF");
        if (entries.length >= MAX_FILES)
          throw new Error("เลือกได้ไม่เกิน 20 ไฟล์");
        if (
          entries.reduce((sum, e) => sum + e.bytes.length, 0) + file.size >
          MAX_BYTES
        )
          throw new Error("ขนาดรวมต้องไม่เกิน 25 MB");
        const bytes = new Uint8Array(await file.arrayBuffer()),
          pdf = await readPdf(bytes);
        if (
          entries.reduce((sum, e) => sum + e.pages, 0) + pdf.getPageCount() >
          MAX_PAGES
        )
          throw new Error("จำนวนหน้ารวมต้องไม่เกิน 100 หน้า");
        let thumbnail: HTMLCanvasElement | undefined;
        try {
          thumbnail = await cover(bytes, signal);
        } catch {
          /* Rendering failure is reported if conversion also fails. */
        }
        if (signal.aborted) {
          if (thumbnail) thumbnail.width = thumbnail.height = 0;
          return;
        }
        entries.push({
          name: file.name,
          bytes,
          pages: pdf.getPageCount(),
          thumbnail,
        });
      } catch (e) {
        const message =
          e instanceof Error && /[ก-๙]/.test(e.message)
            ? e.message
            : "เปิดไม่ได้ ไฟล์อาจเสียหายหรือมีรหัสผ่าน";
        errors.push(`${file.name}: ${message}`);
      }
    }
    if (signal.aborted) return;
    state = entries.length ? "options" : "empty";
    status.textContent = "";
    fail(errors.join("\n"));
    renderCards();
    sync();
  };
  get("choose").addEventListener("click", () => input.click(), { signal });
  input.addEventListener(
    "change",
    () => {
      const files = Array.from(input.files ?? []);
      input.value = "";
      void add(files);
    },
    { signal },
  );
  for (const region of [get("drop"), get("stage")]) {
    region.addEventListener(
      "dragover",
      (e) => {
        if (!busy() && e.dataTransfer?.types.includes("Files")) {
          e.preventDefault();
          region.classList.add("drag-over");
        }
      },
      { signal },
    );
    region.addEventListener(
      "dragleave",
      () => region.classList.remove("drag-over"),
      { signal },
    );
    region.addEventListener(
      "drop",
      (e) => {
        e.preventDefault();
        region.classList.remove("drag-over");
        void add(Array.from(e.dataTransfer?.files ?? []));
      },
      { signal },
    );
  }
  root.querySelectorAll('input[type="radio"]').forEach((el) =>
    el.addEventListener(
      "change",
      () => {
        fail();
        sync();
      },
      { signal },
    ),
  );
  get("clear").addEventListener("click", reset, { signal });
  get("restart").addEventListener("click", reset, { signal });
  get("back").addEventListener(
    "click",
    () => {
      release();
      state = "options";
      sync();
      get("convert").focus();
    },
    { signal },
  );
  get("cancel").addEventListener(
    "click",
    () => {
      work?.abort();
    },
    { signal },
  );
  get("convert").addEventListener(
    "click",
    async () => {
      if (busy() || !entries.length) return;
      fail();
      release();
      state = "converting";
      work = new AbortController();
      const current = work;
      const cancel = () => current.abort();
      signal.addEventListener("abort", cancel, { once: true });
      get<HTMLProgressElement>("progress").value = 0;
      get("progress-label").textContent = "กำลังเตรียมรูปภาพ…";
      sync();
      get("cancel").focus();
      try {
        await new Promise((resolve) => setTimeout(resolve, 0));
        current.signal.throwIfAborted();
        const outputs = await convertToJpg(
          entries,
          mode(),
          quality(),
          current.signal,
          (done, total, label) => {
            get<HTMLProgressElement>("progress").value = done / total;
            get("progress-label").textContent =
              `${label} · ${Math.round((done / total) * 100)}%`;
          },
        );
        current.signal.throwIfAborted();
        const single = outputs.length === 1;
        const bytes = single ? outputs[0].bytes : zipFiles(outputs);
        const blob = new Blob([new Uint8Array(bytes)], {
          type: single ? "image/jpeg" : "application/zip",
        });
        resultUrl = URL.createObjectURL(blob);
        resultName = single ? outputs[0].name : "docnory-jpg.zip";
        get("result-summary").textContent =
          `${outputs.length} รูป · ${fileSize(blob.size)}${single ? "" : " · รวมในไฟล์ ZIP"}`;
        get("download").textContent = single
          ? "ดาวน์โหลด JPG"
          : "ดาวน์โหลดรูปภาพ (ZIP)";
        state = "result";
        status.textContent = "";
        sync();
        get("download").focus();
      } catch (e) {
        if (signal.aborted) return;
        state = "options";
        if (current.signal.aborted)
          status.textContent =
            "ยกเลิกการแปลงแล้ว คุณเปลี่ยนตัวเลือกแล้วเริ่มใหม่ได้";
        else {
          status.textContent = "";
          fail(
            e instanceof Error && /[ก-๙]/.test(e.message)
              ? e.message
              : "แปลงไม่สำเร็จ ไฟล์อาจเสียหายหรือมีขนาดภาพใหญ่เกินไป ลองใช้ไฟล์อื่นหรือคุณภาพปกติ",
          );
        }
        sync();
        get("convert").focus();
      } finally {
        signal.removeEventListener("abort", cancel);
        if (work === current) work = undefined;
      }
    },
    { signal },
  );
  get("download").addEventListener(
    "click",
    () => {
      if (!resultUrl) return;
      const link = document.createElement("a");
      link.href = resultUrl;
      link.download = resultName;
      document.body.append(link);
      link.click();
      link.remove();
    },
    { signal },
  );
  const cleanup = () => {
    work?.abort();
    lifetime.abort();
    picker.dispose();
    release();
    entries.forEach((e) => {
      if (e.thumbnail) e.thumbnail.width = e.thumbnail.height = 0;
    });
    entries = [];
    list.replaceChildren();
  };
  window.addEventListener("pagehide", cleanup, { signal });
  sessions.set(root, cleanup);
  sync();
}
export function dispose(root: HTMLElement) {
  sessions.get(root)?.();
  sessions.delete(root);
}
