import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";

let n = 0;
/** Create a real user + session and return a cookie header for API calls. */
export async function signedInUser(name = "Api User") {
  n += 1;
  const email = `api${n}-${Date.now()}@example.test`;
  const { headers, response } = await auth.api.signUpEmail({
    body: { name, email, password: "integration-password" },
    returnHeaders: true,
  });
  const cookie = headers.get("set-cookie")!.split(";")[0];
  return { id: response.user.id, cookie };
}

export function request(path: string, init: { method?: string; cookie?: string; body?: unknown } = {}) {
  const headers = new Headers();
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
  });
}

export const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

export async function json(res: Response) {
  return res.status === 204 ? null : res.json();
}
