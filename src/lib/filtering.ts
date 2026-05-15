import type { FilterChip, IfcEntity, IfcIndex } from "../types/ifc";
import { allSchemaClassNames, classNameLookup } from "./classNames";

export function createFilterChip(value: string, existing: FilterChip[] = []): FilterChip | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const id = normalizeId(trimmed);
  const type = id ? "id" : isLikelyClass(trimmed) ? "class" : "text";
  let normalizedValue: string;
  if (type === "id") normalizedValue = id ?? trimmed;
  else if (type === "class") normalizedValue = canonicalClass(trimmed);
  else normalizedValue = trimmed;
  const label = normalizedValue;
  const chipId = `${type}:${normalizedValue.toUpperCase()}`;

  if (existing.some((chip) => chip.id === chipId)) return undefined;
  return { id: chipId, type, value: normalizedValue, label };
}

export function filterEntities(index: IfcIndex, filters: FilterChip[], sourceText?: string): IfcEntity[] {
  if (filters.length === 0) return index.orderedIds.map((id) => index.byId[id]).filter(Boolean) as IfcEntity[];

  const indexedFilters = filters.filter((filter) => filter.type === "id" || filter.type === "class");
  const textFilters = filters.filter((filter) => filter.type === "text");

  if (textFilters.length === 0) {
    const ids = new Set<string>();
    indexedFilters.forEach((filter) => {
      if (filter.type === "id" && index.byId[filter.value]) ids.add(filter.value);
      if (filter.type === "class") {
        (index.byClass[filter.value] ?? index.byClass[filter.value.toUpperCase()] ?? []).forEach((id) => ids.add(id));
      }
    });
    return [...ids]
      .map((id) => index.byId[id])
      .filter((entity): entity is IfcEntity => Boolean(entity))
      .sort((a, b) => a.start - b.start);
  }

  const indexedMatches = new Set<string>();
  indexedFilters.forEach((filter) => {
    if (filter.type === "id" && index.byId[filter.value]) indexedMatches.add(filter.value);
    if (filter.type === "class") {
      (index.byClass[filter.value] ?? index.byClass[filter.value.toUpperCase()] ?? []).forEach((id) => indexedMatches.add(id));
    }
  });

  return index.orderedIds
    .map((id) => index.byId[id])
    .filter((entity): entity is IfcEntity => Boolean(entity))
    .filter((entity) => indexedMatches.has(entity.id) || textFilters.some((filter) => entityMatchesFilter(entity, filter, sourceText)));
}

export function buildFilteredText(entities: IfcEntity[], sourceText?: string): string {
  return entities.map((entity) => entityRaw(entity, sourceText)).join("\n\n");
}

export function buildClassSuggestions(query: string, index: IfcIndex, limit = 8): string[] {
  const normalized = query.trim().toUpperCase();
  const loadedClasses = Object.keys(index.classCounts).sort((a, b) => {
    const countDelta = (index.classCounts[b] ?? 0) - (index.classCounts[a] ?? 0);
    return countDelta || a.localeCompare(b);
  });
  const candidates = unique([...loadedClasses, ...allSchemaClassNames]);
  if (!normalized) return candidates.slice(0, limit);
  return candidates.filter((className) => className.toUpperCase().includes(normalized)).slice(0, limit);
}

function entityMatchesFilter(entity: IfcEntity, filter: FilterChip, sourceText?: string): boolean {
  if (filter.type === "id") return entity.id.toUpperCase() === filter.value.toUpperCase();
  if (filter.type === "class") return entity.className.toUpperCase() === filter.value.toUpperCase();
  return entityRaw(entity, sourceText).toLowerCase().includes(filter.value.toLowerCase());
}

export function entityRaw(entity: IfcEntity, sourceText?: string): string {
  return entity.raw || sourceText?.slice(entity.start, entity.end) || "";
}

function normalizeId(value: string): string | undefined {
  const match = value.match(/^#?(\d+)$/);
  return match?.[1] ? `#${match[1]}` : undefined;
}

function isLikelyClass(value: string): boolean {
  const canonical = classNameLookup[value.toUpperCase()];
  return Boolean(canonical) || /^ifc[a-z0-9_]+$/i.test(value);
}

function canonicalClass(value: string): string {
  return classNameLookup[value.toUpperCase()] ?? value;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
