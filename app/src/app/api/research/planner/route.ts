import { handlePlannerRequest } from "@/lib/research/planner/api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  return handlePlannerRequest(request);
}
export const GET = handle;
export const POST = handle;
