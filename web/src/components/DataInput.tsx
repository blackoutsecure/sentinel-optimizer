import { useRef, useState } from "react";
import type { NormalizedResult } from "@engine/schema/normalization.js";
import { parseSentinel, parseSplunk, parseElastic } from "@engine/parsers/index.js";
import { VENDORS, type Vendor } from "../lib/examples.js";

interface Props {
  vendor: Vendor;
  onVendorChange: (v: Vendor) => void;
  onParsed: (result: NormalizedResult, vendorLabel: string) => void;
}

function parseFor(vendor: Vendor, raw: string): NormalizedResult {
  const json = JSON.parse(raw) as unknown;
  switch (vendor) {
    case "sentinel":
      return parseSentinel(json as Parameters<typeof parseSentinel>[0]);
    case "splunk":
      return parseSplunk(json as Parameters<typeof parseSplunk>[0]);
    case "elastic":
      return parseElastic(json as Parameters<typeof parseElastic>[0]);
  }
}

export default function DataInput({ vendor, onVendorChange, onParsed }: Props) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
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
      const result = parseFor(vendor, trimmed);
      if (!result.sources.length) {
        setError("Parsed successfully, but found no data sources. Check the export format.");
        return;
      }
      onParsed(result, meta.label);
    } catch (e) {
      setError(`Couldn't parse that as ${meta.label} JSON: ${(e as Error).message}`);
    }
  }

  function loadExample() {
    setText(meta.example);
    setError(null);
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
        <label htmlFor="vendor">SIEM / data source</label>
        <div className="segmented" role="tablist" aria-label="Source SIEM">
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
              }}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="paste">Paste query results (JSON)</label>
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

      <div className="row">
        <button type="button" className="btn btn-primary" onClick={() => analyze(text)}>
          Analyze
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
          Upload file…
        </button>
        <button type="button" className="btn btn-ghost" onClick={loadExample}>
          Load example
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
