import { describe, expect, it } from "vitest";
import { extractNumbers, normalizeNumber } from "./numbers.js";

describe("normalizeNumber", () => {
  it.each([
    ["70%", "70%"],
    ["70 percent", "70%"],
    ["70 PERCENT", "70%"],
    ["1,200", "1200"],
    ["1.2k", "1200"],
    ["$1.2M", "$1200000"],
    ["₹50,000", "₹50000"],
    ["2x", "2x"],
    ["10×", "10x"],
    ["3.0", "3"],
    ["€1,200.50", "€1200.5"],
    ["£2B", "£2000000000"],
    ["0.5k", "500"],
    ["0.001M", "1000"],
    ["1.1k", "1100"],
    ["1.2345k", "1234.5"],
    ["0003.000", "3"],
    ["0.0", "0"],
    [".50", "0.5"],
    [" 70 % ", "70%"],
    ["-3.00", "-3"],
    ["+3.00", "3"],
    ["-0.0", "0"],
    ["$9007199254740993", "$9007199254740993"],
    ["3.000000000000001", "3.000000000000001"],
  ])("normalizes %s to %s", (raw, norm) => {
    expect(normalizeNumber(raw)).toBe(norm);
    expect(normalizeNumber(norm)).toBe(norm);
  });
});

describe("extractNumbers", () => {
  it.each<[string, string[]]>([
    ["Handled 30 records", ["30"]],
    ["Reduced errors by 70%", ["70%"]],
    ["Reduced errors by 70 percent", ["70 percent"]],
    ["Prepared 1,200 packages", ["1,200"]],
    ["Prepared 1.2k packages", ["1.2k"]],
    ["Saved $1.2M", ["$1.2M"]],
    ["Saved €500", ["€500"]],
    ["Saved £2B", ["£2B"]],
    ["Saved ₹50,000", ["₹50,000"]],
    ["Improved throughput 2x and 10×", ["2x", "10×"]],
    ["Handled 10-20 records", ["10", "20"]],
    ["Handled 10–20 records", ["10", "20"]],
    ["Handled 10—20 records", ["10", "20"]],
    ["Changed 3.0 to 3.5", ["3.0", "3.5"]],
    ["Changed .5 to 0.75", [".5", "0.75"]],
    ["Worked in 1950, 2023 and 2099", []],
    ["Counted 1949 and 2100", ["1949", "2100"]],
    ["Prepared 1,950 records", ["1,950"]],
    ["Saved $2023 and 2023%", ["$2023", "2023%"]],
    ["Counted 2023k packages and 2023x throughput", ["2023k", "2023x"]],
    ["value2023 and 2023records", ["2023"]],
    ["10minutes and 20boxes", ["10", "20"]],
    ["Used v1.2 and v2.10.3", []],
    ["Upgraded to v2.4", []],
    ["Used V3", []],
    ["Used ES2023", []],
    ["H264 and S3", []],
    ["IPv6 rollout", []],
    ["1.2.3 release", []],
    ["10.4.1.2 release", []],
    ["Upgraded to v2.4, V3, IPv6 and 1.2.3.", []],
    ["Used Python 3.12 and Tool 2.7.1", ["3.12"]],
    ["Python 3.12", ["3.12"]],
    ["Cut costs by 3.5%", ["3.5%"]],
    ["Used v1.2 to handle 30 records in 2023", ["30"]],
    ["Used Python 3.12 to reduce errors 70%", ["3.12", "70%"]],
    ["Supported 30 volunteers with 5 coordinators", ["30", "5"]],
    ["Reduced 70% and saved $1.2M", ["70%", "$1.2M"]],
    ["Change was -3.5 and +2", ["-3.5", "+2"]],
    ["No numbers here", []],
  ])("extracts expected raw values from %s", (text, raws) => {
    const tokens = extractNumbers(text);
    expect(tokens.map((token) => token.raw)).toEqual(raws);
    for (const token of tokens) {
      expect(text.slice(token.index, token.index + token.raw.length)).toBe(token.raw);
      expect(token.norm).toBe(normalizeNumber(token.raw));
    }
  });

  it("returns exact offsets and canonical values, including repeated tokens", () => {
    expect(extractNumbers("😀 1.2k / 70 percent / 1.2k")).toEqual([
      { raw: "1.2k", norm: "1200", index: 3 },
      { raw: "70 percent", norm: "70%", index: 10 },
      { raw: "1.2k", norm: "1200", index: 23 },
    ]);
  });
});
