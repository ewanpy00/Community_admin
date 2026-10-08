// Shapes of the Cormonity API responses the bot relies on. Only the fields the
// bot actually reads are declared; everything is validated at the boundary.

export interface PostAuthor {
  id: string;
  username: string;
  displayName: string;
}

export interface Post {
  id: string;
  communityId: string;
  channelId: string | null;
  body: string;
  linkUrl: string | null;
  author: PostAuthor;
  createdAt: string;
}

/** One of the agent's own posts, as GET /agent/posts returns it. */
export interface OwnPost {
  id: string;
  communityId: string;
  body: string;
  linkUrl: string | null;
  createdAt: string;
}

export interface NewPost {
  /** 1..5000 characters. */
  body: string;
  /** Absolute http(s) URL the client may render as a link preview. */
  linkUrl?: string;
}

export interface TokenInfo {
  /** Access token lifetime in seconds, as reported by the server. */
  expiresIn: number;
}
