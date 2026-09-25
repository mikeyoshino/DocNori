import { MAX_BYTES, settings, validateVideo, type Size } from "./settings";
import { MediaSession } from "../shared/media";
const instances = new WeakMap<HTMLElement, () => void>();
export function dispose(root: HTMLElement) {
  instances.get(root)?.();
  instances.delete(root);
}
export function init(root: HTMLElement) {
  dispose(root);
  const lifetime = new AbortController();
  const server = new MediaSession();
  const $ = <T extends HTMLElement>(key: string) =>
    root.querySelector<T>(`[data-${key}]`)!;
  const video = $<HTMLVideoElement>("video"),
    input = $<HTMLInputElement>("file"),
    start = $<HTMLInputElement>("start"),
    end = $<HTMLInputElement>("end");
  let source: File | undefined,
    sourceUrl = "",
    resultUrl = "",
    total = 0,
    width = 0,
    height = 0,
    busy = false,
    opening = false,
    resultEdge = 0,
    playing = false,
    generation = 0;
  let job: AbortController | undefined;
  const show = (name: string) => {
    for (const key of ["intro", "workspace", "progress", "result"])
      $(key).hidden = key !== name;
  };
  const error = (message = "") => {
    $("error").textContent = message;
    $("error").hidden = !message;
  };
  const on = (el: EventTarget, event: string, handler: (event: any) => void) =>
    el.addEventListener(event, handler, { signal: lifetime.signal });
  const revokeResult = () => {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = "";
    $("image").removeAttribute("src");
    $("download").removeAttribute("href");
  };
  const label = (n: number) =>
    `${Math.floor(n / 60)}:${(n % 60).toFixed(1).padStart(4, "0")}`;
  function updateRange() {
    $("start-label").textContent = label(+start.value);
    $("end-label").textContent = label(+end.value);
    $("duration").textContent =
      `${(+end.value - +start.value).toFixed(1)} วินาที`;
    start.setAttribute("aria-valuetext", label(+start.value));
    end.setAttribute("aria-valuetext", label(+end.value));
  }
  async function choose(file?: File) {
    if (!file || busy) return;
    error();
    if (!file.size || file.size > MAX_BYTES)
      return error("เลือกวิดีโอขนาดไม่เกิน 200 MB นะครับ");
    if (!/\.(mp4|mov|webm)$/i.test(file.name))
      return error("เลือกไฟล์ MP4, MOV หรือ WebM");
    const id = ++generation;
    opening = true;
    $<HTMLButtonElement>("create").disabled = true;
    const url = URL.createObjectURL(file),
      probe = document.createElement("video");
    probe.muted = true;
    probe.preload = "metadata";
    $("status").textContent = "กำลังเปิดวิดีโอ…";
    try {
      await new Promise<void>((resolve, reject) => {
        const fail = () =>
          done(
            new Error("เปิดวิดีโอนี้ไม่ได้ ลองเลือกไฟล์ MP4 หรือ WebM อื่น"),
          );
        const done = (e?: Error) => {
          clearTimeout(timer);
          probe.onloadedmetadata = null;
          probe.onerror = null;
          lifetime.signal.removeEventListener("abort", fail);
          e ? reject(e) : resolve();
        };
        const timer = setTimeout(fail, 15000);
        probe.onloadedmetadata = () => done();
        probe.onerror = fail;
        lifetime.signal.addEventListener("abort", fail, { once: true });
        probe.src = url;
      });
      validateVideo(
        file.size,
        probe.duration,
        probe.videoWidth,
        probe.videoHeight,
      );
      if (id !== generation || lifetime.signal.aborted) {
        URL.revokeObjectURL(url);
        return;
      }
      server.leave();
      video.pause();
      playing = false;
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      revokeResult();
      source = file;
      sourceUrl = url;
      total = probe.duration;
      width = probe.videoWidth;
      height = probe.videoHeight;
      video.src = url;
      $("filename").textContent = file.name;
      start.max = String(Math.max(0, total - 0.1));
      end.max = String(total);
      start.value = "0";
      end.value = String(Math.min(5, total));
      updateRange();
      show("workspace");
    } catch (e) {
      URL.revokeObjectURL(url);
      if (id === generation && !lifetime.signal.aborted)
        error((e as Error).message);
    } finally {
      probe.removeAttribute("src");
      probe.load();
      if (id === generation) {
        opening = false;
        $<HTMLButtonElement>("create").disabled = false;
        $("status").textContent = "";
      }
    }
  }
  async function create(smaller = false) {
    if (!source || busy || opening) return;
    $("status").textContent = "";
    error();
    const selected = root.querySelector<HTMLInputElement>(
      'input[name="gif-size"]:checked',
    )!;
    let size = selected.value as Size;
    let smooth = $<HTMLInputElement>("smooth").checked;
    if (smaller) {
      size = size === "large" ? "medium" : "small";
      smooth = false;
    }
    let config: ReturnType<typeof settings>;
    try {
      config = settings(
        +start.value,
        +end.value,
        total,
        width,
        height,
        size,
        smooth,
      );
    } catch (e) {
      error((e as Error).message);
      return;
    }
    if (smaller) {
      root.querySelector<HTMLInputElement>(
        `input[name="gif-size"][value="${size}"]`,
      )!.checked = true;
      $<HTMLInputElement>("smooth").checked = false;
    }
    if (smaller && resultEdge) {
      const ratio = Math.min(
        1,
        (resultEdge * 0.7) / Math.max(config.width, config.height),
      );
      config.width = Math.max(1, Math.round(config.width * ratio));
      config.height = Math.max(1, Math.round(config.height * ratio));
    }
    busy = true;
    playing = false;
    video.pause();
    job = new AbortController();
    show("progress");
    const current = job;
    try {
      const blob = await server.convert(
        source,
        {
          kind: "gif",
          start: config.start,
          end: config.start + config.duration,
          edge: Math.max(160, Math.max(config.width, config.height)),
          fps: config.fps,
          loop: $<HTMLInputElement>("loop").checked,
        },
        (text) => {
          $("progress-text").textContent = text;
        },
      );
      if (current.signal.aborted || lifetime.signal.aborted) return;
      resultEdge = Math.max(config.width, config.height);
      revokeResult();
      resultUrl = URL.createObjectURL(blob);
      $<HTMLImageElement>("image").src = resultUrl;
      const link = $<HTMLAnchorElement>("download");
      link.href = resultUrl;
      link.download = source.name.replace(/\.[^.]+$/, "") + ".gif";
      $("result-size").textContent =
        `${(blob.size / 1_000_000).toFixed(2)} MB · ${config.duration.toFixed(1)} วินาที`;
      $("smaller").hidden = size === "small" && !smooth;
      show("result");
      root.querySelector<HTMLElement>("#gif-result-heading")!.focus();
    } catch (e) {
      if (!lifetime.signal.aborted) {
        show("workspace");
        if (!current.signal.aborted)
          error(
            e instanceof Error ? e.message : "สร้าง GIF ไม่สำเร็จ กรุณาลองใหม่",
          );
      }
    } finally {
      busy = false;
      job = undefined;
    }
  }
  root
    .querySelectorAll<HTMLElement>("[data-choose]")
    .forEach((button) => on(button, "click", () => input.click()));
  on(input, "change", () => {
    void choose(input.files?.[0]);
    input.value = "";
  });
  on($("drop"), "dragover", (e: DragEvent) => {
    e.preventDefault();
    $("drop").classList.add("dragging");
  });
  on($("drop"), "dragleave", () => $("drop").classList.remove("dragging"));
  on($("drop"), "drop", (e: DragEvent) => {
    e.preventDefault();
    $("drop").classList.remove("dragging");
    if (e.dataTransfer?.files.length !== 1) error("เลือกวิดีโอครั้งละ 1 ไฟล์");
    else void choose(e.dataTransfer.files[0]);
  });
  on(start, "input", () => {
    const s = +start.value;
    end.value = String(
      Math.min(total, Math.max(s + 0.1, Math.min(+end.value, s + 30))),
    );
    video.pause();
    playing = false;
    video.currentTime = s;
    updateRange();
  });
  on(end, "input", () => {
    end.value = String(
      Math.min(
        total,
        Math.max(+start.value + 0.1, Math.min(+end.value, +start.value + 30)),
      ),
    );
    video.pause();
    playing = false;
    video.currentTime = +end.value;
    updateRange();
  });
  on($("play"), "click", () => {
    video.currentTime = +start.value;
    playing = true;
    void video
      .play()
      .catch(() => error("เล่นวิดีโอนี้ไม่ได้ ลองเลือกไฟล์อื่น"));
  });
  on(video, "timeupdate", () => {
    if (playing && video.currentTime >= +end.value) {
      video.pause();
      playing = false;
    }
  });
  on($("create"), "click", () => void create());
  on($("smaller"), "click", () => void create(true));
  on($("edit"), "click", () => {
    error();
    show("workspace");
  });
  on($("new"), "click", () => input.click());
  instances.set(root, () => {
    generation++;
    server.dispose();
    lifetime.abort();
    job?.abort();
    video.pause();
    video.removeAttribute("src");
    video.load();
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    revokeResult();
  });
}
