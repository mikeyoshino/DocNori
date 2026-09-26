import { api, button, confirmAction, escape } from "./api";
import {
  defaults,
  layout,
  makeMeasure,
  type Template,
  type Field,
  type Placement,
} from "./model";
import { PdfView } from "./pdf-view";
import { guardUnsavedWork } from "../shared/leave-guard";
import { setupDropdown } from "../shared/dropdown";
export async function workbench(
  root: HTMLElement,
  id: string,
  editing: boolean,
  signal: AbortSignal,
) {
  const limits = await api<{ maxFields: number; maxPlacements: number }>(
    "/api/templates/limits",
  );
  const data = await api<Template>(`/api/templates/${id}`);
  const source = await api<Uint8Array>(`/api/templates/${id}/file`);
  const font = new Uint8Array(
    await (await fetch("/fonts/Sarabun-Regular.ttf")).arrayBuffer(),
  );
  const measure = makeMeasure(font);
  const original = new PdfView(),
    result = new PdfView();
  await original.load(source);
  let page = 0,
    scale = 1,
    pageWidth = 595,
    pageHeight = 842,
    selected: string | undefined,
    armed: string | undefined,
    dirty = false,
    downloaded = false,
    values = defaults(data.definition),
    worker: Worker | undefined,
    output: Uint8Array | undefined,
    requestId = 0,
    timer: ReturnType<typeof setTimeout> | undefined;
  const menus: { dispose(): void }[] = [];
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && armed) {
        armed = undefined;
        note("ยกเลิกการวางช่องแล้ว");
      }
    },
    { signal },
  );
  root.innerHTML = `<header class="workspace-heading"><div><a class="workspace-back" href="/workspace/templates">← แม่แบบของฉัน</a><h1>${escape(data.name)}</h1><p>${editing ? "วางช่องบนเอกสาร แล้วตั้งค่าทางขวา" : "กรอกข้อมูลแล้วดูตัวอย่างก่อนดาวน์โหลด"}</p></div><div data-actions></div></header><p data-status role="status" class="workspace-status"></p><div class="template-workbench ${editing ? "is-design" : "is-fill"}"><aside class="template-fields"><h2>${editing ? "ช่องข้อมูล" : "ข้อมูลเอกสาร"}</h2><div data-fields></div></aside><section class="template-stage"><div class="template-pagebar"><button type="button" data-prev aria-label="หน้าก่อน">←</button><span data-page></span><button type="button" data-next aria-label="หน้าถัดไป">→</button></div><div class="template-scroll"><div class="template-paper"><canvas data-canvas></canvas><div data-overlay></div></div></div><p class="muted">${editing ? "เลือกเพิ่มช่อง แล้วคลิกตำแหน่งบนเอกสาร" : "ข้อมูลที่กรอกและ PDF ผลลัพธ์ไม่ถูกเก็บในบัญชี"}</p></section>${editing ? '<aside class="template-inspector"><h2>ตั้งค่าช่อง</h2><div data-inspector></div></aside>' : ""}</div>`;
  const get = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const status = get("[data-status]");
  const canvas = get<HTMLCanvasElement>("[data-canvas]");
  const overlay = get("[data-overlay]");
  const stage = get(".template-scroll");
  const fieldPanel = get("[data-fields]");
  const actionPanel = get("[data-actions]");
  if (!editing) {
    const tabs = document.createElement("div");
    tabs.className = "template-mobile-tabs";
    tabs.setAttribute("aria-label", "มุมมองเอกสาร");
    for (const [value, title] of [
      ["form", "กรอกข้อมูล"],
      ["preview", "ดูตัวอย่าง"],
    ]) {
      const tab = button(title, () => {
        get(".template-workbench").dataset.mobileView = value;
        for (const b of tabs.querySelectorAll("button"))
          b.setAttribute("aria-pressed", String(b === tab));
        void draw();
      });
      tab.setAttribute("aria-pressed", String(value === "form"));
      tabs.append(tab);
    }
    get(".template-workbench").dataset.mobileView = "form";
    get(".template-workbench").before(tabs);
  }
  const report = (e: unknown) => {
    status.textContent = e instanceof Error ? e.message : String(e);
    status.classList.add("is-error");
  };
  const note = (s: string) => {
    status.textContent = s;
    status.classList.remove("is-error");
  };
  const rename = editing ? document.createElement("input") : null;
  if (rename) {
    rename.value = data.name;
    rename.maxLength = 120;
    rename.setAttribute("aria-label", "ชื่อแม่แบบ");
    get("h1").replaceWith(rename);
    rename.className = "template-name";
    rename.oninput = () => {
      data.name = rename.value;
      changed();
    };
  }
  const primary = button(
    editing ? "บันทึกแม่แบบ" : "ดาวน์โหลด PDF",
    async () => {
      if (editing) {
        if (!data.name.trim()) {
          report("กรุณาตั้งชื่อแม่แบบ");
          return;
        }
        primary.disabled = true;
        try {
          const snapshot = JSON.stringify({
            name: data.name,
            definition: data.definition,
          });
          const saved = await api<Template>(`/api/templates/${id}`, {
            method: "PUT",
            body: JSON.stringify({
              name: data.name,
              version: data.version,
              definition: data.definition,
            }),
          });
          data.version = saved.version;
          dirty =
            snapshot !==
            JSON.stringify({ name: data.name, definition: data.definition });
          note(
            dirty
              ? "บันทึกแล้ว แต่มีการแก้ไขใหม่ที่ยังไม่ได้บันทึก"
              : "บันทึกแม่แบบแล้ว",
          );
        } catch (e) {
          report(e);
        } finally {
          primary.disabled = false;
        }
      } else {
        if (
          !output ||
          Object.keys(layout(data.definition, values, measure).errors).length
        )
          return;
        const url = URL.createObjectURL(
          new Blob([new Uint8Array(output)], { type: "application/pdf" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = data.name + ".pdf";
        a.click();
        downloaded = true;
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        note("ส่งไฟล์ให้เบราว์เซอร์ดาวน์โหลดแล้ว");
      }
    },
    "button button-blue",
  );
  actionPanel.append(primary);
  if (editing)
    actionPanel.append(
      Object.assign(document.createElement("a"), {
        href: `/workspace/templates/${id}/fill`,
        textContent: "กรอกข้อมูล",
        className: "button button-quiet",
      }),
    );
  else
    actionPanel.append(
      button("เริ่มฉบับใหม่", async () => {
        if (
          !downloaded &&
          dirty &&
          !(await confirmAction(
            "เริ่มเอกสารฉบับใหม่?",
            "ข้อมูลที่กรอกในหน้านี้จะถูกล้าง",
          ))
        )
          return;
        values = defaults(data.definition);
        dirty = false;
        downloaded = false;
        renderFields();
        await refresh();
      }),
    );
  guardUnsavedWork(
    () => (editing ? dirty : dirty && !downloaded),
    signal,
    editing
      ? "การแก้ไขแม่แบบที่ยังไม่ได้บันทึกจะหายไป"
      : "ข้อมูลที่กรอกจะหายไป กรุณาดาวน์โหลดเอกสารก่อนออก",
  );
  const current = () =>
    data.definition.placements.find((p) => p.id === selected);
  function changed() {
    dirty = true;
    note("มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก");
    renderBoxes();
  }
  let paintChain: Promise<void> = Promise.resolve();
  function draw() {
    paintChain = paintChain.catch(() => {}).then(paint);
    return paintChain;
  }
  async function paint() {
    if (signal.aborted) return;
    const view = !editing && output && result.doc ? result : original;
    const rendered = await view.draw(
      canvas,
      page,
      Math.max(250, stage.clientWidth - 40),
    );
    if (!rendered) return;
    ({ scale, width: pageWidth, height: pageHeight } = rendered);
    get("[data-page]").textContent =
      `หน้า ${page + 1} / ${original.doc!.numPages}`;
    get<HTMLButtonElement>("[data-prev]").disabled = page === 0;
    get<HTMLButtonElement>("[data-next]").disabled =
      page === original.doc!.numPages - 1;
    renderBoxes();
  }
  function renderBoxes() {
    overlay.replaceChildren();
    const l = layout(data.definition, values, measure);
    for (const p of data.definition.placements.filter((p) => p.page === page)) {
      const f = data.definition.fields.find((f) => f.id === p.fieldId)!;
      const box = document.createElement("div");
      box.className = `template-box ${selected === p.id ? "is-selected" : ""} ${l.invalid.has(p.id) && !editing ? "is-overflow" : ""}`;
      box.style.cssText = `left:${p.x * scale}px;top:${p.y * scale}px;width:${p.width * scale}px;height:${p.height * scale}px;font-size:${p.size * scale}px;text-align:${p.align};color:${p.color}`;
      if (editing) {
        box.tabIndex = 0;
        box.setAttribute("role", "button");
        box.setAttribute("aria-label", f.label);
        box.textContent = f.label;
        box.onclick = (e) => {
          e.stopPropagation();
          selected = p.id;
          inspect();
          renderBoxes();
        };
        box.onkeydown = (e) => {
          if (e.key === "Enter") {
            selected = p.id;
            inspect();
            renderBoxes();
          }
        };
        box.onpointerdown = (e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          selected = p.id;
          const x = e.clientX,
            y = e.clientY,
            px = p.x,
            py = p.y;
          box.setPointerCapture(e.pointerId);
          box.onpointermove = (move) => {
            p.x = Math.max(
              0,
              Math.min(pageWidth - p.width, px + (move.clientX - x) / scale),
            );
            p.y = Math.max(
              0,
              Math.min(pageHeight - p.height, py + (move.clientY - y) / scale),
            );
            box.style.left = p.x * scale + "px";
            box.style.top = p.y * scale + "px";
            dirty = true;
          };
          box.onpointercancel = () => {
            box.onpointermove = null;
            changed();
            inspect();
          };
          box.onpointerup = () => {
            box.onpointermove = null;
            changed();
            inspect();
          };
        };
      } else {
        box.classList.add("is-output");
        if (output && !l.invalid.has(p.id)) box.hidden = true;
        box.textContent = l.items.find((i) => i.id === p.id)?.text ?? "";
        box.style.whiteSpace = "pre";
        box.title = l.errors[f.id] ?? "";
      }
      overlay.append(box);
    }
  }
  function dropdown(
    parent: HTMLElement,
    label: string,
    value: string,
    options: { value: string; text: string }[],
    onChange: (v: string) => void,
  ) {
    const wrap = document.createElement("div");
    wrap.className = "doc-dropdown";
    const uid = crypto.randomUUID();
    wrap.innerHTML = `<label>${escape(label)}</label><button type="button" class="doc-dropdown-trigger" aria-label="${escape(label)}" aria-haspopup="listbox" aria-controls="${uid}" aria-expanded="false"><span>${escape(options.find((o) => o.value === value)?.text ?? value)}</span><span aria-hidden="true">⌄</span></button><div id="${uid}" class="doc-dropdown-menu" role="listbox" aria-label="${escape(label)}" popover="auto">${options.map((o) => `<button type="button" class="doc-dropdown-option" role="option" data-value="${escape(o.value)}" aria-selected="${o.value === value}" tabindex="-1">${escape(o.text)}</button>`).join("")}</div>`;
    parent.append(wrap);
    menus.push(
      setupDropdown(
        wrap.querySelector("button")!,
        wrap.querySelector("[role=listbox]")!,
        { invokeMethodAsync: async (_, v) => onChange(v) },
      ),
    );
  }
  function inspect() {
    if (!editing) return;
    for (const m of menus) m.dispose();
    menus.length = 0;
    const area = get("[data-inspector]");
    area.replaceChildren();
    const p = current();
    if (!p) {
      area.innerHTML = '<p class="muted">เลือกช่องบนเอกสารเพื่อตั้งค่า</p>';
      return;
    }
    const f = data.definition.fields.find((f) => f.id === p.fieldId)!;
    const input = (
      label: string,
      value: string,
      type: string,
      update: (s: string) => void,
    ) => {
      const l = document.createElement("label");
      l.textContent = label;
      const i = document.createElement("input");
      i.type = type;
      i.value = value;
      l.append(i);
      area.append(l);
      i.addEventListener("change", () => {
        update(i.value);
        changed();
        renderFields();
      });
      return i;
    };
    input("ชื่อช่อง", f.label, "text", (s) => (f.label = s)).maxLength = 100;
    dropdown(
      area,
      "ชนิดข้อมูล",
      f.type,
      [
        { value: "text", text: "ข้อความ" },
        { value: "date", text: "วันที่" },
        { value: "number", text: "ตัวเลข" },
      ],
      (v) => {
        f.type = v as Field["type"];
        f.defaultValue = "";
        changed();
        inspect();
      },
    );
    input(
      "ค่าเริ่มต้น",
      f.defaultValue,
      f.type === "date" ? "date" : "text",
      (s) => (f.defaultValue = s),
    ).maxLength = 10000;
    const check = (
      label: string,
      value: boolean,
      update: (v: boolean) => void,
    ) => {
      const l = document.createElement("label");
      l.className = "template-check";
      const i = document.createElement("input");
      i.type = "checkbox";
      i.checked = value;
      l.append(i, document.createTextNode(label));
      area.append(l);
      i.onchange = () => {
        update(i.checked);
        changed();
      };
    };
    check("จำเป็นต้องกรอก", f.required, (v) => (f.required = v));
    check("อนุญาตหลายบรรทัด", p.multiline, (v) => (p.multiline = v));
    for (const [key, label, min, max] of [
      ["size", "ขนาดตัวอักษร", 8, 72],
      ["width", "ความกว้างช่อง", 20, pageWidth - p.x],
      ["height", "ความสูงช่อง", 16, pageHeight - p.y],
      ["x", "ตำแหน่งแนวนอน", 0, pageWidth - p.width],
      ["y", "ตำแหน่งแนวตั้ง", 0, pageHeight - p.height],
    ] as const) {
      const i = input(label, String(Math.round(p[key])), "number", (s) => {
        const upper =
          key === "width"
            ? pageWidth - p.x
            : key === "height"
              ? pageHeight - p.y
              : key === "x"
                ? pageWidth - p.width
                : key === "y"
                  ? pageHeight - p.height
                  : max;
        p[key] = Math.max(min, Math.min(upper, Number(s) || min));
      });
      i.min = String(min);
      i.max = String(max);
    }
    dropdown(
      area,
      "จัดข้อความ",
      p.align,
      [
        { value: "left", text: "ชิดซ้าย" },
        { value: "center", text: "กึ่งกลาง" },
        { value: "right", text: "ชิดขวา" },
      ],
      (v) => {
        p.align = v as Placement["align"];
        changed();
        inspect();
      },
    );
    input("สีตัวอักษร", p.color, "color", (s) => (p.color = s));
    area.append(
      button("วางข้อมูลนี้อีกตำแหน่ง", () => {
        armed = f.id;
        note("คลิกตำแหน่งใหม่บนเอกสารเพื่อใช้ข้อมูลเดิม");
      }),
      button("ลบตำแหน่งนี้", () => {
        data.definition.placements = data.definition.placements.filter(
          (x) => x.id !== p.id,
        );
        if (!data.definition.placements.some((x) => x.fieldId === f.id))
          data.definition.fields = data.definition.fields.filter(
            (x) => x.id !== f.id,
          );
        selected = undefined;
        changed();
        renderFields();
        inspect();
      }),
    );
  }
  function renderFields() {
    fieldPanel.replaceChildren();
    if (editing) {
      fieldPanel.append(
        button(
          "＋ เพิ่มช่องข้อมูล",
          () => {
            armed = "new";
            note("คลิกตำแหน่งบนเอกสารเพื่อเพิ่มช่อง");
          },
          "button button-blue",
        ),
      );
      for (const f of data.definition.fields) {
        const b = button(
          f.label,
          async () => {
            const p = data.definition.placements.find(
              (p) => p.fieldId === f.id,
            );
            if (!p) return;
            selected = p.id;
            page = p.page;
            await draw();
            inspect();
          },
          "template-field-link",
        );
        fieldPanel.append(b);
      }
      if (!data.definition.fields.length)
        fieldPanel.insertAdjacentHTML(
          "beforeend",
          '<p class="muted">เพิ่มช่อง เช่น ชื่อพนักงาน วันที่ หรือเงินเดือน</p>',
        );
    } else {
      for (const f of data.definition.fields) {
        const l = document.createElement("label");
        l.textContent = f.label + (f.required ? " *" : "");
        const input = document.createElement("input");
        input.value = values[f.id] ?? "";
        input.type = f.type === "date" ? "date" : "text";
        input.inputMode = f.type === "number" ? "decimal" : "text";
        input.autocomplete = "off";
        input.maxLength = 10000;
        input.setAttribute("aria-label", f.label);
        const error = document.createElement("span");
        error.className = "template-field-error";
        error.dataset.error = f.id;
        l.append(input, error);
        fieldPanel.append(l);
        if (
          f.type === "text" &&
          data.definition.placements.some(
            (p) => p.fieldId === f.id && p.multiline,
          )
        ) {
          const text = document.createElement("textarea");
          text.value = input.value;
          text.setAttribute("aria-label", f.label);
          text.maxLength = 10000;
          input.replaceWith(text);
          text.oninput = () => onValue(f.id, text.value);
        } else input.oninput = () => onValue(f.id, input.value);
      }
      if (!data.definition.fields.length)
        fieldPanel.innerHTML =
          "<p>แม่แบบนี้ยังไม่มีช่องข้อมูล กรุณาแก้ไขแม่แบบก่อน</p>";
    }
  }
  function onValue(id: string, v: string) {
    requestId++;
    worker?.terminate();
    values[id] = v;
    dirty = true;
    downloaded = false;
    output = undefined;
    primary.disabled = true;
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), 350);
  }
  async function refresh() {
    if (editing) return;
    const generation = ++requestId;
    worker?.terminate();
    output = undefined;
    const l = layout(data.definition, values, measure);
    for (const el of fieldPanel.querySelectorAll<HTMLElement>("[data-error]")) {
      const fieldId = el.dataset.error!;
      const overflowPages = [
        ...new Set(
          data.definition.placements
            .filter((p) => p.fieldId === fieldId && l.invalid.has(p.id))
            .map((p) => p.page + 1),
        ),
      ];
      el.textContent =
        (l.errors[fieldId] ?? "") +
        (overflowPages.length ? ` (หน้า ${overflowPages.join(", ")})` : "");
      const input = el.parentElement!.querySelector("input,textarea")!;
      input.setAttribute("aria-invalid", String(!!el.textContent));
    }
    primary.disabled = true;
    renderBoxes();
    if (Object.keys(l.errors).length || !data.definition.fields.length) {
      await draw();
      note("กรอกข้อมูลให้ครบและแก้ช่องที่แจ้งเตือนก่อนดาวน์โหลด");
      return;
    }
    note("กำลังสร้างตัวอย่าง…");
    const w = (worker = new Worker("/js/export.worker.js", { type: "module" }));
    const timeout = setTimeout(() => {
      w.terminate();
      if (generation === requestId)
        report("สร้างตัวอย่างนานเกินไป กรุณาลองกรอกข้อมูลอีกครั้ง");
    }, 60000);
    w.onmessage = async (e) => {
      clearTimeout(timeout);
      w.terminate();
      if (signal.aborted || generation !== requestId) return;
      if (e.data.error) {
        report(e.data.error);
        return;
      }
      output = e.data.bytes;
      try {
        await result.load(output!);
        if (generation !== requestId || signal.aborted) return;
        await draw();
        if (generation !== requestId || signal.aborted) return;
        renderBoxes();
        primary.disabled = false;
        note("ตรวจเอกสารแล้วดาวน์โหลดได้เลย");
      } catch (e) {
        if (generation === requestId && !signal.aborted) report(e);
      }
    };
    w.onerror = () => {
      clearTimeout(timeout);
      w.terminate();
      if (generation === requestId && !signal.aborted)
        report("สร้างตัวอย่างไม่สำเร็จ กรุณาลองอีกครั้ง");
    };
    w.postMessage({
      bytes: source.slice(),
      items: l.items,
      font: font.slice(),
    });
  }
  overlay.addEventListener(
    "click",
    (e) => {
      if (!editing || !armed) return;
      if (
        data.definition.placements.length >= limits.maxPlacements ||
        (armed === "new" && data.definition.fields.length >= limits.maxFields)
      ) {
        report("จำนวนช่องเกินขีดจำกัด");
        return;
      }
      const rect = overlay.getBoundingClientRect();
      let fid = armed;
      if (armed === "new") {
        fid = crypto.randomUUID();
        data.definition.fields.push({
          id: fid,
          label: `ช่องข้อมูล ${data.definition.fields.length + 1}`,
          type: "text",
          required: false,
          defaultValue: "",
        });
      }
      const p: Placement = {
        id: crypto.randomUUID(),
        fieldId: fid,
        page,
        x: Math.max(
          0,
          Math.min(pageWidth - 180, (e.clientX - rect.left) / scale),
        ),
        y: Math.max(
          0,
          Math.min(pageHeight - 40, (e.clientY - rect.top) / scale),
        ),
        width: Math.min(180, pageWidth),
        height: 40,
        size: 16,
        color: "#172433",
        align: "left",
        multiline: false,
      };
      data.definition.placements.push(p);
      selected = p.id;
      armed = undefined;
      changed();
      renderFields();
      inspect();
    },
    { signal },
  );
  get("[data-prev]").onclick = () => {
    if (page > 0) {
      page--;
      void draw();
    }
  };
  get("[data-next]").onclick = () => {
    if (page < original.doc!.numPages - 1) {
      page++;
      void draw();
    }
  };
  let resizeTimer: ReturnType<typeof setTimeout>;
  const resize = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => void draw(), 150);
  });
  resize.observe(stage);
  signal.addEventListener(
    "abort",
    () => {
      requestId++;
      worker?.terminate();
      clearTimeout(timer);
      clearTimeout(resizeTimer);
      resize.disconnect();
      for (const m of menus) m.dispose();
      void original.destroy();
      void result.destroy();
      source.fill(0);
      font.fill(0);
      output?.fill(0);
      values = {};
    },
    { once: true },
  );
  if (editing && original.doc!.numPages > 1) {
    const pages = document.createElement("details");
    pages.className = "template-page-picker";
    pages.innerHTML = `<summary>เลือกหน้าเอกสาร (${original.doc!.numPages} หน้า)</summary><div></div>`;
    get(".template-stage").prepend(pages);
    let built = false;
    pages.addEventListener(
      "toggle",
      async () => {
        if (!pages.open || built) return;
        built = true;
        for (let i = 0; i < original.doc!.numPages && !signal.aborted; i++) {
          const b = button(`หน้า ${i + 1}`, () => {
            page = i;
            pages.open = false;
            void draw();
          });
          b.setAttribute("aria-label", `ไปหน้า ${i + 1}`);
          const preview = document.createElement("canvas");
          b.prepend(preview);
          pages.querySelector("div")!.append(b);
          const pdfPage = await original.doc!.getPage(i + 1);
          if (signal.aborted) return;
          const viewport = pdfPage.getViewport({
            scale: 80 / pdfPage.getViewport({ scale: 1 }).width,
          });
          preview.width = Math.ceil(viewport.width);
          preview.height = Math.ceil(viewport.height);
          await pdfPage.render({ canvas: preview, viewport }).promise;
        }
      },
      { signal },
    );
  }
  renderFields();
  inspect();
  await draw();
  if (!editing) await refresh();
}
