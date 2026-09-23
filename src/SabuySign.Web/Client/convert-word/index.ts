import { createFileSourcePicker } from "../shared/file-source-picker";
import { cover } from "../merge/preview";
import { readPdf, MAX_BYTES, MAX_FILES, MAX_PAGES } from "../merge/pdf";
import { zipFiles } from "../shared/zip";
import { inspectWord, convertToWord, type WordInput } from "./pdf";

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
  let entries: (WordInput & { thumbnail?: HTMLCanvasElement })[] = [];
  let state: "empty" | "reading" | "options" | "converting" | "result" =
    "empty";
  let work: AbortController | undefined,
    resultUrl: string | undefined,
    resultName = "";
  const picker = createFileSourcePicker(
    root.querySelector("[data-file-picker]")!,
    () => input.click(),
  );
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
    const imagePages = entries.reduce((sum, e) => sum + e.imagePages.length, 0);
    get("scan-note").hidden = !imagePages;
    get("scan-note").textContent =
      `มี ${imagePages} หน้าที่ไม่มีข้อความให้ดึงออกมา หากแปลงโดยไม่ใช้ OCR หน้าเหล่านี้จะเป็นรูปภาพใน Word`;
    get("scan-confirm").hidden = true;
    get<HTMLButtonElement>("choose").disabled = busy();
    get<HTMLButtonElement>("convert").disabled = busy() || !entries.length;
    get<HTMLButtonElement>("clear").disabled = busy();
    input.disabled = busy();
    root
      .querySelectorAll<HTMLInputElement>('input[type="radio"]')
      .forEach((el) => {
        el.disabled = el.hasAttribute("data-ocr-input") || busy();
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
        const imagePages = await inspectWord(bytes, signal);
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
          imagePages,
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
  const start = async () => {
    if (busy() || !entries.length) return;
    fail();
    release();
    state = "converting";
    work = new AbortController();
    const current = work;
    const cancel = () => current.abort();
    signal.addEventListener("abort", cancel, { once: true });
    get<HTMLProgressElement>("progress").value = 0;
    get("progress-label").textContent = "กำลังเตรียมเอกสาร Word…";
    sync();
    get("cancel").focus();
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      current.signal.throwIfAborted();
      const outputs = await convertToWord(
        entries,
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
        type: single
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/zip",
      });
      resultUrl = URL.createObjectURL(blob);
      resultName = single ? outputs[0].name : "docnory-word.zip";
      get("result-summary").textContent =
        `${outputs.length} ไฟล์ Word · ${fileSize(blob.size)}${single ? "" : " · รวมในไฟล์ ZIP"}${entries.some((e) => e.imagePages.length) ? ` · ${entries.reduce((s, e) => s + e.imagePages.length, 0)} หน้าเป็นรูปภาพ แก้ข้อความไม่ได้` : ""}`;
      get("download").textContent = single
        ? "ดาวน์โหลด Word"
        : "ดาวน์โหลด Word (ZIP)";
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
            : "แปลงไม่สำเร็จ ไฟล์อาจเสียหายหรือมีรูปภาพใหญ่เกินไป ลองแยกไฟล์แล้วแปลงอีกครั้ง",
        );
      }
      sync();
      get("convert").focus();
    } finally {
      signal.removeEventListener("abort", cancel);
      if (work === current) work = undefined;
    }
  };
  get("convert").addEventListener(
    "click",
    () => {
      if (busy() || !entries.length) return;
      if (entries.some((e) => e.imagePages.length)) {
        get("workspace").hidden = true;
        get("scan-confirm").hidden = false;
        get("continue").focus();
      } else void start();
    },
    { signal },
  );
  get("continue").addEventListener("click", () => void start(), { signal });
  get("return-options").addEventListener(
    "click",
    () => {
      sync();
      get("convert").focus();
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
