import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!/^[a-z0-9]{20,40}$/.test(name)) return new NextResponse("Not found", { status: 404 });
  const file = await prisma.storedFile.findUnique({ where: { id: name } });
  if (!file) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.size),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
