/**
 * Invoice fixtures for the AI controller.
 *
 * GROUNDING. These are synthetic records, but every rule they are checked
 * against is real, and the anomaly types are the ones Indian B2B AP teams
 * actually see:
 *
 *   - MSMED Act 2006, s.15: a buyer must pay a registered micro/small
 *     enterprise within 45 days. Terms beyond that are a statutory breach and
 *     accrue compound interest at 3x the RBI bank rate (s.16). One fixture
 *     below breaches it deliberately.
 *   - GSTIN is 15 characters: 2-digit state code, 10-character PAN, 1-digit
 *     entity number, "Z", then a checksum. `validateGstin` checks the real
 *     structure, so a malformed one here fails for the real reason.
 *   - GST at 18% is the standard rate for most B2B goods and services.
 *   - Arithmetic: subtotal + tax must equal total. Off-by-a-rupee is the most
 *     common genuine extraction error, and the most commonly missed fraud.
 *
 * Scale reference, from public sources rather than invention:
 *   - MSME Samadhaan has logged ~2.18 lakh delayed-payment applications since
 *     2017, ~Rs 22,363 crore still pending as of July 2025.
 *   - TReDS discounting grew from ~Rs 40,000 crore (FY22) to ~Rs 3.47 lakh
 *     crore (FY26) across five RBI-licensed platforms.
 *
 * The invoice values below sit in the Rs 40,000 - Rs 12,00,000 band, which is
 * where the bulk of MSME B2B invoicing actually happens.
 */

export interface InvoiceFixture {
  /** Stable id so a reviewer can navigate straight to a known case. */
  id: string;
  vendorName: string;
  vendorGstin: string;
  invoiceNumber: string;
  /** Days before the reference date this invoice was raised. */
  invoiceDaysAgo: number;
  /** Payment terms in days. Over 45 breaches the MSMED Act. */
  termsDays: number;
  subtotalPaise: number;
  taxPaise: number;
  /** Deliberately allowed to disagree with subtotal + tax. */
  totalPaise: number;
  fileName: string;
  /** What a reviewer should notice. Drives the seeded reason codes. */
  expectedReasons: string[];
  /** One line for the UI explaining why this case exists. */
  teachingNote: string;
}

const GST_RATE = 0.18;

/** Subtotal plus 18% GST, both in paise, arithmetic correct. */
function withGst(subtotalPaise: number) {
  const taxPaise = Math.round(subtotalPaise * GST_RATE);
  return { subtotalPaise, taxPaise, totalPaise: subtotalPaise + taxPaise };
}

export const INVOICE_FIXTURES: InvoiceFixture[] = [
  /* ------------------------------------------------------------ clean ---- */
  {
    id: "inv_001",
    vendorName: "Aarav Industrial Components",
    vendorGstin: "27AABCA1234K1Z5",
    invoiceNumber: "AIC/2026/0417",
    invoiceDaysAgo: 12,
    termsDays: 45,
    ...withGst(4_20_000_00),
    fileName: "aic-2026-0417.pdf",
    expectedReasons: [],
    teachingNote:
      "The control case. Arithmetic correct, GSTIN well-formed, terms exactly at the MSMED 45-day limit. Everything the checks look for is satisfied, so the anomaly score should be low.",
  },
  {
    id: "inv_002",
    vendorName: "Sundaram Electricals",
    vendorGstin: "33AAGCS8821P1ZB",
    invoiceNumber: "SE-26-1188",
    invoiceDaysAgo: 8,
    termsDays: 30,
    ...withGst(2_75_400_00),
    fileName: "se-26-1188.pdf",
    expectedReasons: [],
    teachingNote:
      "A second clean invoice from a long-tenured vendor on 30-day terms. Present so 'clean' is not a single data point.",
  },

  /* --------------------------------------------------- arithmetic fault -- */
  {
    id: "inv_003",
    vendorName: "Vindhya Textile Mills",
    vendorGstin: "24AACCV5567H1Z9",
    invoiceNumber: "VTM/APR/2291",
    invoiceDaysAgo: 15,
    termsDays: 45,
    subtotalPaise: 8_60_000_00,
    taxPaise: 1_54_800_00,
    // Off by Rs 9,000. Subtotal + tax = 10,14,800; this claims 10,23,800.
    totalPaise: 10_23_800_00,
    fileName: "vtm-apr-2291.pdf",
    expectedReasons: ["TOTAL_MISMATCH"],
    teachingNote:
      "Subtotal plus 18% GST comes to Rs 10,14,800 but the invoice totals Rs 10,23,800 — a Rs 9,000 discrepancy. This is the single most common genuine extraction error AND the most common quiet overbilling. Deterministic arithmetic catches it; a language model reading the document might not.",
  },

  /* ------------------------------------------------------- malformed GST - */
  {
    id: "inv_004",
    vendorName: "Kaveri Logistics Parts",
    vendorGstin: "33AAKCL99XX1Z2",
    invoiceNumber: "KLP/2026/0771",
    invoiceDaysAgo: 6,
    termsDays: 45,
    ...withGst(1_18_500_00),
    fileName: "klp-2026-0771.pdf",
    expectedReasons: ["INVALID_GSTIN"],
    teachingNote:
      "The GSTIN is 14 characters and contains 'XX' where the PAN body must be alphanumeric in a fixed pattern. A malformed GSTIN means input tax credit cannot be claimed against this invoice — a direct, quantifiable cash cost, not a cosmetic defect.",
  },

  /* ------------------------------------------------- MSMED Act breach ---- */
  {
    id: "inv_005",
    vendorName: "Bhavani Agro Processing",
    vendorGstin: "37AAECB3390L1ZK",
    invoiceNumber: "BAP/26/0554",
    invoiceDaysAgo: 20,
    // 90-day terms: double the statutory maximum.
    termsDays: 90,
    ...withGst(5_40_000_00),
    fileName: "bap-26-0554.pdf",
    expectedReasons: ["TERMS_EXCEED_MSMED_LIMIT"],
    teachingNote:
      "90-day payment terms against a registered micro enterprise. Section 15 of the MSMED Act 2006 caps this at 45 days; beyond it, section 16 accrues compound interest at three times the RBI bank rate, and the supplier can escalate to an MSEFC council. This is a legal exposure sitting in an accounts-payable queue, and it is exactly the kind of thing nobody notices until a notice arrives.",
  },

  /* ------------------------------------------------------ near-duplicate - */
  {
    id: "inv_006",
    vendorName: "Nila Packaging Works",
    vendorGstin: "33AADCN7712M1Z4",
    invoiceNumber: "NPW-2026-338",
    invoiceDaysAgo: 18,
    termsDays: 45,
    ...withGst(96_000_00),
    fileName: "npw-2026-338.pdf",
    expectedReasons: [],
    teachingNote:
      "The original. Paired with inv_007 to demonstrate near-duplicate detection.",
  },
  {
    id: "inv_007",
    vendorName: "Nila Packaging Works",
    vendorGstin: "33AADCN7712M1Z4",
    // Different invoice number, same vendor, same amount, 11 days apart.
    invoiceNumber: "NPW-2026-341",
    invoiceDaysAgo: 7,
    termsDays: 45,
    ...withGst(96_000_00),
    fileName: "npw-2026-341.pdf",
    expectedReasons: ["SIMILAR_INVOICE"],
    teachingNote:
      "Same vendor, same GSTIN, identical amount to inv_006, eleven days later, under a different invoice number. Duplicate payment is the most expensive error in accounts payable and the hardest to spot by eye, because nothing about either document is individually wrong. Only comparison against history catches it.",
  },

  /* ------------------------------------------------------- future-dated -- */
  {
    id: "inv_008",
    vendorName: "Konkan Marine Exports",
    vendorGstin: "27AAFCK2201R1Z8",
    invoiceNumber: "KME/2026/0912",
    // Negative: dated in the future.
    invoiceDaysAgo: -9,
    termsDays: 45,
    ...withGst(11_80_000_00),
    fileName: "kme-2026-0912.pdf",
    expectedReasons: ["FUTURE_DATED"],
    teachingNote:
      "Dated nine days from now. Either the date was mis-keyed or someone is pulling revenue into an earlier period. At Rs 13.9 lakh it is also the largest invoice in the set, so it clears any value threshold for review.",
  },

  /* ------------------------------------------------ value outlier -------- */
  {
    id: "inv_009",
    vendorName: "Girnar Auto Fasteners",
    vendorGstin: "24AAFCG6654N1Z1",
    invoiceNumber: "GAF/26/2210",
    invoiceDaysAgo: 4,
    termsDays: 45,
    ...withGst(9_75_000_00),
    fileName: "gaf-26-2210.pdf",
    expectedReasons: ["VALUE_OUTLIER"],
    teachingNote:
      "This vendor's previous invoices average around Rs 40,000. This one is Rs 11.5 lakh — roughly 24x their norm. Not necessarily wrong, since a genuine bulk order looks identical, which is precisely why it needs a human rather than an automatic block.",
  },

  /* ----------------------------------------------- round-number signal --- */
  {
    id: "inv_010",
    vendorName: "Deccan Print Solutions",
    vendorGstin: "29AAHCD4478Q1Z6",
    invoiceNumber: "DPS/2026/0088",
    invoiceDaysAgo: 3,
    termsDays: 45,
    subtotalPaise: 5_00_000_00,
    taxPaise: 90_000_00,
    totalPaise: 5_90_000_00,
    fileName: "dps-2026-0088.pdf",
    expectedReasons: ["ROUND_AMOUNT"],
    teachingNote:
      "Exactly Rs 5,00,000 before tax, to the rupee. Real invoices for printed goods almost never land on a round lakh, because they are quantity times unit price. A round number is weak evidence on its own — it is a flag for a second look, not an accusation.",
  },

  /* ------------------------------------------- inverted dates ------------ */
  {
    id: "inv_011",
    vendorName: "Saffron Retail Supply",
    vendorGstin: "08AAJCS1123T1Z3",
    invoiceNumber: "SRS/26/4417",
    invoiceDaysAgo: 10,
    // Negative terms: due date precedes the invoice date.
    termsDays: -5,
    ...withGst(2_10_000_00),
    fileName: "srs-26-4417.pdf",
    expectedReasons: ["DUE_BEFORE_INVOICE"],
    teachingNote:
      "The due date falls five days before the invoice date. Impossible, and it usually means a date field was transposed during extraction — the sort of defect that silently poisons an ageing report and every cash-flow forecast built on it.",
  },

  /* --------------------------------------------- compound failure -------- */
  {
    id: "inv_012",
    vendorName: "Orbit Kitchenware",
    vendorGstin: "36AAGCO5590W1Z7",
    invoiceNumber: "OK/2026/1902",
    invoiceDaysAgo: 25,
    termsDays: 75,
    subtotalPaise: 3_30_000_00,
    taxPaise: 59_400_00,
    // Off by Rs 2,600 AND terms breach the statutory limit.
    totalPaise: 3_92_000_00,
    fileName: "ok-2026-1902.pdf",
    expectedReasons: ["TOTAL_MISMATCH", "TERMS_EXCEED_MSMED_LIMIT"],
    teachingNote:
      "Two independent faults on one document: the arithmetic is off by Rs 2,600 and the terms breach the 45-day statutory limit. Present so the scoring has to combine signals rather than report only the first thing it finds.",
  },
];

/** Reason codes, with what each one means and what it costs. */
export const REASON_CODE_CATALOGUE: Record<
  string,
  { label: string; severity: "HIGH" | "MEDIUM" | "LOW"; meaning: string; cost: string }
> = {
  TOTAL_MISMATCH: {
    label: "Total does not equal subtotal plus tax",
    severity: "HIGH",
    meaning:
      "Deterministic arithmetic check. Subtotal + tax must equal the stated total, to the paisa.",
    cost: "Direct overpayment of the difference, every time it is missed.",
  },
  INVALID_GSTIN: {
    label: "GSTIN is malformed",
    severity: "HIGH",
    meaning:
      "A GSTIN is 15 characters: state code, PAN, entity number, 'Z', checksum. This one does not match that structure.",
    cost: "Input tax credit cannot be claimed. Typically 18% of the invoice value, lost.",
  },
  TERMS_EXCEED_MSMED_LIMIT: {
    label: "Payment terms breach the MSMED Act",
    severity: "HIGH",
    meaning:
      "Section 15 of the MSMED Act 2006 caps payment to a registered micro or small enterprise at 45 days.",
    cost: "Compound interest at three times the RBI bank rate under s.16, plus MSEFC exposure.",
  },
  SIMILAR_INVOICE: {
    label: "Near-duplicate of an earlier invoice",
    severity: "HIGH",
    meaning:
      "Same vendor and identical amount within a 30-day window, under a different invoice number.",
    cost: "Duplicate payment. The most expensive routine error in accounts payable.",
  },
  FUTURE_DATED: {
    label: "Invoice is dated in the future",
    severity: "MEDIUM",
    meaning: "The invoice date is later than today.",
    cost: "Period misstatement, or a mis-keyed date corrupting the ageing report.",
  },
  VALUE_OUTLIER: {
    label: "Far above this vendor's normal invoice",
    severity: "MEDIUM",
    meaning:
      "Materially larger than this vendor's historical distribution.",
    cost: "Could be a legitimate bulk order or a misplaced decimal. Needs a human.",
  },
  ROUND_AMOUNT: {
    label: "Suspiciously round amount",
    severity: "LOW",
    meaning:
      "Lands exactly on a round figure. Real invoices are quantity times unit price and rarely do.",
    cost: "Weak signal on its own; meaningful in combination with others.",
  },
  DUE_BEFORE_INVOICE: {
    label: "Due date precedes the invoice date",
    severity: "MEDIUM",
    meaning: "Chronologically impossible.",
    cost: "Corrupts ageing buckets and every forecast built on them.",
  },
  NO_VENDOR_HISTORY: {
    label: "No prior invoices from this vendor",
    severity: "LOW",
    meaning: "Nothing to compare against yet.",
    cost: "Not a defect. Recorded so the absence of a baseline is explicit.",
  },
};
