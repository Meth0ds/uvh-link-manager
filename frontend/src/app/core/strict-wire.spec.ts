import { localDateTimeValue, parseHttpDate, parseLocalDateTime, parseRouteId, type StrictDecoder } from "./strict-wire";

/**
 * The contract suite runs over every decoder; the corpora are the family
 * cases folded in from where these decoders used to live (route-id,
 * tokens.component, retry-after). A new strict decoder joins by entering its
 * name and corpora here — the contract laws apply to it from that moment.
 */
interface DecoderContract {
  readonly name: string;
  readonly decode: StrictDecoder<number>;
  readonly accepts: ReadonlyArray<readonly [string, number]>;
  readonly rejects: ReadonlyArray<string | null | undefined>;
}

/** Values no wire scalar may ever accept, whatever its family. "2026" is not
 * here because it is a perfectly good route id — family corpora hold the
 * values only their own grammar must refuse. */
const UNIVERSAL_GARBAGE = [" ", " 1", "1 ", "1\n", "\t1", "1e3", "12abc", "0x10", "1.5", "-1", "+1",
  "NaN", "Infinity", "true", "null", "{}", "42,43", "0", "01", "T10:00", "tomorrow"];

const DECODERS: readonly DecoderContract[] = [
  {
    name: "parseRouteId",
    decode: parseRouteId,
    accepts: [["1", 1], ["42", 42], ["9007199254740991", 9007199254740991]],
    rejects: [null, undefined, "", " ", "0", "01", "-1", "+1", "1e3", "1.5", "12abc", "0x10", " 42",
      "42 ", "9007199254740993", "18446744073709551616"],
  },
  {
    name: "parseLocalDateTime",
    decode: parseLocalDateTime,
    accepts: [
      ["2026-12-31T23:59", new Date(2026, 11, 31, 23, 59).getTime()],
      ["2026-02-28T00:00", new Date(2026, 1, 28, 0, 0).getTime()],
    ],
    rejects: [null, undefined, "", " ", "2026", "2026-12-31", "2026-12-31T24:00", "2026-12-31T10:60",
      "2026-02-30T10:00", "0026-01-01T00:00", "2026-12-31T10:00:00", "2026-12-31 10:00",
      " 2026-12-31T10:00", "2026-12-31T10:00 ", "2026-1-1T00:00"],
  },
  {
    name: "parseHttpDate",
    decode: parseHttpDate,
    accepts: [
      ["Sat, 05 Sep 2026 12:01:00 GMT", Date.parse("Sat, 05 Sep 2026 12:01:00 GMT")],
      ["sat, 05 sep 2026 12:01:00 gmt", Date.parse("Sat, 05 Sep 2026 12:01:00 GMT")],
      ["SAT, 05 SEP 2026 12:01:00 GMT", Date.parse("Sat, 05 Sep 2026 12:01:00 GMT")],
      ["Sat, 05 Sep 2026 12:01:00 -0000", Date.parse("Sat, 05 Sep 2026 12:01:00 GMT")],
    ],
    rejects: [null, undefined, "", " ", "1.5", "60, 120", "tomorrow",
      "Sun, 05 Sep 2026 12:00:00 GMT", "Tue, 31 Feb 2026 12:00:00 GMT", "Sat, 05 Sep 2026 24:00:00 GMT",
      "Sat, 05 Sep 2026 12:01:00 +0000", "Sat, 05 Sep 2026 12:01:00 EST", "Sat, 5 Sep 2026 12:01:00 GMT",
      "2026-09-05T12:01:00Z"],
  },
];

for (const { name, decode, accepts, rejects } of DECODERS) {
  describe(`${name} [strict-wire contract]`, () => {
    it("answers null for absent input instead of a default", () => {
      for (const raw of [null, undefined, ""]) {
        expect(decode(raw)).withContext(String(raw)).toBeNull();
      }
    });

    it("refuses every value outside its grammar instead of guessing one", () => {
      for (const raw of rejects) {
        expect(decode(raw)).withContext(String(raw)).toBeNull();
      }
      for (const raw of UNIVERSAL_GARBAGE) {
        expect(decode(raw)).withContext(raw).toBeNull();
      }
    });

    it("answers exactly the values its grammar names", () => {
      for (const [raw, expected] of accepts) {
        expect(decode(raw)).withContext(raw).toBe(expected);
      }
    });

    it("never leaks NaN or an unsafe integer to its callers", () => {
      const corpus = [...accepts.map(([raw]) => raw), ...rejects.map(String), ...UNIVERSAL_GARBAGE];
      for (const raw of corpus) {
        const decoded = decode(raw);
        expect(decoded === null || Number.isSafeInteger(decoded)).withContext(raw).toBeTrue();
      }
    });
  });
}

describe("localDateTimeValue [strict-wire contract]", () => {
  it("prints the input value that parses back to the same instant", () => {
    for (const iso of ["2026-06-15T12:00:00Z", "2026-01-15T12:00:00Z"]) {
      const value = localDateTimeValue(iso);
      expect(value).withContext(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      expect(parseLocalDateTime(value)).withContext(value).toBe(Date.parse(iso));
    }
  });

  it("answers empty text for anything that names no instant", () => {
    for (const iso of [null, undefined, "", " ", "not-a-date", "2026-13-40", "1e3"]) {
      expect(localDateTimeValue(iso)).withContext(String(iso)).toBe("");
    }
  });
});
