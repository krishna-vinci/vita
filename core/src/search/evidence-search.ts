import { DatabaseSync } from "node:sqlite";
import type { ClaimIndex } from "../claims/index.js";
import type { Outline, OutlineBullet } from "../source/index.js";

interface SearchHit {
  kind: "claim" | "variant" | "evidence" | "outline";
  id: string;
  text: string;
  score: number;
}

export class EvidenceSearch {
  private closed = false;

  private constructor(private readonly db: DatabaseSync) {}

  static build(index: ClaimIndex, outline: Outline): EvidenceSearch {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`CREATE VIRTUAL TABLE content USING fts5(
        kind UNINDEXED, id UNINDEXED, text, tokenize = 'porter unicode61'
      )`);
      const insert = db.prepare("INSERT INTO content(kind, id, text) VALUES (?, ?, ?)");
      const add = (kind: SearchHit["kind"], id: string, text: string) => {
        if (text.trim()) insert.run(kind, id, text);
      };
      const evidenceRows = new Set<string>();
      const addEvidence = (id: string, text: string | undefined) => {
        if (text === undefined) return;
        const key = JSON.stringify([id, text]);
        if (evidenceRows.has(key)) return;
        evidenceRows.add(key);
        add("evidence", id, text);
      };
      db.exec("BEGIN");
      for (const claim of index.claims.values()) {
        add("claim", claim.id, claim.text);
        for (const evidence of claim.evidence) addEvidence(evidence.id, evidence.text);
      }
      for (const variant of index.variants.values()) add("variant", variant.id, variant.text);
      for (const item of index.items.values()) {
        for (const evidence of item.meta.evidence) addEvidence(evidence.id, evidence.text);
      }
      const addBullet = (bullet: OutlineBullet) => {
        add("outline", bullet.claimId ?? `outline:bullet:${bullet.line}`, bullet.text);
      };
      add("outline", "outline:preamble", outline.preamble.join("\n"));
      for (const section of outline.sections) {
        add("outline", `outline:body:${section.line}`, section.body.join("\n"));
        for (const bullet of section.bullets) addBullet(bullet);
        for (const entry of section.entries) {
          add("outline", `outline:body:${entry.line}`, entry.body.join("\n"));
          for (const bullet of entry.bullets) addBullet(bullet);
        }
      }
      db.exec("COMMIT");
      return new EvidenceSearch(db);
    } catch (error) {
      db.close();
      throw error;
    }
  }

  query(terms: string[], limit: number): SearchHit[] {
    if (this.closed) throw new Error("EvidenceSearch is closed");
    const phrases = [...new Set(terms.map((term) => term.trim()).filter(Boolean))];
    if (phrases.length === 0 || limit <= 0) return [];
    const match = phrases.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
    return this.db
      .prepare(`SELECT kind, id, text, -bm25(content) AS score FROM content
        WHERE content MATCH ? ORDER BY score DESC, id ASC, kind ASC, text ASC LIMIT ?`)
      .all(match, limit) as unknown as SearchHit[];
  }

  close(): void {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }
}
