// Allocate one bill payment across outstanding charges, preserving saved receipts.
export function billSettlements(rows: any[], discountPaise: number, amountPaise: number, method: string, reference: string) {
  let discount = discountPaise, amount = amountPaise;
  let balance = rows.reduce((sum, row) => sum + row.net - row.paid, 0);
  if (![discount, amount].every(Number.isSafeInteger) || discount < 0 || amount < 0 || discount + amount > balance) throw new Error('Discount or payment exceeds the outstanding bill balance.');
  return rows.flatMap(row => {
    const due = row.net - row.paid;
    const share = balance ? Number(BigInt(discount) * BigInt(due) / BigInt(balance)) : 0;
    discount -= share; balance -= due;
    const collected = Math.min(amount, due - share);
    amount -= collected;
    return row.kind !== 'saved' || share || collected ? [{ ...row.target, discountPaise: share, amountPaise: collected, method, reference }] : [];
  });
}
