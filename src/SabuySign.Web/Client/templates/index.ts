import { api, post, escape, button, confirmAction } from "./api";
import { account } from "./accounts";
import { workbench } from "./workbench";
import { validatePdf } from "../editor/pdf";
import { unlockPdf } from "../editor/password";
import type { Template } from "./model";
const sessions = new WeakMap<HTMLElement, AbortController>();
export function dispose(root: HTMLElement) {
  sessions.get(root)?.abort();
  sessions.delete(root);
}
export async function init(root: HTMLElement) {
  dispose(root);
  const life = new AbortController();
  sessions.set(root, life);
  const { signal } = life;
  window.addEventListener("pagehide", () => life.abort(), { signal });
  try {
    const path = location.pathname;
    if (path.startsWith("/account/")) {
      await account(root, path.split("/")[2]);
      return;
    }
    const me = await api("/api/account/me");
    if (!me.available) {
      root.innerHTML =
        '<section class="workspace-empty"><h1>แม่แบบเอกสาร</h1><p>ระบบสมาชิกยังไม่พร้อมใช้งาน กรุณากลับมาอีกครั้ง</p></section>';
      return;
    }
    if (!me.authenticated) {
      location.replace("/account/login?returnUrl=" + encodeURIComponent(path));
      return;
    }
    const bar = document.createElement("div");
    bar.className = "workspace-user";
    bar.innerHTML = `<span>${escape(me.email)}</span>`;
    bar.append(
      button("ออกจากระบบ", async () => {
        if (
          await confirmAction(
            "ออกจากระบบ?",
            "กรุณาบันทึกแม่แบบและดาวน์โหลดเอกสารก่อนออกจากระบบ",
          )
        ) {
          try {
            await post("/api/account/logout");
            life.abort();
            location.assign("/account/login");
          } catch (error) {
            const message = document.createElement("p");
            message.setAttribute("role", "status");
            message.textContent = (error as Error).message;
            bar.append(message);
          }
        }
      }),
    );
    if (me.verified && me.googleEnabled && !me.googleLinked) {
      const form = document.createElement("form");
      form.method = "POST";
      form.action = "/api/account/google/link";
      const csrf = await api<{ token: string }>("/api/account/csrf");
      const hidden = document.createElement("input");
      hidden.type = "hidden";
      hidden.name = "__RequestVerificationToken";
      hidden.value = csrf.token;
      const connect = document.createElement("button");
      connect.type = "submit";
      connect.className = "button button-quiet";
      connect.textContent = "เชื่อมบัญชี Google";
      form.append(hidden, connect);
      bar.append(form);
    }
    root.before(bar);
    signal.addEventListener("abort", () => bar.remove(), { once: true });
    if (!me.verified) {
      root.innerHTML =
        '<section class="account-card"><h1>ยืนยันอีเมลก่อนเริ่มใช้งาน</h1><p>เปิดลิงก์ที่ส่งไปทางอีเมลเพื่อเริ่มเก็บแม่แบบ</p><p data-message role="status"></p></section>';
      root.firstElementChild!.append(
        button("ส่งอีเมลยืนยันอีกครั้ง", async () => {
          try {
            await post("/api/account/resend");
            root.querySelector("[data-message]")!.textContent =
              "ส่งคำขอแล้ว กรุณาตรวจอีเมล";
          } catch (e) {
            root.querySelector("[data-message]")!.textContent = (
              e as Error
            ).message;
          }
        }),
      );
      return;
    }
    const parts = path.split("/");
    if (parts[3] && parts[3] !== "new") {
      await workbench(root, parts[3], parts[4] === "edit", signal);
      return;
    }
    if (parts[3] === "new") {
      await upload(root, signal);
      return;
    }
    await listing(root, signal);
  } catch (e) {
    if (signal.aborted) return;
    root.innerHTML = `<section class="workspace-empty"><h1>เปิดพื้นที่ทำงานไม่สำเร็จ</h1><p>${escape((e as Error).message)}</p><a href="/workspace/templates" class="button button-blue">ลองอีกครั้ง</a></section>`;
  }
}
async function listing(root: HTMLElement, signal: AbortSignal) {
  const entries = await api<Template[]>("/api/templates");
  root.innerHTML =
    '<header class="workspace-heading"><div><span class="workspace-eyebrow">พื้นที่ของฉัน</span><h1>แม่แบบเอกสาร</h1><p>เตรียมครั้งเดียว กรอกข้อมูลแล้วใช้ซ้ำได้</p></div><a class="button button-blue" href="/workspace/templates/new">＋ สร้างแม่แบบ</a></header><label class="template-search">ค้นหาแม่แบบ<input type="search" placeholder="ชื่อแม่แบบ" data-search></label><p data-message role="status"></p><div class="template-list"></div>';
  const grid = root.querySelector<HTMLElement>(".template-list")!;
  const message = root.querySelector("[data-message]")!;
  const render = (query = "") => {
    grid.replaceChildren();
    for (const t of entries.filter((t) =>
      t.name.toLowerCase().includes(query.toLowerCase()),
    )) {
      const card = document.createElement("article");
      card.className = "template-card";
      card.innerHTML = `<div class="template-card-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5"/></svg></div><h2>${escape(t.name)}</h2><p class="muted">ฉบับที่ ${t.version}</p><a class="button button-blue" href="/workspace/templates/${t.id}/fill">กรอกข้อมูล</a><div class="template-card-actions"><a href="/workspace/templates/${t.id}/edit">แก้ไข</a></div>`;
      const actions = card.querySelector(".template-card-actions")!;
      actions.append(
        button("ทำสำเนา", async () => {
          try {
            const copy = await post(`/api/templates/${t.id}/duplicate`);
            entries.unshift(copy);
            render();
          } catch (e) {
            message.textContent = (e as Error).message;
          }
        }),
        button("ลบ", async () => {
          if (
            !(await confirmAction(
              "ลบแม่แบบนี้?",
              `“${t.name}” จะถูกลบออกจากบัญชี`,
            ))
          )
            return;
          try {
            await api(`/api/templates/${t.id}`, { method: "DELETE" });
            entries.splice(
              entries.findIndex((x) => x.id === t.id),
              1,
            );
            render();
          } catch (e) {
            message.textContent = (e as Error).message;
          }
        }),
      );
      grid.append(card);
    }
    if (!grid.children.length)
      grid.innerHTML = `<section class="workspace-empty"><h2>${entries.length ? "ไม่พบแม่แบบที่ค้นหา" : "สร้างแม่แบบแรกของคุณ"}</h2><p>${entries.length ? "ลองค้นหาด้วยชื่ออื่น" : "เริ่มจาก PDF ที่ใช้บ่อย เช่น สัญญาจ้างหรือหนังสือรับรอง"}</p>${entries.length ? "" : '<a class="button button-blue" href="/workspace/templates/new">สร้างแม่แบบ</a>'}</section>`;
  };
  render();
  root
    .querySelector("input")!
    .addEventListener(
      "input",
      (e) => render((e.target as HTMLInputElement).value),
      { signal },
    );
}
async function upload(root: HTMLElement, signal: AbortSignal) {
  const limits = await api("/api/templates/limits");
  root.innerHTML = `<section class="template-upload"><a class="workspace-back" href="/workspace/templates">← แม่แบบของฉัน</a><h1>สร้างแม่แบบเอกสาร</h1><p>เลือก PDF แล้วกำหนดช่องข้อมูลที่ต้องกรอก</p><form><label>ชื่อแม่แบบ<input name="name" required maxlength="120" placeholder="เช่น สัญญาจ้างพนักงาน"></label><label class="template-drop">เลือกไฟล์ PDF<input name="file" type="file" accept="application/pdf,.pdf" required></label><p class="muted">PDF ไม่เกิน ${Math.floor(limits.maxFileBytes / 1024 / 1024)} MB / ${limits.maxPages} หน้า · สูงสุด ${limits.maxTemplates ?? 20} แม่แบบต่อบัญชี · พื้นที่รวม ${Math.floor(limits.maxAccountBytes / 1024 / 1024)} MB</p><div class="template-privacy">ไฟล์แม่แบบจะถูกเก็บในบัญชีเพื่อใช้ครั้งต่อไป มีเพียงคุณที่เข้าถึงผ่านเว็บได้ และลบได้ทุกเมื่อ หาก PDF ตั้งรหัสผ่านไว้ เราจะให้คุณปลดรหัสก่อนเก็บเป็นแม่แบบ</div><p data-message role="status"></p><button type="submit" class="button button-blue">อัปโหลดและกำหนดช่อง</button></form></section>`;
  const form = root.querySelector("form")!;
  const msg = root.querySelector("[data-message]")!;
  form.addEventListener(
    "submit",
    async (e) => {
      e.preventDefault();
      const b = form.querySelector("button")!;
      const data = new FormData(form),
        file = data.get("file") as File;
      if (!file?.size) return;
      b.disabled = true;
      try {
        if (file.size > limits.maxFileBytes)
          throw Error("ไฟล์ใหญ่เกินขนาดที่รองรับ");
        let bytes = new Uint8Array(await file.arrayBuffer());
        try {
          const pdf = await validatePdf(bytes);
          if (pdf.getPageCount() > limits.maxPages)
            throw Error("จำนวนหน้าเกินขนาดที่รองรับ");
        } catch (e) {
          if (
            !(e instanceof Error) ||
            !e.message.startsWith(
              "Input document to `PDFDocument.load` is encrypted.",
            )
          )
            throw e;
          const result = await unlockPdf(bytes, signal);
          if (!result) return;
          bytes = new Uint8Array(result);
          const pdf = await validatePdf(bytes);
          if (pdf.getPageCount() > limits.maxPages)
            throw Error("จำนวนหน้าเกินขนาดที่รองรับ");
        }
        if (signal.aborted) return;
        data.set(
          "file",
          new Blob([bytes], { type: "application/pdf" }),
          "template.pdf",
        );
        msg.textContent = "กำลังเก็บแม่แบบ…";
        const t = await api<Template>("/api/templates", {
          method: "POST",
          body: data,
        });
        location.assign(`/workspace/templates/${t.id}/edit`);
      } catch (e) {
        msg.textContent = (e as Error).message;
      } finally {
        b.disabled = false;
      }
    },
    { signal },
  );
}
