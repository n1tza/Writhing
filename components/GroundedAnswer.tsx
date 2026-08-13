"use client";

export interface GroundedEvidence {
  id: string;
  sourceId: string;
  text: string;
  sectionTitle: string | null;
  pageStart: number | null;
}

export interface GroundedSegment {
  text: string;
  evidenceIds: string[];
}

export interface GroundedAnswerProps {
  segments: GroundedSegment[];
  evidence: GroundedEvidence[];
  evidenceSufficient: boolean;
  note?: string | null;
  onOpenSource: (sourceId: string, page: number) => void;
}

export default function GroundedAnswer({
  segments,
  evidence,
  evidenceSufficient,
  note,
  onOpenSource,
}: GroundedAnswerProps) {
  const evidenceMap = new Map(evidence.map((e) => [e.id, e]));

  return (
    <div className="text-sm leading-relaxed text-zinc-200">
      {!evidenceSufficient && (
        <p className="mb-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {note ?? "The uploaded sources don't cover this — nothing here is cited."}
        </p>
      )}

      <p>
        {segments.map((segment, i) => (
          <span key={i}>
            {i > 0 && " "}
            {segment.text}
            {segment.evidenceIds.map((id) => {
              const ev = evidenceMap.get(id);
              if (!ev) return null;
              return (
                <button
                  key={id}
                  type="button"
                  title={ev.text.replace(/\s+/g, " ").slice(0, 160)}
                  onClick={() => onOpenSource(ev.sourceId, ev.pageStart ?? 1)}
                  className="ml-0.5 align-super text-[10px] font-medium text-blue-300 underline decoration-dotted underline-offset-2 transition-colors hover:text-blue-200"
                >
                  [{ev.pageStart ?? "?"}]
                </button>
              );
            })}
          </span>
        ))}
      </p>

      {evidence.length > 0 && (
        <details className="mt-2 rounded-lg border border-[var(--border-subtle)] bg-white/[0.02]">
          <summary className="cursor-pointer px-3 py-1.5 text-[11px] text-zinc-500 hover:text-zinc-300">
            {evidence.length} passage{evidence.length === 1 ? "" : "s"} retrieved
          </summary>
          <div className="space-y-2 px-3 pb-2">
            {evidence.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => onOpenSource(e.sourceId, e.pageStart ?? 1)}
                className="block w-full text-left"
              >
                <span className="block text-[10px] uppercase tracking-wide text-zinc-600">
                  p.{e.pageStart ?? "?"} · {e.sectionTitle ?? "no section"}
                </span>
                <span className="block text-[11px] leading-snug text-zinc-400">
                  {e.text.replace(/\s+/g, " ").slice(0, 180)}…
                </span>
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
