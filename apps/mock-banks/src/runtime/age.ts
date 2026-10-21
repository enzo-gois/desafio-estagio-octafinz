// Full years between an ISO date (YYYY-MM-DD) and a reference instant, on the UTC calendar.
export function ageOn(birthDate: string, reference: Date): number {
  const [year, month, day] = birthDate.split('-').map(Number) as [number, number, number];
  const refMonth = reference.getUTCMonth() + 1;
  const refDay = reference.getUTCDate();
  const hadBirthday = refMonth > month || (refMonth === month && refDay >= day);

  return reference.getUTCFullYear() - year - (hadBirthday ? 0 : 1);
}

export function addMonthsUtc(date: Date, months: number): Date {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}
