// Allocate one bill payment across outstanding charges, preserving saved receipts.
export function billSettlements(rows: any[], discountPaise: number, amountPaise: number, method: string, reference: string, splits?: { amountPaise: number; method: string; reference: string }[]) {
  let discount = discountPaise, amount = amountPaise;
  let balance = rows.reduce((sum, row) => sum + row.net - row.paid, 0);
  if (![discount, amount].every(Number.isSafeInteger) || discount < 0 || amount < 0 || discount + amount > balance) throw new Error('Discount or payment exceeds the outstanding bill balance.');
  if (splits && (splits.some(p => !Number.isSafeInteger(p.amountPaise) || p.amountPaise <= 0) || splits.reduce((n, p) => n + p.amountPaise, 0) !== amountPaise)) throw new Error('Payment method amounts must equal the total paid amount.');
  const parts = splits?.map(p => ({ ...p }));
  return rows.flatMap(row => {
    const due = row.net - row.paid;
    const share = balance ? Number(BigInt(discount) * BigInt(due) / BigInt(balance)) : 0;
    discount -= share; balance -= due;
    const collected = Math.min(amount, due - share);
    amount -= collected;
    let left = collected;
    const rowSplits = parts?.flatMap(part => { const take = Math.min(left, part.amountPaise); left -= take; part.amountPaise -= take; return take ? [{ ...part, amountPaise: take }] : []; });
    return row.kind !== 'saved' || share || collected ? [{ ...row.target, discountPaise: share, amountPaise: collected, method, reference, ...(rowSplits ? { splits: rowSplits } : {}) }] : [];
  });
}
