// Generated independently with Python's decimal module (50 significant digits), seed 20261022:
// closed Price formula rounded half-up to the cent, each case cross-checked by a month-by-month
// amortization schedule. Cases whose exact value falls within 1e-6 cent of a tie were excluded.
// The exact value is kept in the comment for reference.
//
// [principalCents, monthlyRate, installments, expectedInstallmentCents]
export const PRICE_CASES: readonly (readonly [number, number, number, number])[] = [
  [45667200, 0.023, 84, 1232891], // exact 1232891.274769
  [19038811, 0.0138, 1, 19301547], // exact 19301546.591800
  [16262222, 0.0167, 18, 1053506], // exact 1053506.275104
  [246344, 0.0415, 72, 10801], // exact 10801.387767
  [8886227, 0.008, 18, 532046], // exact 532045.672807
  [13029014, 0.0207, 96, 313565], // exact 313564.561843
  [47163892, 0.0386, 84, 1899405], // exact 1899404.757440
  [7203735, 0.0428, 18, 582073], // exact 582072.925237
  [10135717, 0.031, 6, 1877234], // exact 1877234.057110
  [14579447, 0.0352, 60, 586826], // exact 586826.368270
  [391858, 0.0351, 6, 73563], // exact 73563.446668
  [24716476, 0.0122, 84, 471969], // exact 471969.353326
  [23384050, 0.0293, 1, 24069203], // exact 24069202.665000
  [4185156, 0.0125, 12, 377745], // exact 377745.117461
  [30747083, 0.0083, 6, 5274406], // exact 5274406.331677
  [37825717, 0.0164, 72, 899030], // exact 899030.260482
  [34520318, 0.022, 6, 6204429], // exact 6204428.548124
  [11974365, 0.0273, 84, 364882], // exact 364882.418745
  [27994591, 0.0095, 48, 728985], // exact 728984.869623
  [30709620, 0.0413, 1, 31977927], // exact 31977927.306000
];
