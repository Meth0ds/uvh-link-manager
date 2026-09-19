import { decodeParkReceipt, decodeParkedHandoffs } from "./handoff-response-decoders";

const SOON = () => new Date(Date.now() + 60_000).toISOString();

describe("handoff response decoders", () => {
  it("reads which handoffs are parked and when each stops being valid", () => {
    const expiresAt = SOON();
    expect(decodeParkedHandoffs({
      invitation: { pending: true, expiresAt },
      linkIntent: { pending: true, expiresAt },
    })).toEqual({
      invitation: { pending: true, expiresAt },
      "link-intent": { pending: true, expiresAt },
    });
  });

  it("accepts a handoff that is simply not parked", () => {
    expect(decodeParkedHandoffs({
      invitation: { pending: false, expiresAt: null },
      linkIntent: { pending: false, expiresAt: null },
    })).toEqual({
      invitation: { pending: false, expiresAt: null },
      "link-intent": { pending: false, expiresAt: null },
    });
  });

  it("refuses a deadline reported without a park, or the other way round", () => {
    // A countdown in front of a flow that cannot run is worse than no countdown.
    expect(() => decodeParkedHandoffs({
      invitation: { pending: false, expiresAt: SOON() },
      linkIntent: { pending: false, expiresAt: null },
    })).toThrowError(/Invalid parked handoffs response/);
    expect(() => decodeParkedHandoffs({
      invitation: { pending: true, expiresAt: null },
      linkIntent: { pending: false, expiresAt: null },
    })).toThrowError(/Invalid parked handoffs response/);
  });

  it("refuses a handoff that outlives what the server would ever grant", () => {
    const tooLong = new Date(Date.now() + 8 * 24 * 60 * 60_000).toISOString();
    expect(() => decodeParkedHandoffs({
      invitation: { pending: true, expiresAt: tooLong },
      linkIntent: { pending: false, expiresAt: null },
    })).toThrowError(/Invalid parked handoffs response/);
  });

  it("refuses a deadline that has already passed instead of holding a dead park", () => {
    const past = new Date(Date.now() - 60 * 60_000).toISOString();
    expect(() => decodeParkedHandoffs({
      invitation: { pending: true, expiresAt: past },
      linkIntent: { pending: false, expiresAt: null },
    })).toThrowError(/Invalid parked handoffs response/);
  });

  it("refuses a park receipt that is not a confirmation", () => {
    expect(decodeParkReceipt({ pending: true, expiresAt: SOON() }).pending).toBeTrue();
    expect(() => decodeParkReceipt({ pending: false, expiresAt: null })).toThrowError(/Invalid park receipt response/);
    expect(() => decodeParkReceipt({ expiresAt: SOON() })).toThrowError(/Invalid park receipt response/);
    expect(() => decodeParkReceipt("nope")).toThrowError(/Invalid park receipt response/);
  });

  it("refuses a shape that is not an object", () => {
    expect(() => decodeParkedHandoffs([1, 2, 3])).toThrowError(/Invalid parked handoffs response/);
    expect(() => decodeParkedHandoffs(null)).toThrowError(/Invalid parked handoffs response/);
  });
});
