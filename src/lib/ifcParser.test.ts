import { describe, expect, it } from "vitest";
import { parseIfcText } from "./ifcParser";
import { classNameLookup } from "./schema";

const text = `ISO-10303-21;
HEADER;
FILE_SCHEMA(('IFC2X3'));
ENDSEC;
DATA;
#1=IFCORGANIZATION($,'Autodesk; Revit',$,$,$);
#2=IFCAPPLICATION(#1,'2023','Autodesk Revit','Revit');
#3=IFCPERSON($,'Doe','Ada',$,$,$,$,$);
#4=IFCPERSONANDORGANIZATION(#3,#1,$);
#5=IFCOWNERHISTORY(#4,#2,$,.ADDED.,$,$,$,1696925785);
#6=IFCCARTESIANPOINT(
  (0.,0.,0.)
);
#7=IFCRELASSOCIATESMATERIAL('gid',#5,$,$,(#6,#999),#8);
ENDSEC;
END-ISO-10303-21;`;

describe("parseIfcText", () => {
  it("parses schema, multiline entities, strings, and class names", () => {
    const index = parseIfcText(text, { classNameLookup });

    expect(index.schema).toBe("IFC2X3");
    expect(index.byId["#1"]?.className).toBe("IfcOrganization");
    expect(index.byId["#6"]?.args[0]?.raw).toBe("(0.,0.,0.)");
    expect(index.orderedIds).toHaveLength(7);
  });

  it("indexes outgoing and incoming references including unresolved targets", () => {
    const index = parseIfcText(text, { classNameLookup });

    expect(index.outgoing["#7"]).toEqual(["#5", "#6", "#999", "#8"]);
    expect(index.incoming["#6"]).toEqual(["#7"]);
    expect(index.incoming["#999"]).toEqual(["#7"]);
  });

  it("keeps STEP argument order for hover mapping", () => {
    const index = parseIfcText(text, { classNameLookup });
    const ownerHistory = index.byId["#5"];

    expect(ownerHistory?.args.map((arg) => arg.raw)).toEqual(["#4", "#2", "$", ".ADDED.", "$", "$", "$", "1696925785"]);
  });
});
