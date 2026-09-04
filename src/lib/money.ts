export function formatPaise(paise: number): string {
  assertValidPaise(paise);
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

export function rupeesToPaise(value: string | number): number {
  const num = typeof value === "string" ? parseFloat(value) : value;
  const paise = Math.round(num * 100);
  assertValidPaise(paise);
  return paise;
}

export function assertValidPaise(value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Invalid paise amount: ${value} is not an integer`);
  }
  if (value < 0) {
    throw new Error(`Invalid paise amount: ${value} is negative`);
  }
}

export function addPaise(a: number, b: number): number {
  assertValidPaise(a);
  assertValidPaise(b);
  const result = a + b;
  assertValidPaise(result);
  return result;
}

export function subtractPaise(a: number, b: number): number {
  assertValidPaise(a);
  assertValidPaise(b);
  const result = a - b;
  assertValidPaise(result);
  return result;
}

export function multiplyPaise(amount: number, factor: number): number {
  assertValidPaise(amount);
  if (typeof factor !== "number" || !Number.isFinite(factor) || Number.isNaN(factor)) {
    throw new Error(`Factor must be a valid finite number: ${factor}`);
  }
  const result = Math.round(amount * factor);
  assertValidPaise(result);
  return result;
}

export function percentageOfPaise(amount: number, basisPoints: number): number {
  assertValidPaise(amount);
  if (!Number.isInteger(basisPoints) || basisPoints < 0) {
    throw new Error(`Basis points must be a non-negative integer: ${basisPoints}`);
  }
  const result = Math.round((amount * basisPoints) / 10000);
  assertValidPaise(result);
  return result;
}

export function basisPointsToPercentage(bps: number): number {
  if (typeof bps !== "number" || !Number.isFinite(bps) || Number.isNaN(bps)) {
    throw new Error(`Basis points must be a valid number: ${bps}`);
  }
  return bps / 100;
}

export function percentageToBasisPoints(percentage: number): number {
  if (typeof percentage !== "number" || !Number.isFinite(percentage) || Number.isNaN(percentage) || percentage < 0) {
    throw new Error(`Percentage must be a non-negative number: ${percentage}`);
  }
  const result = Math.round(percentage * 100);
  if (!Number.isSafeInteger(result)) {
    throw new Error(`Percentage produces an unsafe basis-point value: ${percentage}`);
  }
  return result;
}
