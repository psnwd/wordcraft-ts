import { buildDocx, type Spec } from "@/lib/docx";

export const runtime = "nodejs";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** POST JSON spec -> .docx */
export async function POST(req: Request) {
  try {
    const bytes = await buildDocx((await req.json()) as Spec);
    return new Response(bytes as BodyInit, { headers: { "Content-Type": DOCX } });
  } catch (e) {
    return Response.json({ error: `${e instanceof Error ? e.name : "Error"}: ${e instanceof Error ? e.message : e}` }, { status: 400 });
  }
}
