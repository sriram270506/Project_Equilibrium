export function formatPaise(paise: number): string {
  assertValidPaise(paise);
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", {
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
  if (!Number.isInteger(value)) {
    throw new Error(`Invalid paise amount: ${value} is not an integer`);
  }
  if (value < 0) {
    throw new Error(`Invalid paise amount: ${value} is negative`);
  }
}

export function addPaise(a: number, b: number): number {
  assertValidPaise(a);
  assertValidPaise(b);
  return a + b;
}

export function subtractPaise(a: number, b: number): number {
  assertValidPaise(a);
  assertValidPaise(b);
  const result = a - b;
  if (result < 0) {
    throw new Error(
      `Invalid subtraction: ${a} - ${b} = ${result} (negative)`
    );
  }
  return result;
}

export function percentageOfPaise(amount: number, basisPoints: number): number {
  assertValidPaise(amount);
  if (!Number.isInteger(basisPoints)) {
    throw new Error(`Basis points must be an integer: ${basisPoints}`);
  }
  const result = Math.round((amount * basisPoints) / 10000);
  assertValidPaise(result);
  return result;
}

export function basisPointsToPercentage(bps: number): number {
  return bps / 100;
}

export function percentageToBasisPoints(percentage: number): number {
  return Math.round(percentage * 100);
}
