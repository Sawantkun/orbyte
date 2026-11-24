// Stand-in for the OpenAI Responses + Images APIs used by E2E tests. Deterministic output;
// prompts containing "[slow]" take 4 s so cancellation can be exercised.
import http from "node:http";
import zlib from "node:zlib";

/** A valid 8x8 purple PNG, built by hand so the mock has no dependencies. */
function tinyPng() {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const w = 8, h = 8;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [0x8b, 0x5c, 0xf6]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const PNG_B64 = tinyPng().toString("base64");

const port = Number(process.env.MOCK_OPENAI_PORT ?? 3199);
http
  .createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") return res.end("ok");
    // Keys: the platform key, or any "sk-e2e-…" user key except revoked ones.
    const auth = String(req.headers.authorization ?? "");
    const keyOk = auth === "Bearer sk-e2e-test-key" || (auth.startsWith("Bearer sk-e2e-") && !auth.includes("revoked"));
    if (req.method === "GET" && req.url === "/v1/models") {
      return res.writeHead(keyOk ? 200 : 401, { "content-type": "application/json" }).end(JSON.stringify(keyOk ? { data: [] } : { error: { message: "bad key" } }));
    }
    if (req.method !== "POST" || (req.url !== "/v1/responses" && req.url !== "/v1/images/generations")) return res.writeHead(404).end();
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw);
      if (!keyOk || String(body.input ?? "").includes("[fail-auth]")) {
        return res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "bad key" } }));
      }
      if (req.url === "/v1/images/generations") {
        return res.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({ data: Array.from({ length: body.n ?? 1 }, () => ({ b64_json: PNG_B64 })), usage: { input_tokens: 12, output_tokens: 1000 } }),
        );
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
