import { NextResponse, type NextRequest } from "next/server";
import { loginSchema } from "@/validators/masters";
import { login } from "@/server/services/auth.service";
import { getClientIp, setSessionCookie } from "@/server/auth/session";
import { assertSameOrigin, errorResponse } from "@/server/api/handler";

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const input = loginSchema.parse(await req.json().catch(() => ({})));
    const { token, expiresAt, user } = await login({
      ...input,
      ip: await getClientIp(),
      userAgent: req.headers.get("user-agent"),
    });
    await setSessionCookie(token, expiresAt);
    return NextResponse.json({ data: { name: user.name, role: user.role } });
  } catch (err) {
    return errorResponse(err, req);
  }
}
