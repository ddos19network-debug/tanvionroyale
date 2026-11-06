import { createSlotEngine } from './slot-generic.engine';

// Games #4 to #13 have been migrated to the server-authoritative slots/ module.
const configs: any[] = [];

export const SLOT_ENGINES = configs.map(createSlotEngine);
