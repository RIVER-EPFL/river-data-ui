// A visit's deep link on its site's Visits tab, and the parameter record it opens on.

/** Where a visit opens, on a parameter's record when one is named. Prefix with `base`. */
export function visitHref(
  siteId: string,
  eventId: string,
  parameterId?: string | null,
): string {
  const path = `/sites/${siteId}?tab=visits&event=${eventId}`;
  return parameterId ? `${path}&parameter=${parameterId}` : path;
}

/**
 * The parameter a deep link opens the visit on: `parameter` names it, `point` names its site
 * parameter. One the site does not report opens nothing.
 */
export function deepLinkParameter(
  params: URLSearchParams,
  siteParameters: readonly { id: string; parameter_id: string }[],
): string | null {
  const parameter = params.get("parameter");
  if (parameter)
    return siteParameters.some((s) => s.parameter_id === parameter)
      ? parameter
      : null;
  const point = params.get("point");
  return siteParameters.find((s) => s.id === point)?.parameter_id ?? null;
}
