export type Side = "BUY" | "SELL";
export interface BotWallet {
  id: string;
  cash: number;
  inventory: number;
  reservedCash: number;
  reservedInventory: number;
}
export interface Order {
  id: number;
  ownerId: string;
  side: Side;
  price: number;
  remaining: number;
  expiresAt: number;
}
export interface Execution {
  sequence: number;
  time: number;
  price: number;
  quantity: number;
  makerId: string;
  takerId: string;
  side: Side;
}
export interface OrderInput {
  ownerId: string;
  side: Side;
  price: number;
  quantity: number;
  expiresAt: number;
  immediateOrCancel?: boolean;
}

export interface BookCheckpoint {
  version: 1;
  wallets: BotWallet[];
  orders: Order[];
  counter: number;
  time: number;
  sequence: number;
}

const positiveInteger = (n: number) => Number.isSafeInteger(n) && n > 0;

/** Integer ticks × integer lots are the underlying's funding units, NOT INR. */
export class OrderBook {
  private wallets = new Map<string, BotWallet>();
  private orders = new Map<number, Order>();
  private counter = 0;
  private time = 0;
  sequence = 0;

  checkpoint(): BookCheckpoint {
    return { version: 1, wallets: [...this.wallets.values()].map(w => ({...w})),
      orders: this.openOrders(), counter: this.counter, time: this.time, sequence: this.sequence };
  }

  static restore(state: BookCheckpoint): OrderBook {
    const nonnegative = (n: number) => Number.isSafeInteger(n) && n >= 0;
    if(state.version !== 1 || !nonnegative(state.counter) || !nonnegative(state.time)
      || !nonnegative(state.sequence) || !Array.isArray(state.wallets) || !Array.isArray(state.orders)) throw new Error("Invalid book checkpoint");
    const book = new OrderBook();
    for(const w of state.wallets) {
      if(!w.id || book.wallets.has(w.id) || ![w.cash,w.inventory,w.reservedCash,w.reservedInventory].every(nonnegative)
        || w.reservedCash>w.cash || w.reservedInventory>w.inventory) throw new Error("Invalid checkpoint wallet");
      book.wallets.set(w.id,{...w});
    }
    const reserved = new Map(state.wallets.map(w => [w.id,{cash:0,inventory:0}]));
    for(const o of state.orders) {
      const r=reserved.get(o.ownerId);
      if(!r || !positiveInteger(o.id) || o.id>state.counter || book.orders.has(o.id)
        || !positiveInteger(o.price) || !positiveInteger(o.remaining) || !Number.isSafeInteger(o.price*o.remaining)
        || !Number.isSafeInteger(o.expiresAt) || o.expiresAt<=state.time || !["BUY","SELL"].includes(o.side)) throw new Error("Invalid checkpoint order");
      if(o.side === "BUY")r.cash+=o.price*o.remaining;else r.inventory+=o.remaining;
      book.orders.set(o.id,{...o});
    }
    for(const w of state.wallets) {
      const r=reserved.get(w.id)!;
      if(r.cash!==w.reservedCash || r.inventory!==w.reservedInventory) throw new Error("Checkpoint reservations do not reconcile");
    }
    book.counter=state.counter;book.time=state.time;book.sequence=state.sequence;
    return book;
  }

  register(id: string, cash: number, inventory: number): void {
    if (!id || this.wallets.has(id) || !positiveInteger(cash) || !positiveInteger(inventory)) {
      throw new Error("Invalid or duplicate bot wallet");
    }
    this.wallets.set(id, { id, cash, inventory, reservedCash: 0, reservedInventory: 0 });
  }

  wallet(id: string): BotWallet {
    const wallet = this.wallets.get(id);
    if (!wallet) throw new Error("Unknown bot");
    return { ...wallet };
  }

  private at(time: number): void {
    if (!Number.isSafeInteger(time) || time < this.time) throw new Error("Market time must be monotonic");
    this.time = time;
  }

  private release(order: Order): void {
    const wallet = this.wallets.get(order.ownerId)!;
    if (order.side === "BUY") wallet.reservedCash -= order.price * order.remaining;
    else wallet.reservedInventory -= order.remaining;
  }

  cancel(id: number, ownerId: string, time: number): boolean {
    this.at(time);
    const order = this.orders.get(id);
    if (!order || order.ownerId !== ownerId) return false;
    this.release(order);
    this.orders.delete(id);
    this.sequence++;
    return true;
  }

  cancelOwner(ownerId: string, time: number): void {
    for (const order of this.openOrders()) if (order.ownerId === ownerId) this.cancel(order.id, ownerId, time);
  }

  expire(time: number): void {
    this.at(time);
    for (const order of this.openOrders()) {
      if (order.expiresAt <= time) this.cancel(order.id, order.ownerId, time);
    }
  }

  submit(input: OrderInput, time: number): Execution[] {
    if (!positiveInteger(input.price) || !positiveInteger(input.quantity) || !Number.isSafeInteger(input.price * input.quantity)
      || !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= time || !["BUY", "SELL"].includes(input.side)) {
      throw new Error("Invalid order");
    }
    this.expire(time);
    const wallet = this.wallets.get(input.ownerId);
    if (!wallet) throw new Error("Unknown bot");
    if (input.side === "BUY" ? wallet.cash - wallet.reservedCash < input.price * input.quantity
      : wallet.inventory - wallet.reservedInventory < input.quantity) throw new Error("Insufficient bot funds");
    const incoming: Order = { id: ++this.counter, ownerId: input.ownerId, side: input.side, price: input.price, remaining: input.quantity, expiresAt: input.expiresAt };
    this.sequence++;
    if (incoming.side === "BUY") wallet.reservedCash += incoming.price * incoming.remaining;
    else wallet.reservedInventory += incoming.remaining;
    const fills: Execution[] = [];
    const opposing = [...this.orders.values()].filter(order => order.side !== incoming.side)
      .sort((a, b) => (incoming.side === "BUY" ? a.price - b.price : b.price - a.price) || a.id - b.id);
    for (const maker of opposing) {
      if (!incoming.remaining || (incoming.side === "BUY" ? maker.price > incoming.price : maker.price < incoming.price)) break;
      // Cancel the remaining taker quantity instead of trading with itself.
      if (maker.ownerId === incoming.ownerId) break;
      const quantity = Math.min(incoming.remaining, maker.remaining);
      const other = this.wallets.get(maker.ownerId)!;
      const buyer = incoming.side === "BUY" ? wallet : other;
      const seller = incoming.side === "SELL" ? wallet : other;
      buyer.cash -= maker.price * quantity;
      buyer.inventory += quantity;
      seller.cash += maker.price * quantity;
      seller.inventory -= quantity;
      if (incoming.side === "BUY") { wallet.reservedCash -= incoming.price * quantity; other.reservedInventory -= quantity; }
      else { wallet.reservedInventory -= quantity; other.reservedCash -= maker.price * quantity; }
      incoming.remaining -= quantity;
      maker.remaining -= quantity;
      fills.push({ sequence: ++this.sequence, time, price: maker.price, quantity, makerId: maker.ownerId, takerId: incoming.ownerId, side: incoming.side });
      if (!maker.remaining) this.orders.delete(maker.id);
    }
    const best = opposing.find(order => order.remaining > 0);
    const selfBlocked = best?.ownerId === incoming.ownerId && (incoming.side === "BUY" ? best.price <= incoming.price : best.price >= incoming.price);
    if (incoming.remaining && !input.immediateOrCancel && !selfBlocked) this.orders.set(incoming.id, incoming);
    else this.release(incoming);
    return fills;
  }

  openOrders(): Order[] { return [...this.orders.values()].map(order => ({ ...order })); }

  depth(side: Side, count = 10): { price: number; quantity: number; orders: number }[] {
    const levels = new Map<number, { price: number; quantity: number; orders: number }>();
    for (const order of this.orders.values()) {
      if (order.side !== side) continue;
      const level = levels.get(order.price) ?? { price: order.price, quantity: 0, orders: 0 };
      level.quantity += order.remaining;
      level.orders++;
      levels.set(order.price, level);
    }
    return [...levels.values()].sort((a, b) => side === "BUY" ? b.price - a.price : a.price - b.price).slice(0, count);
  }
}
