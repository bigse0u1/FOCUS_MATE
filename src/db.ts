import Dexie, { Table } from "dexie";

export type FMState = 'focus'|'transition'|'distract'|'fatigue'|'drowsy';

export interface FrameRec {
  ts: number;
  state: FMState;
  focusScore: number;
}

export interface SessionRec {
  id: string;
  startedAt: number;
  endedAt: number;
  summary: {
    avgFocus: number;
    totalFocusMin: number;
    drowsyMin: number;
    distractMin: number;
  };
}

export class FMDB extends Dexie {
  frames!: Table<FrameRec, number>;
  sessions!: Table<SessionRec, string>;
  constructor(){
    super("focusmate-db");
    this.version(1).stores({
      frames: 'ts',
      sessions: 'id'
    });
  }
}
export const db = new FMDB();
