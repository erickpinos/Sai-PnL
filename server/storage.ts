// Storage interface for Sai Perps Tracker
// Currently using in-memory caching for API responses

export interface IStorage {
  // Cache for trade data - could be extended for persistence
}

export class MemStorage implements IStorage {
  constructor() {
    // Initialize storage
  }
}

export const storage = new MemStorage();
