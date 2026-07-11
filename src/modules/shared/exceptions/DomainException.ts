export class DomainException extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class EntityNotFoundException extends DomainException {}

export class EntityConflictException extends DomainException {}

export class BusinessRuleException extends DomainException {}

export class UnauthorizedAccessException extends DomainException {}

export class ExternalServiceException extends DomainException {}
