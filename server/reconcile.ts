import { createHmac } from 'node:crypto';
import { db, assert } from './core.js';
import { processWebhook } from './platform.js';

// Fetch only server-owned pending orders. No provider order ID is accepted from the browser.
export async function reconcilePayments(invoiceId?: string, fetcher: typeof fetch = fetch) {
  assert(
    process.env.RAZORPAY_KEY_ID &&
      process.env.RAZORPAY_KEY_SECRET &&
      process.env.RAZORPAY_WEBHOOK_SECRET,
    503,
    'Configure Razorpay credentials and webhook secret before reconciliation.',
  );
  const invoices = await db.subscriptionInvoice.findMany({
    where: {
      ...(invoiceId ? { id: invoiceId } : {}),
      status: { in: ['PENDING', 'FAILED'] },
      providerOrderId: { startsWith: 'order_' },
    },
    orderBy: { createdAt: 'asc' },
    take: 5,
  });
  let settled = 0;
  const failures: string[] = [];
  for (const invoice of invoices) {
    try {
      const response = await fetcher(
        `https://api.razorpay.com/v1/orders/${encodeURIComponent(invoice.providerOrderId!)}/payments`,
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64')}`,
          },
          signal: AbortSignal.timeout(8000),
        },
      );
      assert(response.ok, 502, 'Provider reconciliation request failed.');
      const collection: any = await response.json();
      assert(Array.isArray(collection.items), 502, 'Unexpected provider payment collection.');
      for (const payment of collection.items.filter((p: any) => p.status === 'captured')) {
        assert(
          payment.order_id === invoice.providerOrderId,
          502,
          'Provider returned an unrelated order.',
        );
        const raw = Buffer.from(
          JSON.stringify({
            event: 'payment.captured',
            source: 'provider-reconciliation',
            payload: { payment: { entity: payment } },
          }),
        );
        const signature = createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET!)
          .update(raw)
          .digest('hex');
        await processWebhook(raw, signature, `reconciliation:${payment.id}`);
        settled++;
      }
    } catch {
      failures.push(invoice.id);
    }
  }
  return { scanned: invoices.length, settled, failedInvoiceIds: failures };
}
