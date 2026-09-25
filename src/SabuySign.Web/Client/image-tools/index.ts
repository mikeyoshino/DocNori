import { validateBatch, uniqueJpgName, type Mode } from "./core";
import { createFileSourcePicker } from "../shared/file-source-picker";
import { MediaSession } from "../shared/media";
import { zipFiles } from "../shared/zip";
import { Preview } from "../compress/preview";
type Entry = {
  file: File;
  rotation: number;
  thumb?: string;
  output?: Blob;
  url?: string;
  name: string;
  error?: string;
};
type Reply = {
  blob?: Blob;
  bytes?: Uint8Array;
  error?: string;
  progress?: string;
};
const sessions = new WeakMap<HTMLElement, () => void>();
export function init(root: HTMLElement) {
  dispose(root);
  const lifetime = new AbortController(),
    { signal } = lifetime,
    get = <T extends HTMLElement>(key: string) =>
      root.querySelector<T>(`[data-${key}]`)!;
  const mode = root.dataset.mode as Mode,
    input = get<HTMLInputElement>("files"),
    list = get("list"),
    dialog = get<HTMLDialogElement>("preview"),
    preview = new Preview(get("canvas"));
  let entries: Entry[] = [],
    busy = false,
    pdf: Uint8Array | undefined,
    url: string | undefined,
    downloaded = false,
    page = 1,
    worker: Worker | undefined,
    stop: ((e: Error) => void) | undefined,
    drag = -1;
  const picker = createFileSourcePicker(
    root.querySelector("[data-file-picker]")!,
    () => input.click(),
  );
  const guard = new MediaSession(
    () => busy || (!downloaded && (!!pdf || entries.some((e) => e.output))),
  );
  const fail = (message = "") => {
    get("error").textContent = message;
    get("error").hidden = !message;
  };
  const resetPdf = () => {
    pdf = undefined;
    if (url) URL.revokeObjectURL(url);
    url = undefined;
    downloaded = false;
    preview.clear();
    if (dialog.open) dialog.close();
  };
  const task = (path: string, data: unknown) =>
    new Promise<Reply>((resolve, reject) => {
      const active = (worker = new Worker(new URL(path, import.meta.url), {
        type: "module",
      }));
      const timer = setTimeout(
        () => finish(new Error("รูปนี้ใช้เวลานานเกินไป ลองใช้รูปขนาดเล็กลง")),
        90000,
      );
      const finish = (e?: Error, value?: Reply) => {
        clearTimeout(timer);
        active.terminate();
        worker = undefined;
        stop = undefined;
        e ? reject(e) : resolve(value!);
      };
      stop = (e) => finish(e);
      active.onerror = (e) => {
        e.preventDefault();
        finish(
          new Error(
            "ประมวลผลรูปไม่ได้ กรุณาใช้เบราว์เซอร์รุ่นล่าสุดหรือลองรูปขนาดเล็กลง",
          ),
        );
      };
      active.onmessage = ({ data }: MessageEvent<Reply>) => {
        if (data.progress) {
          get("progress").textContent = data.progress;
          return;
        }
        finish(data.error ? new Error(data.error) : undefined, data);
      };
      active.postMessage(data);
    });
  const move = (from: number, to: number) => {
    if (busy || to < 0 || to >= entries.length || from === to) return;
    entries.splice(to, 0, entries.splice(from, 1)[0]);
    resetPdf();
    render();
  };
  function render() {
    get("intro").hidden = entries.length > 0;
    get("workspace").hidden = !entries.length;
    get("reading").hidden = !busy || !!entries.length;
    get("count").textContent =
      `${entries.length} รูป · ${(entries.reduce((s, e) => s + e.file.size, 0) / 1024 / 1024).toFixed(1)} MB`;
    root
      .querySelectorAll<HTMLButtonElement>("[data-choose]")
      .forEach((b) => (b.disabled = busy));
    picker.update(entries.length, busy);
    get<HTMLButtonElement>("convert").disabled = busy || !entries.length;
    get("convert").hidden = !!pdf;
    get("view-pdf").hidden = !pdf;
    get("download").hidden = !pdf;
    get("zip").hidden = mode !== "heic" || !entries.some((e) => e.output);
    get<HTMLButtonElement>("zip").disabled = busy;
    get<HTMLButtonElement>("clear").disabled = busy;
    const settings = get<HTMLFieldSetElement>("settings");
    if (settings) settings.disabled = busy;
    const related = get("related");
    if (related) related.hidden = !pdf;
    list.replaceChildren();
    entries.forEach((entry, i) => {
      const row = document.createElement("article");
      row.className = "image-card";
      row.draggable = mode === "pdf" && !busy;
      row.addEventListener("dragstart", () => {
        drag = i;
      });
      row.addEventListener("dragover", (e) => e.preventDefault());
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (drag >= 0) move(drag, i);
        drag = -1;
      });
      row.addEventListener("dragend", () => {
        drag = -1;
      });
      const thumb = document.createElement("div");
      thumb.className = "image-thumb";
      if (entry.thumb || entry.url) {
        const img = new Image();
        img.src = entry.thumb ?? entry.url!;
        img.alt = "";
        img.style.transform = `rotate(${entry.rotation}deg)`;
        thumb.append(img);
      } else thumb.textContent = "HEIC";
      const info = document.createElement("div");
      info.className = "image-info";
      const title = document.createElement("h2");
      title.textContent = entry.file.name;
      const meta = document.createElement("p");
      meta.textContent =
        entry.error ??
        (entry.output
          ? "พร้อมดาวน์โหลด"
          : `${(entry.file.size / 1024 / 1024).toFixed(1)} MB`);
      if (entry.error) meta.className = "image-file-error";
      info.append(title, meta);
      const actions = document.createElement("div");
      actions.className = "image-actions";
      const button = (
        label: string,
        text: string,
        action: () => void,
        disabled = false,
      ) => {
        const b = document.createElement("button");
        b.className = "button button-light";
        b.type = "button";
        b.setAttribute("aria-label", `${label} ${entry.file.name}`);
        b.textContent = text;
        b.disabled = busy || disabled;
        b.addEventListener("click", action);
        actions.append(b);
      };
      if (mode === "pdf") {
        button("เลื่อนไปก่อน", "↑", () => move(i, i - 1), i === 0);
        button(
          "เลื่อนไปหลัง",
          "↓",
          () => move(i, i + 1),
          i === entries.length - 1,
        );
        button("หมุนรูป", "↻", () => {
          entry.rotation = (entry.rotation + 90) % 360;
          resetPdf();
          render();
        });
      }
      if (entry.url) {
        const a = document.createElement("a");
        a.className = "button button-light";
        a.href = entry.url;
        a.download = entry.name;
        a.textContent = "ดาวน์โหลด";
        actions.append(a);
      }
      button("นำรูปออก", "×", () => {
        if (entry.thumb) URL.revokeObjectURL(entry.thumb);
        if (entry.url) URL.revokeObjectURL(entry.url);
        entries.splice(i, 1);
        resetPdf();
        render();
      });
      row.append(thumb, info, actions);
      list.append(row);
    });
  }
  const add = async (files: FileList | File[]) => {
    if (busy || !files.length) return;
    fail();
    const chosen = Array.from(files);
    try {
      validateBatch(
        chosen,
        entries.length,
        entries.reduce((s, e) => s + e.file.size, 0),
        mode,
      );
    } catch (e) {
      fail((e as Error).message);
      input.value = "";
      return;
    }
    busy = true;
    render();
    const used = new Set(entries.map((e) => e.name.toLowerCase()));
    let failures = 0;
    try {
      for (const file of chosen) {
        if (signal.aborted) break;
        const entry: Entry = {
          file,
          rotation: 0,
          name: uniqueJpgName(file.name, used),
        };
        try {
          if (mode === "pdf") {
            const r = await task("./image-pdf.worker.js", {
              inspect: true,
              files: [{ file, rotation: 0 }],
            });
            if (signal.aborted) break;
            if (!r.blob) throw new Error("เปิดรูปไม่ได้");
            entry.thumb = URL.createObjectURL(r.blob);
          }
          entries.push(entry);
        } catch {
          failures++;
        }
      }
      if (!signal.aborted) {
        resetPdf();
        if (failures)
          fail(`เปิดรูปไม่ได้ ${failures} ไฟล์ รูปอื่นที่อ่านได้เพิ่มไว้แล้ว`);
      }
    } finally {
      busy = false;
      if (!signal.aborted) render();
      input.value = "";
    }
  };
  root
    .querySelectorAll("[data-choose]")
    .forEach((b) =>
      b.addEventListener("click", () => input.click(), { signal }),
    );
  input.addEventListener(
    "change",
    () => {
      if (input.files) void add(input.files);
    },
    { signal },
  );
  root.addEventListener("dragover", (e) => e.preventDefault(), { signal });
  root.addEventListener(
    "drop",
    (e) => {
      e.preventDefault();
      if (e.dataTransfer?.files.length) void add(e.dataTransfer.files);
    },
    { signal },
  );
  get("settings")?.addEventListener(
    "change",
    () => {
      resetPdf();
      render();
    },
    { signal },
  );
  get("convert").addEventListener(
    "click",
    async () => {
      if (busy || !entries.length) return;
      busy = true;
      fail();
      render();
      get("progress").textContent = "กำลังเตรียมไฟล์…";
      try {
        if (mode === "pdf") {
          const selected = (name: string) =>
            root.querySelector<HTMLInputElement>(
              `input[name="image-${name}"]:checked`,
            )!.value;
          const r = await task("./image-pdf.worker.js", {
            files: entries.map((e) => ({ file: e.file, rotation: e.rotation })),
            paper: selected("paper"),
            orientation: selected("orientation"),
            margin: Number(selected("margin")),
          });
          if (signal.aborted) return;
          if (!r.bytes) throw new Error("สร้าง PDF ไม่สำเร็จ");
          pdf = r.bytes;
          url = URL.createObjectURL(
            new Blob([new Uint8Array(pdf)], { type: "application/pdf" }),
          );
          const a = get<HTMLAnchorElement>("download");
          a.href = url;
          a.download = "images.pdf";
          downloaded = false;
          get("progress").textContent = `สร้าง PDF แล้ว ${entries.length} หน้า`;
        } else {
          let total = entries.reduce((n, e) => n + (e.output?.size ?? 0), 0);
          for (const [i, entry] of entries.entries()) {
            if (signal.aborted) return;
            if (entry.output) continue;
            get("progress").textContent =
              `กำลังแปลง ${i + 1} / ${entries.length}`;
            try {
              const r = await task("./heic-jpg.worker.js", {
                file: entry.file,
              });
              if (signal.aborted) return;
              if (!r.blob) throw new Error("สร้าง JPG ไม่สำเร็จ");
              if (total + r.blob.size > 100 * 1024 * 1024)
                throw new Error(
                  "ผลลัพธ์รวมใหญ่เกิน 100 MB กรุณาแบ่งแปลงเป็นชุดเล็กลง",
                );
              total += r.blob.size;
              entry.output = r.blob;
              entry.url = URL.createObjectURL(r.blob);
              entry.error = undefined;
            } catch (e) {
              entry.error = (e as Error).message;
            }
            if (!signal.aborted) render();
          }
          get("progress").textContent =
            `แปลงสำเร็จ ${entries.filter((e) => e.output).length} / ${entries.length} รูป`;
          downloaded = false;
        }
      } catch (e) {
        if (!signal.aborted) fail((e as Error).message);
      } finally {
        busy = false;
        if (!signal.aborted) render();
      }
    },
    { signal },
  );
  get("zip").addEventListener(
    "click",
    async () => {
      if (busy) return;
      busy = true;
      render();
      try {
        const files = [];
        for (const e of entries)
          if (e.output)
            files.push({
              name: e.name,
              bytes: new Uint8Array(await e.output.arrayBuffer()),
            });
        if (signal.aborted) return;
        const bytes = zipFiles(files),
          link = document.createElement("a"),
          zipUrl = URL.createObjectURL(
            new Blob([bytes], { type: "application/zip" }),
          );
        link.href = zipUrl;
        link.download = "photos.zip";
        link.click();
        setTimeout(() => URL.revokeObjectURL(zipUrl), 30000);
        downloaded = true;
      } catch {
        if (!signal.aborted) fail("สร้าง ZIP ไม่สำเร็จ ดาวน์โหลดรูปแยกได้");
      } finally {
        busy = false;
        if (!signal.aborted) render();
      }
    },
    { signal },
  );
  get("download").addEventListener(
    "click",
    () => {
      downloaded = true;
    },
    { signal },
  );
  const clear = () => {
    if (
      !downloaded &&
      (pdf || entries.some((e) => e.output)) &&
      !confirm("เริ่มใหม่หรือไม่? กรุณาดาวน์โหลดก่อนล้างรายการ")
    )
      return;
    resetPdf();
    for (const e of entries) {
      if (e.thumb) URL.revokeObjectURL(e.thumb);
      if (e.url) URL.revokeObjectURL(e.url);
    }
    entries = [];
    get("progress").textContent = "";
    fail();
    render();
  };
  get("clear").addEventListener("click", clear, { signal });
  const showPage = async () => {
    if (!pdf) return;
    get("page").textContent = `${page} / ${entries.length}`;
    get<HTMLButtonElement>("prev").disabled = page <= 1;
    get<HTMLButtonElement>("next").disabled = page >= entries.length;
    get("preview-status").textContent = "กำลังเตรียมตัวอย่าง…";
    try {
      await preview.show(pdf, page);
      get("preview-status").textContent = "";
    } catch {
      get("preview-status").textContent =
        "แสดงตัวอย่างไม่ได้ กรุณาดาวน์โหลดเพื่อตรวจไฟล์";
    }
  };
  get("view-pdf").addEventListener(
    "click",
    () => {
      page = 1;
      dialog.showModal();
      void showPage();
    },
    { signal },
  );
  get("close").addEventListener("click", () => dialog.close(), { signal });
  dialog.addEventListener("close", () => preview.clear(), { signal });
  get("prev").addEventListener(
    "click",
    () => {
      if (page > 1) {
        page--;
        void showPage();
      }
    },
    { signal },
  );
  get("next").addEventListener(
    "click",
    () => {
      if (page < entries.length) {
        page++;
        void showPage();
      }
    },
    { signal },
  );
  addEventListener(
    "pagehide",
    () => stop?.(new Error("ออกจากหน้าแล้ว งานถูกยกเลิก")),
    { signal },
  );
  sessions.set(root, () => {
    lifetime.abort();
    stop?.(new Error("ปิดหน้าแล้ว"));
    worker?.terminate();
    picker.dispose();
    guard.dispose();
    preview.clear();
    resetPdf();
    for (const e of entries) {
      if (e.thumb) URL.revokeObjectURL(e.thumb);
      if (e.url) URL.revokeObjectURL(e.url);
    }
    entries = [];
  });
}
export function dispose(root: HTMLElement) {
  sessions.get(root)?.();
  sessions.delete(root);
}
