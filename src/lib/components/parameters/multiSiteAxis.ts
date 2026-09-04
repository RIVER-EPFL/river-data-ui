/**
 * The y-axis label for a multi-site plot. The unit is dropped when the plotted sites disagree on
 * one: the values share a single scale, and naming one site's unit misreads the others.
 */
export function axisLabel(parameterName: string, units: string | null | undefined, mixedUnits: boolean): string {
	return units && !mixedUnits ? `${parameterName} (${units})` : parameterName;
}
