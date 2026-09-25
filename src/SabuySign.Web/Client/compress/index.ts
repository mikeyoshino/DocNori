import { MAX_BYTES, type Quality } from "./pdf";
import { Preview } from "./preview";
import { MediaSession } from "../shared/media";
const sessions = new WeakMap<HTMLElement, () => void>();
const size = (n: number) =>
  n < 1024 * 1024
    ? `${(n / 1024).toFixed(1)} KB`
    : `${(n / 1024 / 1024).toFixed(2)} MB`;
type Reply = {
  bytes?: Uint8Array;
  pages: number;
  error?: string;
  progress?: number;
};
export function init(root: HTMLElement) {
  dispose(root);
  const lifetime = new AbortController(),
    { signal } = lifetime;
  const get = <T extends HTMLElement>(key: string) =>
    root.querySelector<T>(`[data-${key}]`)!;
  const input = get<HTMLInputElement>("file"),
    preview = new Preview(get("preview"));
  let source: Uint8Array | undefined,
    result: Uint8Array | undefined,
    name = "",
    count = 0,
    page = 1,
    view = "original",
    busy = false,
    url: string | undefined,
    downloaded = false;
  let worker: Worker | undefined,
    rejectWork: ((e: Error) => void) | undefined,
    previewGeneration = 0;
  // Reuse the existing local-work navigation guard; no server job is created.
  const guard = new MediaSession(() => busy || (!!result && !downloaded));
  const fail = (message = "") => {
    get("error").textContent = message;
    get("error").hidden = !message;
  };
  const release = () => {
    if (url) URL.revokeObjectURL(url);
    url = undefined;
  };
  const sync = () => {
    get("intro").hidden = !!source;
    get("reading").hidden = !busy || !!source;
    get("workspace").hidden = !source;
    get<HTMLButtonElement>("run").disabled = busy || !source;
    get("run").hidden = !!result;
    get("download").hidden = !result;
    get("again").hidden = !result;
    get("result").hidden = !result;
    get<HTMLFieldSetElement>("levels").disabled = busy || !!result;
    get<HTMLButtonElement>("replace").disabled = busy;
    root
      .querySelectorAll<HTMLButtonElement>("[data-choose]")
      .forEach((b) => (b.disabled = busy));
    get<HTMLButtonElement>("prev").disabled = page <= 1;
    get<HTMLButtonElement>("next").disabled = page >= count;
    root.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((b) => {
      b.disabled = b.dataset.view === "result" && !result;
      b.setAttribute("aria-pressed", String(b.dataset.view === view));
    });
    get("page").textContent = `${page} / ${count}`;
    get("progress").hidden = !busy;
    root.setAttribute("aria-busy", String(busy));
  };
  const render = async () => {
    const bytes = view === "result" ? result : source;
    if (!bytes) return;
    const generation = ++previewGeneration;
    get("preview-status").textContent = "กำลังเตรียมตัวอย่าง…";
    try {
      await preview.show(bytes, page);
      if (generation === previewGeneration)
        get("preview-status").textContent = "";
    } catch {
      if (generation === previewGeneration)
        get("preview-status").textContent =
          "แสดงตัวอย่างไม่ได้ กรุณาตรวจไฟล์ในโปรแกรมอ่าน PDF";
    }
  };
  const runWorker = (bytes: Uint8Array, inspect = false) =>
    new Promise<Reply>((resolve, reject) => {
      worker?.terminate();
      const active = (worker = new Worker(
        new URL("./compress.worker.js", import.meta.url),
        { type: "module" },
      ));
      const timer = setTimeout(
        () => finish(new Error("ไฟล์นี้ใช้เวลานานเกินไป ลองใช้ไฟล์ที่เล็กลง")),
        120000,
      );
      const finish = (error?: Error, data?: Reply) => {
        clearTimeout(timer);
        active.terminate();
        if (worker === active) worker = undefined;
        rejectWork = undefined;
        if (error) reject(error);
        else resolve(data!);
      };
      rejectWork = (error) => finish(error);
      active.onerror = (e) => {
        e.preventDefault();
        finish(
          new Error("ประมวลผลไม่สำเร็จ ลองใช้ไฟล์ที่เล็กลงหรือเปิดหน้าใหม่"),
        );
      };
      active.onmessage = ({ data }: MessageEvent<Reply>) => {
        if (data.progress !== undefined) {
          get<HTMLProgressElement>("progress").value = data.progress;
          get("status").textContent = `กำลังลดขนาด… ${data.progress}%`;
          return;
        }
        finish(data.error ? new Error(data.error) : undefined, data);
      };
      const copy = bytes.slice();
      const quality = root.querySelector<HTMLInputElement>(
        'input[name="compress-quality"]:checked',
      )!.value as Quality;
      active.postMessage({ bytes: copy, quality, inspect }, [copy.buffer]);
    });
  const open = async (files: FileList | File[]) => {
    if (busy || !files.length) return;
    fail();
    if (files.length !== 1) {
      fail("เลือก PDF ครั้งละ 1 ไฟล์");
      return;
    }
    const file = files[0];
    if (!/\.pdf$/i.test(file.name)) {
      fail("กรุณาเลือกไฟล์ PDF");
      return;
    }
    if (file.size > MAX_BYTES) {
      fail("เลือกไฟล์ PDF ขนาดไม่เกิน 50 MB");
      return;
    }
    if (
      result &&
      !downloaded &&
      !confirm("เปลี่ยนไฟล์หรือไม่? กรุณาดาวน์โหลดผลลัพธ์ก่อน")
    )
      return;
    busy = true;
    get("status").textContent = "กำลังอ่านไฟล์…";
    get<HTMLProgressElement>("progress").removeAttribute("value");
    sync();
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (signal.aborted) return;
      const info = await runWorker(bytes, true);
      if (signal.aborted) return;
      previewGeneration++;
      preview.clear();
      release();
      source = bytes;
      result = undefined;
      name = file.name;
      count = info.pages;
      page = 1;
      view = "original";
      downloaded = false;
      get("name").textContent = name;
      get("info").textContent = `${count} หน้า · ${size(file.size)}`;
      get("status").textContent = "";
      void render();
    } catch (e) {
      if (!signal.aborted)
        fail(e instanceof Error ? e.message : "เปิดไฟล์ไม่ได้");
    } finally {
      busy = false;
      if (!signal.aborted) sync();
      input.value = "";
    }
  };
  root
    .querySelectorAll("[data-choose],[data-replace]")
    .forEach((b) =>
      b.addEventListener("click", () => input.click(), { signal }),
    );
  input.addEventListener(
    "change",
    () => {
      if (input.files) void open(input.files);
    },
    { signal },
  );
  const drop = get("drop");
  root.addEventListener(
    "dragover",
    (e) => {
      e.preventDefault();
      if (!busy) drop.classList.add("dragging");
    },
    { signal },
  );
  root.addEventListener("dragleave", () => drop.classList.remove("dragging"), {
    signal,
  });
  root.addEventListener(
    "drop",
    (e) => {
      e.preventDefault();
      drop.classList.remove("dragging");
      if (e.dataTransfer) void open(e.dataTransfer.files);
    },
    { signal },
  );
  get("run").addEventListener(
    "click",
    async () => {
      if (!source || busy) return;
      busy = true;
      fail();
      get("status").textContent = "กำลังลดขนาด…";
      get<HTMLProgressElement>("progress").removeAttribute("value");
      sync();
      try {
        const output = await runWorker(source);
        if (signal.aborted) return;
        if (!output.bytes) throw new Error("สร้างไฟล์ไม่สำเร็จ กรุณาลองใหม่");
        result = output.bytes;
        release();
        url = URL.createObjectURL(
          new Blob([new Uint8Array(result)], { type: "application/pdf" }),
        );
        const download = get<HTMLAnchorElement>("download");
        download.href = url;
        download.download = name.replace(/\.pdf$/i, "") + "-compressed.pdf";
        downloaded = false;
        const saved = source.length - result.length;
        get("saved").textContent =
          saved > 0
            ? `เล็กลง ${((saved / source.length) * 100).toFixed(1)}%`
            : "ไฟล์นี้เล็กอยู่แล้ว";
        get("before").textContent = size(source.length);
        get("after").textContent = size(result.length);
        get("result-note").textContent =
          saved > 0
            ? "ตรวจตัวอย่างก่อนนำไปใช้"
            : "ลดเพิ่มไม่ได้โดยวิธีนี้ ดาวน์โหลดไฟล์ต้นฉบับได้ด้านล่าง";
        get("status").textContent = "พร้อมดาวน์โหลด";
        view = "result";
        void render();
      } catch (e) {
        if (!signal.aborted) {
          fail(e instanceof Error ? e.message : "ลดขนาดไม่สำเร็จ");
          get("status").textContent = "ลองอีกครั้งได้";
        }
      } finally {
        busy = false;
        if (!signal.aborted) sync();
      }
    },
    { signal },
  );
  get("again").addEventListener(
    "click",
    () => {
      release();
      result = undefined;
      view = "original";
      get("status").textContent = "";
      fail();
      sync();
      void render();
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
  get("prev").addEventListener(
    "click",
    () => {
      if (page > 1) {
        page--;
        sync();
        void render();
      }
    },
    { signal },
  );
  get("next").addEventListener(
    "click",
    () => {
      if (page < count) {
        page++;
        sync();
        void render();
      }
    },
    { signal },
  );
  root.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((b) =>
    b.addEventListener(
      "click",
      () => {
        view = b.dataset.view!;
        sync();
        void render();
      },
      { signal },
    ),
  );
  addEventListener(
    "pagehide",
    () => rejectWork?.(new Error("ออกจากหน้าแล้ว งานถูกยกเลิก")),
    { signal },
  );
  sessions.set(root, () => {
    lifetime.abort();
    rejectWork?.(new Error("ปิดหน้าแล้ว"));
    worker?.terminate();
    previewGeneration++;
    preview.clear();
    release();
    guard.dispose();
    source = result = undefined;
  });
}
export function dispose(root: HTMLElement) {
  sessions.get(root)?.();
  sessions.delete(root);
}
