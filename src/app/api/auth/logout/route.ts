import { NextResponse, type NextRequest } from "next/server";
import { logout } from "@/server/services/auth.service";
import { clearSessionCookie, getSessionToken } from "@/server/auth/session";
import { assertSameOrigin, errorResponse } from "@/server/api/handler";

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    await logout(await getSessionToken());
    await clearSessionCookie();
    return NextResponse.json({ data: { ok: true } });
  } catch (err) {
    return errorResponse(err, req);
  }
}
