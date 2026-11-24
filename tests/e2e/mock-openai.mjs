// Stand-in for the OpenAI Responses API used by E2E tests. Deterministic output;
// prompts containing "[slow]" take 4 s so cancellation can be exercised.
import http from "node:http";

const port = Number(process.env.MOCK_OPENAI_PORT ?? 3199);
http
  .createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") return res.end("ok");
    if (req.method !== "POST" || req.url !== "/v1/responses") return res.writeHead(404).end();
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw);
      if (req.headers.authorization !== "Bearer sk-e2e-test-key") {
        return res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "bad key" } }));
      }
      const reply = () =>
        res.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({
            status: "completed",
            output: [{ type: "message", content: [{ type: "output_text", text: `Mock ${body.model}: ${String(body.input).slice(0, 120)}` }] }],
            usage: { input_tokens: String(body.input).length, output_tokens: 42 },
          }),
        );
      if (String(body.input).includes("[slow]")) setTimeout(reply, 4000);
      else reply();
    });
  })
  .listen(port, "127.0.0.1", () => console.log(`mock-openai on ${port}`));
