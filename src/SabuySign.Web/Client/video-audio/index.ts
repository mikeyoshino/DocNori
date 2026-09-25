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
  const input = $<HTMLInputElement>("file"),
    video = $<HTMLVideoElement>("video"),
    audio = $<HTMLAudioElement>("audio");
  let source: File | undefined,
    sourceUrl = "",
    outputUrl = "",
    busy = false,
    opening = false,
    generation = 0;
  let job: AbortController | undefined;
  const on = (target: EventTarget, event: string, callback: (e: any) => void) =>
    target.addEventListener(event, callback, { signal: lifetime.signal });
  const error = (message = "") => {
    $("error").textContent = message;
    $("error").hidden = !message;
  };
  const show = (state: string) => {
    for (const key of ["intro", "workspace", "progress", "result"])
      $(key).hidden = key !== state;
  };
  const clearOutput = () => {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    $("download").removeAttribute("href");
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = "";
  };
  async function choose(file?: File) {
    if (!file || busy) return;
    error();
    if (!file.size || file.size > 500_000_000)
      return error("เลือกวิดีโอขนาดไม่เกิน 500 MB");
    if (!/\.(mp4|mov|webm)$/i.test(file.name))
      return error("เลือกไฟล์ MP4, MOV หรือ WebM");
    const id = ++generation,
      url = URL.createObjectURL(file),
      probe = document.createElement("video");
    opening = true;
    $<HTMLButtonElement>("create").disabled = true;
    $("status").textContent = "กำลังเปิดวิดีโอ…";
    try {
      await new Promise<void>((resolve, reject) => {
        const fail = () =>
          done(
            new Error("เปิดวิดีโอนี้ไม่ได้ ลองเลือกไฟล์ MP4 หรือ WebM อื่น"),
          );
        const done = (e?: Error) => {
          clearTimeout(timer);
          lifetime.signal.removeEventListener("abort", fail);
          probe.onloadedmetadata = null;
          probe.onerror = null;
          e ? reject(e) : resolve();
        };
        const timer = setTimeout(fail, 15000);
        probe.preload = "metadata";
        probe.muted = true;
        probe.onloadedmetadata = () => done();
        probe.onerror = fail;
        lifetime.signal.addEventListener("abort", fail, { once: true });
        probe.src = url;
      });
      if (!Number.isFinite(probe.duration) || probe.duration <= 0)
        throw new Error("อ่านความยาววิดีโอไม่ได้ ลองเลือกไฟล์อื่น");
      if (probe.duration > 3600.1)
        throw new Error("เลือกวิดีโอที่มีความยาวไม่เกิน 1 ชั่วโมง");
      if (id !== generation || lifetime.signal.aborted) {
        URL.revokeObjectURL(url);
        return;
      }
      server.leave();
      clearOutput();
      video.pause();
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      source = file;
      sourceUrl = url;
      video.src = url;
      $("filename").textContent = file.name;
      $("duration").textContent =
        `${Math.floor(probe.duration / 60)}:${Math.floor(probe.duration % 60)
          .toString()
          .padStart(2, "0")} นาที · ${(file.size / 1_000_000).toFixed(1)} MB`;
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
  async function create() {
    if (!source || busy || opening) return;
    busy = true;
    error();
    $("status").textContent = "";
    video.pause();
    audio.pause();
    show("progress");
    const current = (job = new AbortController());
    try {
      const blob = await server.convert(source, { kind: "mp3" }, (text) => {
        $("progress-text").textContent = text;
      });
      if (current.signal.aborted || lifetime.signal.aborted) return;
      clearOutput();
      outputUrl = URL.createObjectURL(blob);
      audio.src = outputUrl;
      const link = $<HTMLAnchorElement>("download");
      link.href = outputUrl;
      link.download = source.name.replace(/\.[^.]+$/, "") + ".mp3";
      $("result-size").textContent =
        `${(blob.size / 1_000_000).toFixed(2)} MB · MP3`;
      show("result");
      $("result-title").focus();
    } catch (e) {
      if (!lifetime.signal.aborted) {
        show("workspace");
        if (!current.signal.aborted)
          error(
            e instanceof Error
              ? e.message
              : "แปลงไม่สำเร็จ ลองเลือกไฟล์อื่นแล้วลองใหม่",
          );
      }
    } finally {
      busy = false;
      job = undefined;
    }
  }
  root
    .querySelectorAll("[data-choose]")
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
  on($("create"), "click", () => void create());
  instances.set(root, () => {
    generation++;
    server.dispose();
    lifetime.abort();
    job?.abort();
    clearOutput();
    video.pause();
    video.removeAttribute("src");
    video.load();
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  });
}
