import { handleDiscoveryRequest } from "@/lib/research/discovery/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

export function GET(request: Request) {
  return handleDiscoveryRequest(request);
}
export function POST(request: Request) {
  return handleDiscoveryRequest(request);
}
