import { guardUnsavedWork } from "../shared/leave-guard";
import { SplitPreview } from "./preview";
import { MAX_BYTES, readPdf } from "../merge/pdf";
import {
  parsePages,
  splitPdf,
  rangeGroups,
  fixedRanges,
  exportGroups,
  type PageRange,
} from "./pdf";
import { zipFiles } from "../shared/zip";
const sessions = new WeakMap<HTMLElement, () => void>();
export function init(root: HTMLElement) {
  dispose(root);
  const abort = new AbortController(),
    { signal } = abort;
  const get = <T extends HTMLElement>(key: string) =>
    root.querySelector<T>(`[data-${key}]`)!;
  const file = get<HTMLInputElement>("file"),
    range = get<HTMLInputElement>("range"),
    size = get<HTMLInputElement>("size"),
    combine = get<HTMLInputElement>("combine"),
    selected = get<HTMLButtonElement>("selected"),
    remaining = get<HTMLButtonElement>("remaining"),
    status = get("status"),
    drop = get("drop");
  let source: { bytes: Uint8Array; name: string; count: number } | undefined,
    busy = false,
    mode = "ranges",
    rangeMode = "custom",
    ranges: PageRange[] = [{ start: 1, end: 1 }];
  let savedSource: typeof source;
  let savedOptions = "";
  const optionsKey = () =>
    JSON.stringify([
      mode,
      rangeMode,
      ranges,
      range.value,
      size.value,
      combine.checked,
    ]);
  const preview = new SplitPreview(
    root,
    (index) => {
      if (busy || !source || mode !== "pages") return;
      let pages: number[] = [];
      try {
        pages = parsePages(range.value, source.count);
      } catch {
        /* Start a new selection. */
      }
      const set = new Set(pages);
      if (set.has(index)) set.delete(index);
      else set.add(index);
      range.value = [...set]
        .sort((a, b) => a - b)
        .map((p) => p + 1)
        .join(", ");
      fail("");
      render();
    },
    signal,
  );
  const fail = (message: string) => {
    for (const key of ["error", "open-error"]) {
      get(key).textContent = message;
      get(key).hidden = !message || (key === "error" ? !source : !!source);
    }
  };
  const groups = () => {
    if (!source) return [];
    if (mode === "pages") return [parsePages(range.value, source.count)];
    return rangeGroups(
      rangeMode === "fixed"
        ? fixedRanges(source.count, Number(size.value))
        : ranges,
      source.count,
    );
  };
  const render = () => {
    get("intro").hidden = !!source;
    get("workspace").hidden = !source;
    root.classList.toggle("has-document", !!source);
    root
      .querySelectorAll<HTMLButtonElement>(
        "button:not(.split-page-toggle):not(.split-page-zoom)",
      )
      .forEach((b) => (b.disabled = busy));
    root
      .querySelectorAll<HTMLInputElement>("input")
      .forEach((i) => (i.disabled = busy));
    selected.disabled = remaining.disabled = true;
    root
      .querySelectorAll<HTMLButtonElement>("[data-mode]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.mode === mode)),
      );
    root
      .querySelectorAll<HTMLButtonElement>("[data-range-mode]")
      .forEach((b) =>
        b.setAttribute(
          "aria-pressed",
          String(b.dataset.rangeMode === rangeMode),
        ),
      );
    get("range-settings").hidden = mode !== "ranges";
    get("page-settings").hidden = mode !== "pages";
    get("custom").hidden = rangeMode !== "custom";
    get("fixed").hidden = rangeMode !== "fixed";
    get<HTMLButtonElement>("add").disabled = busy || ranges.length >= 100;
    root
      .querySelectorAll<HTMLButtonElement>("[data-remove-range]")
      .forEach((b) => (b.disabled = busy || ranges.length === 1));
    status.textContent = busy
      ? "กำลังประมวลผล…"
      : source
        ? "พร้อมแยกไฟล์"
        : "ยังไม่ได้เลือกไฟล์";
    if (!source) return;
    get("name").textContent = `${source.name} · ${source.count} หน้า`;
    try {
      const result = groups(),
        pages = [...new Set(result.flat())];
      preview.layout(mode === "ranges" ? result : null);
      preview.sync(pages, busy || mode !== "pages");
      selected.disabled = busy;
      remaining.disabled = busy || pages.length === source.count;
      range.setAttribute("aria-invalid", "false");
      const files = mode === "pages" || combine.checked ? 1 : result.length;
      get("selection").textContent =
        `${files} ไฟล์ · ${mode === "pages" || combine.checked ? pages.length : result.flat().length} หน้า${files > 1 ? " · ดาวน์โหลดเป็น ZIP" : " · ดาวน์โหลดเป็น PDF"}`;
    } catch (e) {
      get("selection").textContent = (e as Error).message;
      range.setAttribute("aria-invalid", "true");
      preview.layout(mode === "ranges" ? [] : null);
      preview.sync([], busy || mode !== "pages");
    }
  };
  const drawRanges = () => {
    const list = get("ranges");
    list.replaceChildren();
    ranges.forEach((value, index) => {
      const row = document.createElement("fieldset"),
        legend = document.createElement("legend");
      legend.textContent = `ช่วงที่ ${index + 1}`;
      row.append(legend);
      for (const [key, label] of [
        ["start", "จากหน้า"],
        ["end", "ถึงหน้า"],
      ] as const) {
        const wrap = document.createElement("label"),
          input = document.createElement("input");
        wrap.append(label);
        input.type = "number";
        input.min = "1";
        input.max = String(source?.count ?? 100);
        input.value = String(value[key]);
        input.setAttribute("aria-label", `${label} ช่วงที่ ${index + 1}`);
        input.oninput = () => {
          value[key] = Number(input.value);
          fail("");
          render();
        };
        wrap.append(input);
        row.append(wrap);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "ลบ";
      remove.dataset.removeRange = "";
      remove.setAttribute("aria-label", `ลบช่วงที่ ${index + 1}`);
      remove.onclick = () => {
        ranges.splice(index, 1);
        drawRanges();
        render();
        get<HTMLButtonElement>("add").focus();
      };
      row.append(remove);
      list.append(row);
    });
  };
  const open = async (files: File[]) => {
    if (busy || !files.length) return;
    if (files.length !== 1) {
      fail("กรุณาเลือกครั้งละ 1 ไฟล์");
      return;
    }
    busy = true;
    fail("");
    render();
    try {
      const candidate = files[0];
      if (!/\.pdf$/i.test(candidate.name))
        throw new Error("กรุณาเลือกไฟล์ PDF");
      if (candidate.size > MAX_BYTES)
        throw new Error("ไฟล์ต้องมีขนาดไม่เกิน 25 MB");
      const bytes = new Uint8Array(await candidate.arrayBuffer()),
        pdf = await readPdf(bytes);
      if (signal.aborted) return;
      source = { bytes, name: candidate.name, count: pdf.getPageCount() };
      mode = "ranges";
      rangeMode = "custom";
      ranges = [{ start: 1, end: source.count }];
      range.value = "1";
      size.value = "1";
      size.max = String(source.count);
      combine.checked = false;
      drawRanges();
      void preview.load(bytes);
      window.scrollTo(0, 0);
    } catch (e) {
      fail(
        e instanceof Error && /[ก-๙]/.test(e.message)
          ? e.message
          : "เปิดไฟล์ไม่ได้ ไฟล์อาจเสียหายหรือมีรหัสผ่าน ไฟล์เดิมยังอยู่หากเปิดไว้แล้ว",
      );
    } finally {
      if (!signal.aborted) {
        busy = false;
        render();
      }
    }
  };
  for (const key of ["choose", "replace"])
    get(key).addEventListener("click", () => file.click(), { signal });
  file.addEventListener(
    "change",
    () => {
      const files = [...(file.files ?? [])];
      file.value = "";
      void open(files);
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
      void open([...(e.dataTransfer?.files ?? [])]);
    },
    { signal },
  );
  root.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) =>
    b.addEventListener(
      "click",
      () => {
        mode = b.dataset.mode!;
        fail("");
        render();
      },
      { signal },
    ),
  );
  root.querySelectorAll<HTMLButtonElement>("[data-range-mode]").forEach((b) =>
    b.addEventListener(
      "click",
      () => {
        rangeMode = b.dataset.rangeMode!;
        fail("");
        render();
      },
      { signal },
    ),
  );
  for (const input of [range, size, combine])
    input.addEventListener(
      "input",
      () => {
        fail("");
        render();
      },
      { signal },
    );
  get("add").addEventListener(
    "click",
    () => {
      if (!source || ranges.length >= 100) return;
      const start = Math.min(source.count, (ranges.at(-1)?.end || 0) + 1);
      ranges.push({ start, end: source.count });
      drawRanges();
      render();
      get("ranges").lastElementChild?.querySelector("input")?.focus();
    },
    { signal },
  );
  get("clear").addEventListener(
    "click",
    () => {
      preview.clear();
      source = undefined;
      fail("");
      render();
      get("choose").focus();
    },
    { signal },
  );
  const download = async (rest = false) => {
    if (busy || !source) return;
    busy = true;
    fail("");
    render();
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      let bytes: Uint8Array,
        extension = "pdf";
      if (rest) bytes = await splitPdf(source.bytes, range.value, true);
      else {
        const files = await exportGroups(
          source.bytes,
          groups(),
          mode === "pages" || combine.checked,
        );
        if (files.length === 1) bytes = files[0].bytes;
        else {
          bytes = zipFiles(files);
          extension = "zip";
        }
      }
      if (signal.aborted) return;
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], {
          type: extension === "zip" ? "application/zip" : "application/pdf",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `${source.name.replace(/\.pdf$/i, "")}-${rest ? "remaining" : "split"}.${extension}`;
      link.click();
      savedSource = source;
      savedOptions = optionsKey();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      busy = false;
      render();
      status.textContent = "แยกไฟล์แล้ว · ส่งไฟล์ให้เบราว์เซอร์ดาวน์โหลดแล้ว";
    } catch {
      busy = false;
      render();
      fail(
        "แยกไฟล์ไม่สำเร็จ ลองตรวจช่วงหน้าหรือใช้ PDF อื่น ไฟล์ต้นฉบับยังอยู่เหมือนเดิม",
      );
    }
  };
  selected.addEventListener("click", () => void download(), { signal });
  remaining.addEventListener("click", () => void download(true), { signal });
  guardUnsavedWork(
    () => !!source && (source !== savedSource || optionsKey() !== savedOptions),
    signal,
  );
  sessions.set(root, () => {
    preview.clear();
    abort.abort();
    source = undefined;
  });
}
export function dispose(root: HTMLElement) {
  sessions.get(root)?.();
  sessions.delete(root);
}
