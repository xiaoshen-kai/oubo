import { logoutRequest, sessionCookieName } from "@/lib/auth";
import { ok } from "@/lib/http";

export async function POST(request: Request) {
  logoutRequest(request);
  const response = ok({ loggedOut: true });
  response.cookies.set(sessionCookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0
  });
  return response;
}
