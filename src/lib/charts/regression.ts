export interface RegressionResult {
	slope: number;
	intercept: number;
	rSquared: number;
	n: number;
}

/** Compute linear regression: y = slope * x + intercept, plus R-squared. */
export function linearRegression(xs: number[], ys: number[]): RegressionResult | null {
	const n = xs.length;
	if (n < 2) return null;

	let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
	for (let i = 0; i < n; i++) {
		sumX += xs[i];
		sumY += ys[i];
		sumXY += xs[i] * ys[i];
		sumX2 += xs[i] * xs[i];
	}

	const denom = n * sumX2 - sumX * sumX;
	if (denom === 0) return null;

	const slope = (n * sumXY - sumX * sumY) / denom;
	const intercept = (sumY - slope * sumX) / n;

	const yMean = sumY / n;
	let ssTot = 0, ssRes = 0;
	for (let i = 0; i < n; i++) {
		ssTot += (ys[i] - yMean) ** 2;
		ssRes += (ys[i] - (slope * xs[i] + intercept)) ** 2;
	}
	const rSquared = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

	return { slope, intercept, rSquared, n };
}
