import { generatedSchemaCatalog } from "../data/schemaCatalog.generated";
import type { HoverInfo, IfcEntity, IfcIndex, IfcSchemaName } from "../types/ifc";
import type { GeneratedSchemaCatalog, SchemaAttribute, SchemaDefinition, SchemaEntity } from "../types/schema";
import { allSchemaClassNames, classNameLookup } from "./classNames";

export const schemaCatalog: GeneratedSchemaCatalog = generatedSchemaCatalog;
export { allSchemaClassNames, classNameLookup };

export function schemaForName(schemaName: IfcSchemaName): SchemaDefinition | undefined {
  if (schemaName === "UNKNOWN") return undefined;
  return schemaCatalog[schemaName];
}

export function entitySchema(schemaName: IfcSchemaName, className: string): SchemaEntity | undefined {
  return schemaForName(schemaName)?.entities[className] ?? findEntityInAnySchema(className);
}

export function attributeForArgument(schemaName: IfcSchemaName, className: string, argumentIndex: number): SchemaAttribute | undefined {
  return entitySchema(schemaName, className)?.attributes[argumentIndex];
}

export function summarizeEntity(entity?: IfcEntity): string | undefined {
  if (!entity) return undefined;
  const name = entity.args[2]?.raw;
  const tag = entity.args[7]?.raw;
  const cleanName = cleanIfcString(name);
  const cleanTag = cleanIfcString(tag);
  return cleanName || cleanTag || undefined;
}

export function buildHoverInfo(index: IfcIndex, entity: IfcEntity, argumentIndex?: number, refId?: string): HoverInfo {
  const attribute = typeof argumentIndex === "number" ? attributeForArgument(index.schema, entity.className, argumentIndex) : undefined;
  const target = refId ? index.byId[refId] : undefined;
  return {
    id: entity.id,
    className: entity.className,
    argumentIndex,
    attributeName: attribute?.name,
    attributeDescription: attribute?.description,
    target: target
      ? {
          id: target.id,
          className: target.className,
          name: summarizeEntity(target),
          lineStart: target.lineStart
        }
      : undefined
  };
}

function findEntityInAnySchema(className: string): SchemaEntity | undefined {
  const canonical = classNameLookup[className.toUpperCase()] ?? className;
  for (const schema of Object.values(schemaCatalog)) {
    const entity = schema.entities[canonical];
    if (entity) return entity;
  }
  return undefined;
}

function cleanIfcString(value?: string): string | undefined {
  if (!value || value === "$" || value === "*") return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith("'") || !trimmed.endsWith("'")) return trimmed;
  return trimmed.slice(1, -1).replace(/''/g, "'");
}
