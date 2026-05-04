import { describe, expect, it } from "vitest";
import type { UsageMeter } from "../src/platforms/types";
import { languageModeFromStorageValue } from "../src/storage/language";
import {
  formatAgeLocalized,
  formatMeterLabelLocalized,
  formatMeterValueLocalized,
  formatResetLocalized,
  resolveLanguage
} from "../src/utils/i18n";

const baseMeter: UsageMeter = {
  key: "limits_progress:file_upload",
  label: "File Upload",
  source: "api",
  confidence: "high"
};

describe("i18n", () => {
  it("resolves auto language from browser language candidates", () => {
    expect(resolveLanguage("auto", ["zh-Hans-CN"])).toBe("zh-CN");
    expect(resolveLanguage("auto", ["zh-TW"])).toBe("zh-CN");
    expect(resolveLanguage("auto", ["en-US"])).toBe("en");
    expect(resolveLanguage("auto", ["en-US", "zh-CN"])).toBe("en");
    expect(resolveLanguage("auto", ["fr-FR", "zh-CN", "en-US"])).toBe("zh-CN");
    expect(resolveLanguage("auto", ["fr-FR"])).toBe("en");
  });

  it("keeps explicit language modes", () => {
    expect(resolveLanguage("zh-CN", ["en-US"])).toBe("zh-CN");
    expect(resolveLanguage("en", ["zh-CN"])).toBe("en");
  });

  it("falls back unknown stored language values to auto", () => {
    expect(languageModeFromStorageValue("en")).toBe("en");
    expect(languageModeFromStorageValue("zh-CN")).toBe("zh-CN");
    expect(languageModeFromStorageValue("ja")).toBe("auto");
    expect(languageModeFromStorageValue(null)).toBe("auto");
  });

  it("localizes meter labels only in Chinese mode", () => {
    expect(formatMeterLabelLocalized("zh-CN", baseMeter)).toBe("文件上传");
    expect(formatMeterLabelLocalized("en", baseMeter)).toBe("File Upload");
    expect(
      formatMeterLabelLocalized("zh-CN", {
        ...baseMeter,
        label: "grok-4 query limit"
      })
    ).toBe("grok-4 查询额度");
  });

  it("localizes meter values", () => {
    expect(
      formatMeterValueLocalized("zh-CN", {
        ...baseMeter,
        remainingPercent: 43.2
      })
    ).toBe("43% 剩余");
    expect(
      formatMeterValueLocalized("en", {
        ...baseMeter,
        remainingPercent: 43.2
      })
    ).toBe("43% remaining");
    expect(
      formatMeterValueLocalized("en", {
        ...baseMeter,
        used: 2,
        total: 5
      })
    ).toBe("Used 2/5");
  });

  it("localizes relative ages and reset durations", () => {
    expect(formatAgeLocalized("zh-CN", 0, 2_000)).toBe("刚刚");
    expect(formatAgeLocalized("en", 0, 2_000)).toBe("just now");
    expect(formatAgeLocalized("zh-CN", 0, 20_000)).toBe("20秒前");
    expect(formatAgeLocalized("en", 0, 20_000)).toBe("20s ago");

    const meter: UsageMeter = {
      ...baseMeter,
      resetAfterSeconds: 90
    };
    expect(formatResetLocalized("zh-CN", meter, 0)).toBe("1分钟");
    expect(formatResetLocalized("en", meter, 0)).toBe("1m");
  });
});
