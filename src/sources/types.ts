/** One hackathon announcement, in the shape every source is reduced to. */
export interface Announcement {
  /** Stable across runs: `<source>:<id the source itself uses>`. */
  id: string;
  /** Name of the source it came from, for the post footer and the logs. */
  source: string;
  title: string;
  url: string;
  /** ISO 8601, when the source gives real dates. */
  startsAt: string | null;
  endsAt: string | null;
  /** The source's own wording of the dates, when it gives no ISO dates. */
  dateText: string | null;
  location: string | null;
  /** ISO 3166-1 alpha-2, when the source states it. */
  country: string | null;
  online: boolean;
  organizer: string | null;
  /** Registrations, where the source reports them. */
  popularity: number | null;
  prize: string | null;
  themes: string[];
  /** Came from a listing that is itself about the configured region. */
  assumeRegion: boolean;
  /** Listed by a source that vets its events, so it counts as popular without a number. */
  curated: boolean;
}

export interface SourceContext {
  /** GETs a page or an API response as text; throws on a non-2xx answer. */
  fetchText(url: string, accept?: string): Promise<string>;
  now(): number;
}

export interface Source {
  readonly name: string;
  fetch(context: SourceContext): Promise<Announcement[]>;
}
