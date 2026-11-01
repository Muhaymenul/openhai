import { handleResearchRequest } from "@/lib/research/api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return handleResearchRequest(request);
}
