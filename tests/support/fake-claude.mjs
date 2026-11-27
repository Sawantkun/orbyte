#!/usr/bin/env node
// Stand-in for the `claude` CLI in tests (never spends a real subscription).
// Behaviour is chosen by markers in the prompt read from stdin.
import fs from "node:fs";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("9.9.9 (Fake Claude Code)\n");
  process.exit(0);
}
const raw = fs.readFileSync(0, "utf8");
const msg = JSON.parse(raw.trim().split("\n")[0]);
const blocks = msg.message.content;
const prompt = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
const images = blocks.filter((b) => b.type === "image").map((b) => `${b.source.media_type}:${b.source.data.length}`);
const model = args[args.indexOf("--model") + 1];
const ok = (result, extra = {}) =>
  process.stdout.write(JSON.stringify({ type: "system", subtype: "init" }) + "\n" + JSON.stringify({ type: "result", subtype: "success", is_error: false, result, stop_reason: "end_turn", usage: { input_tokens: 3, cache_creation_input_tokens: 100, cache_read_input_tokens: 0, output_tokens: 7 }, total_cost_usd: 0.0002, ...extra }));

if (prompt.includes("[echo]")) {
  ok(JSON.stringify({ images, args, envKeys: Object.keys(process.env).sort(), cwdEntries: fs.readdirSync(process.cwd()), prompt }));
} else if (prompt.includes("[auth]")) {
  process.stdout.write("Invalid API key · Please run /login\n");
  process.exit(1);
} else if (prompt.includes("[limit]")) {
  process.stdout.write(JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, result: "Claude AI usage limit reached", api_error_status: 429 }));
  process.exit(1);
} else if (prompt.includes("[garbage]")) {
  process.stdout.write("not json at all");
} else if (prompt.includes("[slow]")) {
  setTimeout(() => ok("late"), 10_000);
} else if (images.length) {
  ok(`fake ${model} saw ${images.length} image(s) (${images.join(", ")}): ${prompt.trim().slice(0, 200)}`);
} else {
  ok(`fake ${model}: ${prompt.trim().slice(0, 200)}`);
}
