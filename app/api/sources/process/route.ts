const WORKER_URL = process.env.WORKER_URL ?? "http://localhost:8000";

// Parsing a scanned PDF runs to minutes on CPU, and the worker only answers
// once processing has finished.
export const maxDuration = 300;

export async function POST(request: Request) {
  const { sourceId } = await request.json();

  if (!sourceId) {
    return Response.json({ error: "sourceId required" }, { status: 400 });
  }

  const response = await fetch(`${WORKER_URL}/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_id: sourceId }),
  });

  const data = await response.json();

  if (!response.ok) {
    return Response.json({ error: data.message }, { status: 500 });
  }

  return Response.json({ status: "ok" });
}
