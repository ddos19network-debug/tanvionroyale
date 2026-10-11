/**
 * Tiny in-process event bus for crash engine → WebSocket fan-out.
 * The gateway subscribes to the room subject; the engine/service emit into it.
 * Using a bus avoids circular module dependencies between the engine and the
 * socket gateway.
 */

import { Injectable } from '@nestjs/common';
import { Subject, Subscription } from 'rxjs';

export interface CrashWsEvent {
  type: string;
  payload: Record<string, unknown> | null;
}

export const CRASH_ROOM = 'crash:sky-rocket';

@Injectable()
export class CrashEventBus {
  private readonly rooms = new Map<string, Subject<CrashWsEvent>>();

  private subject(room: string): Subject<CrashWsEvent> {
    let subject = this.rooms.get(room);
    if (!subject) {
      subject = new Subject<CrashWsEvent>();
      this.rooms.set(room, subject);
    }
    return subject;
  }

  emit(room: string, type: string, payload: Record<string, unknown> | null): void {
    this.subject(room).next({ type, payload });
  }

  subscribe(room: string, next: (event: CrashWsEvent) => void): Subscription {
    return this.subject(room).subscribe({ next });
  }
}