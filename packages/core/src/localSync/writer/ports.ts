// The ports a disk writer reaches the platform through: the file calls it makes, the replica it persists, the lock, visibility and change observer of the host.
import type { Replica } from "../replicaHub.js";

export interface FileStat { readonly lastModified: number; readonly size: number }

export interface WriterFiles { read(path: string): Promise<string>; stat(path: string): Promise<FileStat>; write(path: string, text: string): Promise<void> }

export type WriterReplica = Pick<Replica, "doc" | "text" | "replace">;

export interface WriterLock { request(name: string, onGranted: () => void): () => void }

export interface WriterVisibility { visible(): boolean; onVisible(listener: () => void): () => void }

export interface WriterObserver { observe(path: string, onChange: () => void): () => void }
