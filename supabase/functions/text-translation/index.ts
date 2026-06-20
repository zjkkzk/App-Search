import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")
    return new Response("Method Not Allowed", { status: 405, headers: CORS });

  let q: string, from: string, to: string;
  try {
    const body = await req.json();
    q = body.q;
    from = body.from;
    to = body.to;
    if (!q || !from || !to) throw new Error("Missing params");
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400, headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  const apiKey = Deno.env.get("INTEGRATIONS_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Server configuration error" }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  const upstream = await fetch(
    "https://app-cblk1rqa5fk1-api-e94GZ5j0PWpa-gateway.appmiaoda.com/rpc/2.0/mt/texttrans/v1",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=utf-8",
        "X-Gateway-Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ q, from, to }),
    },
  );

  if (upstream.status === 429 || upstream.status === 402) {
    const errText = await upstream.text();
    return new Response(errText, { status: upstream.status, headers: { "Content-Type": "application/json", ...CORS } });
  }
  if (!upstream.ok) {
    return new Response(JSON.stringify({ error: `Upstream error: ${upstream.status}` }), {
      status: 502, headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  const data = await upstream.json();
  return new Response(JSON.stringify(data), {
    status: 200, headers: { "Content-Type": "application/json", ...CORS },
  });
});
