export type MediaOptions = {
  kind: "gif" | "mp3" | "word-pdf";
  start?: number;
  end?: number;
  edge?: number;
  fps?: number;
  loop?: boolean;
};
/** One page owns one server job. No recovery link or background job after leaving. */
export class MediaSession {
  private id?: string;
  private token = "";
  private requestAbort?: AbortController;
  private heartbeat?: ReturnType<typeof setInterval>;
  private lifetime = new AbortController();
  constructor(hasLocalWork: () => boolean = () => false) {
    const signal = this.lifetime.signal;
    let navigationApproved = false;
    addEventListener("pagehide", () => this.leave(), { signal });
    addEventListener(
      "beforeunload",
      (e: BeforeUnloadEvent) => {
        if (navigationApproved) {
          navigationApproved = false;
          return;
        }
        if (this.id || hasLocalWork()) {
          e.preventDefault();
          e.returnValue = "";
        }
      },
      { signal },
    );
    document.addEventListener(
      "click",
      (event: MouseEvent) => {
        const link = (event.target as Element).closest<HTMLAnchorElement>(
          "a[href]",
        );
        if (
          (!this.id && !hasLocalWork()) ||
          !link ||
          link.hasAttribute("download") ||
          link.target === "_blank" ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.altKey ||
          event.button !== 0 ||
          link.href.startsWith("blob:") ||
          new URL(link.href).pathname === location.pathname
        )
          return;
        if (
          !confirm(
            "ออกจากหน้านี้หรือไม่? งานแปลงและไฟล์ชั่วคราวจะถูกลบ กรุณาดาวน์โหลดไฟล์ก่อนออก",
          )
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        // Cancel only on actual departure. A later navigation guard may keep
        // the page open, in which case the server job must remain alive.
        navigationApproved = true;
      },
      { signal, capture: true },
    );
  }
  leave() {
    if (this.id) {
      const url = `/api/media/${this.id}/leave`;
      if (!navigator.sendBeacon(url, this.token))
        void fetch(url, {
          method: "POST",
          body: this.token,
          keepalive: true,
        }).catch(() => {});
    }
    this.id = undefined;
    this.requestAbort?.abort();
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }
  dispose() {
    this.leave();
    this.lifetime.abort();
  }
  async convert(
    file: File,
    options: MediaOptions,
    status: (text: string) => void,
  ): Promise<Blob> {
    this.leave();
    const id = (this.id = crypto.randomUUID());
    this.token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (v) =>
      v.toString(16).padStart(2, "0"),
    ).join("");
    const controller = (this.requestAbort = new AbortController());
    const request = async (path: string, init: RequestInit = {}) => {
      const r = await fetch(`/api/media/${id}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { Authorization: `Bearer ${this.token}`, ...init.headers },
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(
          body.error || "เชื่อมต่อไม่สำเร็จ กรุณาเลือกไฟล์แล้วลองใหม่",
        );
      }
      return r;
    };
    try {
      status("กำลังเตรียมอัปโหลด…");
      const created = await (
        await request("", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...options, bytes: file.size }),
        })
      ).json();
      this.heartbeat = setInterval(() => {
        void request("/heartbeat", { method: "POST" }).catch(() => {});
      }, 15000);
      let offset = 0;
      while (offset < file.size) {
        status(`กำลังอัปโหลด ${Math.floor((offset / file.size) * 100)}%`);
        let received = offset;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const r = await request(`/chunks?offset=${offset}`, {
              method: "PUT",
              headers: { "Content-Type": "application/octet-stream" },
              body: file.slice(offset, offset + created.chunkSize),
            });
            received = (await r.json()).received;
            break;
          } catch (e) {
            if (controller.signal.aborted || attempt === 2) throw e;
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
        if (received <= offset || received > file.size)
          throw new Error("ส่งไฟล์ไม่ครบ กรุณาเลือกไฟล์ใหม่");
        offset = received;
      }
      await request("/complete", { method: "POST" });
      while (true) {
        const data = await (await request("")).json();
        if (data.state === "ready") {
          status("กำลังรับไฟล์…");
          return await (await request("/result")).blob();
        }
        if (["failed", "expired", "cancelled"].includes(data.state))
          throw new Error(data.error || "งานนี้ปิดแล้ว กรุณาเลือกไฟล์ใหม่");
        status(data.state === "running" ? "กำลังแปลงไฟล์…" : "กำลังรอคิว…");
        await new Promise((r) => setTimeout(r, 2000));
        controller.signal.throwIfAborted();
      }
    } catch (e) {
      this.leave();
      throw e;
    }
  }
}
