import type { VitaEvent } from "@vita/shared";

type Subscriber = (event: VitaEvent) => void;
export class EventHub {
  readonly #subscribers = new Set<Subscriber>();
  publish(event: VitaEvent): void {
    for (const subscriber of this.#subscribers) {
      try {
        subscriber(event);
      } catch {
        /* A disconnected client cannot fail a job. */
      }
    }
  }
  subscribe(subscriber: Subscriber): () => void {
    this.#subscribers.add(subscriber);
    return () => {
      this.#subscribers.delete(subscriber);
    };
  }
}
