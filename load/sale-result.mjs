// Version-specific TanStack Start response contract, verified against base2.
// HTTP 200 also carries serialized application errors: require a sale UUID.
export function saleResult(body) {
  try {
    const envelope = JSON.parse(body);
    const field = (value, key) => {
      const index = value?.p?.k?.indexOf(key) ?? -1;
      return index >= 0 ? value.p.v[index] : undefined;
    };
    const error = field(envelope, "error");
    if (error && error.t !== 2) return { ok: false, err: "application error" };
    const result = field(envelope, "result");
    const saleId = field(result, "saleId")?.s;
    if (typeof saleId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saleId)) {
      return { ok: false, err: "response has no saleId UUID" };
    }
    return { ok: true, saleId };
  } catch {
    return { ok: false, err: "invalid sale response JSON" };
  }
}
