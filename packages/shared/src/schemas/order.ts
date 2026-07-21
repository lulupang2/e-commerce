// 이 스키마의 책임: Order/OrderItem 도메인 불변식 (수량>0, 금액 정합성, 빈 주문 방지)
import { z } from 'zod';

// ---- OrderItem -----------------------------------------------------------

export const OrderItemSchema = z
  .object({
    productId: z.number().int().positive('productId must be positive'),
    productName: z.string().min(1, 'productName must not be empty'),
    quantity: z.number().int().positive('quantity must be > 0'),
    unitPrice: z.number().min(0, 'unitPrice must be >= 0'),
    subtotal: z.number().min(0),
  })
  .superRefine((item, ctx) => {
    const expected = item.unitPrice * item.quantity;
    if (Math.abs(item.subtotal - expected) >= 0.01) {
      ctx.addIssue({
        code: 'custom',
        message: `subtotal ${item.subtotal} does not match unitPrice(${item.unitPrice}) × quantity(${item.quantity}) = ${expected}`,
        path: ['subtotal'],
      });
    }
  });

/** @see {@link OrderItemSchema} */
export type OrderItem = z.infer<typeof OrderItemSchema>;

// ---- Order ---------------------------------------------------------------

export const OrderStatus = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  SHIPPED: 'SHIPPED',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
} as const;

export const OrderSchema = z
  .object({
    id: z.number().int().positive().optional(),
    uuid: z.string().uuid(),
    customerEmail: z.string().email('customerEmail must be valid email'),
    status: z.enum(['PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED']),
    currency: z.string().regex(/^[A-Z]{3}$/, 'currency must be ISO 4217 (3 capital letters)'),
    totalAmount: z.number().min(0, 'totalAmount must be >= 0'),
    items: z.array(OrderItemSchema).min(1, 'order must have at least 1 item'),
    metadata: z.record(z.unknown()).default({}),
    createdAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime().optional(),
  })
  .superRefine((order, ctx) => {
    const itemsTotal = order.items.reduce((sum, i) => sum + i.subtotal, 0);
    if (Math.abs(order.totalAmount - itemsTotal) >= 0.01) {
      ctx.addIssue({
        code: 'custom',
        message: `totalAmount ${order.totalAmount} does not match sum of item subtotals ${itemsTotal}`,
        path: ['totalAmount'],
      });
    }
  });

/** @see {@link OrderSchema} */
export type Order = z.infer<typeof OrderSchema>;
