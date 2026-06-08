import { currentUserFromRequest, publicUser } from "@/lib/auth";
import { fail, ok } from "@/lib/http";

export async function GET(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return fail("请先登录", 401);
  return ok(publicUser(user));
}
