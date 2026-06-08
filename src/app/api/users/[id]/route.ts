import { AuthError, deleteEmployeeUserByAdmin, requireAdmin, updateUserByAdmin } from "@/lib/auth";
import { fail, ok } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Params) {
  try {
    requireAdmin(request);
    const { id } = await context.params;
    const input = (await request.json()) as { displayName?: string; status?: "active" | "disabled"; password?: string };
    return ok(updateUserByAdmin(id, input));
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("更新账号失败", 500);
  }
}

export async function DELETE(request: Request, context: Params) {
  try {
    requireAdmin(request);
    const { id } = await context.params;
    return ok(deleteEmployeeUserByAdmin(id));
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("删除账号失败", 500);
  }
}
