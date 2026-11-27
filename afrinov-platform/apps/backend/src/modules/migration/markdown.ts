// Text for a cell of a Markdown table in the import reports. A `|` would end
// the cell, so it is escaped; a backslash is escaped first, or a value ending
// in `\` would turn the escape of the next `|` back into a column break
// (CodeQL js/incomplete-sanitization).
export const mdCell = (s: string | null | undefined): string => (s ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
