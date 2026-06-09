export interface DomainEvent<TType extends string = string, TData = unknown> {
  eventType: TType;
  occurredAt: string;
  data: TData;
}

export interface IMessagePublisher {
  publish<E extends DomainEvent>(event: E): Promise<void>;
}

export const MESSAGE_PUBLISHER = Symbol('MESSAGE_PUBLISHER');
