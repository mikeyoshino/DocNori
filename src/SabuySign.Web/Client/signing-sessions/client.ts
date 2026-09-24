import { newSecret, hashSecret } from "../signatures/crypto";
import { seal, unseal, validatePlacements } from "./crypto";
import { signatureSvg } from "../signatures/data";
import type { TextItem } from "../editor/session";
type Credentials = {
  id: string;
  key: string;
  token: string;
  invite: string;
  participant: string;
  owner: boolean;
};
type Snapshot = {
  session: {
    closed: boolean;
    owner: boolean;
    revision: number;
    expiresAt: string;
  };
  members: { number: number; signing: boolean; online: boolean }[];
  batches: { id: string; member: number; at: string; data: string }[];
};
type Hooks = {
  document(): Promise<{ bytes: Uint8Array; name: string }>;
  open(file: File): Promise<void>;
  drafts(): TextItem[];
  clear(): void;
  refresh(): void;
  pages(): number;
  pageBounds(page: number): Promise<{ width: number; height: number }>;
  go(page: number): void;
  draw(): void;
};
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const dialog = (id: string) => $<HTMLDialogElement>(id);
const time = (value: string) =>
  new Date(value).toLocaleString("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
export class SigningSession {
  credentials?: Credentials;
  snapshot?: Snapshot;
  confirmed: TextItem[] = [];
  private cache = new Map<string, TextItem[]>();
  private lifetime = new AbortController();
  private pollAbort?: AbortController;
  private heartbeat?: ReturnType<typeof setInterval>;
  private number = 0;
  private pending?: { id: string; bytes: Uint8Array; items: TextItem[] };
  working = false;
  online = false;
  expired = false;
  private unavailable: "deleted" | "expired" | "unknown" | "invalid" =
    "unknown";
  private hadDrafts = false;
  private outcome = "";
  private version = "";
  private notice = "";
  get active() {
    return !!this.credentials;
  }
  get closed() {
    return !!this.snapshot?.session.closed || this.expired;
  }
  get locked() {
    return this.working || !!this.pending || this.closed;
  }
  constructor(private hooks: Hooks) {
    const listen = (id: string, fn: () => void | Promise<void>) =>
      $(id).addEventListener(
        "click",
        () => {
          void this.run(fn);
        },
        { signal: this.lifetime.signal },
      );
    listen("sign-only-me", () => {
      dialog("signing-mode").close();
      hooks.draw();
    });
    listen("sign-with-others", async () => {
      dialog("signing-mode").close();
      dialog("signing-create").showModal();
      $<HTMLButtonElement>("signing-create-confirm").disabled = true;
      const r = await fetch("/api/signing/config");
      if (!(await r.json()).enabled)
        throw new Error("บริการเซ็นร่วมกันยังไม่เปิดใช้งาน");
      $<HTMLButtonElement>("signing-create-confirm").disabled = false;
    });
    listen("signing-create-confirm", () => this.create());
    listen("signing-share", () => this.share());
    listen("signing-copy", async () => {
      await navigator.clipboard.writeText(this.link());
      this.message("คัดลอกลิงก์สำหรับผู้เซ็นแล้ว");
    });
    listen("signing-copy-owner", async () => {
      await navigator.clipboard.writeText(this.ownerLink());
      this.message("คัดลอกลิงก์เจ้าของแล้ว เก็บไว้ส่วนตัว อย่าส่งต่อ");
    });
    listen("signing-submit", () => this.submit());
    listen("signing-finish", () => this.finish());
    listen("signing-delete", () => this.remove());
    listen("signing-outcome-delete", () => this.remove());
    listen("signing-add", () => hooks.draw());
    document.querySelectorAll("[data-close-signing]").forEach((el) =>
      el.addEventListener("click", () => el.closest("dialog")!.close(), {
        signal: this.lifetime.signal,
      }),
    );
    $("signing-email").addEventListener(
      "input",
      () => {
        const email = $<HTMLInputElement>("signing-email");
        const link = $<HTMLAnchorElement>("signing-email-link");
        const valid = email.value.trim() && email.checkValidity();
        link.hidden = !valid;
        if (valid)
          link.href = `mailto:${encodeURIComponent(email.value.trim())}?subject=${encodeURIComponent("เชิญเซ็นเอกสารผ่าน DocNori")}&body=${encodeURIComponent("เปิดลิงก์เพื่ออ่านและเซ็นเอกสาร\n" + this.link())}`;
      },
      { signal: this.lifetime.signal },
    );
  }
  choose() {
    if (this.active) this.hooks.draw();
    else dialog("signing-mode").showModal();
  }
  private async run(fn: () => void | Promise<void>) {
    try {
      await fn();
    } catch (e) {
      this.message(
        e instanceof Error ? e.message : "เกิดข้อผิดพลาด กรุณาลองใหม่",
        true,
      );
    }
  }
  private message(text: string, error = false) {
    this.notice = text;
    for (const id of [
      "signing-message",
      "signing-outcome-message",
      "signing-dialog-message",
      "signing-create-message",
    ]) {
      $(id).textContent = text;
      $(id).classList.toggle("signing-error", error);
    }
  }
  private async request(path: string, init: RequestInit = {}) {
    const c = this.credentials!;
    const response = await fetch(`/api/signing/${c.id}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${c.token}`,
        "X-Participant": c.participant,
        ...init.headers,
      },
      signal: init.signal ?? this.lifetime.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      if (response.status === 404) {
        this.unavailable = this.snapshot
          ? Date.now() >= Date.parse(this.snapshot.session.expiresAt)
            ? "expired"
            : "deleted"
          : "unknown";
        this.expired = true;
        this.update();
        throw new Error(
          "ลิงก์หมดอายุ ถูกปิด หรือไม่ถูกต้อง เอกสารนี้ไม่เปิดให้ใช้งานแล้ว",
        );
      }
      throw new Error(
        response.status === 409
          ? "เอกสารมีการเปลี่ยนแปลงหรือปิดรับแล้ว กรุณารอสถานะล่าสุดแล้วลองอีกครั้ง"
          : response.status === 429
            ? "มีผู้ใช้งานจำนวนมาก กรุณารอสักครู่"
            : response.status === 413
              ? "ข้อมูลเกินขนาดที่รองรับ กรุณาลดจำนวนจุดในชุดนี้"
              : "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่",
      );
    }
    return response;
  }
  link() {
    const c = this.credentials!;
    return `${location.origin}/sign-together#v1.${c.id}.${c.key}.${c.invite}`;
  }
  private ownerLink() {
    const c = this.credentials!;
    return `${location.origin}/sign-together#owner.${c.id}.${c.key}.${c.token}.${c.invite}`;
  }
  private save() {
    sessionStorage.setItem(
      `docnori-signing:${this.credentials!.id}`,
      JSON.stringify(this.credentials),
    );
  }
  async restore() {
    if (location.pathname != "/sign-together") return;
    document.documentElement.classList.add("signing-terminal");
    $("signing-loading").hidden = false;
    try {
      const parts = location.hash.slice(1).split(".");
      const id = new URLSearchParams(location.search).get("session");
      if (
        (parts[0] === "v1" && parts.length === 4) ||
        (parts[0] === "owner" && parts.length === 5)
      ) {
        if (
          !/^[0-9a-f-]{36}$/i.test(parts[1]) ||
          parts.slice(2).some((p) => !/^[\w-]{43}$/.test(p))
        )
          throw new Error("ลิงก์ไม่ถูกต้อง");
        this.credentials = {
          id: parts[1],
          key: parts[2],
          token: parts[3],
          invite: parts[0] === "owner" ? parts[4] : parts[3],
          participant: newSecret(),
          owner: parts[0] === "owner",
        };
        const old = sessionStorage.getItem(`docnori-signing:${parts[1]}`);
        if (old) {
          const c = JSON.parse(old) as Credentials;
          if (c.token === parts[3])
            this.credentials.participant = c.participant;
        }
        this.save();
        history.replaceState(null, "", `/sign-together?session=${parts[1]}`);
      } else if (id) {
        const saved = sessionStorage.getItem(`docnori-signing:${id}`);
        if (saved) this.credentials = JSON.parse(saved) as Credentials;
      }
      if (!this.credentials)
        throw new Error("กรุณาเปิดลิงก์เชิญฉบับเต็มอีกครั้ง");
      const c = this.credentials;
      const r = await this.request("/document");
      const bytes = await unseal(
        new Uint8Array(await r.arrayBuffer()),
        c.key,
        `${c.id}/document`,
      );
      // Filename is encrypted with the document, never stored as clear metadata.
      const length = new DataView(bytes.buffer).getUint32(0);
      if (length > 1024 || length + 4 >= bytes.length)
        throw new Error("ข้อมูลเอกสารไม่ถูกต้อง");
      const name = new TextDecoder().decode(bytes.slice(4, 4 + length));
      await this.hooks.open(
        new File([bytes.slice(4 + length).buffer], name, {
          type: "application/pdf",
        }),
      );
      await this.start();
    } catch (e) {
      if (!this.expired) this.unavailable = "invalid";
      this.expired = true;
      $("signing-loading").hidden = true;
      this.message(e instanceof Error ? e.message : "เปิดเอกสารไม่ได้", true);
      $("signing-loading-text").textContent =
        "เปิดเอกสารไม่ได้ กรุณาตรวจสอบลิงก์หรือขอลิงก์จากเจ้าของอีกครั้ง";
      this.update();
      return;
    }
    $("signing-loading").hidden = true;
  }
  private async create() {
    if (this.working) return;
    this.working = true;
    $("signing-create-confirm").setAttribute("disabled", "");
    try {
      const document = await this.hooks.document();
      if (document.bytes.length > 25 * 1024 * 1024)
        throw new Error("รองรับไฟล์ไม่เกิน 25 MB");
      const c: Credentials = {
        id: crypto.randomUUID(),
        key: newSecret(),
        token: newSecret(),
        invite: newSecret(),
        participant: newSecret(),
        owner: true,
      };
      const name = new TextEncoder().encode(document.name.slice(0, 200));
      const bytes = new Uint8Array(4 + name.length + document.bytes.length);
      new DataView(bytes.buffer).setUint32(0, name.length);
      bytes.set(name, 4);
      bytes.set(document.bytes, 4 + name.length);
      const encrypted = await seal(bytes, c.key, `${c.id}/document`);
      const response = await fetch(`/api/signing/${c.id}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${c.token}`,
          "X-Invite-Hash": await hashSecret(c.invite),
          "Content-Type": "application/octet-stream",
        },
        body: encrypted.slice().buffer,
        signal: this.lifetime.signal,
      });
      if (!response.ok) throw new Error("สร้าง session ไม่สำเร็จ กรุณาลองใหม่");
      this.credentials = c;
      this.save();
      await this.hooks.open(
        new File([document.bytes.slice().buffer], document.name, {
          type: "application/pdf",
        }),
      );
      history.replaceState(null, "", `/sign-together?session=${c.id}`);
      dialog("signing-create").close();
      await this.start();
      this.share();
    } finally {
      this.working = false;
      $("signing-create-confirm").removeAttribute("disabled");
      this.update();
    }
  }
  private async start() {
    await this.sync();
    if (!this.closed) {
      this.number = (
        await (await this.request("/join", { method: "POST" })).json()
      ).number;
    }
    this.online = true;
    this.heartbeat = setInterval(() => {
      this.update();
      void this.presence();
    }, 12000);
    void this.presence();
    void this.poll();
    this.update();
  }
  private async presence() {
    if (!this.number || this.expired) return;
    try {
      await this.request("/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signing:
            !this.closed &&
            (this.hooks.drafts().length > 0 ||
              !!document.querySelector(
                "#signature-desktop[open],#signature-phone[open]",
              )),
        }),
      });
    } catch {
      /* State polling owns connection feedback. */
    }
  }
  private async sync(signal?: AbortSignal, long = false) {
    const r = await this.request("/state", {
      headers: long ? { "X-State-Version": this.version } : {},
      signal,
    });
    const snapshot = (await r.json()) as Snapshot;
    // A slower response must never roll back a newer confirmed snapshot.
    if (
      this.snapshot &&
      snapshot.session.revision < this.snapshot.session.revision
    )
      return;
    const items: TextItem[] = [];
    for (const batch of snapshot.batches) {
      let parsed = this.cache.get(batch.id);
      if (!parsed) {
        const plain = await unseal(
          new Uint8Array(
            await (
              await this.request(`/batches/${batch.id}`, { signal })
            ).arrayBuffer(),
          ),
          this.credentials!.key,
          `${this.credentials!.id}/batch/${batch.id}`,
        );
        parsed = validatePlacements(
          JSON.parse(new TextDecoder().decode(plain)),
          this.hooks.pages(),
        );
        for (const [i, p] of parsed.entries()) {
          const bounds = await this.hooks.pageBounds(p.page);
          if (
            p.x + p.width > bounds.width + 0.1 ||
            p.y + p.height > bounds.height + 0.1
          )
            throw new Error("ลายเซ็นอยู่นอกหน้าเอกสาร");
          p.id = `confirmed-${batch.id}-${i}`;
        }
        this.cache.set(batch.id, parsed);
      }
      items.push(...parsed);
    }
    if (
      this.snapshot &&
      snapshot.session.revision < this.snapshot.session.revision
    )
      return;
    this.version = r.headers.get("X-State-Version") ?? "";
    const changed =
      this.snapshot?.session.revision !== snapshot.session.revision;
    if (snapshot.session.closed && !this.snapshot?.session.closed) {
      this.hadDrafts = this.hooks.drafts().length > 0;
      this.hooks.clear();
      this.pending = undefined;
    }
    this.snapshot = snapshot;
    this.confirmed = items;
    this.online = true;
    if (changed) this.hooks.refresh();
    this.update();
  }
  private async poll() {
    this.pollAbort = new AbortController();
    while (!this.lifetime.signal.aborted && !this.expired) {
      try {
        await this.sync(this.pollAbort.signal, true);
      } catch (e) {
        if (this.lifetime.signal.aborted) return;
        this.online = false;
        this.update();
        if (this.expired) break;
        this.message(
          e instanceof Error ? e.message : "กำลังเชื่อมต่อใหม่…",
          true,
        );
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }
  share() {
    if (!this.active) return;
    $<HTMLInputElement>("signing-share-link").value = this.link();
    $("signing-copy-owner").hidden = !this.credentials?.owner;
    dialog("signing-share-dialog").showModal();
  }

  private confirm(
    title: string,
    description: string,
    action: string,
  ): Promise<boolean> {
    const modal = dialog("signing-confirm");
    $("signing-confirm-title").textContent = title;
    $("signing-confirm-description").textContent = description;
    $("signing-confirm-accept").textContent = action;
    return new Promise((resolve) => {
      let accepted = false;
      const events = new AbortController();
      $("signing-confirm-accept").addEventListener(
        "click",
        () => {
          accepted = true;
          modal.close();
        },
        { signal: events.signal },
      );
      for (const id of ["signing-confirm-cancel", "signing-confirm-close"])
        $(id).addEventListener("click", () => modal.close(), {
          signal: events.signal,
        });
      modal.addEventListener(
        "close",
        () => {
          events.abort();
          resolve(accepted);
        },
        { once: true },
      );
      modal.showModal();
    });
  }
  private async submit() {
    if (this.working || this.closed) return;
    const drafts = this.pending?.items ?? this.hooks.drafts();
    if (!drafts.length) return;
    if (!this.pending) {
      if (drafts.length > 50)
        throw new Error(
          "ยืนยันได้ครั้งละไม่เกิน 50 จุด กรุณาลดจำนวนจุดในชุดนี้",
        );
      validatePlacements(drafts, this.hooks.pages());
      for (const placement of drafts) {
        const bounds = await this.hooks.pageBounds(placement.page);
        if (
          placement.x + placement.width > bounds.width + 0.1 ||
          placement.y + placement.height > bounds.height + 0.1
        )
          throw new Error(
            "มีลายเซ็นอยู่นอกหน้าเอกสาร กรุณาย้ายกลับเข้ามาก่อนยืนยัน",
          );
      }

      const overlaps = drafts.some((a) =>
        this.confirmed.some(
          (b) =>
            a.page === b.page &&
            a.x < b.x + b.width &&
            a.x + a.width > b.x &&
            a.y < b.y + b.height &&
            a.y + a.height > b.y,
        ),
      );
      const pages = [...new Set(drafts.map((i) => i.page + 1))]
        .sort((a, b) => a - b)
        .join(", ");
      if (
        !(await this.confirm(
          "ยืนยันลายเซ็น",
          `${overlaps ? "มีลายเซ็นซ้อนกับตำแหน่งที่ยืนยันแล้ว กรุณาตรวจสอบ\n\n" : ""}ยืนยันลายเซ็น ${drafts.length} จุด บนหน้า ${pages}? หลังยืนยันจะย้ายหรือลบไม่ได้`,
          "ยืนยันลายเซ็น",
        ))
      )
        return;
    }
    this.working = true;
    this.update();
    try {
      if (!this.pending) {
        const id = crypto.randomUUID();
        this.pending = {
          id,
          items: drafts,
          bytes: await seal(
            new TextEncoder().encode(JSON.stringify(drafts)),
            this.credentials!.key,
            `${this.credentials!.id}/batch/${id}`,
          ),
        };
      }
      if (this.pending.bytes.length > 524288) {
        this.pending = undefined;
        throw new Error("ลายเซ็นชุดนี้มีรายละเอียดมากเกินไป กรุณาลดจำนวนจุด");
      }
      await this.request(`/batches/${this.pending.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: this.pending.bytes.slice().buffer,
      });
      this.hooks.clear();
      this.pending = undefined;
      this.hooks.refresh();
      await this.sync();
      this.message("ยืนยันลายเซ็นแล้ว ทุกคนเห็นลายเซ็นของคุณได้");
      void this.presence();
    } finally {
      this.working = false;
      this.update();
    }
  }
  private async finish() {
    if (!this.credentials?.owner || this.working || this.closed) return;
    await this.sync();
    const revision = this.snapshot!.session.revision;
    const pending = this.snapshot!.members.some((m) => m.signing);
    if (
      !(await this.confirm(
        "จบการเซ็นเอกสาร",
        `${pending ? "ยังมีผู้เข้าร่วมกำลังเซ็นอยู่\n\n" : ""}จบการเซ็น? ทุกคนจะเซ็นเพิ่มไม่ได้ และดาวน์โหลดเอกสารได้อีก 24 ชั่วโมง`,
        "จบการเซ็น",
      ))
    )
      return;
    this.working = true;
    this.update();
    try {
      await this.request("/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision }),
      });
      await this.sync();
      this.message("ปิดรับลายเซ็นแล้ว ดาวน์โหลดฉบับสุดท้ายได้ภายใน 24 ชั่วโมง");
    } finally {
      this.working = false;
      this.update();
    }
  }
  private async remove() {
    if (!this.credentials?.owner || this.working) return;
    if (
      !(await this.confirm(
        "ลบเอกสารและปิด session",
        "ลิงก์ของทุกคนจะใช้งานไม่ได้ และกู้คืนไม่ได้ กรุณาตรวจสอบว่าทุกคนดาวน์โหลดเอกสารแล้ว",
        "ลบเอกสาร",
      ))
    )
      return;
    this.working = true;
    this.update();
    try {
      await this.request("", { method: "DELETE" });
      sessionStorage.removeItem(`docnori-signing:${this.credentials.id}`);
      this.expired = true;
      this.hooks.clear();
      this.dispose();
      location.replace("/tools/fill-sign");
    } catch (e) {
      this.working = false;
      this.update();
      throw e;
    }
  }
  update() {
    if (
      this.snapshot &&
      Date.now() >= Date.parse(this.snapshot.session.expiresAt)
    ) {
      this.unavailable = "expired";
      this.expired = true;
    }
    if (this.expired && this.hooks.drafts().length) this.hadDrafts = true;
    this.renderOutcome();
    document.documentElement.classList.toggle("shared-signing", this.active);
    document.documentElement.classList.toggle(
      "shared-signing-closed",
      this.closed,
    );
    $("signing-panel").hidden = !this.active;
    if (!this.active) return;
    const snapshot = this.snapshot,
      drafts = this.hooks.drafts();
    $("signing-state").textContent = this.expired
      ? "session ปิดแล้ว"
      : this.closed
        ? "พร้อมดาวน์โหลด"
        : this.online
          ? "เปิดรับลายเซ็น"
          : "กำลังเชื่อมต่อใหม่…";
    $("signing-identity").textContent = this.credentials?.owner
      ? "คุณเป็นเจ้าของเอกสาร"
      : this.number
        ? `คุณคือผู้เซ็น ${this.number}`
        : "ผู้รับเอกสาร";
    $("signing-expiry").textContent = snapshot
      ? `${this.closed ? "ดาวน์โหลดได้ถึง" : "เปิดรับถึง"} ${time(snapshot.session.expiresAt)}`
      : "";
    const button = $<HTMLButtonElement>("signing-submit");
    button.disabled =
      this.working ||
      this.closed ||
      (!drafts.length && !this.pending) ||
      !this.online;
    button.textContent = this.working
      ? "กำลังบันทึก…"
      : this.pending
        ? "ลองยืนยันอีกครั้ง"
        : `ยืนยันลายเซ็น · ${drafts.length} จุด`;
    $<HTMLButtonElement>("signing-add").disabled = this.locked;
    $("signing-finish").hidden = !this.credentials?.owner || this.closed;
    $<HTMLButtonElement>("signing-finish").disabled =
      this.working || !this.online || !snapshot?.batches.length;
    $("signing-delete").hidden = !this.credentials?.owner || this.expired;
    $("signing-share").hidden = this.expired;
    $("signing-pending").textContent = drafts.length
      ? `รอยืนยัน ${drafts.length} จุด · หน้า ${[...new Set(drafts.map((x) => x.page + 1))].join(", ")}`
      : "วางลายเซ็นได้ทุกหน้าและทุกตำแหน่ง";
    const points = $("signing-points");
    const pointKey = drafts.map((p) => `${p.id}:${p.page}`).join(",");
    if (points.dataset.key !== pointKey) {
      points.dataset.key = pointKey;
      points.replaceChildren();
      drafts.forEach((item, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "button button-quiet";
        button.textContent = `จุด ${index + 1} · หน้า ${item.page + 1}`;
        button.onclick = () => this.hooks.go(item.page);
        points.append(button);
      });
    }
    document
      .querySelectorAll<HTMLElement>("#thumbnails button")
      .forEach((button, page) => {
        const count = this.confirmed.filter((p) => p.page === page).length;
        let badge = button.querySelector<HTMLElement>(".signing-page-count");
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "signing-page-count";
          button.append(badge);
        }
        badge.hidden = !count;
        badge.textContent = `${count} ลายเซ็น`;
      });
    const root = $("signing-activity");
    root.replaceChildren();
    for (const member of snapshot?.members ?? []) {
      const row = document.createElement("div");
      row.className = "signing-member";
      const name = document.createElement("strong");
      name.textContent = `ผู้เซ็น ${member.number}${member.number === this.number ? " (คุณ)" : ""}`;
      const detail = document.createElement("span");
      const batches = snapshot!.batches.filter(
        (b) => b.member === member.number,
      );
      const count = batches.reduce(
        (n, b) => n + (this.cache.get(b.id)?.length ?? 0),
        0,
      );
      detail.textContent =
        member.signing && !this.closed
          ? "กำลังเซ็น…"
          : count
            ? `ยืนยันแล้ว ${count} จุด · ${time(batches.at(-1)!.at)}`
            : member.online
              ? "กำลังดูเอกสาร"
              : "ยังไม่ได้เซ็น";
      row.append(name, detail);
      root.append(row);
    }
    if (this.expired) {
      this.confirmed = [];
      this.hooks.clear();
      $("page-surface").hidden = true;
    }
    // One live status region; never move the user's scroll position or keyboard focus.
    $("signing-live").textContent = this.expired
      ? "session นี้ปิดแล้ว"
      : `${snapshot?.members.filter((m) => m.online).length ?? 0} คนออนไลน์ · ยืนยันแล้ว ${this.confirmed.length} จุด`;
  }
  private renderOutcome() {
    const terminal = this.expired || !!this.snapshot?.session.closed;
    document.documentElement.classList.toggle("signing-terminal", terminal);
    $("signing-outcome").hidden = !terminal;
    if (!terminal) return;
    $("signing-loading").hidden = true;
    const state = this.expired ? this.unavailable : "closed";
    const titles = {
      closed: "เอกสารพร้อมดาวน์โหลด",
      deleted: "เจ้าของลบเอกสารนี้แล้ว",
      expired: "ลิงก์เอกสารหมดอายุแล้ว",
      unknown: "เอกสารนี้ไม่พร้อมใช้งานแล้ว",
      invalid: "เปิดเอกสารไม่ได้",
    };
    $("signing-outcome-title").textContent = titles[state];
    $("signing-outcome-description").textContent =
      state === "closed"
        ? "ปิดรับลายเซ็นแล้ว ดาวน์โหลดเอกสารพร้อมลายเซ็นที่ยืนยันเรียบร้อยแล้วได้ที่นี่"
        : state === "deleted"
          ? "เอกสารถูกลบแล้ว ลิงก์นี้ไม่สามารถเปิดหรือดาวน์โหลดเอกสารได้อีก"
          : state === "expired"
            ? "เอกสารหมดอายุแล้ว กรุณาติดต่อเจ้าของเพื่อขอลิงก์ใหม่"
            : "กรุณาตรวจสอบลิงก์ หรือติดต่อเจ้าของเอกสารเพื่อขอลิงก์ใหม่";
    $("signing-outcome-download").hidden = this.expired;
    $("signing-outcome-delete").hidden =
      this.expired || !this.credentials?.owner;
    $<HTMLButtonElement>("signing-outcome-delete").disabled = this.working;
    $("signing-outcome-drafts").hidden = !this.hadDrafts;
    $("signing-outcome-expiry").textContent =
      !this.expired && this.snapshot
        ? `ดาวน์โหลดได้ถึง ${time(this.snapshot.session.expiresAt)}`
        : "";
    if (this.outcome !== state) {
      this.outcome = state;
      document
        .querySelectorAll<HTMLDialogElement>("dialog[open]")
        .forEach((d) => d.close());
      $("signing-outcome-title").focus();
    }
  }
  render(root: HTMLElement, page: number, zoom: number) {
    for (const item of this.confirmed.filter((i) => i.page === page)) {
      const el = document.createElement("div");
      el.className = "confirmed-signature";
      el.setAttribute("aria-label", "ลายเซ็นที่ยืนยันแล้ว");
      Object.assign(el.style, {
        left: `${item.x * zoom}px`,
        top: `${item.y * zoom}px`,
        width: `${item.width * zoom}px`,
        height: `${item.height * zoom}px`,
      });
      const img = document.createElement("img");
      img.src = `data:image/svg+xml,${encodeURIComponent(signatureSvg(item.signature!))}`;
      img.alt = "ลายเซ็นที่ยืนยันแล้ว";
      img.draggable = false;
      el.append(img);
      root.append(el);
    }
  }
  dispose() {
    this.lifetime.abort();
    this.pollAbort?.abort();
    clearInterval(this.heartbeat);
    document.documentElement.classList.remove(
      "shared-signing",
      "shared-signing-closed",
      "signing-terminal",
    );
  }
}
