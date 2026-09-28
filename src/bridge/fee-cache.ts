import type { Network } from "../types";
import { circleJson } from "./cctp-api";
import { quoteFee, type CctpRoute } from "./cctp";

/** Display quotes share validated fee parameters, never an amount-specific fee. */
export class CircleFeeCache {
  private entries = new Map<string, Promise<unknown>>();

  async quote(
    amount: bigint,
    route: CctpRoute,
    network: Network,
    fresh = false,
  ) {
    const key = `${network}:${route}`;
    let request = this.entries.get(key);
    if (!request || fresh) {
      request = circleJson(undefined, route, network).then((data) => {
        quoteFee(data, 0n, route);
        return data;
      });
      this.entries.set(key, request);
    }
    try {
      return quoteFee(await request, amount, route);
    } catch (error) {
      if (this.entries.get(key) === request) this.entries.delete(key);
      throw error;
    }
  }
}
