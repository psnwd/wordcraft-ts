import { renderSpec } from "@/lib/report";

export const runtime = "nodejs";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_BODY = 64 * 1024 * 1024; // 64 MB: a report spec can be big

/** POST a report spec (JSON, schema: ../REPORT_JSON.md) of any size -> one .docx */
export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return Response.json({ error: "body too large" }, { status: 413 });
  try {
    const bytes = await renderSpec(JSON.parse(await req.text()));
    return new Response(bytes as BodyInit, { headers: { "Content-Type": DOCX } });
  } catch (e) {
    return Response.json({ error: `${e instanceof Error ? e.name : "Error"}: ${e instanceof Error ? e.message : e}` }, { status: 400 });
  }
}
