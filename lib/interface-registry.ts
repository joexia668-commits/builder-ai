import type {
  DecomposerOutput,
  ModuleDefinition,
  ModuleContract,
  ModuleStatus,
  ExportEntry,
  ContractVerifyResult,
} from "@/lib/types";
import { extractStructuredExports } from "@/lib/extract-exports";

export interface InterfaceRegistry {
  registerActual(moduleName: string, files: Record<string, string>): void;
  markCompleted(moduleName: string): void;
  markFailed(moduleName: string, reason: string): void;
  markDegraded(moduleName: string, stubbedExports: string[]): void;
  getContract(moduleName: string): ModuleContract;
  getStatus(moduleName: string): ModuleStatus;
  getActualExports(moduleName: string): ExportEntry[];
  getConsumers(moduleName: string, allModules: readonly ModuleDefinition[]): string[];
  verifyContract(moduleName: string): ContractVerifyResult;
  toContextSummary(): string;
}

export function createInterfaceRegistry(output: DecomposerOutput): InterfaceRegistry {
  const contracts = new Map<string, ModuleContract>();

  for (const mod of output.modules) {
    contracts.set(mod.name, {
      declared: {
        exports: [...mod.interface.exports],
        consumes: [...mod.interface.consumes],
        stateContract: mod.interface.stateContract,
      },
      actual: null,
      status: "pending",
    });
  }

  function getOrThrow(moduleName: string): ModuleContract {
    const c = contracts.get(moduleName);
    if (!c) throw new Error(`Unknown module: ${moduleName}`);
    return c;
  }

  return {
    registerActual(moduleName: string, files: Record<string, string>): void {
      const contract = getOrThrow(moduleName);
      const exports = extractStructuredExports(files);
      contract.actual = {
        exports,
        filePaths: Object.keys(files),
      };
    },

    markCompleted(moduleName: string): void {
      getOrThrow(moduleName).status = "completed";
    },

    markFailed(moduleName: string, reason: string): void {
      const c = getOrThrow(moduleName);
      c.status = "failed";
      c.failureReason = reason;
    },

    markDegraded(moduleName: string, stubbedExports: string[]): void {
      const c = getOrThrow(moduleName);
      c.status = "degraded";
      c.degradedExports = stubbedExports;
    },

    getContract(moduleName: string): ModuleContract {
      return getOrThrow(moduleName);
    },

    getStatus(moduleName: string): ModuleStatus {
      return getOrThrow(moduleName).status;
    },

    getActualExports(moduleName: string): ExportEntry[] {
      return [...(getOrThrow(moduleName).actual?.exports ?? [])];
    },

    getConsumers(moduleName: string, allModules: readonly ModuleDefinition[]): string[] {
      return allModules
        .filter((m) => m.deps.includes(moduleName))
        .map((m) => m.name);
    },

    verifyContract(moduleName: string): ContractVerifyResult {
      const contract = getOrThrow(moduleName);
      const declaredNames = contract.declared.exports;
      const actualNames = (contract.actual?.exports ?? []).map((e) => e.name);
      const actualSet = new Set(actualNames);
      const declaredSet = new Set(declaredNames);

      const missingExports = declaredNames.filter((n) => !actualSet.has(n));
      const extraExports = actualNames.filter((n) => !declaredSet.has(n));

      return {
        satisfied: missingExports.length === 0,
        missingExports,
        extraExports,
      };
    },

    toContextSummary(): string {
      const lines: string[] = ["## 模块接口注册表"];
      for (const [name, contract] of contracts) {
        const status = contract.status;
        lines.push(`${name} [${status}]:`);

        if (contract.actual && contract.actual.exports.length > 0) {
          const exportStrs = contract.actual.exports.map(
            (e) => `${e.name} (${e.kind}, ${e.filePath})`
          );
          lines.push(`  exports: ${exportStrs.join(", ")}`);
          lines.push(`  files: ${contract.actual.filePaths.join(", ")}`);
        } else if (status === "pending") {
          lines.push(`  exports: (pending)`);
        } else if (status === "failed") {
          lines.push(`  失败原因: ${contract.failureReason ?? "unknown"}`);
        } else if (status === "degraded") {
          lines.push(`  降级 exports: ${(contract.degradedExports ?? []).join(", ")}`);
        }
      }
      return lines.join("\n");
    },
  };
}
