export class VideoCancelledError extends Error {
  constructor(message = 'Pemrosesan video dibatalkan oleh pengguna.') {
    super(message);
    this.name = 'VideoCancelledError';
  }
}
