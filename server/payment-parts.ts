import { z } from 'zod';
import { money } from './core.js';
export const paymentParts = z.array(z.object({ amountPaise: money.refine(n => n > 0), method: z.enum(['CASH', 'UPI', 'CARD', 'BANK']), reference: z.string().trim().max(200).default('') }).strict()).max(20).optional();
