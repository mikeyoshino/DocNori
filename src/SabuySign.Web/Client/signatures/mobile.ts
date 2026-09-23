import { SignaturePad } from "./pad";
import { encryptSignature } from "./crypto";
let pad: SignaturePad | undefined;
let abort: AbortController;
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
export async function init() {
  dispose();
  abort = new AbortController();
  const { signal } = abort;
  window.addEventListener("hashchange", () => void init(), { signal });
  const hash = location.hash;
  history.replaceState(null, "", location.pathname);
  const match = /^#v1\.([a-f0-9]{32})\.([\w-]{43})\.([\w-]{43})$/.exec(hash);
  const status = $("mobile-status"),
    save = $<HTMLButtonElement>("mobile-save");
  save.disabled = true;
  save.textContent = "บันทึกลายเซ็น";
  $("mobile-pad").style.pointerEvents = "auto";
  $<HTMLButtonElement>("mobile-clear").disabled = true;
  $<HTMLButtonElement>("mobile-undo").disabled = true;
  if (!match) {
    status.textContent = "ลิงก์ไม่ครบหรือถูกรีเฟรช กรุณาสแกน QR จากคอมอีกครั้ง";
    return;
  }
  if (!crypto.subtle) {
    status.textContent = "กรุณาเปิดเว็บผ่าน HTTPS เพื่อเข้ารหัสลายเซ็น";
    return;
  }
  const [, id, key, writer] = match;
  const headers = { Authorization: `Bearer ${writer}` };
  let sending = false,
    done = false,
    payload: Uint8Array | undefined;
  try {
    const res = await fetch(`/api/pairing/${id}/state`, { headers, signal });
    if (!res.ok) throw new Error();
    const state = await res.json();
    if (signal.aborted) return;
    if (state.status !== "waiting") {
      status.textContent =
        "ลิงก์นี้ส่งลายเซ็นแล้ว กรุณาสร้าง QR ใหม่เมื่อต้องการเซ็นอีกครั้ง";
      return;
    }
  } catch {
    if (signal.aborted) return;
    status.textContent =
      "ลิงก์หมดอายุ ถูกยกเลิก หรือเชื่อมต่อไม่ได้ กรุณาสร้าง QR ใหม่บนคอม";
    return;
  }
  pad = new SignaturePad($("mobile-pad"), () => {
    save.disabled = sending || done || pad!.empty;
    if (!sending) payload = undefined;
  });
  status.textContent = "พร้อมรับลายเซ็น";
  for (const [id, action] of [
    ["mobile-clear", () => pad!.clear()],
    ["mobile-undo", () => pad!.undo()],
  ] as const) {
    const b = $<HTMLButtonElement>(id);
    b.disabled = false;
    b.addEventListener(
      "click",
      () => {
        if (!sending && !done) action();
      },
      { signal },
    );
  }
  save.addEventListener(
    "click",
    async () => {
      if (sending || done || pad!.empty) return;
      sending = true;
      save.disabled = true;
      $("mobile-pad").style.pointerEvents = "none";
      try {
        payload ??= await encryptSignature(pad!.save(), key, id);
        const result = await fetch(`/api/pairing/${id}/signature`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/octet-stream" },
          body: payload.slice().buffer,
          signal,
        });
        if (signal.aborted) return;
        if (result.status === 404)
          throw new Error("ลิงก์หมดอายุหรือถูกยกเลิก กรุณาสร้าง QR ใหม่บนคอม");
        if (result.status === 409)
          throw new Error(
            "ลิงก์นี้ได้รับลายเซ็นแล้ว กลับไปตรวจบนคอม หรือสร้าง QR ใหม่",
          );
        if (!result.ok)
          throw new Error("ส่งไม่สำเร็จ กรุณากดบันทึกเพื่อลองอีกครั้ง");
        done = true;
        pad!.clear();
        save.textContent = "บันทึกแล้ว";
        status.textContent = "ส่งลายเซ็นแล้ว กลับไปที่คอมเพื่อลากวางบนเอกสาร";
        $<HTMLButtonElement>("mobile-clear").disabled = true;
        $<HTMLButtonElement>("mobile-undo").disabled = true;
      } catch (e) {
        if (signal.aborted) return;
        status.textContent =
          e instanceof Error && /[ก-๙]/.test(e.message)
            ? e.message
            : "การเชื่อมต่อขัดข้อง กดบันทึกเพื่อลองอีกครั้ง";
      } finally {
        if (!signal.aborted) {
          sending = false;
          save.disabled = done || pad!.empty;
          if (!done) $("mobile-pad").style.pointerEvents = "auto";
        }
      }
    },
    { signal },
  );
}
export function dispose() {
  abort?.abort();
  pad?.dispose();
  pad = undefined;
}
