import { afterEach, describe, expect, it } from "vitest";
import { checkCronAuth, corsHeaders, readBody } from "./http";

const req = (headers: Record<string, string>, body?: string) => new Request("https://engine.test/x", { method: "POST", headers, ...(body ? { body } : {}) });

describe("CORS", () => {
  afterEach(() => { delete process.env["ALLOWED_ORIGINS"]; });
  it("allows the public Netlify site by default", () => {
    expect(corsHeaders(req({ origin: "https://teachershaspeaking.netlify.app" }))["Access-Control-Allow-Origin"]).toBe("https://teachershaspeaking.netlify.app");
  });
  it("blocks other origins", () => {
    expect(corsHeaders(req({ origin: "https://evil.example" }))["Access-Control-Allow-Origin"]).toBeUndefined();
  });
  it("respects ALLOWED_ORIGINS", () => {
    process.env["ALLOWED_ORIGINS"] = "https://a.example, https://b.example/";
    expect(corsHeaders(req({ origin: "https://b.example" }))["Access-Control-Allow-Origin"]).toBe("https://b.example");
  });
});

describe("body parsing", () => {
  it("parses JSON and form bodies", async () => {
    expect((await readBody(req({ "content-type": "application/json" }, '{"a":1}'))).data).toEqual({ a: 1 });
    expect((await readBody(req({ "content-type": "application/x-www-form-urlencoded" }, "a=1&b=TSC-A48D85"))).data).toEqual({ a: "1", b: "TSC-A48D85" });
  });
});

describe("cron auth", () => {
  afterEach(() => { delete process.env["CRON_SECRET"]; });
  it("requires the bearer secret", async () => {
    process.env["CRON_SECRET"] = "s3cret";
    expect((await checkCronAuth(req({})))?.status).toBe(401);
    expect((await checkCronAuth(req({ authorization: "Bearer nope" })))?.status).toBe(401);
    expect(await checkCronAuth(req({ authorization: "Bearer s3cret" }))).toBeNull();
  });
});
