import type { IfcSchemaName } from "./ifc";

export interface SchemaAttribute {
  name: string;
  description?: string;
  optional: boolean;
  type: string;
}

export interface SchemaEntity {
  description?: string;
  specUrl?: string;
  abstract: boolean;
  attributes: SchemaAttribute[];
  predefinedTypes?: Record<string, string>;
}

export interface SchemaDefinition {
  entities: Record<string, SchemaEntity>;
}

export type GeneratedSchemaCatalog = Record<Exclude<IfcSchemaName, "UNKNOWN">, SchemaDefinition>;
