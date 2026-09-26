let token = "";
export async function api<T = any>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (init.method && init.method !== "GET") {
    if (!token) {
      const r = await fetch("/api/account/csrf", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!r.ok) throw Error("ยังเชื่อมต่อระบบสมาชิกไม่ได้");
      token = (await r.json()).token;
    }
    init.headers = {
      ...(init.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      "X-CSRF-TOKEN": token,
      ...init.headers,
    };
  }
  const r = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (init.method && init.method !== "GET" && path.startsWith("/api/account/"))
    token = "";
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw Error(
      path.startsWith("/api/account/")
        ? accountError(r.status, body.error)
        : r.status === 401
          ? "กรุณาเข้าสู่ระบบอีกครั้ง แล้วลองบันทึกใหม่"
          : r.status === 409
            ? "แม่แบบถูกแก้ไขในอีกหน้าหนึ่ง กรุณาเปิดฉบับล่าสุดก่อนบันทึก"
            : (body.error ??
              body.message ??
              body.detail ??
              "ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง"),
    );
  }
  if (r.status === 204) return undefined as T;
  return r.headers.get("Content-Type")?.includes("application/pdf")
    ? (new Uint8Array(await r.arrayBuffer()) as T)
    : await r.json();
}
export const post = (path: string, body: unknown = {}) =>
  api(path, { method: "POST", body: JSON.stringify(body) });
export const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function button(
  label: string,
  action: () => void | Promise<void>,
  className = "button button-quiet",
) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.textContent = label;
  b.addEventListener("click", () => void action());
  return b;
}
export function confirmAction(title: string, message: string) {
  return new Promise<boolean>((resolve) => {
    const d = document.createElement("dialog");
    d.className = "leave-dialog";
    d.setAttribute("aria-label", title);
    d.innerHTML = `<h2>${escape(title)}</h2><p>${escape(message)}</p><div class="leave-dialog-actions"></div>`;
    let done = false;
    const finish = (yes: boolean) => {
      if (done) return;
      done = true;
      d.close();
      d.remove();
      resolve(yes);
    };
    d.querySelector("div")!.append(
      button("ยกเลิก", () => finish(false), "leave-dialog-stay"),
      button("ยืนยัน", () => finish(true), "leave-dialog-exit"),
    );
    d.addEventListener("cancel", (e) => {
      e.preventDefault();
      finish(false);
    });
    document.body.append(d);
    d.showModal();
  });
}

function accountError(status: number, error?: string): string {
  if (status === 429) return "ทำรายการบ่อยเกินไป กรุณารอสักครู่แล้วลองอีกครั้ง";
  if (status === 503)
    return "ระบบสมาชิกยังไม่พร้อมใช้งาน กรุณาลองอีกครั้งภายหลัง";
  if (status === 401)
    return "อีเมลหรือรหัสผ่านไม่ถูกต้อง หรือบัญชีถูกพักชั่วคราว กรุณาลองอีกครั้ง";
  if (error?.includes("security token"))
    return "กรุณารีเฟรชหน้าแล้วลองอีกครั้ง";
  if (error?.includes("register"))
    return "สมัครไม่สำเร็จ กรุณาตรวจอีเมลและรหัสผ่าน หากมีบัญชีแล้วให้เข้าสู่ระบบ";
  if (error?.includes("expired"))
    return "ลิงก์ไม่ถูกต้องหรือหมดอายุ กรุณาขอลิงก์ใหม่ และตรวจว่ารหัสผ่านตรงตามเงื่อนไข";
  return "ทำรายการไม่สำเร็จ กรุณาตรวจข้อมูลแล้วลองอีกครั้ง";
}
