export const MUSE_ACTION_ID = "4079f81de7e3c60f654eca235aabf4d39f9bf920af";
export const MUSE_SCRIPT = `(0,l.createServerReference)("${MUSE_ACTION_ID}",l.callServer,void 0,l.findSourceMapURL,"fetchSubscriptionAction")`;
export const MUSE_RESPONSE = {
  success: true,
  subscription: {
    tier: { tierId: "hatch_free", name: "Muse 免费版", isPaid: false },
    usage: { state: "METERED", percentUsed: 45, resetsAt: 1792246921, quotaStatus: "SUFFICIENT" },
    usageRowLabel: "免费版",
    topupBalance: 40000000,
    topupTotal: 40000000,
    topupRowLabel: "额外的使用额度",
    topupRowValueLabel: "已使用 0%（剩余 10 亿个词元）",
    agreement: { privateField: "synthetic-billing-data" }
  }
};
export function museRsc(value: unknown = MUSE_RESPONSE): string {
  return `0:{"a":"$@1","f":"","b":"deployment"}\n1:${JSON.stringify(value)}\n`;
}
