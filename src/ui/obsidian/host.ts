import { setIcon } from 'obsidian'
import type { Host } from '../components/host'

/** Draws icons with Obsidian's own helper. */
export const obsidianHost: Host = { icon: setIcon }
