/**
 * Parses inline variable tags from LLM output.
 *
 * Canonical format is <var="shot1">...</var>. The parser also accepts a
 * common LLM typo, <var-"shot1">...</var>, so one malformed delimiter does not
 * silently break downstream prompt constructors.
 */
export function parseVarTags(text: string): Array<{ name: string; value: string }> {
  const regex = /<var\s*(?:=|-)\s*["']([\w-]+)["']\s*>([\s\S]*?)<\/var>/g;
  const vars: Array<{ name: string; value: string }> = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    vars.push({ name: match[1], value: match[2].trim() });
  }
  return vars;
}
