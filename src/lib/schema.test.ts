import { describe, expect, it } from "vitest";
import { attributeForArgument, classNameLookup } from "./schema";

describe("schema catalog", () => {
  it("maps uppercase IFC classes to canonical schema names", () => {
    expect(classNameLookup.IFCOWNERHISTORY).toBe("IfcOwnerHistory");
  });

  it("uses inherited ordered attributes for IFC instances", () => {
    expect(attributeForArgument("IFC2X3", "IfcOwnerHistory", 0)?.name).toBe("OwningUser");
    expect(attributeForArgument("IFC2X3", "IfcOwnerHistory", 3)?.name).toBe("ChangeAction");
    expect(attributeForArgument("IFC4", "IfcWall", 0)?.name).toBe("GlobalId");
  });
});
