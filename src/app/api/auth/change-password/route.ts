import { AuthError, changeOwnPassword, logoutRequest, requireUser, sessionCookieName } from "@/lib/auth";
import { fail, ok } from "@/lib/http";

export async function POST(request: Request) {
  try {
    const user = requireUser(request);
    const input = (await request.json()) as { oldPassword?: string; newPassword?: string };
    changeOwnPassword(user.id, input.oldPassword || "", input.newPassword || "");
    logoutRequest(request);
    const response = ok({ changed: true });
    response.cookies.set(sessionCookieName, "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0
    });
    return response;
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("修改密码失败", 500);
  }
}
