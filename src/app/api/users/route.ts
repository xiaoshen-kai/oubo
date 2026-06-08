import { AuthError, createEmployeeUser, listPublicUsers, requireAdmin } from "@/lib/auth";
import { fail, ok } from "@/lib/http";

export async function GET(request: Request) {
  try {
    requireAdmin(request);
    return ok(listPublicUsers());
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("读取账号失败", 500);
  }
}

export async function POST(request: Request) {
  try {
    requireAdmin(request);
    const input = (await request.json()) as { username?: string; displayName?: string; password?: string };
    return ok(createEmployeeUser(input));
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("创建账号失败", 500);
  }
}
