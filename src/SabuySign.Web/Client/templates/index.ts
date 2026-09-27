import { beginActivity } from "../shared/activity";
import { setupDropdown } from "../shared/dropdown";
import { api, post, escape, button, confirmAction } from "./api";
import { account } from "./accounts";
import { workbench } from "./workbench";
import { validatePdf } from "../editor/pdf";
import { unlockPdf } from "../editor/password";
import { PdfView } from "./pdf-view";
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
  const finishLoading = beginActivity();
  signal.addEventListener("abort", finishLoading, { once: true });
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
      location.replace(
        "/account/login?returnUrl=" +
          encodeURIComponent(path + location.search + location.hash),
      );
      return;
    }
    const bar = document.createElement("div");
    bar.className = "workspace-user";
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
    if (bar.childElementCount) root.before(bar);
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
  } finally {
    finishLoading();
  }
}
type LibraryEntry = Omit<Template, "definition"> & {
  definition?: Template["definition"];
};
async function listing(root: HTMLElement, signal: AbortSignal) {
  const entries = await api<LibraryEntry[]>("/api/templates", { signal });
  root.innerHTML =
    '<header class="workspace-heading"><div><span class="workspace-eyebrow">แม่แบบเอกสาร</span><h1>แม่แบบของฉัน</h1><p>เลือกแม่แบบเพื่อกรอกข้อมูล หรือสร้างจาก PDF ที่ใช้บ่อย</p></div><a class="button button-blue" href="/workspace/templates/new">＋ สร้างแม่แบบ</a></header><div class="template-library-tools"><label class="template-search">ค้นหาแม่แบบ<input type="search" placeholder="ชื่อแม่แบบ" data-search></label><div class="template-sort doc-dropdown"><span>เรียงตาม</span><button type="button" class="doc-dropdown-trigger" data-sort aria-label="เรียงตาม" aria-haspopup="listbox" aria-expanded="false"><span data-sort-label>แก้ไขล่าสุด</span><span class="doc-dropdown-chevron" aria-hidden="true">⌄</span></button><div class="doc-dropdown-menu" data-sort-menu role="listbox" aria-label="เรียงตาม" popover="auto"><button type="button" class="doc-dropdown-option" role="option" data-value="latest" aria-selected="true" tabindex="-1">แก้ไขล่าสุด</button><button type="button" class="doc-dropdown-option" role="option" data-value="oldest" aria-selected="false" tabindex="-1">แก้ไขเก่าสุด</button><button type="button" class="doc-dropdown-option" role="option" data-value="name" aria-selected="false" tabindex="-1">ชื่อแม่แบบ</button></div></div></div><p data-message role="status"></p><div class="template-list"></div>';
  const search = root.querySelector<HTMLInputElement>("[data-search]")!;
  const sort = root.querySelector<HTMLButtonElement>("[data-sort]")!;
  const sortMenu = root.querySelector<HTMLElement>("[data-sort-menu]")!;
  sortMenu.id = `template-sort-${crypto.randomUUID()}`;
  sort.setAttribute("aria-controls", sortMenu.id);
  let sortValue = "latest";
  const editedTime = (entry: LibraryEntry) =>
    Date.parse(entry.updatedAt ?? "") || 0;
  const metadata = (entry: LibraryEntry) => {
    const date = editedTime(entry);
    const updated = date
      ? `แก้ไขล่าสุด ${new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric" }).format(date)}`
      : `ฉบับที่ ${entry.version}`;
    return (
      updated +
      (entry.definition ? ` · ${entry.definition.fields.length} ช่อง` : "")
    );
  };
  const grid = root.querySelector<HTMLElement>(".template-list")!;
  const message = root.querySelector("[data-message]")!;
  let thumbnails = Promise.resolve();
  const observer = new IntersectionObserver((items) => {
    for (const item of items) {
      if (!item.isIntersecting) continue;
      observer.unobserve(item.target);
      const card = item.target as HTMLElement;
      thumbnails = thumbnails.then(async () => {
        if (signal.aborted || !card.isConnected) return;
        const view = new PdfView();
        const frame = card.querySelector<HTMLElement>(".template-card-icon")!;
        const cancel = () => {
          void view.destroy();
        };
        signal.addEventListener("abort", cancel, { once: true });
        let bytes: Uint8Array | undefined;
        try {
          bytes = await api<Uint8Array>(
            `/api/templates/${card.dataset.id}/file`,
            { signal },
            { silent: true },
          );
          if (signal.aborted || !card.isConnected) return;
          await view.load(bytes);
          bytes.fill(0);
          const canvas = document.createElement("canvas");
          canvas.setAttribute("aria-hidden", "true");
          await view.draw(canvas, 0, 170, 1, 158);
          if (signal.aborted || !card.isConnected) return;
          frame.replaceChildren(canvas);
          card.querySelector("[data-pages]")!.textContent =
            ` · ${view.doc!.numPages} หน้า`;
        } catch {
          if (card.isConnected) frame.textContent = "ไม่มีภาพตัวอย่าง";
        } finally {
          bytes?.fill(0);
          frame.setAttribute("aria-busy", "false");
          signal.removeEventListener("abort", cancel);
          await view.destroy();
        }
      });
    }
  });
  signal.addEventListener("abort", () => observer.disconnect(), { once: true });
  const render = () => {
    observer.disconnect();
    grid.replaceChildren();
    const visible = entries.filter((t) =>
      t.name.toLowerCase().includes(search.value.toLowerCase()),
    );
    visible.sort((a, b) =>
      sortValue === "name"
        ? a.name.localeCompare(b.name, "th")
        : (sortValue === "oldest" ? 1 : -1) * (editedTime(a) - editedTime(b)) ||
          a.name.localeCompare(b.name, "th"),
    );
    for (const t of visible) {
      const card = document.createElement("article");
      card.className = "template-card template-library-card";
      const fillUrl = `/workspace/templates/${encodeURIComponent(t.id)}/fill`;
      card.innerHTML = `<a class="template-card-thumbnail" href="${fillUrl}" aria-label="กรอกข้อมูล ${escape(t.name)}"><span class="template-card-icon" aria-busy="true"><span class="template-thumbnail-placeholder" role="img" aria-label="กำลังโหลดตัวอย่าง"><span aria-hidden="true"></span></span></span></a><h2><a href="${fillUrl}" title="${escape(t.name)}">${escape(t.name)}</a></h2><p class="muted template-card-meta">${escape(metadata(t))}<span data-pages></span></p><a class="button button-blue" href="${fillUrl}">กรอกข้อมูล</a><details class="template-card-menu"><summary aria-label="จัดการแม่แบบ ${escape(t.name)}">⋯</summary><div class="template-card-actions"><a href="/workspace/templates/${encodeURIComponent(t.id)}/edit">แก้ไข</a></div></details>`;
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
      card.dataset.id = t.id;
      grid.append(card);
      observer.observe(card);
    }
    if (!grid.children.length)
      grid.innerHTML = `<section class="workspace-empty"><h2>${entries.length ? "ไม่พบแม่แบบที่ค้นหา" : "สร้างแม่แบบแรกของคุณ"}</h2><p>${entries.length ? "ลองค้นหาด้วยชื่ออื่น" : "เริ่มจาก PDF ที่ใช้บ่อย เช่น สัญญาจ้างหรือหนังสือรับรอง"}</p>${entries.length ? "" : '<a class="button button-blue" href="/workspace/templates/new">สร้างแม่แบบ</a>'}</section>`;
  };
  render();
  search.addEventListener("input", render, { signal });
  const sortDropdown = setupDropdown(sort, sortMenu, {
    invokeMethodAsync: async (_, value) => {
      const options = [
        ...sortMenu.querySelectorAll<HTMLButtonElement>('[role="option"]'),
      ];
      const selected = options.find((option) => option.dataset.value === value);
      if (!selected) return;
      sortValue = value;
      sort.querySelector("[data-sort-label]")!.textContent =
        selected.textContent;
      for (const option of options)
        option.setAttribute("aria-selected", String(option === selected));
      render();
    },
  });
  signal.addEventListener("abort", () => sortDropdown.dispose(), {
    once: true,
  });
}
async function upload(root: HTMLElement, signal: AbortSignal) {
  const limits = await api("/api/templates/limits");
  root.innerHTML = `<section class="template-upload template-upload-refined"><a class="workspace-back" href="/workspace/templates">← แม่แบบของฉัน</a><h1>สร้างแม่แบบเอกสาร</h1><p>เลือก PDF แล้วกำหนดช่องข้อมูลที่ต้องกรอก</p><form><div class="template-upload-drop" data-dropzone><input class="template-file-input" name="file" type="file" accept="application/pdf,.pdf" aria-label="เลือกไฟล์ PDF" aria-describedby="template-file-limits template-upload-message"><span data-file-name>ลากไฟล์ PDF มาวางที่นี่</span><span data-file-size></span><button type="button" class="button button-quiet" data-file-select>เลือกไฟล์จากเครื่อง</button></div><p class="muted" id="template-file-limits">PDF ไม่เกิน ${Math.floor(limits.maxFileBytes / 1024 / 1024)} MB · ${limits.maxPages} หน้า</p><p data-message id="template-upload-message" role="status"></p><label>ชื่อแม่แบบ<input name="name" required maxlength="120" placeholder="ใช้ชื่อไฟล์ หรือพิมพ์ชื่อใหม่"></label><p class="template-upload-privacy">ไฟล์และการตั้งค่าช่องจะเก็บในบัญชีของคุณเพื่อใช้ซ้ำ ลบได้ทุกเมื่อ</p><button type="submit" class="button button-blue" disabled>อัปโหลดและกำหนดช่อง</button><details class="template-upload-quota"><summary>ขีดจำกัดบัญชี</summary><p>สูงสุด ${limits.maxTemplates ?? 20} แม่แบบ · พื้นที่รวม ${Math.floor(limits.maxAccountBytes / 1024 / 1024)} MB</p></details></form></section>`;
  const form = root.querySelector("form")!;
  const msg = root.querySelector<HTMLElement>("[data-message]")!;
  const input = form.querySelector<HTMLInputElement>('input[type="file"]')!;
  const name = form.querySelector<HTMLInputElement>('input[name="name"]')!;
  const picker = form.querySelector<HTMLButtonElement>("[data-file-select]")!;
  const submit = form.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  )!;
  const drop = form.querySelector<HTMLElement>("[data-dropzone]")!;
  let selected: File | undefined;
  let busy = false;
  const select = (file?: File) => {
    if (busy || !file) return;
    selected = undefined;
    msg.textContent = "";
    input.setAttribute("aria-invalid", "false");
    if (
      !/\.pdf$/i.test(file.name) ||
      (file.type && file.type !== "application/pdf")
    )
      msg.textContent = "กรุณาเลือกไฟล์ PDF แล้วลองอีกครั้ง";
    else if (!file.size) msg.textContent = "ไฟล์ว่าง กรุณาเลือก PDF ไฟล์อื่น";
    else if (file.size > limits.maxFileBytes)
      msg.textContent = `ไฟล์ใหญ่เกิน ${Math.floor(limits.maxFileBytes / 1024 / 1024)} MB กรุณาเลือกไฟล์ที่เล็กลง`;
    else selected = file;
    form.querySelector("[data-file-name]")!.textContent = file.name;
    form.querySelector("[data-file-size]")!.textContent =
      file.size >= 1048576
        ? `${(file.size / 1048576).toFixed(1)} MB`
        : `${Math.max(1, Math.ceil(file.size / 1024))} KB`;
    picker.textContent = "เปลี่ยนไฟล์";
    submit.disabled = !selected;
    input.setAttribute("aria-invalid", String(!selected));
    if (selected && !name.value.trim())
      name.value = file.name.replace(/\.pdf$/i, "").slice(0, 120);
  };
  picker.addEventListener("click", () => input.click(), { signal });
  input.addEventListener("change", () => select(input.files?.[0]), { signal });
  for (const type of ["dragenter", "dragover"])
    drop.addEventListener(
      type,
      (event) => {
        event.preventDefault();
        if (!busy) drop.classList.add("is-dragging");
      },
      { signal },
    );
  drop.addEventListener(
    "dragleave",
    (event) => {
      if (!drop.contains((event as DragEvent).relatedTarget as Node))
        drop.classList.remove("is-dragging");
    },
    { signal },
  );
  drop.addEventListener(
    "drop",
    (event) => {
      event.preventDefault();
      drop.classList.remove("is-dragging");
      select(event.dataTransfer?.files[0]);
    },
    { signal },
  );
  form.addEventListener(
    "submit",
    async (e) => {
      e.preventDefault();
      if (busy || !selected) return;
      const b = submit;
      const data = new FormData(form),
        file = selected;
      busy = true;
      b.disabled = picker.disabled = input.disabled = true;
      b.setAttribute("aria-busy", "true");
      b.textContent = "กำลังเตรียมแม่แบบ…";
      const finishUpload = beginActivity();
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
        finishUpload();
        busy = false;
        b.disabled = !selected;
        picker.disabled = input.disabled = false;
        b.removeAttribute("aria-busy");
        b.textContent = "อัปโหลดและกำหนดช่อง";
      }
    },
    { signal },
  );
}
