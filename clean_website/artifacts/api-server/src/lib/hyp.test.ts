import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// node-fetch is mocked at the module boundary so these tests exercise the
// exact request/response shapes documented at developers.hyp.co.il/pay
// without making any real network call -- useful as a fast, no-credentials-
// needed sanity check of lib/hyp.ts's contract with Hyp's API while waiting
// on real test-terminal credentials (see routes/billing.ts's callers for
// where this gets exercised end-to-end once those are available).
const fetchMock = vi.fn();
vi.mock("node-fetch", () => ({ default: (...args: unknown[]) => fetchMock(...args) }));

import { createHypPaymentUrl, verifyHypReturn } from "./hyp";

describe("lib/hyp", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.HYP_MASOF = "0010345518";
    process.env.HYP_API_KEY = "test-key";
    process.env.HYP_API_PASSWORD = "test-pass";
    fetchMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("createHypPaymentUrl requests APISign/SIGN with the right params and appends the raw response verbatim", async () => {
    // Response modeled directly on the "Creating a Payment Page" doc's own
    // example, so this fails loudly if our understanding of Hyp's contract
    // (echo the request params back + append the raw response verbatim, no
    // re-encoding) is ever wrong.
    const docResponseBody =
      "Amount=10&ClientLName=Parkington&ClientName=Jenny&Masof=0010345518&Order=12345678910" +
      "&PageLang=HEB&Sign=True&action=pay&email=jennyp%40example.co.il" +
      "&signature=0806fe45b00f11d4b3f3392d894fbfe8be372bb3822ae83fef87831c7c35426a";

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => docResponseBody });

    const url = await createHypPaymentUrl({
      amountILS: 10,
      order: "12345678910",
      clientName: "Jenny",
      email: "jennyp@example.co.il",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestedUrl = fetchMock.mock.calls[0]![0] as string;
    expect(requestedUrl.startsWith("https://pay.hyp.co.il/p/?")).toBe(true);

    const requestParams = new URLSearchParams(requestedUrl.split("?")[1]);
    expect(requestParams.get("action")).toBe("APISign");
    expect(requestParams.get("What")).toBe("SIGN");
    expect(requestParams.get("Sign")).toBe("True");
    expect(requestParams.get("Masof")).toBe("0010345518");
    expect(requestParams.get("KEY")).toBe("test-key");
    expect(requestParams.get("PassP")).toBe("test-pass");
    expect(requestParams.get("Amount")).toBe("10");
    expect(requestParams.get("Coin")).toBe("1");
    expect(requestParams.get("Order")).toBe("12345678910");
    expect(requestParams.get("ClientName")).toBe("Jenny");
    expect(requestParams.get("email")).toBe("jennyp@example.co.il");

    // The final payment URL must be the raw response appended as-is -- Hyp's
    // docs are explicit that re-parsing/re-encoding it breaks the signature.
    expect(url).toBe(`https://pay.hyp.co.il/p/?${docResponseBody}`);
  });

  it("createHypPaymentUrl throws when the APISign response has no signature", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => "Amount=10&Masof=0010345518" });
    await expect(createHypPaymentUrl({ amountILS: 10, order: "1" })).rejects.toThrow(/signature/i);
  });

  it("createHypPaymentUrl throws without ever calling fetch when credentials are missing", async () => {
    delete process.env.HYP_API_PASSWORD;
    await expect(createHypPaymentUrl({ amountILS: 10, order: "1" })).rejects.toThrow(/HYP_MASOF/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("verifyHypReturn appends the raw success-redirect query string verbatim after the VERIFY prefix", async () => {
    // Modeled on the docs' paired "Handle the redirect back to your website"
    // and "Validate the transaction" examples.
    const rawQuery =
      "Id=408941655&CCode=0&Amount=10&ACode=0505293&Order=12345678910" +
      "&Fild1=Jenny%20Parkington&Fild2=jennyp%40example.co.il&Fild3=" +
      "&Sign=a84b11187377554427f267a9139ad4fd7daf7fb661dd668a9b954cf41cd25904";

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => "CCode=0" });

    const verified = await verifyHypReturn(rawQuery);

    expect(verified).toBe(true);
    const requestedUrl = fetchMock.mock.calls[0]![0] as string;
    expect(requestedUrl).toBe(
      `https://pay.hyp.co.il/p/?action=APISign&What=VERIFY&Masof=0010345518&KEY=test-key&PassP=test-pass&${rawQuery}`,
    );
  });

  it("verifyHypReturn returns false when Hyp reports a non-zero CCode", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => "CCode=902" });
    expect(await verifyHypReturn("Id=1&CCode=902")).toBe(false);
  });

  it("verifyHypReturn returns false (not throws) when the HTTP request itself fails", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "" });
    expect(await verifyHypReturn("Id=1&CCode=0")).toBe(false);
  });
});
