import { api, post } from "./api";
export async function account(root: HTMLElement, action: string) {
  const linkParams = new URLSearchParams(location.search);
  if (action === "reset" || action === "verify")
    history.replaceState(null, "", location.pathname);
  let me;
  try {
    me = await api("/api/account/me");
  } catch {
    me = { available: false };
  }
  const titles: Record<string, string> = {
    login: "เข้าสู่ระบบ",
    register: "สร้างบัญชี DocNori",
    forgot: "ลืมรหัสผ่าน",
    reset: "ตั้งรหัสผ่านใหม่",
    verify: "ยืนยันอีเมล",
  };
  root.innerHTML = `<section class="account-card"><a class="workspace-back" href="/templates">แม่แบบเอกสาร</a><h1>${titles[action] ?? titles.login}</h1><p>เก็บแม่แบบไว้ในบัญชี แล้วกลับมาใช้ได้ทุกครั้ง</p><p data-message role="status"></p><div data-content></div></section>`;
  const msg = root.querySelector<HTMLElement>("[data-message]")!;
  const content = root.querySelector<HTMLElement>("[data-content]")!;
  if (!me.available) {
    msg.textContent = "ระบบสมาชิกยังไม่พร้อมใช้งาน กรุณากลับมาอีกครั้ง";
    return;
  }
  const errors: Record<string, string> = {
    sign_in_to_link_google:
      "อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่าน แล้วเลือกเชื่อมบัญชี Google",
    google_failed: "เข้าสู่ระบบด้วย Google ไม่สำเร็จ กรุณาลองอีกครั้ง",
    google_already_linked: "บัญชี Google นี้เชื่อมกับบัญชีอื่นอยู่แล้ว",
    google_email_unverified: "กรุณายืนยันอีเมลในบัญชี Google ก่อน",
    link_session_expired: "กรุณาเข้าสู่ระบบอีกครั้งเพื่อเชื่อมบัญชี Google",
  };
  const queryError = linkParams.get("error");
  if (queryError)
    msg.textContent =
      errors[queryError] ?? "ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง";
  if (action === "verify") {
    const p = linkParams;
    try {
      await post("/api/account/verify", {
        userId: p.get("userId"),
        token: p.get("token"),
      });
      msg.textContent = "ยืนยันอีเมลแล้ว เข้าสู่ระบบเพื่อเริ่มสร้างแม่แบบ";
    } catch (e) {
      msg.textContent = (e as Error).message;
    }
    history.replaceState(null, "", location.pathname);
    content.innerHTML =
      '<a class="button button-blue" href="/account/login">เข้าสู่ระบบ</a>';
    return;
  }
  content.innerHTML = `${["login", "register"].includes(action) ? `<a class="button button-quiet account-google ${me.googleEnabled ? "" : "unavailable"}" ${me.googleEnabled ? 'href="/api/account/google?returnUrl=/workspace/templates"' : 'aria-disabled="true"'}>เข้าสู่ระบบด้วย Google</a>${me.googleEnabled ? "" : '<p class="muted">Google ยังไม่เปิดใช้งาน</p>'}<div class="account-divider">หรือใช้อีเมล</div>` : ""}<form>${action !== "reset" ? '<label>อีเมล<input name="email" type="email" autocomplete="email" required maxlength="254"></label>' : ""}${action !== "forgot" ? `<label>รหัสผ่าน<input name="password" type="password" autocomplete="${action === "login" ? "current-password" : "new-password"}" required minlength="${action === "login" ? 1 : 12}" maxlength="128"></label>${action !== "login" ? '<p class="muted">อย่างน้อย 12 ตัวอักษร มีตัวพิมพ์ใหญ่ พิมพ์เล็ก ตัวเลข และสัญลักษณ์</p>' : ""}` : ""}<button class="button button-blue" type="submit">${titles[action] ?? titles.login}</button></form><div class="account-links"><a href="/account/login">เข้าสู่ระบบ</a><a href="/account/register">สมัครสมาชิก</a><a href="/account/forgot">ลืมรหัสผ่าน</a></div>`;
  if (
    (action === "register" || action === "forgot") &&
    me.emailEnabled === false
  ) {
    content.querySelector("form")!.remove();
    msg.textContent = "การสมัครและกู้คืนด้วยอีเมลยังไม่เปิดใช้งาน";
    return;
  }
  content.querySelector("form")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const b = form.querySelector("button")!;
    b.disabled = true;
    msg.textContent = "";
    const data = Object.fromEntries(new FormData(form));
    if (action === "reset") {
      const p = linkParams;
      data.userId = p.get("userId") ?? "";
      data.token = p.get("token") ?? "";
    }
    try {
      await post("/api/account/" + action, data);
      if (action === "login") {
        const next = new URLSearchParams(location.search).get("returnUrl");
        location.assign(
          next?.startsWith("/workspace/") ? next : "/workspace/templates",
        );
      } else if (action === "register") {
        location.assign("/workspace/templates");
      } else {
        form.reset();
        msg.textContent =
          action === "reset"
            ? "เปลี่ยนรหัสผ่านแล้ว เข้าสู่ระบบด้วยรหัสใหม่"
            : "หากอีเมลนี้ใช้ทำรายการได้ เราจะส่งลิงก์ให้ทางอีเมล กรุณาตรวจกล่องจดหมาย";
      }
    } catch (err) {
      msg.textContent = (err as Error).message;
    } finally {
      b.disabled = false;
    }
  });
}
