import { cleanParams, makeSpec } from "@/lib/report";

export const runtime = "nodejs";

/** POST JSON parameters -> a big sample report spec (synthetic numbers) */
export async function POST(req: Request) {
  try {
    return Response.json(makeSpec(cleanParams(await req.json().catch(() => ({})))));
  } catch (e) {
    return Response.json({ error: `${e instanceof Error ? e.name : "Error"}: ${e instanceof Error ? e.message : e}` }, { status: 400 });
  }
}
