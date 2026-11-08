export type Confidence = "exact" | "component-only" | "none";

export interface SourceComponent {
  name: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface Selection {
  version: 1;
  id: string;
  createdAt: string;
  page: {
    url: string;
    title: string;
    viewport: { w: number; h: number };
    /** The route file that renders this page, e.g. app/account/page.tsx. `inferred` means a pattern guessed from the URL. */
    route?: { file: string; inferred: boolean };
  };
  element: {
    tag: string;
    selector: string;
    text: string;
    html: string;
    attributes: Record<string, string>;
    rect: { x: number; y: number; w: number; h: number };
    styles: Record<string, string>;
    ancestors: { tag: string; classes: string[] }[];
  };
  source: {
    /** Free-form so new stacks need no schema change: "react", "vue", "svelte", ... */
    framework: string;
    confidence: Confidence;
    components: SourceComponent[];
  };
  screenshot?: { mime: "image/png" | "image/jpeg"; base64: string; w: number; h: number };
  userNote?: string;
}

export interface StoredSet {
  selections: Selection[];
  receivedAt: string;
  ageMs: number;
  stale: boolean;
}
