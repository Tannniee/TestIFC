export interface PropertyGroup {
  name: string;
  rows: Array<{ name: string; value: string }>;
}

export interface BimElementRecord {
  properties?: Record<string, unknown>;
  quantities?: Record<string, unknown>;
  units?: Record<string, unknown>;
  type?: Record<string, unknown>;
  material?: Record<string, unknown>;
  classifications?: Array<Record<string, unknown>>;
  spatialPath?: Array<Record<string, unknown>>;
  groups?: Array<Record<string, unknown>>;
  systems?: Array<Record<string, unknown>>;
}

function rowsFrom(value: unknown): PropertyGroup["rows"] {
  const rows: PropertyGroup["rows"] = [];
  const visit = (item: unknown, name: string) => {
    if (item === null || item === undefined) return;
    if (Array.isArray(item)) {
      item.forEach((child, index) => visit(child, `${name} [${index + 1}]`));
    } else if (typeof item === "object") {
      for (const [key, child] of Object.entries(item)) {
        if (key === "id") continue; // IfcOpenShell's internal entity ID is not a Pset value.
        visit(child, name ? `${name} / ${key}` : key);
      }
    } else {
      rows.push({ name, value: String(item) });
    }
  };
  visit(value, "");
  return rows;
}

export function bimPropertyGroups(record: BimElementRecord, section: "properties" | "relations"): PropertyGroup[] {
  const groups: PropertyGroup[] = [];
  const add = (name: string, value: unknown) => {
    const rows = rowsFrom(value);
    if (rows.length) groups.push({ name, rows });
  };
  if (section === "properties") {
    for (const [name, value] of Object.entries(record.properties ?? {})) add(name, value);
    const quantityStart = groups.length;
    for (const [name, value] of Object.entries(record.quantities ?? {})) add(name, value);
    if (groups.length > quantityStart) add("Quantity units", record.units);
  } else {
    record.spatialPath?.forEach((item, index) =>
      add(`Spatial ${index + 1}: ${String(item.name || item.ifcType || "Element")}`, item));
    add("Type", record.type);
    add("Material", record.material);
    record.groups?.forEach((item, index) => add(`Group ${index + 1}`, item));
    record.systems?.forEach((item, index) => add(`System ${index + 1}`, item));
    record.classifications?.forEach((item, index) => add(`Classification ${index + 1}`, item));
  }
  return groups;
}
