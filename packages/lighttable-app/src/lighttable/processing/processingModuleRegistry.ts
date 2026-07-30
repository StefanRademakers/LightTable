import {
  CURRENT_PROCESSING_MODULES,
  type CurrentAdjustmentSettingsPath,
  type ProcessingModuleDefinition,
  type ProcessingScope
} from './moduleDefinitions';

/**
 * Immutable registry for serializable processing-module contracts.
 *
 * Registration validates stable type identity and exclusive ownership of each
 * legacy settings path. GPU implementations remain outside this metadata
 * boundary and can be attached by the evaluator without changing documents.
 */
export class ProcessingModuleRegistry {
  private readonly orderedDefinitions: readonly ProcessingModuleDefinition[];
  private readonly definitionsByType: ReadonlyMap<string, ProcessingModuleDefinition>;

  constructor(definitions: readonly ProcessingModuleDefinition[]) {
    const byType = new Map<string, ProcessingModuleDefinition>();
    const pathOwners = new Map<CurrentAdjustmentSettingsPath, string>();

    for (const definition of definitions) {
      if (byType.has(definition.type)) {
        throw new Error(`Duplicate processing module type: ${definition.type}`);
      }
      byType.set(definition.type, definition);

      for (const path of definition.settingsPaths) {
        const owner = pathOwners.get(path);
        if (owner) {
          throw new Error(
            `Processing settings path "${path}" is owned by both ${owner} and ${definition.type}`
          );
        }
        pathOwners.set(path, definition.type);
      }
    }

    this.orderedDefinitions = [...definitions];
    this.definitionsByType = byType;
  }

  definitions(): readonly ProcessingModuleDefinition[] {
    return this.orderedDefinitions;
  }

  definition(type: string): ProcessingModuleDefinition | undefined {
    return this.definitionsByType.get(type);
  }

  has(type: string): boolean {
    return this.definitionsByType.has(type);
  }

  allows(type: string, scope: ProcessingScope): boolean {
    return this.definition(type)?.allowedScopes.includes(scope) ?? false;
  }
}

export const currentProcessingModuleRegistry =
  new ProcessingModuleRegistry(CURRENT_PROCESSING_MODULES);
