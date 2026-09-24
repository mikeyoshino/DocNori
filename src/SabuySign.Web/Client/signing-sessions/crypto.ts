import { decode } from "../signatures/crypto";
import { validateSignature } from "../signatures/data";
import type { TextItem } from "../editor/session";
async function key(value: string) {
  if (!/^[\w-]{43}$/.test(value)) throw new Error("ลิงก์ไม่ถูกต้อง");
  return crypto.subtle.importKey("raw", decode(value), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function seal(bytes: Uint8Array, secret: string, context: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) },
    await key(secret),
    bytes.slice().buffer,
  );
  const result = new Uint8Array(12 + cipher.byteLength);
  result.set(iv);
  result.set(new Uint8Array(cipher), 12);
  return result;
}
export async function unseal(
  bytes: Uint8Array,
  secret: string,
  context: string,
) {
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bytes.slice(0, 12),
        additionalData: new TextEncoder().encode(context),
      },
      await key(secret),
      bytes.slice(12).buffer,
    ),
  );
}
export function validatePlacements(value: unknown, pages: number): TextItem[] {
  if (!Array.isArray(value) || !value.length || value.length > 50)
    throw new Error("ชุดลายเซ็นไม่ถูกต้อง");
  return value.map((v: TextItem) => {
    if (
      !v ||
      !Number.isInteger(v.page) ||
      v.page < 0 ||
      v.page >= pages ||
      ![v.x, v.y, v.width, v.height].every(Number.isFinite) ||
      v.x < 0 ||
      v.y < 0 ||
      v.width < 1 ||
      v.height < 1 ||
      v.x + v.width > 5000 ||
      v.y + v.height > 5000 ||
      v.text ||
      v.mark ||
      v.date
    )
      throw new Error("ตำแหน่งลายเซ็นไม่ถูกต้อง");
    return {
      id: crypto.randomUUID(),
      page: v.page,
      x: v.x,
      y: v.y,
      width: v.width,
      height: v.height,
      text: "",
      size: 2.4,
      color: "#172433",
      align: "left",
      signature: validateSignature(v.signature),
    };
  });
}
