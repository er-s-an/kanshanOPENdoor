/**
 * Structural commit channel shared by the optional gameplay modules that
 * commit facts (dialogue effects, objective progress). Declared structurally
 * so a module can be driven by the host's ctx.commit, a bare core CommitLog,
 * or a test double — no imports required.
 */

export interface CommitReceiptLike {
  status: 'committed' | 'duplicate';
}

export interface CommitChannel {
  commit(name: string, payload: unknown, eventId: string): CommitReceiptLike;
}
