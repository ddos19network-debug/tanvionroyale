/** Error thrown by a free-play engine for invalid player actions. */
export class PlayerActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlayerActionError';
  }
}