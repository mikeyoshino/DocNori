import { EditHistory } from "./history";
import { createGhostRenderer } from "./ghost";
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
import {
  guardUnsavedWork,
  leaveAfterConfirmation,
} from "../shared/leave-guard";
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
  const renderGhost = createGhostRenderer(font);
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
    previewing = false,
    zoom = 1,
    fitWidth = editing,
    saving = false,
    snapAlign = false,
    values = defaults(data.definition),
    worker: Worker | undefined,
    output: Uint8Array | undefined,
    requestId = 0,
    timer: ReturnType<typeof setTimeout> | undefined;
  const snapshot = () => ({ name: data.name, definition: data.definition });
  const history = new EditHistory(snapshot());
  let savedSnapshot = JSON.stringify(snapshot());
  let lastStyle = {
    size: 16,
    width: 180,
    height: 25.6,
    color: "#172433",
    align: "left" as Placement["align"],
    multiline: false,
  };
  const touched = new Set<string>();
  const samples: Record<string, string> = Object.create(null);
  const menus: { dispose(): void }[] = [];
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && armed) {
        setArmed(undefined);
        note("ยกเลิกการวางช่องแล้ว");
      }
    },
    { signal },
  );
  root.innerHTML = `<header class="workspace-heading template-editor-heading"><div class="template-heading-info"><a class="workspace-back" href="/workspace/templates">← แม่แบบของฉัน</a><h1>${escape(data.name)}</h1><p>${editing ? "วางช่องบนเอกสาร แล้วตั้งค่าทางขวา" : "กรอกข้อมูลแล้วดูตัวอย่างก่อนดาวน์โหลด"}</p></div><div data-actions></div></header><p data-status role="status" class="workspace-status"></p><div class="template-workbench ${editing ? "is-design" : "is-fill"}"><aside class="template-fields"><h2>${editing ? "ช่องข้อมูล" : "ข้อมูลเอกสาร"}</h2><div data-fields></div></aside><section class="template-stage"><div class="template-pagebar"><button type="button" data-prev aria-label="หน้าก่อน">←</button><span data-page></span><button type="button" data-next aria-label="หน้าถัดไป">→</button></div><div class="template-scroll"><div class="template-paper"><canvas data-canvas></canvas><div data-overlay></div></div></div><p class="muted">${editing ? "เลือกเพิ่มช่อง แล้วคลิกตำแหน่งบนเอกสาร" : "ข้อมูลที่กรอกและ PDF ผลลัพธ์ไม่ถูกเก็บในบัญชี"}</p></section>${editing ? '<aside class="template-inspector"><h2>ตั้งค่าช่อง</h2><div data-inspector></div></aside>' : ""}</div>`;
  root.classList.add("has-workbench");
  const bench = root.querySelector(".template-workbench")!;
  const sidebar = document.createElement("div");
  sidebar.className = "template-sidebar";
  sidebar.append(root.querySelector(".template-fields")!);
  const inspector = root.querySelector(".template-inspector");
  if (inspector) sidebar.append(inspector);
  bench.append(sidebar);
  if (editing) {
    const tabs = document.createElement("div");
    tabs.className = "template-panel-tabs";
    for (const [mode, label] of [
      ["fields", "ช่องข้อมูล"],
      ["properties", "ตั้งค่าช่อง"],
    ]) {
      const tab = button(label, () => showPanel(mode));
      tab.dataset.panelTab = mode;
      tabs.append(tab);
    }
    sidebar.prepend(tabs);
    const close = button("กลับไปเอกสาร", () => showPanel("canvas"));
    close.classList.add("template-sheet-close");
    sidebar.prepend(close);
    showPanel(matchMedia("(max-width:700px)").matches ? "canvas" : "fields");
  }
  function showPanel(mode: string) {
    (bench as HTMLElement).dataset.panel = mode;
    for (const tab of sidebar.querySelectorAll<HTMLElement>("[data-panel-tab]"))
      tab.setAttribute("aria-pressed", String(tab.dataset.panelTab === mode));
  }
  const get = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const status = get("[data-status]");
  const canvas = get<HTMLCanvasElement>("[data-canvas]");
  const overlay = get("[data-overlay]");
  function setArmed(value: string | undefined) {
    armed = value;
    overlay.classList.toggle("is-placing", !!value);
    const placement = root.querySelector<HTMLElement>(
      ".template-placement-actions",
    );
    if (placement) placement.hidden = !value;
    if (value) {
      showPanel("canvas");
      stage.scrollIntoView({ block: "nearest" });
      note("คลิกหรือแตะตำแหน่งบนเอกสารเพื่อเพิ่มช่อง");
    }
    const add = root.querySelector("[data-add-field]");
    add?.setAttribute("aria-pressed", String(value === "new"));
  }
  const stage = get(".template-scroll");
  const fieldPanel = get("[data-fields]");
  const errorLinks = document.createElement("div");
  errorLinks.className = "template-error-links";
  errorLinks.setAttribute("aria-label", "ช่องที่ต้องตรวจ");
  if (!editing) fieldPanel.before(errorLinks);
  function previewBusy(busy: boolean) {
    get(".template-stage").setAttribute("aria-busy", String(busy));
  }
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
    previewBusy(false);
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
    const nameLabel = document.createElement("label");
    nameLabel.className = "template-name-label";
    nameLabel.textContent = "ชื่อแม่แบบ";
    nameLabel.append(rename);
    get("h1").replaceWith(nameLabel);
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
        await saveTemplate();
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
  async function saveTemplate() {
    if (saving) return false;
    if (!data.name.trim()) {
      report("กรุณาตั้งชื่อแม่แบบ");
      rename?.focus();
      return false;
    }
    saving = true;
    primary.disabled = true;
    primary.setAttribute("aria-busy", "true");
    const saved = JSON.stringify(snapshot());
    try {
      const response = await api<Template>(
        `/api/templates/${id}`,
        {
          method: "PUT",
          body: JSON.stringify({ ...snapshot(), version: data.version }),
          signal,
        },
        { silent: true },
      );
      data.version = response.version;
      savedSnapshot = saved;
      dirty = savedSnapshot !== JSON.stringify(snapshot());
      note(
        dirty
          ? "บันทึกแล้ว แต่มีการแก้ไขใหม่ที่ยังไม่ได้บันทึก"
          : "บันทึกแม่แบบแล้ว",
      );
      return !dirty;
    } catch (e) {
      report(e);
      return false;
    } finally {
      saving = false;
      primary.disabled = false;
      primary.removeAttribute("aria-busy");
    }
  }
  primary.disabled = !editing;
  actionPanel.append(primary);
  let previewButton: HTMLButtonElement | undefined;
  if (editing) {
    previewButton = button(
      "ดูตัวอย่าง",
      async () => {
        previewing = !previewing;
        setArmed(undefined);
        previewButton!.textContent = previewing
          ? "กลับไปจัดช่อง"
          : "ดูตัวอย่าง";
        previewButton!.setAttribute("aria-pressed", String(previewing));
        get(".template-workbench").classList.toggle(
          "is-previewing",
          previewing,
        );
        overlay.hidden = previewing;
        if (previewing) await refresh();
        else {
          previewBusy(false);
          requestId++;
          worker?.terminate();
          output = undefined;
          await draw();
          note("เลือกช่องบนเอกสารเพื่อตั้งค่า");
        }
      },
      "button button-quiet",
    );
    previewButton.setAttribute("aria-pressed", "false");
    actionPanel.prepend(previewButton);
  }
  function returnToDesign() {
    if (!previewing) return;
    previewing = false;
    previewBusy(false);
    requestId++;
    worker?.terminate();
    clearTimeout(timer);
    output = undefined;
    previewButton!.textContent = "ดูตัวอย่าง";
    previewButton!.setAttribute("aria-pressed", "false");
    get(".template-workbench").classList.remove("is-previewing");
    overlay.hidden = false;
    void draw();
  }
  const pagebar = get(".template-pagebar");
  const tools = document.createElement("div");
  tools.className = "template-editor-tools";
  if (editing) {
    const add = button(
      "＋ เพิ่มช่องข้อมูล",
      () => {
        returnToDesign();
        setArmed("new");
      },
      "button button-blue",
    );
    add.setAttribute("data-add-field", "");
    add.setAttribute("aria-pressed", "false");
    tools.append(add);
    const undo = button("↶", () => restoreEdit(history.undo()));
    undo.setAttribute("aria-label", "เลิกทำ");
    undo.dataset.undo = "";
    const redo = button("↷", () => restoreEdit(history.redo()));
    redo.setAttribute("aria-label", "ทำซ้ำ");
    redo.dataset.redo = "";
    tools.append(undo, redo);
    const list = button("ช่องข้อมูล", () => showPanel("fields"));
    list.classList.add("template-open-fields");
    tools.append(list);
    const placement = document.createElement("div");
    placement.className = "template-placement-actions";
    placement.hidden = true;
    placement.append(
      button("วางกลางหน้า", () =>
        placeAt(
          Math.max(0, (pageWidth - lastStyle.width) / 2),
          Math.max(0, (pageHeight - lastStyle.height) / 2),
        ),
      ),
      button("ยกเลิกการวาง", () => setArmed(undefined)),
    );
    tools.append(placement);
    get(".template-stage").prepend(tools);
  }
  function syncHistory() {
    const undo = root.querySelector<HTMLButtonElement>("[data-undo]");
    const redo = root.querySelector<HTMLButtonElement>("[data-redo]");
    if (undo) undo.disabled = !history.canUndo;
    if (redo) redo.disabled = !history.canRedo;
  }
  function restoreEdit(value: ReturnType<typeof snapshot> | undefined) {
    if (!value) return;
    setArmed(undefined);
    previewBusy(false);
    data.name = value.name;
    data.definition = value.definition;
    if (rename) rename.value = data.name;
    selected = data.definition.placements.some((p) => p.id === selected)
      ? selected
      : data.definition.placements.find((p) => p.page === page)?.id;
    dirty = JSON.stringify(snapshot()) !== savedSnapshot;
    requestId++;
    worker?.terminate();
    output = undefined;
    clearTimeout(timer);
    renderFields();
    inspect();
    renderBoxes();
    syncHistory();
    note(
      dirty ? "มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก" : "กลับสู่ฉบับที่บันทึกแล้ว",
    );
    if (previewing) void refresh();
  }
  window.addEventListener(
    "keydown",
    (e) => {
      const typing =
        e.target instanceof Element &&
        !!e.target.closest("input,textarea,[contenteditable=true]");
      if (
        !editing ||
        typing ||
        !(e.ctrlKey || e.metaKey) ||
        e.key.toLowerCase() !== "z"
      )
        return;
      e.preventDefault();
      restoreEdit(e.shiftKey ? history.redo() : history.undo());
    },
    { signal },
  );
  syncHistory();
  const zoomLabel = document.createElement("span");
  zoomLabel.className = "template-zoom-label";
  const setZoom = (value: number) => {
    zoom = Math.max(0.5, Math.min(2, value));
    zoomLabel.textContent =
      (fitWidth ? "พอดีความกว้าง" : "พอดีหน้า") +
      (zoom === 1 ? "" : ` × ${zoom.toFixed(2)}`);
    void draw();
  };
  const zoomOut = button("−", () => setZoom(zoom - 0.25));
  zoomOut.setAttribute("aria-label", "ย่อเอกสาร");
  const zoomIn = button("+", () => setZoom(zoom + 0.25));
  zoomIn.setAttribute("aria-label", "ขยายเอกสาร");
  const fit = button("พอดีหน้า", () => {
    fitWidth = false;
    setZoom(1);
  });
  const widthFit = button("พอดีความกว้าง", () => {
    fitWidth = true;
    setZoom(1);
  });
  pagebar.append(zoomOut, zoomLabel, zoomIn, fit, widthFit);
  zoomLabel.textContent = fitWidth ? "พอดีความกว้าง" : "พอดีหน้า";

  if (editing)
    actionPanel.append(
      Object.assign(document.createElement("a"), {
        href: `/workspace/templates/${id}/fill`,
        textContent: "กรอกข้อมูล",
        className: "button button-quiet template-fill-link",
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
        touched.clear();
        dirty = false;
        downloaded = false;
        renderFields();
        await refresh();
      }),
    );
  let handoffOpen = false;
  window.addEventListener(
    "click",
    async (e) => {
      if (
        !editing ||
        !dirty ||
        e.button !== 0 ||
        e.ctrlKey ||
        e.metaKey ||
        e.shiftKey ||
        e.altKey ||
        !(e.target instanceof Element) ||
        !e.target.closest(".template-fill-link")
      )
        return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (handoffOpen) return;
      handoffOpen = true;
      const dialog = document.createElement("dialog");
      dialog.className = "leave-dialog";
      dialog.setAttribute("aria-label", "บันทึกก่อนกรอกข้อมูล");
      dialog.innerHTML =
        '<h2>บันทึกก่อนกรอกข้อมูล?</h2><p>ใช้แม่แบบที่แก้ไขล่าสุด หรือเปิดฉบับที่บันทึกไว้</p><div class="leave-dialog-actions"></div>';
      let canceled = false;
      const close = () => {
        canceled = true;
        dialog.close();
        dialog.remove();
        handoffOpen = false;
      };
      const next = `/workspace/templates/${id}/fill`;
      dialog.querySelector("div")!.append(
        button(
          "บันทึกและกรอกข้อมูล",
          async () => {
            for (const b of dialog.querySelectorAll("button"))
              b.disabled = true;
            const ok = await saveTemplate();
            const navigate = ok && !canceled && !signal.aborted;
            close();
            if (navigate) leaveAfterConfirmation(next);
          },
          "button button-blue",
        ),
        button("ใช้ฉบับที่บันทึกไว้", () => {
          close();
          leaveAfterConfirmation(next);
        }),
        button("กลับไปแก้ไข", close),
      );
      dialog.addEventListener("cancel", (e) => {
        e.preventDefault();
        close();
      });
      signal.addEventListener("abort", close, { once: true });
      document.body.append(dialog);
      dialog.showModal();
    },
    { signal, capture: true },
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
    history.record(snapshot());
    syncHistory();
    dirty = JSON.stringify(snapshot()) !== savedSnapshot;
    const style = current();
    if (style)
      lastStyle = {
        size: style.size,
        width: style.width,
        height: style.height,
        color: style.color,
        align: style.align,
        multiline: style.multiline,
      };
    note("มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก");
    renderBoxes();
    if (previewing) {
      requestId++;
      worker?.terminate();
      output = undefined;
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 350);
    }
  }
  let paintChain: Promise<void> = Promise.resolve();
  function draw() {
    paintChain = paintChain.catch(() => {}).then(paint);
    return paintChain;
  }
  async function paint() {
    if (signal.aborted) return;
    const view =
      (!editing || previewing) && output && result.doc ? result : original;
    const rendered = await view.draw(
      canvas,
      page,
      Math.max(220, stage.clientWidth - 32),
      zoom,
      fitWidth ? Infinity : Math.max(250, stage.clientHeight - 32),
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
    overlay.hidden = previewing && !!output;
    const focusId = (document.activeElement as HTMLElement)?.dataset
      .placementId;
    const selectedField = data.definition.placements.find(
      (p) => p.id === selected,
    )?.fieldId;
    for (const link of fieldPanel.querySelectorAll<HTMLElement>(
      "[data-field-link]",
    ))
      link.setAttribute(
        "aria-pressed",
        String(link.dataset.fieldLink === selectedField),
      );
    overlay.replaceChildren();
    const l = layout(
      data.definition,
      editing ? sampleValues() : values,
      measure,
    );
    for (const p of data.definition.placements.filter((p) => p.page === page)) {
      const f = data.definition.fields.find((f) => f.id === p.fieldId)!;
      const box = document.createElement("div");
      box.dataset.fieldId = p.fieldId;
      box.className = `template-box ${selected === p.id ? "is-selected" : ""} ${l.invalid.has(p.id) ? "is-overflow" : ""}`;
      box.style.cssText = `left:${p.x * scale}px;top:${p.y * scale}px;width:${p.width * scale}px;height:${p.height * scale}px;font-size:${p.size * scale}px;text-align:${p.align};color:${p.color}`;
      if (editing) {
        box.dataset.placementId = p.id;
        box.tabIndex = 0;
        box.setAttribute("role", "button");
        box.setAttribute("aria-label", f.label);
        const label = document.createElement("span");
        label.className = "template-box-label";
        label.textContent = f.label;
        box.append(label);
        const sample = l.items.find((item) => item.id === p.id);
        if (sample) box.append(renderGhost(sample, scale));
        box.onclick = (e) => {
          if (armed) return;
          e.stopPropagation();
          selected = p.id;
          inspect();
          renderBoxes();
        };
        box.onkeydown = (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            selected = p.id;
            inspect();
            renderBoxes();
          }
        };
        const selectKey = box.onkeydown;
        box.onkeydown = (e) => {
          if (
            ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
          ) {
            e.preventDefault();
            const step = e.shiftKey ? 10 : 1;
            p.x = Math.max(
              0,
              Math.min(
                pageWidth - p.width,
                p.x +
                  (e.key === "ArrowRight"
                    ? step
                    : e.key === "ArrowLeft"
                      ? -step
                      : 0),
              ),
            );
            p.y = Math.max(
              0,
              Math.min(
                pageHeight - p.height,
                p.y +
                  (e.key === "ArrowDown"
                    ? step
                    : e.key === "ArrowUp"
                      ? -step
                      : 0),
              ),
            );
            selected = p.id;
            changed();
            return;
          }
          selectKey?.call(box, e);
        };
        box.onpointerdown = (e) => {
          if (e.button !== 0 || armed) return;
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
            if (snapAlign) {
              for (const other of data.definition.placements.filter(
                (o) => o.page === page && o.id !== p.id,
              )) {
                if (Math.abs(p.x - other.x) < 4)
                  p.x = Math.min(pageWidth - p.width, other.x);
                if (Math.abs(p.y - other.y) < 4)
                  p.y = Math.min(pageHeight - p.height, other.y);
              }
            }
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
    if (focusId)
      [...overlay.querySelectorAll<HTMLElement>("[data-placement-id]")]
        .find((e) => e.dataset.placementId === focusId)
        ?.focus({ preventScroll: true });
    if (editing) {
      const hint = root.querySelector<HTMLElement>("[data-sample-error]");
      const p = current();
      if (hint)
        hint.textContent =
          p && l.invalid.has(p.id)
            ? "ข้อความล้นช่อง · ขยายช่องหรือเปิดหลายบรรทัด"
            : "";
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
    showPanel("properties");
    lastStyle = {
      size: p.size,
      width: p.width,
      height: p.height,
      color: p.color,
      align: p.align,
      multiline: p.multiline,
    };
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
    const fontName = document.createElement("p");
    fontName.className = "template-font-name";
    fontName.textContent = "Sarabun · ขนาดจริงใน PDF";
    area.append(fontName);
    const sizeLabel = document.createElement("label");
    sizeLabel.textContent = "ขนาดตัวอักษร (pt)";
    const sizeInput = document.createElement("input");
    sizeInput.type = "number";
    sizeInput.min = "8";
    sizeInput.max = "72";
    sizeInput.value = String(p.size);
    sizeLabel.append(sizeInput);
    area.append(sizeLabel);
    sizeInput.onchange = () => {
      p.size = Math.max(8, Math.min(72, Number(sizeInput.value) || 16));
      if (!p.multiline) p.height = Math.max(16, p.size * 1.6);
      p.y = Math.min(p.y, Math.max(0, pageHeight - p.height));
      sizeInput.value = String(p.size);
      changed();
      updateGeometryInputs();
    };
    const trialLabel = document.createElement("label");
    trialLabel.textContent = "ข้อความทดลอง";
    const trial = document.createElement("textarea");
    trial.value = sampleValues()[f.id];
    trial.maxLength = 10000;
    trial.rows = 2;
    trialLabel.append(trial);
    area.append(trialLabel);
    const hint = document.createElement("small");
    hint.className = "muted";
    hint.textContent = "ใช้ดูตัวอย่างเท่านั้น ไม่บันทึกเป็นค่าเริ่มต้น";
    const sampleError = document.createElement("p");
    sampleError.dataset.sampleError = "";
    sampleError.className = "template-field-error";
    sampleError.setAttribute("role", "status");
    area.append(sampleError);
    area.append(hint);
    trial.oninput = () => {
      samples[f.id] = trial.value;
      requestId++;
      worker?.terminate();
      output = undefined;
      clearTimeout(timer);
      renderBoxes();
      if (previewing) timer = setTimeout(() => void refresh(), 350);
    };
    const fieldName = input("ชื่อช่อง", f.label, "text", (s) => (f.label = s));
    fieldName.maxLength = 100;
    area.prepend(fieldName.parentElement!);
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
    check("อนุญาตหลายบรรทัด", p.multiline, (v) => {
      p.multiline = v;
      p.height = Math.max(16, p.size * 1.6 * (v ? 3 : 1));
      p.height = Math.min(p.height, pageHeight);
      p.y = Math.min(p.y, pageHeight - p.height);
      updateGeometryInputs();
    });
    const geometry = document.createElement("details");
    geometry.className = "template-geometry";
    geometry.innerHTML = "<summary>ขนาดและตำแหน่งช่อง</summary>";
    const snap = document.createElement("label");
    snap.className = "template-check";
    const snapInput = document.createElement("input");
    snapInput.type = "checkbox";
    snapInput.checked = snapAlign;
    snapInput.onchange = () => {
      snapAlign = snapInput.checked;
    };
    snap.append(snapInput, document.createTextNode("ช่วยจัดแนวขณะลาก"));
    geometry.append(snap);
    area.append(geometry);
    for (const [key, label, min, max] of [
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
        updateGeometryInputs();
      });
      i.dataset.geometry = key;
      geometry.append(i.parentElement!);
      i.min = String(min);
      i.max = String(max);
    }
    function updateGeometryInputs() {
      for (const i of area.querySelectorAll<HTMLInputElement>(
        "[data-geometry]",
      )) {
        const key = i.dataset.geometry as "width" | "height" | "x" | "y";
        i.value = String(Math.round(p![key]));
        i.max = String(
          key === "width"
            ? pageWidth - p!.x
            : key === "height"
              ? pageHeight - p!.y
              : key === "x"
                ? pageWidth - p!.width
                : pageHeight - p!.height,
        );
      }
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
      button("ทำสำเนาเป็นช่องใหม่", () => {
        if (
          data.definition.fields.length >= limits.maxFields ||
          data.definition.placements.length >= limits.maxPlacements
        ) {
          report("จำนวนช่องเกินขีดจำกัด");
          return;
        }
        const copy = {
          ...f,
          id: crypto.randomUUID(),
          label: f.label + " (สำเนา)",
        };
        const placement = {
          ...p,
          id: crypto.randomUUID(),
          fieldId: copy.id,
          x: Math.min(pageWidth - p.width, p.x + 12),
          y: Math.min(pageHeight - p.height, p.y + 32),
        };
        data.definition.fields.push(copy);
        data.definition.placements.push(placement);
        selected = placement.id;
        changed();
        renderFields();
        inspect();
      }),
      button("วางข้อมูลนี้อีกตำแหน่ง", () => {
        returnToDesign();
        setArmed(f.id);
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
    const checkLayout = layout(data.definition, sampleValues(), measure);
    sampleError.textContent = checkLayout.invalid.has(p.id)
      ? "ข้อความล้นช่อง · ขยายช่องหรือเปิดหลายบรรทัด"
      : "";
  }
  function renderFields() {
    fieldPanel.replaceChildren();
    if (editing) {
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
        b.dataset.fieldLink = f.id;
        b.setAttribute(
          "aria-pressed",
          String(
            data.definition.placements.find((p) => p.id === selected)
              ?.fieldId === f.id,
          ),
        );
        const row = document.createElement("div");
        row.className = "template-field-row";
        row.append(b);
        for (const [step, label] of [
          [-1, "ขึ้น"],
          [1, "ลง"],
        ] as const) {
          const move = button(step === -1 ? "↑" : "↓", () => {
            const index = data.definition.fields.findIndex(
                (item) => item.id === f.id,
              ),
              to = index + step;
            if (to < 0 || to >= data.definition.fields.length) return;
            data.definition.fields.splice(index, 1);
            data.definition.fields.splice(to, 0, f);
            changed();
            renderFields();
          });
          move.setAttribute("aria-label", `ย้าย ${f.label} ${label}`);
          move.disabled =
            data.definition.fields.indexOf(f) + step < 0 ||
            data.definition.fields.indexOf(f) + step >=
              data.definition.fields.length;
          row.append(move);
        }
        fieldPanel.append(row);
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
        error.id = "field-error-" + f.id;
        input.setAttribute("aria-describedby", error.id);
        l.append(input, error);
        const placements = data.definition.placements.filter(
          (p) => p.fieldId === f.id,
        );
        const positions = document.createElement("span");
        positions.className = "template-field-positions";
        for (const placement of placements) {
          const link = button(`ดูหน้า ${placement.page + 1}`, async () => {
            page = placement.page;
            selected = placement.id;
            get(".template-workbench").dataset.mobileView = "preview";
            for (const tab of root.querySelectorAll(
              ".template-mobile-tabs button",
            ))
              tab.setAttribute(
                "aria-pressed",
                String(tab.textContent === "ดูตัวอย่าง"),
              );
            await draw();
            stage.scrollTop = Math.max(
              0,
              placement.y * scale - stage.clientHeight / 3,
            );
          });
          positions.append(link);
        }
        l.append(positions);
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
          text.setAttribute("aria-describedby", error.id);
          text.onfocus = () => void focusField(f.id);
          text.onblur = () => {
            touched.add(f.id);
            updateValidation(layout(data.definition, values, measure));
          };
          input.replaceWith(text);
          text.oninput = () => onValue(f.id, text.value);
        } else {
          input.oninput = () => onValue(f.id, input.value);
          input.onfocus = () => void focusField(f.id);
          input.onblur = () => {
            touched.add(f.id);
            updateValidation(layout(data.definition, values, measure));
          };
        }
      }
      if (!data.definition.fields.length)
        fieldPanel.innerHTML =
          "<p>แม่แบบนี้ยังไม่มีช่องข้อมูล กรุณาแก้ไขแม่แบบก่อน</p>";
    }
  }
  async function focusField(id: string, preferInvalid = false) {
    const invalid = preferInvalid
      ? layout(data.definition, values, measure).invalid
      : undefined;
    const p =
      data.definition.placements.find(
        (p) => p.fieldId === id && invalid?.has(p.id),
      ) ?? data.definition.placements.find((p) => p.fieldId === id);
    if (!p) return;
    selected = p.id;
    page = p.page;
    await draw();
    const box = [...overlay.children].find(
      (b) => (b as HTMLElement).dataset.fieldId === id,
    ) as HTMLElement | undefined;
    if (box) {
      stage.scrollTop = p.y * scale - stage.clientHeight / 3;
      stage.scrollLeft = Math.max(0, p.x * scale - stage.clientWidth / 3);
    }
  }
  function onValue(id: string, v: string) {
    requestId++;
    worker?.terminate();
    values[id] = v;
    dirty = true;
    downloaded = false;
    output = undefined;
    previewBusy(true);
    primary.disabled = true;
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), 350);
  }
  function sampleValues() {
    return Object.fromEntries(
      data.definition.fields.map((f) => [
        f.id,
        Object.hasOwn(samples, f.id)
          ? samples[f.id]
          : f.defaultValue ||
            (f.type === "number"
              ? "15000"
              : f.type === "date"
                ? "2026-01-01"
                : "ข้อความตัวอย่าง"),
      ]),
    );
  }
  function updateValidation(l: ReturnType<typeof layout>) {
    errorLinks.replaceChildren();
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
        (touched.has(fieldId) || !!values[fieldId]?.trim()
          ? (l.errors[fieldId] ?? "")
          : "") +
        (overflowPages.length ? ` (หน้า ${overflowPages.join(", ")})` : "");
      const input = el.parentElement!.querySelector("input,textarea")!;
      input.setAttribute("aria-invalid", String(!!el.textContent));
      if (el.textContent) {
        const field = data.definition.fields.find((f) => f.id === fieldId)!;
        const link = button(field.label, () => {
          (input as HTMLElement).focus();
          void focusField(fieldId, true);
        });
        errorLinks.append(link);
      }
    }
  }
  async function refresh() {
    if (editing && !previewing) return;
    const generation = ++requestId;
    previewBusy(false);
    worker?.terminate();
    output = undefined;
    const l = layout(
      data.definition,
      editing ? sampleValues() : values,
      measure,
    );
    updateValidation(l);
    if (!editing) primary.disabled = true;
    renderBoxes();
    if (Object.keys(l.errors).length || !data.definition.fields.length) {
      await draw();
      const messages = [
        ...new Set(
          Object.entries(l.errors).map(
            ([id, error]) =>
              (data.definition.fields.find((f) => f.id === id)?.label ?? "") +
              ": " +
              error,
          ),
        ),
      ];
      note(
        editing
          ? "ตรวจข้อความทดลอง — " + messages.join(" · ")
          : `กรอกข้อมูลให้ครบก่อนดาวน์โหลด · เหลือ ${Object.keys(l.errors).length} ช่อง`,
      );
      return;
    }
    previewBusy(true);
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
        previewBusy(false);
        if (!editing) primary.disabled = false;
        note(
          editing
            ? "ตัวอย่าง PDF · ตำแหน่งและฟอนต์แบบเดียวกับไฟล์ดาวน์โหลด"
            : "ตรวจเอกสารแล้วดาวน์โหลดได้เลย",
        );
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
  function placeAt(x: number, y: number) {
    if (!editing || previewing || !armed) return;
    if (
      data.definition.placements.length >= limits.maxPlacements ||
      (armed === "new" && data.definition.fields.length >= limits.maxFields)
    ) {
      report("จำนวนช่องเกินขีดจำกัด");
      return;
    }
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
        Math.min(pageWidth - Math.min(lastStyle.width, pageWidth), x),
      ),
      y: Math.max(
        0,
        Math.min(pageHeight - Math.min(lastStyle.height, pageHeight), y),
      ),
      ...lastStyle,
      width: Math.min(lastStyle.width, pageWidth),
      height: Math.min(lastStyle.height, pageHeight),
    };
    data.definition.placements.push(p);
    selected = p.id;
    setArmed(undefined);
    changed();
    renderFields();
    inspect();
  }
  overlay.addEventListener(
    "click",
    (e) => {
      const rect = overlay.getBoundingClientRect();
      placeAt((e.clientX - rect.left) / scale, (e.clientY - rect.top) / scale);
    },
    { signal },
  );
  async function changePage(next: number) {
    page = next;
    if (editing) {
      selected = undefined;
      inspect();
    }
    await draw();
  }
  get("[data-prev]").onclick = () => {
    if (page > 0) {
      void changePage(page - 1);
    }
  };
  get("[data-next]").onclick = () => {
    if (page < original.doc!.numPages - 1) {
      void changePage(page + 1);
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
      for (const key of Object.keys(samples)) delete samples[key];
      root.classList.remove("has-workbench");
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
            pages.open = false;
            void changePage(i);
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
