import { route } from "@/server/api/handler";
import { validation } from "@/server/errors";
import { prisma } from "@/server/db";

export const runtime = "nodejs";

const MAX = Number(process.env.UPLOAD_MAX_BYTES || 2 * 1024 * 1024);

/** Detects the real image type from magic bytes (never trusts the client's content-type). */
function sniff(buf: Buffer): "image/png" | "image/jpeg" | "image/webp" | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 12 && buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}

// Images are stored in the database so uploads persist on serverless hosts.
export const POST = route({ permission: "products.manage" }, async ({ req }) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") throw validation("Choose an image file");
  if (file.size > MAX) throw validation(`Image must be smaller than ${Math.round(MAX / 1024 / 1024)} MB`);
  const buf = Buffer.from(await file.arrayBuffer());
  const mimeType = sniff(buf);
  if (!mimeType) throw validation("Only PNG, JPEG or WebP images are allowed");
  const stored = await prisma.storedFile.create({ data: { mimeType, size: buf.length, data: buf }, select: { id: true } });
  return { url: `/api/uploads/${stored.id}` };
});
