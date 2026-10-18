// The account an AI call is made for (D-145 cost log): set once per authenticated request, and
// inherited by the background work it starts (set writers, notes, the question bank).
import { AsyncLocalStorage } from "node:async_hooks";

export const aiOwner = new AsyncLocalStorage<string>();
