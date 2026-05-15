export type IfcSchemaName = "IFC2X3" | "IFC4" | "IFC4X3" | "UNKNOWN";

export interface IfcArgument {
  raw: string;
  start: number;
  end: number;
  refs: string[];
}

export interface IfcEntity {
  id: string;
  className: string;
  rawClassName: string;
  raw: string;
  start: number;
  end: number;
  lineStart: number;
  lineEnd: number;
  args: IfcArgument[];
  refs: string[];
}

export interface IfcLine {
  lineNumber: number;
  text: string;
  start: number;
}

export interface IfcTextSource {
  getLineRange(startLine: number, count: number): Promise<IfcLine[]>;
  getEntityById(expressId: string): Promise<IfcEntity | null>;
  getLineCountEstimate(): Promise<number>;
  dispose(): void;
}

export interface IfcIndex {
  schema: IfcSchemaName;
  byId: Record<string, IfcEntity>;
  byClass: Record<string, string[]>;
  outgoing: Record<string, string[]>;
  incoming: Record<string, string[]>;
  classCounts: Record<string, number>;
  orderedIds: string[];
  parseErrors: string[];
  lineCount: number;
  lineStarts: number[];
}

export interface FilterChip {
  id: string;
  type: "class" | "id" | "text";
  value: string;
  label: string;
}

export interface ChainStep {
  id: string;
  className: string;
  sourceId?: string;
  argumentIndex?: number;
  attributeName?: string;
}

export interface SavedQuery {
  id: string;
  name: string;
  filters: FilterChip[];
}

export interface ReferenceClick {
  refId: string;
  sourceId?: string;
  argumentIndex?: number;
  attributeName?: string;
}

export interface HoverInfo {
  id: string;
  className: string;
  argumentIndex?: number;
  attributeName?: string;
  attributeDescription?: string;
  target?: {
    id: string;
    className: string;
    name?: string;
    lineStart: number;
  };
}
