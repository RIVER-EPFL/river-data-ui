/** A visit as the choice reads it: which one it is, and whether it carries anything. */
interface Candidate {
  id: string;
  parameters_filled: number;
}

/**
 * The visit a page opens on, given the site's visits newest first: the one a link names while the
 * site still holds it, else the latest carrying values, so the tables fill on choosing a site.
 */
export function visitToOpen(visits: Candidate[], keep = ""): string {
  if (keep && visits.some((v) => v.id === keep)) return keep;
  return (visits.find((v) => v.parameters_filled > 0) ?? visits[0])?.id ?? "";
}
