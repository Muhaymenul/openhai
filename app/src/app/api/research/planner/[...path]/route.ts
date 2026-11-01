import { handlePlannerRequest } from "@/lib/research/planner/api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
async function handle(request: Request, context: Context) {
  return handlePlannerRequest(request, (await context.params).path);
}
export const GET = handle;
export const PATCH = handle;
