import { AuthError, loginUser, sessionCookieName } from "@/lib/auth";
import { fail, ok } from "@/lib/http";

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as { username?: string; password?: string };
    const result = loginUser(input.username || "", input.password || "");
    const response = ok(result.user);
    response.cookies.set(sessionCookieName, result.token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60
    });
    return response;
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("登录失败", 500);
  }
}
