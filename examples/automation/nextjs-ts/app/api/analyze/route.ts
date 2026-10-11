import { analyzeDocx } from "@/lib/docx";

export const runtime = "nodejs";

const MAX_BODY = 64 * 1024 * 1024; // 64 MB

/** POST .docx bytes -> JSON (tables, headings, word count) */
export async function POST(req: Request) {
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length > MAX_BODY) return Response.json({ error: "body too large" }, { status: 413 });
  try {
    return Response.json(analyzeDocx(bytes));
  } catch (e) {
    return Response.json({ error: `${e instanceof Error ? e.name : "Error"}: ${e instanceof Error ? e.message : e}` }, { status: 400 });
  }
}
