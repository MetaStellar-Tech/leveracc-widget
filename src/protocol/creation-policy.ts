import type { ResolvedConfig } from "../core/config";
export type CreationFlow = "combined" | "gas_only" | "activation_only" | "none";
export function creationFlow(config: ResolvedConfig): CreationFlow {
  // The original opt-out still uses the original combined funding route.
  if (config.creationLegacyMode) return "combined";
  return config.creationGasConversionEnabled
    ? config.creationAccountActivationEnabled
      ? "combined"
      : "gas_only"
    : config.creationAccountActivationEnabled
      ? "activation_only"
      : "none";
}
export const creationAmount = (flow: CreationFlow) =>
  flow === "none" ? "0" : flow === "activation_only" ? "1100000" : "3000000";
export const flowEndpoint = (flow: CreationFlow) =>
  flow === "activation_only"
    ? "account-activations"
    : flow === "gas_only"
      ? "gas-conversions"
      : "gas-top-ups";
