import { generatedClassNames } from "../data/classNames.generated";

export const allSchemaClassNames = [...generatedClassNames];

export const classNameLookup: Record<string, string> = Object.fromEntries(
  allSchemaClassNames.map((className) => [className.toUpperCase(), className])
);
