import { describe, expect, it } from "vitest";
import { UpdateProfileSchema } from "@asm/contracts";
import {
  DETAILS_ERROR_KEYS,
  detailsBody,
  detailsProblems,
  draftFromProfile,
  formatDobInput,
  isAdult,
  sanitizeAadhaar,
  sanitizePan,
  type DetailsDraft,
} from "./details-model";

const TODAY = new Date(2026, 9, 30); // 30 Oct 2026, local time

const GOOD: DetailsDraft = {
  firstName: "Asha",
  lastName: "Rao",
  dateOfBirth: "1990-01-31",
  aadhaar: "123412341234",
  pan: "ABCDE1234F",
  address: "12 MG Road, Pune 411001",
  country: "India",
};

describe("draftFromProfile", () => {
  it("copies the identity fields, turning nulls into empty text and defaulting the country to India", () => {
    const empty = { firstName: null, lastName: null, dateOfBirth: null, aadhaar: null, pan: null, address: null, country: null };
    expect(draftFromProfile(empty)).toEqual({ firstName: "", lastName: "", dateOfBirth: "", aadhaar: "", pan: "", address: "", country: "India" });
  });
  it("keeps what the profile already holds", () => {
    expect(draftFromProfile({ ...GOOD, country: "Nepal" })).toEqual({ ...GOOD, country: "Nepal" });
  });
  it("keeps only the date of a longer timestamp", () => {
    expect(draftFromProfile({ ...GOOD, dateOfBirth: "1990-01-31T00:00:00.000Z" }).dateOfBirth).toBe("1990-01-31");
  });
});

describe("input sanitisers", () => {
  it("keeps Aadhaar to 12 digits", () => {
    expect(sanitizeAadhaar("1234 5678-9012 99")).toBe("123456789012");
  });
  it("upper-cases PAN, drops anything but letters and digits, and caps it at 10", () => {
    expect(sanitizePan("abcde-1234 fxyz")).toBe("ABCDE1234F");
  });
  it("formats a date of birth as YYYY-MM-DD while the digits are typed", () => {
    expect(formatDobInput("")).toBe("");
    expect(formatDobInput("19")).toBe("19");
    expect(formatDobInput("1990")).toBe("1990");
    expect(formatDobInput("19900")).toBe("1990-0");
    expect(formatDobInput("199001")).toBe("1990-01");
    expect(formatDobInput("1990013")).toBe("1990-01-3");
    expect(formatDobInput("19900131")).toBe("1990-01-31");
    expect(formatDobInput("1990-01-31")).toBe("1990-01-31");
    expect(formatDobInput("199001319999")).toBe("1990-01-31");
    expect(formatDobInput("31/01/1990")).toBe("3101-19-90");
  });
});

describe("isAdult", () => {
  it("is true from the 18th birthday on, and false the day before", () => {
    expect(isAdult("2008-10-30", TODAY)).toBe(true);
    expect(isAdult("2008-10-31", TODAY)).toBe(false);
    expect(isAdult("1990-01-31", TODAY)).toBe(true);
  });
  it("is false for a date in the future", () => {
    expect(isAdult("2027-01-01", TODAY)).toBe(false);
  });
});

describe("detailsBody", () => {
  it("trims, strips spaces from the numbers and upper-cases PAN, as the web form does", () => {
    expect(detailsBody({ ...GOOD, firstName: "  Asha ", aadhaar: "1234 1234 1234", pan: " abcde1234f ", address: " 12 MG Road " })).toEqual({
      ...GOOD,
      address: "12 MG Road",
    });
  });
  it("is accepted by the server's schema", () => {
    expect(UpdateProfileSchema.safeParse(detailsBody(GOOD)).success).toBe(true);
  });
});

describe("detailsProblems", () => {
  it("finds nothing wrong with good details", () => {
    expect(detailsProblems(GOOD, TODAY)).toEqual({});
  });
  it("asks for every field that is empty or only spaces", () => {
    const problems = detailsProblems({ firstName: " ", lastName: "", dateOfBirth: "", aadhaar: "", pan: "", address: "  ", country: "" }, TODAY);
    expect(problems).toEqual({
      firstName: DETAILS_ERROR_KEYS.firstName,
      lastName: DETAILS_ERROR_KEYS.lastName,
      dateOfBirth: DETAILS_ERROR_KEYS.dateOfBirth,
      aadhaar: DETAILS_ERROR_KEYS.aadhaar,
      pan: DETAILS_ERROR_KEYS.pan,
      address: DETAILS_ERROR_KEYS.address,
      country: DETAILS_ERROR_KEYS.country,
    });
  });
  it("maps the schema's own failures to keys: a short Aadhaar, a wrong PAN, an impossible date", () => {
    expect(detailsProblems({ ...GOOD, aadhaar: "1234" }, TODAY)).toEqual({ aadhaar: DETAILS_ERROR_KEYS.aadhaar });
    expect(detailsProblems({ ...GOOD, pan: "ABCDE12345" }, TODAY)).toEqual({ pan: DETAILS_ERROR_KEYS.pan });
    expect(detailsProblems({ ...GOOD, dateOfBirth: "1990-02-30" }, TODAY)).toEqual({ dateOfBirth: DETAILS_ERROR_KEYS.dateOfBirth });
    expect(detailsProblems({ ...GOOD, dateOfBirth: "1990-1-5" }, TODAY)).toEqual({ dateOfBirth: DETAILS_ERROR_KEYS.dateOfBirth });
  });
  it("rejects a text that is too long for the server", () => {
    expect(detailsProblems({ ...GOOD, address: "x".repeat(241) }, TODAY)).toEqual({ address: DETAILS_ERROR_KEYS.address });
  });
  it("says under 18 with its own message, not the date-format one", () => {
    expect(detailsProblems({ ...GOOD, dateOfBirth: "2012-05-01" }, TODAY)).toEqual({ dateOfBirth: "kyc.err.underage" });
  });
  it("never returns text: every value is an i18n key", () => {
    for (const key of Object.values(DETAILS_ERROR_KEYS)) expect(key.startsWith("kyc.err.")).toBe(true);
  });
});
