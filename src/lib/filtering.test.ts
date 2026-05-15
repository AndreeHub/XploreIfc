import { describe, expect, it } from "vitest";
import { buildClassSuggestions, createFilterChip, filterEntities } from "./filtering";
import { parseIfcText } from "./ifcParser";
import { classNameLookup } from "./schema";

const index = parseIfcText(
  `DATA;
#1=IFCWALL('gid',$,'North wall',$,$,$,$,'W-1');
#2=IFCBEAM('gid2',$,'Main beam',$,$,$,$,'B-1');
#3=IFCCARTESIANPOINT((0.,0.,0.));
ENDSEC;`,
  { classNameLookup }
);

describe("filtering", () => {
  it("creates class, id, and text chips", () => {
    expect(createFilterChip("ifcwall")?.type).toBe("class");
    expect(createFilterChip("3")?.value).toBe("#3");
    expect(createFilterChip("North")?.type).toBe("text");
  });

  it("filters entities with OR semantics", () => {
    const wall = createFilterChip("IfcWall");
    const id = createFilterChip("#3");
    const results = filterEntities(index, [wall!, id!]);

    expect(results.map((entity) => entity.id)).toEqual(["#1", "#3"]);
  });

  it("suggests loaded classes before schema-only matches", () => {
    const suggestions = buildClassSuggestions("ifc", index, 3);
    expect(suggestions).toContain("IfcWall");
    expect(suggestions).toContain("IfcBeam");
  });
});
