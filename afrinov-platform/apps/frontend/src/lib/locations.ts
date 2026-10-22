// How a location is named wherever someone picks one: a rack with the room it
// stands in ("D-1 · Main Storeroom"), anything else by its own name. Stock is
// booked to the location itself; the room only says where to find it. In the
// stock workbook a rack code and a room share one column, so the room is new.

/** What a location needs to be named: its own name and the room it stands in, if any. */
export interface NamedLocation {
  name: string;
  parent?: { name: string } | null;
}

/** "D-1 · Main Storeroom" for a location inside a room, else the location's name. */
export function locationLabel(l: NamedLocation): string {
  return l.parent ? `${l.name} · ${l.parent.name}` : l.name;
}
