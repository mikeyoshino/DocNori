import { createFileSourcePicker } from "../shared/file-source-picker";
import { cover } from "./preview";
import { MAX_BYTES, MAX_FILES, MAX_PAGES, readPdf, mergePdfs } from "./pdf";
const sessions = new WeakMap<HTMLElement, () => void>();
export function init(root: HTMLElement) {
  dispose(root);
  const abort = new AbortController(),
    { signal } = abort;
  const get = <T extends HTMLElement>(key: string) =>
    root.querySelector<T>(`[data-${key}]`)!;
  const input = get<HTMLInputElement>("files"),
    choose = get<HTMLButtonElement>("choose"),
    merge = get<HTMLButtonElement>("merge"),
    clear = get<HTMLButtonElement>("clear"),
    list = get("list"),
    status = get("status"),
    error = get("error"),
    drop = get("drop");
  let entries: {
      name: string;
      bytes: Uint8Array;
      pages: number;
      cover?: HTMLCanvasElement;
    }[] = [],
    busy = false;
  const filePicker = createFileSourcePicker(
    root.querySelector<HTMLElement>("[data-file-picker]")!,
    () => input.click(),
  );
  let dragging: number | undefined;
  let ascending = true;
  const fail = (message: string) => {
    error.textContent = message;
    error.hidden = !message;
  };
  const render = () => {
    if (entries.length) get("footer").prepend(get("feedback"));
    else root.append(get("feedback"));
    get("intro").hidden = entries.length > 0;
    get("workspace").hidden = !entries.length;
    root.classList.toggle("has-documents", entries.length > 0);
    filePicker.update(entries.length, busy);
    get("summary").textContent =
      `${entries.length} ไฟล์ · ${entries.reduce((n, e) => n + e.pages, 0)} หน้า`;
    get<HTMLButtonElement>("sort").disabled = busy || entries.length < 2;
    list.replaceChildren();
    entries.forEach((entry, index) => {
      const row = document.createElement("li"),
        info = document.createElement("div"),
        title = document.createElement("strong"),
        meta = document.createElement("span"),
        actions = document.createElement("div");
      row.draggable = !busy;
      row.dataset.index = String(index);
      row.addEventListener("dragstart", (e) => {
        if (busy) {
          e.preventDefault();
          return;
        }
        dragging = index;
        e.dataTransfer!.effectAllowed = "move";
        e.dataTransfer!.setData("text/plain", String(index));
        row.classList.add("is-dragging");
      });
      row.addEventListener("dragover", (e) => {
        if (dragging === undefined || busy) return;
        e.preventDefault();
        e.dataTransfer!.dropEffect = "move";
        row.classList.add("drag-target");
      });
      row.addEventListener("dragleave", () =>
        row.classList.remove("drag-target"),
      );
      row.addEventListener("dragend", () => {
        dragging = undefined;
        list
          .querySelectorAll("li")
          .forEach((r) => r.classList.remove("is-dragging", "drag-target"));
      });
      row.addEventListener("drop", (e) => {
        if (dragging === undefined || busy) return;
        e.preventDefault();
        e.stopPropagation();
        const [entry] = entries.splice(dragging, 1);
        entries.splice(index, 0, entry);
        dragging = undefined;
        render();
      });
      const image = document.createElement("div");
      image.className = "merge-cover";
      if (entry.cover) image.append(entry.cover);
      else {
        const fallback = document.createElement("span");
        fallback.textContent = "PDF · ไม่มีภาพตัวอย่าง";
        image.append(fallback);
      }
      title.textContent = `${index + 1}. ${entry.name}`;
      meta.textContent = `${entry.pages} หน้า · ${(entry.bytes.length / 1024 / 1024).toFixed(2)} MB`;
      info.append(title, meta);
      actions.className = "merge-row-actions";
      for (const [label, delta] of [
        ["เลื่อนขึ้น", -1],
        ["เลื่อนลง", 1],
        ["ลบ", 0],
      ] as const) {
        const button = document.createElement("button");
        button.textContent = label;
        button.type = "button";
        button.setAttribute("aria-label", `${label} ${entry.name}`);
        button.disabled =
          busy ||
          (delta !== 0 &&
            (index + delta < 0 || index + delta >= entries.length));
        button.onclick = () => {
          if (delta)
            [entries[index], entries[index + delta]] = [
              entries[index + delta],
              entries[index],
            ];
          else entries.splice(index, 1);
          render();
          const target =
            list.children[
              Math.min(entries.length - 1, Math.max(0, index + delta))
            ];
          (
            target?.querySelector(
              "button:not(:disabled)",
            ) as HTMLButtonElement | null
          )?.focus();
        };
        actions.append(button);
      }
      row.append(image, info, actions);
      list.append(row);
    });
    choose.disabled = busy;
    clear.disabled = busy || !entries.length;
    merge.disabled = busy || entries.length < 2;
    status.textContent = busy
      ? "กำลังประมวลผล…"
      : entries.length
        ? `${entries.length} ไฟล์ · ${entries.reduce((n, e) => n + e.pages, 0)} หน้า · จัดลำดับก่อนรวมไฟล์`
        : "ยังไม่ได้เลือกไฟล์";
  };
  const add = async (files: File[]) => {
    if (busy || !files.length) return;
    busy = true;
    fail("");
    render();
    const errors: string[] = [];
    for (const file of files) {
      if (signal.aborted) return;
      try {
        if (entries.length >= MAX_FILES)
          throw new Error("เลือกได้ไม่เกิน 20 ไฟล์");
        if (!/\.pdf$/i.test(file.name)) throw new Error("กรุณาเลือกไฟล์ PDF");
        if (
          entries.reduce((n, e) => n + e.bytes.length, 0) + file.size >
          MAX_BYTES
        )
          throw new Error("ขนาดรวมต้องไม่เกิน 25 MB");
        const bytes = new Uint8Array(await file.arrayBuffer());
        const doc = await readPdf(bytes);
        if (
          entries.reduce((n, e) => n + e.pages, 0) + doc.getPageCount() >
          MAX_PAGES
        )
          throw new Error("จำนวนหน้ารวมต้องไม่เกิน 100 หน้า");
        let thumbnail: HTMLCanvasElement | undefined;
        try {
          thumbnail = await cover(bytes, signal);
        } catch {
          /* A preview failure does not block a valid PDF. */
        }
        if (signal.aborted) return;
        entries.push({
          name: file.name,
          bytes,
          pages: doc.getPageCount(),
          cover: thumbnail,
        });
      } catch (e) {
        const message =
          e instanceof Error && /[ก-๙]/.test(e.message)
            ? e.message
            : "เปิดไม่ได้ ไฟล์อาจเสียหายหรือมีรหัสผ่าน";
        errors.push(`${file.name}: ${message}`);
      }
    }
    if (signal.aborted) {
      entries = [];
      return;
    }
    busy = false;
    render();
    fail(errors.join("\n"));
  };
  choose.addEventListener("click", () => input.click(), { signal });
  get("sort").addEventListener(
    "click",
    () => {
      const direction = ascending ? 1 : -1;
      entries.sort(
        (a, b) =>
          direction *
          a.name.localeCompare(b.name, "th", {
            numeric: true,
            sensitivity: "base",
          }),
      );
      ascending = !ascending;
      get("sort-label").textContent = ascending ? "A↓Z" : "Z↓A";
      get("sort").setAttribute(
        "aria-label",
        ascending ? "เรียงชื่อไฟล์ ก–ฮ / A–Z" : "เรียงชื่อไฟล์ ฮ–ก / Z–A",
      );
      render();
    },
    { signal },
  );
  const stage = get("stage");
  stage.addEventListener(
    "dragover",
    (e) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        stage.classList.add("dragging");
      }
    },
    { signal },
  );
  stage.addEventListener(
    "dragleave",
    () => stage.classList.remove("dragging"),
    { signal },
  );
  stage.addEventListener(
    "drop",
    (e) => {
      if (e.dataTransfer?.files.length) {
        e.preventDefault();
        stage.classList.remove("dragging");
        void add([...e.dataTransfer.files]);
      }
    },
    { signal },
  );
  input.addEventListener(
    "change",
    () => {
      const files = [...(input.files ?? [])];
      input.value = "";
      void add(files);
    },
    { signal },
  );
  drop.addEventListener(
    "dragover",
    (e) => {
      e.preventDefault();
      drop.classList.add("dragging");
    },
    { signal },
  );
  drop.addEventListener("dragleave", () => drop.classList.remove("dragging"), {
    signal,
  });
  drop.addEventListener(
    "drop",
    (e) => {
      e.preventDefault();
      drop.classList.remove("dragging");
      void add([...(e.dataTransfer?.files ?? [])]);
    },
    { signal },
  );
  clear.addEventListener(
    "click",
    () => {
      entries = [];
      fail("");
      render();
    },
    { signal },
  );
  merge.addEventListener(
    "click",
    async () => {
      if (busy || entries.length < 2) return;
      busy = true;
      fail("");
      render();
      try {
        await new Promise((resolve) => setTimeout(resolve, 0));
        const bytes = await mergePdfs(entries.map((e) => e.bytes));
        if (signal.aborted) return;
        const url = URL.createObjectURL(
          new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = "merged.pdf";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        busy = false;
        render();
        status.textContent =
          "รวมไฟล์แล้ว · ส่งไฟล์ merged.pdf ให้เบราว์เซอร์ดาวน์โหลดแล้ว";
      } catch {
        busy = false;
        render();
        fail(
          "รวมไฟล์ไม่สำเร็จ ลองลบไฟล์ที่มีปัญหาหรือเลือกไฟล์ใหม่ รายการเดิมยังอยู่",
        );
      }
    },
    { signal },
  );
  window.addEventListener(
    "beforeunload",
    (e) => {
      if (entries.length) {
        e.preventDefault();
        e.returnValue = "";
      }
    },
    { signal },
  );
  sessions.set(root, () => {
    filePicker.dispose();
    abort.abort();
    entries = [];
  });
}
export function dispose(root: HTMLElement) {
  sessions.get(root)?.();
  sessions.delete(root);
}
