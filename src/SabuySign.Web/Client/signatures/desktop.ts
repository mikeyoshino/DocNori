import QRCode from "qrcode";
import { SignaturePad } from "./pad";
import { signatureSvg, type SignatureData } from "./data";
import { newSecret, hashSecret, decryptSignature } from "./crypto";
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const dialog = (id: string) => $<HTMLDialogElement>(id);
export class Signatures {
  private assets = new Map<string, SignatureData>();
  private pad: SignaturePad;
  private abort = new AbortController();
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private pair?: { id: string; owner: string };
  constructor(private place: (id: string) => void) {
    const { signal } = this.abort;
    this.pad = new SignaturePad($("desktop-pad"), () => {
      $<HTMLButtonElement>("desktop-save").disabled = this.pad.empty;
    });
    $("sign-desktop").addEventListener(
      "click",
      () => {
        dialog("signature-source").close();
        this.pad.clear();
        $("desktop-sign-error").textContent = "";
        dialog("signature-desktop").showModal();
      },
      { signal },
    );
    $("sign-phone").addEventListener(
      "click",
      () => {
        dialog("signature-source").close();
        dialog("signature-phone").showModal();
        void this.startPair();
      },
      { signal },
    );
    $("desktop-undo").addEventListener("click", () => this.pad.undo(), {
      signal,
    });
    $("desktop-clear").addEventListener("click", () => this.pad.clear(), {
      signal,
    });
    $("desktop-save").addEventListener(
      "click",
      () => {
        try {
          this.add(this.pad.save());
          this.pad.clear();
          dialog("signature-desktop").close();
        } catch (e) {
          $("desktop-sign-error").textContent = (e as Error).message;
        }
      },
      { signal },
    );
    document.querySelectorAll("[data-close-signature]").forEach((el) =>
      el.addEventListener("click", () => el.closest("dialog")!.close(), {
        signal,
      }),
    );
    dialog("signature-phone").addEventListener("close", () => this.stopPair(), {
      signal,
    });
    dialog("signature-desktop").addEventListener(
      "close",
      () => this.pad.clear(),
      { signal },
    );
    $("pair-retry").addEventListener("click", () => void this.startPair(), {
      signal,
    });
    this.render();
  }
  create() {
    dialog("signature-source").showModal();
  }
  get count() {
    return this.assets.size;
  }
  get(id: string) {
    return this.assets.get(id);
  }
  private add(data: SignatureData) {
    this.assets.set(crypto.randomUUID(), data);
    this.render();
  }
  private render() {
    const root = $("signature-library");
    root.replaceChildren();
    if (!this.assets.size) {
      const p = document.createElement("p");
      p.className = "field-help";
      p.textContent = "สร้างลายเซ็น แล้วลากมาวางบนเอกสาร";
      root.append(p);
      return;
    }
    let n = 0;
    for (const [id, data] of this.assets) {
      const row = document.createElement("div");
      row.className = "signature-card";
      const button = document.createElement("button");
      button.className = "signature-thumbnail";
      button.draggable = true;
      button.setAttribute("aria-label", `วางลายเซ็น ${++n}`);
      const img = document.createElement("img");
      img.src = `data:image/svg+xml,${encodeURIComponent(signatureSvg(data))}`;
      img.alt = `ลายเซ็น ${n}`;
      img.draggable = false;
      button.append(img);
      button.onclick = () => this.place(id);
      button.ondragstart = (e) => {
        e.dataTransfer!.setData("application/x-sabuysign-signature", id);
        e.dataTransfer!.effectAllowed = "copy";
      };
      const remove = document.createElement("button");
      remove.className = "tool";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `ลบลายเซ็น ${n} จากคลัง`);
      remove.onclick = () => {
        this.assets.delete(id);
        this.render();
      };
      row.append(button, remove);
      root.append(row);
    }
  }
  private stopPair() {
    this.generation++;
    clearTimeout(this.timer);
    if (this.pair) {
      const { id, owner } = this.pair;
      void fetch(`/api/pairing/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${owner}` },
        keepalive: true,
      }).catch(() => {});
      this.pair = undefined;
    }
    $("pair-link").hidden = true;
    $<HTMLAnchorElement>("pair-link").removeAttribute("href");
    const canvas = $<HTMLCanvasElement>("signature-qr");
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    canvas.hidden = true;
  }
  private async startPair() {
    this.stopPair();
    const generation = this.generation;
    const status = $("pair-status");
    status.textContent = "กำลังสร้าง QR…";
    $("pair-origin-note").textContent =
      location.hostname === "localhost" || location.hostname === "127.0.0.1"
        ? "กำลังใช้ localhost: มือถือเปิดที่อยู่นี้ไม่ได้ ต้องเปิดเว็บผ่าน HTTPS ที่ทั้งสองเครื่องเข้าถึงได้ ลิงก์ด้านล่างใช้ทดสอบในเครื่องนี้ได้"
        : "มือถือและคอมต้องเข้าถึงที่อยู่เว็บนี้ผ่าน HTTPS ได้";
    try {
      if (!crypto.subtle)
        throw new Error("ต้องเปิดเว็บผ่าน HTTPS เพื่อเข้ารหัสลายเซ็น");
      const owner = newSecret(),
        writer = newSecret(),
        key = newSecret();
      const response = await fetch("/api/pairing", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${owner}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ writerHash: await hashSecret(writer) }),
      });
      if (!response.ok)
        throw new Error("เชื่อมต่อบริการลายเซ็นไม่ได้ กรุณาลองใหม่");
      const pair = (await response.json()) as { id: string; expiresAt: string };
      if (generation !== this.generation) {
        void fetch(`/api/pairing/${pair.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${owner}` },
        });
        return;
      }
      this.pair = { id: pair.id, owner };
      const url = `${location.origin}/sign#v1.${pair.id}.${key}.${writer}`;
      await QRCode.toCanvas($<HTMLCanvasElement>("signature-qr"), url, {
        width: 256,
        margin: 2,
        errorCorrectionLevel: "M",
      });
      if (generation !== this.generation) return;
      $("signature-qr").hidden = false;
      const link = $<HTMLAnchorElement>("pair-link");
      link.href = url;
      link.hidden = false;
      status.textContent = "รอรับลายเซ็นจากมือถือ · QR ใช้ได้ 5 นาที";
      let added = false;
      const poll = async () => {
        if (generation !== this.generation) return;
        if (Date.now() >= Date.parse(pair.expiresAt)) {
          this.stopPair();
          status.textContent = "QR หมดอายุแล้ว กดสร้าง QR ใหม่";
          return;
        }
        try {
          if (added) {
            const ack = await fetch(`/api/pairing/${pair.id}/ack`, {
              method: "POST",
              headers: { Authorization: `Bearer ${owner}` },
            });
            if (generation !== this.generation) return;
            if (ack.ok) {
              this.pair = undefined;
              dialog("signature-phone").close();
              return;
            }
            if (ack.status === 404) {
              this.pair = undefined;
              dialog("signature-phone").close();
              return;
            }
          } else {
            const result = await fetch(`/api/pairing/${pair.id}/signature`, {
              headers: { Authorization: `Bearer ${owner}` },
            });
            if (generation !== this.generation) return;
            if (result.status === 200) {
              const data = await decryptSignature(
                new Uint8Array(await result.arrayBuffer()),
                key,
                pair.id,
              );
              if (generation !== this.generation) return;
              this.add(data);
              added = true;
              status.textContent = "บันทึกลายเซ็นแล้ว กำลังยืนยันการรับ…";
            } else if (result.status === 404 || result.status === 410) {
              this.stopPair();
              status.textContent = "ลิงก์นี้ใช้ไม่ได้แล้ว กรุณาสร้าง QR ใหม่";
              return;
            }
          }
        } catch {
          if (generation === this.generation)
            status.textContent = added
              ? "บันทึกลายเซ็นแล้ว กำลังยืนยันการรับ…"
              : "กำลังลองเชื่อมต่อใหม่…";
        }
        if (generation === this.generation)
          this.timer = setTimeout(() => void poll(), 1000);
      };
      void poll();
    } catch (e) {
      if (generation === this.generation)
        status.textContent = (e as Error).message;
    }
  }
  reset() {
    this.stopPair();
    this.assets.clear();
    this.pad.clear();
    this.render();
    for (const id of [
      "signature-source",
      "signature-desktop",
      "signature-phone",
    ])
      dialog(id).close();
  }
  dispose() {
    this.reset();
    this.abort.abort();
    this.pad.dispose();
  }
}
