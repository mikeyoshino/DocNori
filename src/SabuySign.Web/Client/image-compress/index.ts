import { validateBatch } from "../image-tools/core";
import { createFileSourcePicker } from "../shared/file-source-picker";
import { MediaSession } from "../shared/media";
import { zipFiles } from "../shared/zip";
import type { Quality } from "./core";
type Reply = {
  blob: Blob;
  unchanged?: boolean;
  error?: string;
  width: number;
  height: number;
};
type Entry = {
  file: File;
  thumb: string;
  result?: Reply;
  url?: string;
  error?: string;
  downloaded: boolean;
  name: string;
};
const sessions = new WeakMap<HTMLElement, () => void>();
const size = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1024 / 1024).toFixed(2)} MB`;
export function init(root: HTMLElement) {
  dispose(root);
  const lifetime = new AbortController(),
    { signal } = lifetime;
  const get = <T extends HTMLElement>(name: string) =>
    root.querySelector<T>(`[data-${name}]`)!;
  const input = get<HTMLInputElement>("files"),
    list = get("list"),
    dialog = get<HTMLDialogElement>("preview");
  let entries: Entry[] = [],
    busy = false,
    job: AbortController | undefined,
    originalUrl: string | undefined;
  const guard = new MediaSession(
    () => busy || entries.some((e) => e.result && !e.downloaded),
  );
  const picker = createFileSourcePicker(
    root.querySelector("[data-file-picker]")!,
    () => input.click(),
  );
  const error = (message = "") => {
    get("error").textContent = message;
    get("error").hidden = !message;
  };
  const task = (
    file: File,
    quality: Quality,
    inspect: boolean,
    cancellation: AbortSignal,
  ) =>
    new Promise<Reply>((resolve, reject) => {
      if (cancellation.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      const worker = new Worker(
        new URL("./image-compress.worker.js", import.meta.url),
        { type: "module" },
      );
      const finish = (err?: Error, value?: Reply) => {
        clearTimeout(timer);
        cancellation.removeEventListener("abort", abort);
        worker.terminate();
        err ? reject(err) : resolve(value!);
      };
      const abort = () => finish(new DOMException("Aborted", "AbortError"));
      const timer = setTimeout(
        () => finish(new Error("รูปนี้ใช้เวลานานเกินไป ลองใช้รูปขนาดเล็กลง")),
        90000,
      );
      cancellation.addEventListener("abort", abort, { once: true });
      worker.onerror = (e) => {
        e.preventDefault();
        finish(
          new Error(
            "ประมวลผลรูปไม่ได้ กรุณาใช้เบราว์เซอร์รุ่นล่าสุดหรือลองรูปอื่น",
          ),
        );
      };
      worker.onmessage = ({ data }: MessageEvent<Reply>) =>
        finish(data.error ? new Error(data.error) : undefined, data);
      worker.postMessage({ file, quality, inspect });
    });
  const closePreview = () => {
    if (dialog.open) dialog.close();
    get<HTMLImageElement>("before").removeAttribute("src");
    get<HTMLImageElement>("after").removeAttribute("src");
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    originalUrl = undefined;
  };
  const showPreview = (e: Entry) => {
    if (!e.url) return;
    closePreview();
    originalUrl = URL.createObjectURL(e.file);
    get<HTMLImageElement>("before").src = originalUrl;
    get<HTMLImageElement>("after").src = e.url;
    get("preview-name").textContent = e.file.name;
    get("before-size").textContent = size(e.file.size);
    get("after-size").textContent = size(e.result!.blob.size);
    get<HTMLInputElement>("actual").checked = false;
    get("compare").classList.remove("actual-size");
    dialog.showModal();
  };
  const clearOutput = (e: Entry) => {
    if (e.url) URL.revokeObjectURL(e.url);
    e.url = undefined;
    e.result = undefined;
    e.error = undefined;
    e.downloaded = false;
  };
  function render() {
    get("intro").hidden = entries.length > 0;
    get("workspace").hidden = !entries.length;
    get("reading").hidden = !busy || !!entries.length;
    get("count").textContent =
      `${entries.length} รูป · ${size(entries.reduce((s, e) => s + e.file.size, 0))}`;
    root
      .querySelectorAll<HTMLButtonElement>("[data-choose]")
      .forEach((b) => (b.disabled = busy));
    picker.update(entries.length, busy);
    get<HTMLFieldSetElement>("quality").disabled = busy;
    const pending = entries.some((e) => !e.result),
      done = entries.filter((e) => e.result);
    get<HTMLButtonElement>("convert").disabled = busy || !pending;
    get<HTMLButtonElement>("clear").disabled = busy;
    get<HTMLButtonElement>("zip").disabled = busy;
    get("zip").hidden = !done.length;
    get("summary").textContent = done.length
      ? `ลดขนาดแล้ว ${done.length} / ${entries.length} รูป · ${size(done.reduce((s, e) => s + e.file.size, 0))} → ${size(done.reduce((s, e) => s + e.result!.blob.size, 0))}`
      : "";
    list.replaceChildren();
    for (const e of entries) {
      const row = document.createElement("article");
      row.className = "image-card";
      const thumb = document.createElement("div");
      thumb.className = "image-thumb";
      const img = document.createElement("img");
      img.src = e.thumb;
      img.alt = "";
      thumb.append(img);
      const info = document.createElement("div");
      info.className = "image-info";
      const name = document.createElement("h2");
      name.textContent = e.file.name;
      const status = document.createElement("p");
      status.textContent =
        e.error ??
        (e.result
          ? e.result.unchanged
            ? `${size(e.file.size)} · เล็กอยู่แล้ว ใช้ไฟล์ต้นฉบับ`
            : `${size(e.file.size)} → ${size(e.result.blob.size)} · ลด ${((1 - e.result.blob.size / e.file.size) * 100).toFixed(1)}%`
          : `${size(e.file.size)} · พร้อมลดขนาด`);
      if (e.error) status.className = "image-file-error";
      info.append(name, status);
      const actions = document.createElement("div");
      actions.className = "image-actions";
      if (e.url) {
        const view = document.createElement("button");
        view.className = "button button-light";
        view.textContent = "เปรียบเทียบ";
        view.onclick = () => showPreview(e);
        const download = document.createElement("a");
        download.className = "button button-light";
        download.textContent = "ดาวน์โหลด";
        download.download = e.name;
        download.href = e.url;
        download.onclick = () => {
          e.downloaded = true;
        };
        actions.append(view, download);
      }
      const remove = document.createElement("button");
      remove.className = "button button-light";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `ลบ ${e.file.name}`);
      remove.disabled = busy;
      remove.onclick = () => {
        closePreview();
        clearOutput(e);
        URL.revokeObjectURL(e.thumb);
        entries = entries.filter((x) => x !== e);
        render();
      };
      actions.append(remove);
      row.append(thumb, info, actions);
      list.append(row);
    }
  }
  async function add(files: File[]) {
    if (busy || !files.length) return;
    error();
    try {
      validateBatch(
        files,
        entries.length,
        entries.reduce((s, e) => s + e.file.size, 0),
        "pdf",
      );
    } catch (e) {
      error((e as Error).message);
      return;
    }
    busy = true;
    const active = (job = new AbortController());
    render();
    const failures: string[] = [];
    try {
      for (const file of files) {
        if (active.signal.aborted) break;
        try {
          const preview = await task(file, "high", true, active.signal);
          if (active.signal.aborted) break;
          let name = file.name.replace(/[\\/\u0000-\u001f]/g, "_");
          const stem = name.replace(/\.(jpe?g|png)$/i, ""),
            ext = preview.blob.type === "image/png" ? "png" : "jpg";
          name = `${stem}.${ext}`;
          let n = 2;
          while (
            entries.some((e) => e.name.toLowerCase() === name.toLowerCase())
          )
            name = `${stem}-${n++}.${ext}`;
          entries.push({
            file,
            thumb: URL.createObjectURL(preview.blob),
            name,
            downloaded: false,
          });
          render();
        } catch (e) {
          if ((e as Error).name === "AbortError") break;
          failures.push(`${file.name}: ${(e as Error).message}`);
        }
      }
    } finally {
      if (!signal.aborted && job === active) {
        busy = false;
        input.value = "";
        error(failures.join(" · "));
        render();
      }
    }
  }
  const run = async () => {
    if (busy || !entries.length) return;
    error();
    busy = true;
    const active = (job = new AbortController());
    render();
    const quality = root.querySelector<HTMLInputElement>(
      'input[name="image-quality"]:checked',
    )!.value as Quality;
    try {
      for (const [i, e] of entries.entries()) {
        if (active.signal.aborted) break;
        if (e.result) continue;
        e.error = undefined;
        get("progress").textContent =
          `กำลังลดขนาด ${i + 1} / ${entries.length}`;
        try {
          const result = await task(e.file, quality, false, active.signal);
          if (active.signal.aborted) break;
          e.result = result;
          e.url = URL.createObjectURL(result.blob);
        } catch (err) {
          if ((err as Error).name === "AbortError") break;
          e.error = (err as Error).message;
        }
        render();
      }
    } finally {
      if (!signal.aborted && job === active) {
        busy = false;
        get("progress").textContent = active.signal.aborted
          ? "หยุดการทำงานแล้ว กดลดขนาดเพื่อลองอีกครั้ง"
          : "ประมวลผลเรียบร้อยแล้ว";
        render();
      }
    }
  };
  input.addEventListener(
    "change",
    () => void add(Array.from(input.files ?? [])),
    { signal },
  );
  root
    .querySelectorAll("[data-choose]")
    .forEach((el) =>
      el.addEventListener("click", () => input.click(), { signal }),
    );
  root.addEventListener("dragover", (e) => e.preventDefault(), { signal });
  root.addEventListener(
    "drop",
    (e) => {
      e.preventDefault();
      void add(Array.from(e.dataTransfer?.files ?? []));
    },
    { signal },
  );
  get("convert").addEventListener("click", () => void run(), { signal });
  get("quality").addEventListener(
    "change",
    () => {
      closePreview();
      entries.forEach(clearOutput);
      get("progress").textContent = "";
      render();
    },
    { signal },
  );
  const temporaryDownloads = new Map<string, ReturnType<typeof setTimeout>>();
  const reset = () => {
    job?.abort();
    job = undefined;
    busy = false;
    closePreview();
    entries.forEach((e) => {
      clearOutput(e);
      URL.revokeObjectURL(e.thumb);
    });
    entries = [];
    input.value = "";
    for (const [url, timer] of temporaryDownloads) {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
    }
    temporaryDownloads.clear();
    error();
    get("progress").textContent = "";
    if (!signal.aborted) render();
  };
  get("clear").addEventListener(
    "click",
    () => {
      if (!busy) reset();
    },
    { signal },
  );
  get("zip").addEventListener(
    "click",
    async () => {
      if (busy) return;
      busy = true;
      const active = (job = new AbortController());
      render();
      const done = entries.filter((e) => e.result);
      let link: string | undefined;
      try {
        const files = [];
        for (const e of done) {
          if (active.signal.aborted) return;
          files.push({
            name: e.name,
            bytes: new Uint8Array(await e.result!.blob.arrayBuffer()),
          });
        }
        if (signal.aborted || active.signal.aborted) return;
        const zip = zipFiles(files);
        link = URL.createObjectURL(
          new Blob([zip], { type: "application/zip" }),
        );
        const a = document.createElement("a");
        a.href = link;
        a.download = "docnori-images.zip";
        a.click();
        done.forEach((e) => (e.downloaded = true));
      } catch {
        if (!signal.aborted && job === active)
          error("สร้าง ZIP ไม่สำเร็จ กรุณาดาวน์โหลดแยกไฟล์");
      } finally {
        if (link) {
          const url = link;
          temporaryDownloads.set(
            url,
            setTimeout(() => {
              URL.revokeObjectURL(url);
              temporaryDownloads.delete(url);
            }, 30000),
          );
        }
        if (!signal.aborted && job === active) {
          busy = false;
          render();
        }
      }
    },
    { signal },
  );
  get("close").addEventListener("click", closePreview, { signal });
  dialog.addEventListener("cancel", closePreview, { signal });
  get("actual").addEventListener(
    "change",
    () =>
      get("compare").classList.toggle(
        "actual-size",
        get<HTMLInputElement>("actual").checked,
      ),
    { signal },
  );
  addEventListener("pagehide", reset, { signal });
  sessions.set(root, () => {
    lifetime.abort();
    reset();
    guard.dispose();
    picker.dispose();
  });
  render();
}
export function dispose(root: HTMLElement) {
  sessions.get(root)?.();
  sessions.delete(root);
}
