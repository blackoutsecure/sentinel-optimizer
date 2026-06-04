import { useRef, useState } from "react";
import type { NormalizedResult } from "@engine/schema/normalization.js";
import {
  parseSentinel,
  parseSplunk,
  parseElastic,
  parseGeneric,
} from "@engine/parsers/index.js";
import type { ExportProvenance } from "../lib/exporters.js";
import { VENDORS, type Vendor, type VendorMeta } from "../lib/examples.js";
import { requestAiExample } from "../lib/aiClient.js";

interface Props {
  vendor: Vendor;
  onVendorChange: (v: Vendor) => void;
  onParsed: (result: NormalizedResult, vendorLabel: string, provenance: ExportProvenance) => void;
}

/** Wrap a bare array of rows into the envelope a bespoke parser expects. */
function envelope(json: unknown, key: string): Record<string, unknown> {
  if (Array.isArray(json)) return { [key]: json };
  return json as Record<string, unknown>;
}

function parseFor(meta: VendorMeta, raw: string): NormalizedResult {
  const json = JSON.parse(raw) as unknown;
  switch (meta.parser) {
    case "sentinel":
      return parseSentinel(envelope(json, "usage") as Parameters<typeof parseSentinel>[0]);
    case "splunk":
      return parseSplunk(envelope(json, "results") as Parameters<typeof parseSplunk>[0]);
    case "elastic":
      return parseElastic(envelope(json, "indices") as Parameters<typeof parseElastic>[0]);
    case "generic":
      return parseGeneric(json as Parameters<typeof parseGeneric>[0], {
        vendor: meta.id,
        avgEventBytes: meta.avgEventBytes,
      });
  }
}

export default function DataInput({ vendor, onVendorChange, onParsed }: Props) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const meta = VENDORS.find((v) => v.id === vendor)!;

  function analyze(raw: string) {
    setError(null);
    const trimmed = raw.trim();
    if (!trimmed) {
      setError("Paste your exported query results, or load an example.");
      return;
    }
    try {
      const result = parseFor(meta, trimmed);
      if (!result.sources.length) {
        setError("Parsed successfully, but found no data sources. Check the export format.");
        return;
      }
      onParsed(result, meta.label, {
        mode: "query-export",
        vendorId: meta.id,
        queryLanguage: meta.queryLang,
        queryText: meta.query,
        rawInputText: trimmed,
        ...(typeof meta.avgEventBytes === "number" ? { avgEventBytes: meta.avgEventBytes } : {}),
      });
    } catch (e) {
      setError(`Couldn't parse that as ${meta.label} JSON: ${(e as Error).message}`);
    }
  }

  async function generateExample() {
    setError(null);
    setNotice(null);
    setGenerating(true);
    try {
      const text = await requestAiExample({
        vendor: meta.id,
        label: meta.label,
        schemaHint: meta.hint,
        template: meta.example,
      });
      setText(text);
      setNotice(`Generated a sample ${meta.label} export with AI. Review, then Analyze.`);
    } catch (e) {
      // Graceful fallback: AI off or unreachable — drop in the built-in example.
      setText(meta.example);
      setNotice(`${(e as Error).message} Loaded the built-in ${meta.label} example instead.`);
    } finally {
      setGenerating(false);
    }
  }

  async function copyQuery() {
    try {
      await navigator.clipboard.writeText(meta.query);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Couldn't access the clipboard — select the query text and copy manually.");
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result ?? "");
      setText(content);
      analyze(content);
    };
    reader.onerror = () => setError("Could not read that file.");
    reader.readAsText(file);
    e.target.value = "";
  }

  return (
    <div className="stack">
      <div className="field">
        <label>SIEM / data source</label>
        <div className="segmented segmented-wrap" role="tablist" aria-label="Source SIEM">
          {VENDORS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={v.id === vendor}
              className={v.id === vendor ? "active" : ""}
              onClick={() => {
                onVendorChange(v.id);
                setError(null);
                setCopied(false);
                setNotice(null);
              }}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <div className="query-head">
          <label htmlFor="query">
            <span className="step-pill">A</span> Run this in {meta.label}
            <span className="query-lang">{meta.queryLang}</span>
          </label>
          <button type="button" className="btn btn-secondary btn-sm" onClick={copyQuery}>
            {copied ? "Copied ✓" : "Copy query"}
          </button>
        </div>
        <pre id="query" className="code-block" aria-label={`${meta.label} query`}>
          <code>{meta.query}</code>
        </pre>
      </div>

      <div className="field">
        <label htmlFor="paste">
          <span className="step-pill">B</span> Paste the JSON results
        </label>
        <p className="ai-note">{meta.hint}</p>
        <textarea
          id="paste"
          spellCheck={false}
          rows={10}
          value={text}
          placeholder={`Paste ${meta.label} export here…`}
          onChange={(e) => setText(e.target.value)}
        />
      </div>

      {error && <div className="error-box">{error}</div>}
      {notice && !error && <p className="ai-note">{notice}</p>}

      <div className="row">
        <button type="button" className="btn btn-primary" onClick={() => analyze(text)}>
          Analyze
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
          Upload file…
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={generateExample}
          disabled={generating}
        >
          {generating ? "Generating…" : "Generate example with AI"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json,text/plain"
          hidden
          onChange={onFile}
        />
      </div>
      <p className="ai-note">
        Your pasted data is parsed entirely in your browser and never uploaded.
      </p>
    </div>
  );
}
