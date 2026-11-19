/**
 * Comments on an issue or epic (GitLab notes), as the browser sees them. Loaded on demand for one
 * item at a time (the board's item list doesn't carry them). System notes ("changed the status")
 * are left out: these are only what people wrote.
 *
 * `body` is GitLab's raw Markdown, shown as plain text (never as HTML), like descriptions.
 */
export interface CommentAuthor {
	id: string;
	name: string;
	username: string;
}

export interface Comment {
	/** gid://gitlab/Note/<n> */
	id: string;
	author: CommentAuthor | null;
	body: string;
	createdAt: string;
	/** An internal note: only project members with at least Reporter access see it in GitLab */
	internal: boolean;
}

/** A GitLab discussion: the first comment and its replies, oldest first. */
export interface CommentThread {
	/** gid://gitlab/Discussion/<hex>: replies go to this id */
	id: string;
	comments: Comment[];
}

/** GitLab allows ~1 MB per note; the board takes comments up to this size. */
export const COMMENT_MAX = 20_000;
