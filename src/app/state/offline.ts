/**
 * What the shell shows about the queue.
 *
 * Deliberately a store of *facts* rather than of sentences: the sync engine
 * publishes counts and the browser's opinion, and the indicator turns them into
 * words. A screen that formatted its own message from a different source would
 * be a second opinion about whether the shop is connected.
 */

import { Store } from './store'

export interface OfflineUiStatus {
  /** The browser's flag. A hint — the queue's own results are the truth. */
  online: boolean
  /** Sales taken and not yet accepted by the server. */
  pending: number
  /** Writes the server refused: somebody has to decide about these. */
  failed: number
  syncing: boolean
  lastSyncedAt: number | null
  lastError: string | null
  /** False when storage could not survive a reload (private mode). */
  persistent: boolean
}

export const offlineStatus = new Store<OfflineUiStatus>({
  online: true,
  pending: 0,
  failed: 0,
  syncing: false,
  lastSyncedAt: null,
  lastError: null,
  persistent: true,
})
