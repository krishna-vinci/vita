import type { VitaEvent } from "@vita/shared";

type Subscriber = (event: VitaEvent) => void;
export class EventHub {
  readonly #subscribers = new Set<Subscriber>();
  readonly #closeSubscribers = new Set<() => void>();
  get subscriberCount(): number {
    return this.#subscribers.size;
  }
  onClose(subscriber: () => void): () => void {
    this.#closeSubscribers.add(subscriber);
    return () => {
      this.#closeSubscribers.delete(subscriber);
    };
  }
  closeStreams(): void {
    for (const subscriber of this.#closeSubscribers) subscriber();
    this.#closeSubscribers.clear();
  }
  close(): void {
    this.closeStreams();
    this.#subscribers.clear();
  }
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
